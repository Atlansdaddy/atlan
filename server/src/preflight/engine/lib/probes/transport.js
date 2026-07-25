// src/lib/probes/transport.js
//
// Transport-layer security probes: missing headers, CORS, SSRF / open redirect.
//
// Extracted from the prior builtin.js monolith when it crossed the
// file-size HIGH threshold. Probe bodies are byte-identical to the
// originals; only the location moved. Public import surface is
// preserved by builtin.js, which is now a back-compat shim re-exporting
// every probe function from its new family file.

import { isTestFile, isScannerSelfSource } from '../file-filter.js';

// Parse a Cloudflare Pages / Netlify `_headers` file for the set of header names
// it configures. Format: indented `Header-Name: value` lines under a path
// pattern (`/*`, `/admin/*`, etc.). Returns a lowercased Set.
function parseHeadersFileNames(content) {
  const headers = new Set();
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^[ \t]+([A-Za-z][A-Za-z0-9-]*)\s*:/);
    if (m) headers.add(m[1].toLowerCase());
  }
  return headers;
}

// Parse vercel.json `headers` array for header names across all path blocks.
function parseVercelHeaderNames(content) {
  const headers = new Set();
  try {
    const cfg = JSON.parse(content);
    const blocks = Array.isArray(cfg.headers) ? cfg.headers : [];
    for (const block of blocks) {
      const list = Array.isArray(block.headers) ? block.headers : [];
      for (const h of list) {
        if (h && typeof h.key === 'string') headers.add(h.key.toLowerCase());
      }
    }
  } catch {
    /* malformed JSON: caller treats as no headers configured */
  }
  return headers;
}

// Parse firebase.json hosting.headers for header names.
function parseFirebaseHeaderNames(content) {
  const headers = new Set();
  try {
    const cfg = JSON.parse(content);
    const blocks = Array.isArray(cfg?.hosting?.headers) ? cfg.hosting.headers : [];
    for (const block of blocks) {
      const list = Array.isArray(block.headers) ? block.headers : [];
      for (const h of list) {
        if (h && typeof h.key === 'string') headers.add(h.key.toLowerCase());
      }
    }
  } catch {
    /* malformed JSON: caller treats as no headers configured */
  }
  return headers;
}

// Minimal TOML parse for [[headers]] blocks: pulls header key names out of
// `[headers.values]` tables. Full TOML parser is overkill for this scope.
function parseNetlifyTomlHeaderNames(content) {
  const headers = new Set();
  // Match each [[headers]] block and the [headers.values] sub-table inside it.
  const re = /\[headers\.values\]([\s\S]*?)(?=\n\s*\[|$)/g;
  let m;
  while ((m = re.exec(content))) {
    for (const line of m[1].split(/\r?\n/)) {
      const km = line.match(/^\s*([A-Za-z][A-Za-z0-9-]*)\s*=/);
      if (km) headers.add(km[1].toLowerCase());
    }
  }
  return headers;
}

// FP-3 disambiguation: presence of any IaC template suggests headers may be
// configured at the host edge layer (CloudFront Response Headers Policy, etc.)
// where PreFlight can't statically see them. Downgrade severity rather than
// suppress entirely so the user still sees a reminder.
function hasInfraAsCode(files) {
  return files.some((f) =>
    /(\.tf|(^|\/)cdk\.json|(^|\/)template\.ya?ml|(^|\/)serverless\.ya?ml)$/.test(f.path)
  );
}

// FP-10 disambiguation: a reverse proxy in front of the app may inject headers
// outside PreFlight's static view.
function hasReverseProxy(files) {
  return files.some((f) =>
    /((^|\/)Caddyfile|(^|\/)nginx\.conf|(^|\/)traefik\.ya?ml)$/.test(f.path)
  );
}

// FP-8 disambiguation: a GitHub Pages target has no first-class header config
// mechanism; flagging "missing _headers" is misleading because the user can't
// fix it at the framework layer.
function isGitHubPagesOnly(files, hostsDetected) {
  if (hostsDetected.size > 1) return false;
  return files.some(
    (f) =>
      /\.github\/workflows\/.+\.ya?ml$/.test(f.path) &&
      /(actions\/deploy-pages|actions\/upload-pages-artifact|gh-pages)/.test(f.content)
  );
}

// FP-9 disambiguation: Next.js `output: 'export'` silently disables
// next.config.js `headers()`. The probe's positive signal becomes meaningless.
function isNextStaticExport(nextFile) {
  return /output\s*:\s*['"`]export['"`]/.test(nextFile.content);
}

// Cheap host classifier. Used only for the GitHub-Pages-only suppression today
// (FP-8); host-config-file detection drives the rest of the probe directly.
function classifyHosts(files) {
  const hosts = new Set();
  if (files.some((f) => /(^|\/)wrangler\.(toml|jsonc?)$/.test(f.path))) hosts.add('cloudflare');
  if (files.some((f) => /(^|\/)netlify\.toml$/.test(f.path))) hosts.add('netlify');
  if (files.some((f) => /(^|\/)vercel\.(json|ts)$/.test(f.path))) hosts.add('vercel');
  if (files.some((f) => /(^|\/)fly\.toml$/.test(f.path))) hosts.add('fly');
  if (files.some((f) => /(^|\/)render\.yaml$/.test(f.path))) hosts.add('render');
  if (files.some((f) => /(^|\/)railway\.(json|toml)$/.test(f.path))) hosts.add('railway');
  if (files.some((f) => /(^|\/)firebase\.json$/.test(f.path))) hosts.add('firebase');
  if (files.some((f) => /(^|\/)_headers$/.test(f.path))) hosts.add('static-headers');
  return hosts;
}

// Canonical security-header set for SAST-visible checking. Sourced from MDN's
// HTTP security headers reference. Per-header severity is calibrated to the
// real-world impact of each individual header missing in 2026:
//   CSP / HSTS    medium  (foundational defenses)
//   X-CTO         low     (older defense, still recommended)
//   Referrer      low     (privacy + small auth-token-in-URL leak risk)
//   Permissions   low     (least urgent on apps that don't use camera/mic/etc)
// Frame-ancestors is checked separately because either X-Frame-Options or a
// CSP with frame-ancestors directive satisfies it.
const CANONICAL_SECURITY_HEADERS = [
  { key: 'content-security-policy', label: 'Content-Security-Policy', baseSev: 'medium' },
  { key: 'strict-transport-security', label: 'Strict-Transport-Security', baseSev: 'medium' },
  { key: 'x-content-type-options', label: 'X-Content-Type-Options', baseSev: 'low' },
  { key: 'referrer-policy', label: 'Referrer-Policy', baseSev: 'low' },
  { key: 'permissions-policy', label: 'Permissions-Policy', baseSev: 'low' },
];

export function probeMissingHeaders(files) {
  const findings = [];

  // Stage 0: FP-8 — GitHub Pages target with no other host signal: suppress.
  const hostsDetected = classifyHosts(files);
  if (isGitHubPagesOnly(files, hostsDetected)) return findings;

  // Stage 1: collect statically-parseable host config sources and the union of
  // header names they configure. next.config.js is excluded from this set
  // because its `headers()` function is opaque to static analysis (returns at
  // runtime), so we treat it as an ambiguous-positive in Stage 3.
  const configured = new Set();
  const staticSources = [];
  const collect = (file, names) => {
    staticSources.push(file.path);
    for (const n of names) configured.add(n);
  };

  const headersFile = files.find((f) => /(^|\/)_headers$/.test(f.path));
  if (headersFile) collect(headersFile, parseHeadersFileNames(headersFile.content));

  const netlifyToml = files.find((f) => /(^|\/)netlify\.toml$/.test(f.path));
  if (netlifyToml) collect(netlifyToml, parseNetlifyTomlHeaderNames(netlifyToml.content));

  const vercelJson = files.find((f) => /(^|\/)vercel\.json$/.test(f.path));
  if (vercelJson) collect(vercelJson, parseVercelHeaderNames(vercelJson.content));

  const firebaseJson = files.find((f) => /(^|\/)firebase\.json$/.test(f.path));
  if (firebaseJson) collect(firebaseJson, parseFirebaseHeaderNames(firebaseJson.content));

  const next = files.find((f) => /(^|\/)next\.config\.(js|mjs|ts)$/.test(f.path));
  const nextConfigured =
    next && (/headers\s*\(/.test(next.content) || /securityHeaders/.test(next.content));
  const nextStaticExport = next ? isNextStaticExport(next) : false;

  // Stage 2: FP-9 — Next static-export with only next.config.js headers() is
  // effectively missing because Next silently drops headers() on static export.
  if (nextConfigured && nextStaticExport && staticSources.length === 0) {
    findings.push({
      id: `headers-next-static-export-${next.path}`,
      probe: 'Security Headers',
      title: 'next.config.js headers() ignored on static export',
      severity: 'medium',
      category: 'Misconfiguration',
      cwe: 'CWE-693',
      file: next.path,
      line: 1,
      evidence:
        'next.config has output: "export" and headers(), but Next.js does not apply headers() on static exports.',
      remediation: `Static-exported Next.js apps must configure headers at the host layer. Add the headers to public/_headers (Cloudflare Pages / Netlify), vercel.json's headers array, or firebase.json's hosting.headers. The headers() function in next.config will not run on a static export. Reference: https://nextjs.org/docs/app/api-reference/config/next-config-js/headers`,
    });
    return findings;
  }

  // Stage 3: Per-header coverage on statically-parseable host config.
  if (staticSources.length > 0) {
    const downgrade = hasInfraAsCode(files) || hasReverseProxy(files);
    const primarySource = staticSources[0];
    const allSources = staticSources.join(', ');

    for (const c of CANONICAL_SECURITY_HEADERS) {
      if (!configured.has(c.key)) {
        findings.push({
          id: `headers-missing-${c.key}-${primarySource}`,
          probe: 'Security Headers',
          title: `Missing ${c.label} header`,
          severity: downgrade ? 'info' : c.baseSev,
          category: 'Misconfiguration',
          cwe: 'CWE-693',
          file: primarySource,
          line: 1,
          evidence: `${c.label} is not set in ${allSources}.${downgrade ? ' Severity downgraded to info because IaC or a reverse proxy was detected, which may set headers outside this repo.' : ''}`,
          remediation: `Add ${c.label} to ${primarySource}. See MDN's reference: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/${c.label}. The security-headers Learn page has recommended values for each.`,
        });
      }
    }

    // Frame-ancestors: satisfied by X-Frame-Options OR a CSP that includes
    // `frame-ancestors`. Check the raw config contents for the directive.
    const hasXFO = configured.has('x-frame-options');
    const hasCspFrameAncestors =
      configured.has('content-security-policy') &&
      [headersFile, netlifyToml, vercelJson, firebaseJson]
        .filter(Boolean)
        .some((f) => /frame-ancestors/i.test(f.content));
    if (!hasXFO && !hasCspFrameAncestors) {
      findings.push({
        id: `headers-missing-frame-ancestors-${primarySource}`,
        probe: 'Security Headers',
        title: 'No clickjacking protection (X-Frame-Options or CSP frame-ancestors)',
        severity: downgrade ? 'info' : 'medium',
        category: 'Misconfiguration',
        cwe: 'CWE-1021',
        file: primarySource,
        line: 1,
        evidence: `Neither X-Frame-Options nor a Content-Security-Policy with a frame-ancestors directive is set in ${allSources}.`,
        remediation: `Add either X-Frame-Options: DENY (or SAMEORIGIN) to ${primarySource}, or include frame-ancestors 'none' (or 'self') in your Content-Security-Policy. CSP frame-ancestors supersedes X-Frame-Options in modern browsers; either is acceptable.`,
      });
    }
    return findings;
  }

  // Stage 4: No statically-parseable host config. If next.config.js declared a
  // headers() function, treat as opaque-positive and suppress (we cannot
  // inspect what it returns; legacy behavior preserved for compatibility).
  if (next && nextConfigured) return findings;

  // Stage 5: next.config.js exists but has no headers() — legacy single
  // finding preserved. Any other framework with no host config is silent here
  // to avoid false positives on architectures the probe doesn't yet model.
  if (next && !nextConfigured) {
    findings.push({
      id: `headers-${next.path}`,
      probe: 'Security Headers',
      title: 'No custom security headers configured in next.config',
      severity: 'medium',
      category: 'Misconfiguration',
      cwe: 'CWE-693',
      file: next.path,
      line: 1,
      evidence: 'No headers() function or securityHeaders array found',
      remediation: `Add a headers() function returning Content-Security-Policy, Strict-Transport-Security, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, and Referrer-Policy: strict-origin-when-cross-origin. These prevent XSS, clickjacking, and MIME sniffing attacks. If this is a static export (output: 'export'), configure headers at the host layer (public/_headers or vercel.json) instead.`,
    });
  }
  return findings;
}

export function probeCORS(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$|\.py$/.test(file.path)) return;
    const c = file.content;
    // Depth round 3: detect reflected-origin + credentials at file level. If
    // the file echoes req.headers.origin into the ACAO header AND sets
    // Allow-Credentials: true anywhere in the same file, it is the canonical
    // CORS auth-bypass shape. Emits a single high-severity finding for the
    // file (not per-line) to avoid double-emit with the wildcard rule.
    const echoesOrigin =
      /Access-Control-Allow-Origin['"`\s,:=]+(?:req|request)\.(?:headers|header)\s*\.?\s*\[?\s*['"]?origin['"]?\s*\]?/i.test(
        c
      ) ||
      /Access-Control-Allow-Origin['"`\s,:=]+(?:request|req)\.headers\.get\s*\(\s*['"]origin['"]/i.test(
        c
      );
    const allowsCredentials =
      /Access-Control-Allow-Credentials['"`\s,:=]+['"`]?true['"`]?/i.test(c) ||
      /credentials\s*:\s*true/.test(c);
    const corsOriginTrue = /\bcors\s*\(\s*\{[^}]*origin\s*:\s*true/i.test(c);
    const setsVaryOrigin = /Vary['"`\s,:=]+['"`]?Origin/i.test(c);
    // FastAPI CORSMiddleware allow_origins=["*"] + allow_credentials=True
    const fastapiBypass =
      /CORSMiddleware\([^)]*allow_origins\s*=\s*\[[^\]]*['"]\*['"][^\]]*\][\s\S]*?allow_credentials\s*=\s*True/i.test(
        c
      ) ||
      /CORSMiddleware\([^)]*allow_credentials\s*=\s*True[\s\S]*?allow_origins\s*=\s*\[[^\]]*['"]\*['"]/i.test(
        c
      );
    if ((echoesOrigin || corsOriginTrue) && allowsCredentials) {
      findings.push({
        id: `cors-credentialed-reflect-${file.path}`,
        probe: 'CORS Check',
        title:
          'CORS reflects request origin with Access-Control-Allow-Credentials: true (auth bypass)',
        severity: 'high',
        category: 'Misconfiguration',
        cwe: 'CWE-942',
        file: file.path,
        line: 1,
        evidence: 'Echoed Origin + Allow-Credentials true detected in same file',
        remediation:
          'Reflecting the request Origin while also enabling credentials lets any origin read authenticated responses. Pin to an allowlist instead, e.g. const ALLOWED = new Set([...]); if (ALLOWED.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin). Add Vary: Origin to caches.',
      });
    } else if (echoesOrigin && !setsVaryOrigin) {
      findings.push({
        id: `cors-reflect-no-vary-${file.path}`,
        probe: 'CORS Check',
        title: 'CORS echoes request origin without Vary: Origin',
        severity: 'low',
        category: 'Misconfiguration',
        cwe: 'CWE-942',
        file: file.path,
        line: 1,
        evidence: 'Reflected Origin header without companion Vary: Origin',
        remediation:
          'Without Vary: Origin, intermediate caches may serve a response keyed on the wrong origin. Add res.setHeader("Vary", "Origin") whenever the response is origin-scoped.',
      });
    }
    if (fastapiBypass) {
      findings.push({
        id: `cors-fastapi-bypass-${file.path}`,
        probe: 'CORS Check',
        title: 'FastAPI CORSMiddleware allow_origins=["*"] with allow_credentials=True',
        severity: 'high',
        category: 'Misconfiguration',
        cwe: 'CWE-942',
        file: file.path,
        line: 1,
        evidence: 'FastAPI CORSMiddleware misconfiguration',
        remediation:
          'FastAPI documents this as forbidden — browsers refuse to honor it but server-side intent is wrong. Either set allow_credentials=False or replace allow_origins=["*"] with an explicit allowlist.',
      });
    }
    const lines = c.split('\n');
    lines.forEach((line, i) => {
      if (/Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']/.test(line)) {
        findings.push({
          id: `cors-wildcard-${file.path}-${i}`,
          probe: 'CORS Check',
          title: 'CORS wildcard "*" on Access-Control-Allow-Origin',
          severity: 'medium',
          category: 'Misconfiguration',
          cwe: 'CWE-942',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation: `If this endpoint returns user-specific data or accepts authenticated requests, "*" allows any origin to read responses. Restrict to known origins or echo the request Origin against an allowlist.`,
        });
      }
      // Long Access-Control-Max-Age — preflight-cache poisoning surface.
      const maxAgeMatch = line.match(/Access-Control-Max-Age["']?\s*[:,]\s*["']?(\d+)/i);
      if (maxAgeMatch) {
        const seconds = parseInt(maxAgeMatch[1], 10);
        if (seconds > 86400) {
          findings.push({
            id: `cors-long-max-age-${file.path}-${i}`,
            probe: 'CORS Check',
            title: `Access-Control-Max-Age set to ${seconds}s (preflight cache too long)`,
            severity: 'low',
            category: 'Misconfiguration',
            cwe: 'CWE-942',
            file: file.path,
            line: i + 1,
            evidence: line.trim().slice(0, 200),
            remediation:
              'Browsers cap at 7200s anyway, but a configured value > 86400 (24h) signals that a stale CORS policy can persist for too long after a fix. Set Access-Control-Max-Age to 600-3600.',
          });
        }
      }
    });
  });
  return findings;
}

// ==========================================================================
// MODERN ATTACK SURFACE PROBES (May 2026)
// ==========================================================================

// --- LLM / AI Application Security (OWASP LLM Top 10 2025) ---

export function probeSSRFOpenRedirect(files) {
  const findings = [];
  // Same input-source family as v05.js USER_INPUT_TOKEN_RE — widened post the
  // May 2026 emailassist gap to include `url`, `originalUrl`, `path`, `baseUrl`
  // (raw Node http.createServer + Express URL accessors), plus the framework
  // siblings: Koa `ctx.*`, Lambda `event.body|queryStringParameters`,
  // CF Worker / Hono `c.req.*`, Web Fetch API `request.*`. `headers` is
  // included because Host / X-Forwarded-Host / Referer are real SSRF vectors.
  const USER_INPUT = `(?:req|request|ctx|context|event|c\\.req)\\.(?:body|query|params|headers|cookies|searchParams|url|originalUrl|path|baseUrl|queryStringParameters)|searchParams\\.get|params\\.`;
  // HTTP-client family for SSRF detection. The original regex covered only
  // fetch / axios / node:http. Real Node code uses far more: got, request,
  // node-fetch, undici, superagent, phin, ky, https.*, plus the Web Streams
  // Response.redirect() for the redirect side.
  const HTTP_CLIENT = `fetch|axios(?:\\.(?:get|post|put|delete|patch|head|options|request))?|https?\\.(?:get|request)|got(?:\\.(?:get|post|put|delete|patch|head|stream))?|node-fetch|undici(?:\\.(?:fetch|request))?|superagent(?:\\.(?:get|post|put|delete|patch))?|phin|ky(?:\\.(?:get|post|put|delete|patch))?|request`;
  // Redirect family. Adds Response.redirect, the SvelteKit `redirect()`
  // from $app/navigation, and Next App-Router `redirect()` from
  // next/navigation. `location =` window assignment is a client-side open
  // redirect; we treat both the same.
  const REDIRECT = `res\\.redirect|NextResponse\\.redirect|Response\\.redirect|(?<![.\\w])redirect|location\\s*=`;
  const ssrfRe = new RegExp(`(?:${HTTP_CLIENT})\\s*\\(\\s*(?:${USER_INPUT})`, 'i');
  const redirectRe = new RegExp(`(?:${REDIRECT})\\s*\\(\\s*(?:${USER_INPUT})`, 'i');
  // Location-header write: res.setHeader("Location", <userInput>) — comma-
  // separated args, separate match from the redirect-call shape above.
  const locationHeaderRe = new RegExp(
    `res\\.setHeader\\s*\\(\\s*['"\`]Location['"\`]\\s*,\\s*(?:${USER_INPUT})`,
    'i'
  );

  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$|\.py$/.test(file.path)) return;
    file.content.split('\n').forEach((line, i) => {
      if (redirectRe.test(line) || locationHeaderRe.test(line)) {
        findings.push({
          id: `redirect-${file.path}-${i}`,
          probe: 'Open Redirect',
          title: 'Redirect target taken from user input',
          severity: 'medium',
          category: 'Code Injection',
          cwe: 'CWE-601',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Open redirects feed phishing campaigns: your-domain.com/?next=evil.com looks legitimate. Validate the target against an allowlist of known-safe paths or domains before redirecting.',
        });
      }
      if (ssrfRe.test(line)) {
        findings.push({
          id: `ssrf-${file.path}-${i}`,
          probe: 'SSRF',
          title: 'Server-side fetch with user-controlled URL',
          severity: 'high',
          category: 'Code Injection',
          cwe: 'CWE-918',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Server-side request forgery lets attackers reach your internal network: cloud metadata endpoints (169.254.169.254 = AWS credentials), localhost-bound admin services, internal DBs. Validate URLs against an allowlist before fetching, or proxy through a service that blocks internal IPs. Now part of OWASP A01:2025 Broken Access Control.',
        });
      }
    });
  });
  return findings;
}

// --- Auth cookie flag hygiene ---
