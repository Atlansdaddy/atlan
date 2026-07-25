// src/lib/probes/web.js
// Web hygiene cluster: URL Reputation (probeExternalURLs), HTML hygiene (inline event
// handlers, target=_blank without rel=noopener, mixed-content scripts, eval in <script>),
// SEO hygiene (meta tags, structured data, canonical, hreflang, viewport, lang), GEO hygiene
// (AI-search visibility — llms.txt, AI-crawler allows in robots.txt), and A11y landmarks
// (skip-link, heading order, lang attribute, ARIA roles, alt text).

import {
  isTestFile,
  isScannerSelfSource,
  isMetaDocFile,
  isTemplateFragment,
} from '../file-filter.js';
import {
  URL_PLACEHOLDER_HOSTS,
  URL_PLACEHOLDER_IP_RE,
  URL_RAW_IP_RE,
  URL_SUSPICIOUS_TLD_RE,
  URL_SHORTENERS,
  isHostInSafeList,
  AI_CRAWLER_BOTS,
} from '../threat-intel.js';

// Architecture-aware gating for SEO / GEO probes. A project is treated as a
// "private installable PWA / internal tool" when it ships BOTH:
//   - a Web App Manifest (`manifest.json` or `manifest.webmanifest`) with an
//     installable display mode (`standalone`, `fullscreen`, `minimal-ui`).
//   - a service worker (`sw.js`, `service-worker.js`, or any `.js` whose body
//     begins a service-worker lifecycle binding `self.addEventListener('install'`).
// These two together are a strong signal the project is an installable app
// for a known audience (field tech, ops console, kiosk) rather than a public
// content site indexed by search engines. SEO / GEO hygiene findings are
// noise on these projects and erode user trust in the rest of the report.
//
// The detection is intentionally conservative: a single signal (just a
// manifest, just a service worker) is not enough — many public-web apps
// add either independently. Both together is the right precision/recall
// trade for the "private PWA" verdict.
export function isPrivatePWAContext(files) {
  const manifest = files.find(
    (f) => /(^|\/)manifest\.(json|webmanifest)$/i.test(f.path) && typeof f.content === 'string'
  );
  if (!manifest) return false;
  let parsed;
  try {
    parsed = JSON.parse(manifest.content);
  } catch {
    return false;
  }
  const display = typeof parsed?.display === 'string' ? parsed.display.toLowerCase() : '';
  if (!/^(standalone|fullscreen|minimal-ui)$/.test(display)) return false;
  const hasServiceWorker = files.some((f) => {
    if (/(^|\/)(sw|service-worker)\.js$/i.test(f.path)) return true;
    if (!/\.[jt]sx?$/.test(f.path)) return false;
    return /self\.addEventListener\(\s*['"]install['"]/i.test(f.content || '');
  });
  return hasServiceWorker;
}

export function probeExternalURLs(files) {
  const findings = [];
  // Char class includes `:` `[` `]` `@` so we capture IPv6 (`https://[::1]/`) and
  // credentials-in-URL (`https://user:pass@host/`) instead of breaking at those chars.
  const URL_RE = /https?:\/\/[A-Za-z0-9.\-_~%:@\[\]]+(?::\d+)?(?:\/[^\s"'<>`)\]]*)?/g;
  // host -> { occurrences: [{file,line,url}], allHttp: bool }
  const seen = new Map();

  // Self-domain allowlist from two sources:
  //   1. package.json#homepage  (auto-derived; the conventional npm field)
  //   2. .preflight.yml `self_domains:` list  (explicit, for sites with multiple domains
  //      or where homepage is a subdomain but the apex should also be allowlisted)
  const selfDomains = new Set();
  const pkgFile = files.find(
    (f) => /(^|\/)package\.json$/.test(f.path) && !/node_modules/.test(f.path)
  );
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      if (pkg.homepage) {
        try {
          selfDomains.add(new URL(pkg.homepage).hostname.toLowerCase());
        } catch {
          // homepage is malformed — fall through; one bad field shouldn't break the probe
        }
      }
    } catch {
      // package.json is malformed — let the dedicated package-manager probe surface that
    }
  }
  const preflightFile = files.find((f) => /(^|\/)\.preflight\.(ya?ml|json)$/i.test(f.path));
  if (preflightFile) {
    // Cheap line-grep for `self_domains:` block — avoids depending on the YAML parser here
    // (probes.js stays parser-free; the App layer owns full config parsing).
    const lines = (preflightFile.content || '').split('\n');
    const startIdx = lines.findIndex((l) => /^\s*self_domains\s*:/i.test(l));
    if (startIdx >= 0) {
      for (let i = startIdx + 1; i < lines.length; i++) {
        const m = lines[i].match(/^\s*-\s*['"]?([A-Za-z0-9.\-_]+)['"]?\s*$/);
        if (m) selfDomains.add(m[1].toLowerCase());
        else if (/^\s*\S/.test(lines[i]) && !/^\s*-\s/.test(lines[i])) break; // next top-level key
      }
    }
  }

  // Returns true if the URL match sits inside a remediation/description/help string literal
  // context — i.e. it's documentation, not a real reference. Heuristic: walk back up to 80
  // chars from the match index looking for one of those property names.
  const isInHelpContext = (content, idx) => {
    const back = content.slice(Math.max(0, idx - 120), idx);
    return /\b(remediation|description|help|docs?Url|learn_?more|message|note|hint|source|title|label)\s*[:=]\s*[`'"][^`'"]*$/i.test(
      back
    );
  };

  // Returns true if the URL match sits on a line that opens with `//`, ` *`, or `/*` — i.e.
  // it's a comment. Single-line comments (`// see https://foo`) and JSDoc bodies (` * @see
  // https://bar`) carry doc links, not runtime endpoints. Flagging them is pure noise.
  const isInCommentLine = (content, idx) => {
    const lineStart = content.lastIndexOf('\n', idx - 1) + 1;
    const prefix = content.slice(lineStart, idx).replace(/^\s+/, '');
    return /^(?:\/\/|\*\s|\/\*)/.test(prefix);
  };

  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    // Skip lockfiles (massive volume of registry URLs that drown the signal).
    if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(file.path)) return;
    // Skip meta/doc files (llms.txt, sitemap.xml, .preflight.yml) — they are *expected* to
    // contain URL references as content; flagging those references is pure noise.
    if (isMetaDocFile(file.path)) return;
    const content = file.content || '';
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(content)) !== null) {
      const raw = m[0].replace(/[.,;:!?)\]\}]+$/, ''); // strip trailing punctuation
      let host, port;
      try {
        const parsed = new URL(raw);
        host = parsed.hostname.toLowerCase();
        port = parsed.port;
      } catch {
        continue;
      }
      if (!host || isHostInSafeList(host)) continue;
      if (URL_PLACEHOLDER_HOSTS.has(host)) continue;
      if (URL_PLACEHOLDER_IP_RE.test(host)) continue;
      // Docker Compose / Kubernetes service names: bare-identifier hostnames (no dots,
      // valid DNS label shape) with an explicit port. e.g. `http://agent-ollama:11434`,
      // `http://redis:6379`, `http://postgres-db:5432`. These resolve only inside the
      // service mesh; they can't have HTTPS and they aren't real internet hosts. Skip.
      if (port && !host.includes('.') && /^[a-z][a-z0-9-]*$/.test(host)) continue;
      if (selfDomains.has(host)) continue;
      if (isInHelpContext(content, m.index)) continue;
      if (isInCommentLine(content, m.index)) continue;

      const lineNum = content.slice(0, m.index).split('\n').length;
      const isHttp = raw.startsWith('http:');
      // Depth round 4: XML/JSON-Schema/RDF namespace URIs are conventionally
      // http://, not because the resource is unencrypted — they are URI
      // IDENTIFIERS, not URLs to dereference. The W3C / sitemaps.org /
      // schema.org / xmlns:foaf families never redirect to https because the
      // namespace identifier IS the canonical URI. Suppress.
      const isNamespaceURI =
        /(?:sitemaps|schema|schemas|xmlns|opensearch|atom|rdf|foaf|dublincore|purl)\.org|w3\.org\/(?:[12]\d\d\d|ns|xml|tr|graphics)|xmlns="http|"http:\/\/schema\.org/.test(
          raw
        ) ||
        /^http:\/\/(?:www\.)?(?:sitemaps\.org|w3\.org|purl\.org|opensearch\.org|atom\.geo\.org)/i.test(
          raw
        );
      if (isNamespaceURI && isHttp) continue;
      const entry = seen.get(host) || { occurrences: [], allHttp: true };
      entry.occurrences.push({ file: file.path, line: lineNum, url: raw });
      entry.allHttp = entry.allHttp && isHttp;
      seen.set(host, entry);
    }
  });

  // Only emit a finding when the host trips an objective heuristic. The pre-v0.6 behavior of
  // flagging every unknown HTTPS host as `info` produced a wall of noise on any real app
  // (Twitter / blog hosts / vendor docs / etc. are not on the curated safe list, but
  // referencing them isn't a security issue). The new contract: this probe is a signal
  // detector, not an "unknown URL census."
  for (const [host, info] of seen) {
    const isIP = URL_RAW_IP_RE.test(host);
    // Depth round 3: RFC 1918 private-IP range distinct from generic raw-IP.
    const isPrivateIP = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
    const sketchyTLD = URL_SUSPICIOUS_TLD_RE.test(host);
    const isShortener = URL_SHORTENERS.has(host);
    const httpOnly = info.allHttp;
    // Depth round 3: IDN / punycode (homoglyph attack indicator).
    const isPunycode = /(?:^|\.)xn--/i.test(host);
    // Credentials baked into URL (user:pass@host).
    const hasCredsInUrl = info.occurrences.some((o) => /:\/\/[^/:\s@]+:[^/@\s]+@/.test(o.url));
    // Tor hidden service.
    const isOnion = /\.onion$/i.test(host);

    if (
      !isIP &&
      !sketchyTLD &&
      !isShortener &&
      !httpOnly &&
      !isPunycode &&
      !hasCredsInUrl &&
      !isOnion
    )
      continue;

    let severity, reason;
    if (hasCredsInUrl) {
      severity = 'high';
      reason = 'Credentials embedded in URL (user:pass@host)';
    } else if (isPunycode) {
      severity = 'medium';
      reason = 'Punycode / IDN host (possible homograph attack)';
    } else if (isPrivateIP) {
      severity = 'medium';
      reason = 'Private RFC 1918 IP referenced from source (possible staging endpoint leak)';
    } else if (isIP) {
      severity = 'medium';
      reason = 'Raw IP address used as endpoint';
    } else if (sketchyTLD) {
      severity = 'medium';
      reason = 'Suspicious TLD';
    } else if (isShortener) {
      severity = 'medium';
      reason = 'URL shortener (hides destination)';
    } else if (isOnion) {
      severity = 'medium';
      reason = 'Tor hidden service (.onion)';
    } else {
      severity = 'low';
      reason = 'HTTP only — no TLS';
    }

    const first = info.occurrences[0];
    const evidence = info.occurrences
      .slice(0, 3)
      .map((o) => `${o.file}:${o.line} → ${o.url.length > 90 ? o.url.slice(0, 90) + '…' : o.url}`)
      .join(' | ');
    findings.push({
      id: `url-${host}-${first.file}-${first.line}`,
      probe: 'URL Reputation',
      title: `${reason}: ${host}${info.occurrences.length > 1 ? ` (×${info.occurrences.length} occurrences)` : ''}`,
      severity,
      category: 'Misconfiguration',
      cwe: 'CWE-829',
      file: first.file,
      line: first.line,
      evidence,
      remediation:
        `This URL trips a heuristic associated with abuse infrastructure (raw IP, suspicious TLD, shortener, or HTTP-only). The probe doesn't claim the domain is malicious; it asks you to verify.\n\n` +
        `One-click reputation checks (PreFlight can't query these from the browser due to CORS):\n` +
        `• VirusTotal: https://www.virustotal.com/gui/domain/${encodeURIComponent(host)}\n` +
        `• urlhaus (abuse.ch): https://urlhaus.abuse.ch/browse.php?search=${encodeURIComponent(host)}\n` +
        `• whois: https://who.is/whois/${encodeURIComponent(host)}\n\n` +
        `Fixes by signal: raw IP → use a hostname so DNS can be repointed; suspicious TLD → move to a verified registrar; shortener → use the unshortened destination so the target is auditable; HTTP-only → switch to https://.`,
    });
  }
  return findings;
}

// --- HTML / static-site probe (catches the "I wrote it in plain HTML" cohort) ---
export function probeHTML(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.html?$/i.test(file.path)) return;
    const content = file.content || '';
    const lines = content.split('\n');

    // Inline event handlers — XSS sinks if any attribute value comes from user data.
    // Expanded vocabulary covers the common DOMPurify-bypass favorites that the original
    // 8-event regex missed (adversarial finding): dblclick, key events, paste, toggle, pointer, aux.
    lines.forEach((line, i) => {
      const inlineHandler = line.match(
        /\son(?:click|dblclick|auxclick|load|error|mouseover|mousedown|mouseup|focus|blur|input|change|submit|keydown|keyup|keypress|paste|copy|cut|drop|drag|toggle|pointerdown|pointerup|pointermove|wheel|scroll|resize|select)\s*=/i
      );
      if (inlineHandler) {
        findings.push({
          id: `html-inline-${file.path}-${i}`,
          probe: 'HTML Hygiene',
          title: 'Inline event handler in HTML',
          severity: 'low',
          category: 'Code Injection',
          cwe: 'CWE-79',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Inline handlers like onclick="..." are common XSS sinks when any attribute value is templated from user data. Move to addEventListener in a script block, and apply a Content-Security-Policy that disallows inline scripts and inline handlers.',
        });
      }
    });

    // <a target="_blank"> without rel="noopener" — tabnabbing on older browsers.
    [...content.matchAll(/<a\s[^>]*target\s*=\s*["']_blank["'][^>]*>/gi)].forEach((m) => {
      if (!/rel\s*=\s*["'][^"']*noopener/i.test(m[0])) {
        const ln = content.slice(0, m.index).split('\n').length;
        findings.push({
          id: `html-tabnab-${file.path}-${m.index}`,
          probe: 'HTML Hygiene',
          title: 'target="_blank" without rel="noopener"',
          severity: 'low',
          category: 'Code Injection',
          cwe: 'CWE-1022',
          file: file.path,
          line: ln,
          evidence: m[0].slice(0, 200),
          remediation:
            'Pages opened via target="_blank" can manipulate window.opener and redirect the original tab. Add rel="noopener noreferrer" to every external link with target="_blank".',
        });
      }
    });

    // Mixed-content fetches: HTTPS page loading http:// scripts/images.
    [
      ...content.matchAll(
        /<(?:script|img|iframe|link)[^>]*\b(?:src|href)\s*=\s*["']http:\/\/[^"']+["']/gi
      ),
    ].forEach((m) => {
      const ln = content.slice(0, m.index).split('\n').length;
      findings.push({
        id: `html-mixed-${file.path}-${m.index}`,
        probe: 'HTML Hygiene',
        title: 'HTTP resource referenced in HTML (mixed-content risk)',
        severity: 'medium',
        category: 'Misconfiguration',
        cwe: 'CWE-319',
        file: file.path,
        line: ln,
        evidence: m[0].slice(0, 200),
        remediation:
          'When served over HTTPS, browsers block or downgrade-warn on http:// scripts/images. Switch to https://, or use protocol-relative //example.com/x.js if the asset host supports both.',
      });
    });

    // <script> blocks containing eval() / new Function() — classic RCE class in static sites.
    [...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].forEach((m) => {
      const body = m[1];
      if (/\beval\s*\(/.test(body) || /\bnew\s+Function\s*\(/.test(body)) {
        const ln = content.slice(0, m.index).split('\n').length;
        findings.push({
          id: `html-eval-${file.path}-${m.index}`,
          probe: 'HTML Hygiene',
          title: 'eval() or new Function() inside <script>',
          severity: 'high',
          category: 'Code Injection',
          cwe: 'CWE-95',
          file: file.path,
          line: ln,
          evidence: (body.match(/.{0,80}(?:eval|new Function)\s*\([^)]{0,80}/) || [''])[0],
          remediation:
            'Inline eval/new Function in a <script> is a direct RCE path if any input ever flows into the evaluated string. Use JSON.parse for data, switch statements for known operations, or a real expression parser.',
        });
      }
    });

    // Forms posting over HTTP, even on HTTPS pages.
    [...content.matchAll(/<form[^>]*\baction\s*=\s*["']http:\/\/[^"']+["']/gi)].forEach((m) => {
      const ln = content.slice(0, m.index).split('\n').length;
      findings.push({
        id: `html-form-http-${file.path}-${m.index}`,
        probe: 'HTML Hygiene',
        title: 'Form posts to http:// endpoint',
        severity: 'high',
        category: 'Data Breach',
        cwe: 'CWE-319',
        file: file.path,
        line: ln,
        evidence: m[0].slice(0, 200),
        remediation:
          'A form that POSTs over HTTP exposes submitted data (passwords, tokens, PII) to anyone on the network path. Switch the action URL to https://.',
      });
    });

    // Missing or weak CSP meta tag in <head> of an otherwise scriptful page.
    // Skip template fragments — they inherit CSP from the base template they extend.
    const hasInlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(content);
    const hasCsp = /<meta[^>]*http-equiv\s*=\s*["']content-security-policy["']/i.test(content);
    if (hasInlineScript && !hasCsp && !isTemplateFragment(content)) {
      findings.push({
        id: `html-nocsp-${file.path}`,
        probe: 'HTML Hygiene',
        title: 'Inline <script> with no Content-Security-Policy meta tag',
        severity: 'low',
        category: 'Misconfiguration',
        cwe: 'CWE-693',
        file: file.path,
        line: 1,
        evidence: '<script> block detected; no CSP meta tag found',
        remediation:
          'A CSP header is the single most effective XSS mitigation. If you cannot set it via server headers, add <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; ..."> in <head>. Then iterate to add only the origins you need.',
      });
    }
  });
  return findings;
}

// --- SEO Hygiene: index.html meta tags, robots.txt, sitemap.xml ---
export function probeSEOHygiene(files) {
  const findings = [];
  // Architecture gate: private installable PWAs aren't public content sites.
  // Search-engine and social-share hygiene findings are noise for them; the
  // report becomes louder without becoming more useful. Suppress the entire
  // probe when the project shows BOTH an installable manifest AND a service
  // worker — that's a strong enough signal we won't FP on real public sites.
  if (isPrivatePWAContext(files)) return findings;
  files.forEach((file) => {
    // Test-fixture HTML is not a public page; SEO hygiene doesn't apply.
    // FP triage 2026-07 (gemini-cli-fork scan).
    if (isTestFile(file.path)) return;
    // index.html (or any *.html that looks like a SPA entry — has <head>)
    if (/\.html?$/i.test(file.path)) {
      const c = file.content || '';
      const head = (c.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ['', ''])[1];
      const isEntry =
        /<div\s+id=["']root["']|<div\s+id=["']app["']/i.test(c) ||
        /\/?index\.html?$/i.test(file.path);
      if (!isEntry) return;

      const issues = [];
      if (!/<html[^>]*\blang\s*=/i.test(c))
        issues.push({
          k: 'no-lang',
          t: '<html> missing lang attribute',
          s: 'medium',
          cwe: 'WCAG 3.1.1',
        });
      if (!/<title[^>]*>[^<]{4,}<\/title>/i.test(head))
        issues.push({
          k: 'no-title',
          t: 'Missing or empty <title> in <head>',
          s: 'high',
          cwe: 'SEO-fundamentals',
        });
      // Quote-delimiter aware: a double-quoted description may legitimately
      // contain apostrophes ("HIPAA's", "don't") and vice versa. The old
      // [^"']{20,} forbade both quote chars, so any description with an
      // apostrophe in its first 20 chars was a false "thin" positive.
      if (!/<meta[^>]*name=["']description["'][^>]*content=(?:"[^"]{20,}"|'[^']{20,}')/i.test(head))
        issues.push({
          k: 'no-description',
          t: 'Missing or thin <meta name="description">',
          s: 'medium',
          cwe: 'SEO-fundamentals',
        });
      if (!/<meta[^>]*name=["']viewport["']/i.test(head))
        issues.push({
          k: 'no-viewport',
          t: 'Missing <meta name="viewport">',
          s: 'medium',
          cwe: 'WCAG 1.4.10',
        });
      if (!/<link[^>]*rel=["']canonical["']/i.test(head))
        issues.push({
          k: 'no-canonical',
          t: 'Missing <link rel="canonical">',
          s: 'low',
          cwe: 'SEO-fundamentals',
        });
      if (!/<meta[^>]*property=["']og:title["']/i.test(head))
        issues.push({
          k: 'no-og-title',
          t: 'Missing Open Graph og:title',
          s: 'low',
          cwe: 'SEO-social-share',
        });
      if (!/<meta[^>]*property=["']og:description["']/i.test(head))
        issues.push({
          k: 'no-og-desc',
          t: 'Missing Open Graph og:description',
          s: 'low',
          cwe: 'SEO-social-share',
        });
      if (!/<meta[^>]*property=["']og:image["']/i.test(head))
        issues.push({
          k: 'no-og-image',
          t: 'Missing Open Graph og:image (poor share previews)',
          s: 'low',
          cwe: 'SEO-social-share',
        });
      if (!/<meta[^>]*name=["']twitter:card["']/i.test(head))
        issues.push({
          k: 'no-twitter',
          t: 'Missing twitter:card meta',
          s: 'info',
          cwe: 'SEO-social-share',
        });
      if (!/<link[^>]*rel=["']icon["']/i.test(head))
        issues.push({
          k: 'no-favicon',
          t: 'Missing favicon <link rel="icon">',
          s: 'info',
          cwe: 'SEO-fundamentals',
        });
      // Schema drift / missing JSON-LD
      const hasJsonLd = /<script[^>]*type=["']application\/ld\+json["'][^>]*>/i.test(head);
      if (!hasJsonLd)
        issues.push({
          k: 'no-jsonld',
          t: 'No JSON-LD structured data in <head>',
          s: 'medium',
          cwe: 'SEO-structured-data',
        });

      issues.forEach((issue) => {
        findings.push({
          id: `seo-${issue.k}-${file.path}`,
          probe: 'SEO Hygiene',
          title: issue.t,
          severity: issue.s,
          category: 'Misconfiguration',
          cwe: issue.cwe,
          file: file.path,
          line: 1,
          evidence: `entry HTML: ${file.path}`,
          remediation: `Search engines and AI-search crawlers rely on these head tags. ${
            issue.k === 'no-title'
              ? 'Add <title>Your descriptive title</title>.'
              : issue.k === 'no-description'
                ? 'Add <meta name="description" content="..." /> with 70–160 chars describing the page.'
                : issue.k === 'no-canonical'
                  ? 'Add <link rel="canonical" href="https://yourdomain.com/" /> to prevent duplicate-content penalties.'
                  : issue.k === 'no-og-title'
                    ? 'Add <meta property="og:title" content="..." /> so links shared on social show a title card.'
                    : issue.k === 'no-og-image'
                      ? 'Add <meta property="og:image" content="https://yourdomain.com/og.png" /> with a 1200×630 image.'
                      : issue.k === 'no-lang'
                        ? 'Add lang="en" (or the appropriate BCP47 code) to <html>. Required for screen-reader pronunciation (WCAG 3.1.1).'
                        : issue.k === 'no-viewport'
                          ? 'Add <meta name="viewport" content="width=device-width, initial-scale=1" /> so mobile zoom and text scaling work (WCAG 1.4.10).'
                          : issue.k === 'no-jsonld'
                            ? 'Add a <script type="application/ld+json"> block with at minimum a WebSite or SoftwareApplication entity. Google and Perplexity use it directly.'
                            : 'Add the missing tag — most are 1 line of HTML.'
          }`,
        });
      });
    }

    if (/(^|\/)robots\.txt$/i.test(file.path)) {
      const c = file.content || '';
      if (!/^\s*Sitemap:\s*\S+/im.test(c)) {
        findings.push({
          id: `seo-robots-no-sitemap-${file.path}`,
          probe: 'SEO Hygiene',
          title: 'robots.txt has no Sitemap: line',
          severity: 'low',
          category: 'Misconfiguration',
          cwe: 'SEO-fundamentals',
          file: file.path,
          line: 1,
          evidence: 'No "Sitemap:" directive found',
          remediation:
            'Add a line: Sitemap: https://yourdomain.com/sitemap.xml — helps crawlers discover URLs they would otherwise miss.',
        });
      }
      // Only flag a site-blocking Disallow when it appears under a wildcard `User-agent: *` block.
      // A `Disallow: /` under a specific bot (e.g. BadBot) is a deliberate per-bot block, not a
      // catastrophic site-wide misconfig (adversarial-agent finding).
      {
        const cleanedRobots = c
          .split('\n')
          .map((l) => l.replace(/#.*$/, '').trimEnd())
          .join('\n');
        for (const block of cleanedRobots.split(/\n\s*\n/)) {
          const uas = [...block.matchAll(/^User-agent:\s*(\S+)/gim)].map((m) => m[1]);
          if (!uas.includes('*')) continue;
          if (!/^Disallow:\s*\/\s*$/im.test(block)) continue;
          if (/^Allow:\s*\//im.test(block)) continue;
          findings.push({
            id: `seo-robots-disallow-all-${file.path}`,
            probe: 'SEO Hygiene',
            title: 'robots.txt blocks the entire site (Disallow: / under User-agent: *)',
            severity: 'critical',
            category: 'Misconfiguration',
            cwe: 'SEO-fundamentals',
            file: file.path,
            line: 1,
            evidence: 'Wildcard User-agent block contains "Disallow: /" with no compensating Allow',
            remediation:
              'A "Disallow: /" under "User-agent: *" blocks every search engine from indexing the site. If this is intentional (staging, deprecated), ignore; otherwise change to "Disallow:" (empty) or add a permissive "Allow: /" line.',
          });
          break; // one finding per file
        }
      }
    }
  });
  return findings;
}

export function probeGEOHygiene(files) {
  const findings = [];
  // Same architecture gate as probeSEOHygiene — see comment there. Private
  // installable PWAs don't need AI-search optimization.
  if (isPrivatePWAContext(files)) return findings;
  const hasLlms = files.some((f) => /(^|\/)llms\.txt$/i.test(f.path));
  const robotsFile = files.find((f) => /(^|\/)robots\.txt$/i.test(f.path));
  // Fixture HTML under test dirs is not site content; a repo whose only HTML
  // is test fixtures has no AI-search surface to optimize. FP triage 2026-07.
  const htmlFile = files.find(
    (f) =>
      /\.html?$/i.test(f.path) &&
      !isTestFile(f.path) &&
      /<div\s+id=["'](root|app)["']/i.test(f.content || '')
  );
  const hasAnyHtml = files.some((f) => /\.html?$/i.test(f.path) && !isTestFile(f.path));

  if (hasAnyHtml && !hasLlms) {
    findings.push({
      id: 'geo-no-llmstxt',
      probe: 'GEO Hygiene',
      title: 'No llms.txt for AI-search crawlers',
      severity: 'low',
      category: 'Misconfiguration',
      cwe: 'GEO-fundamentals',
      file: 'public/llms.txt (missing)',
      line: 1,
      evidence: 'Project has HTML but no llms.txt at the site root',
      remediation:
        'Create public/llms.txt per https://llmstxt.org — a Markdown summary of your site for AI crawlers (Perplexity, ChatGPT search, Gemini). Headline tagline first, then sectioned facts. AI search engines preferentially quote llms.txt content.',
    });
  }

  if (robotsFile) {
    const c = robotsFile.content || '';
    // Walk robots.txt block by block. A "block" is a contiguous set of non-blank lines
    // (after stripping # comments) that share their User-agent context. This is the only
    // way to correctly scope `Disallow: /` to the user-agent that owns it — a free-floating
    // regex falsely attributes one bot's Disallow to a different bot mentioned earlier in a
    // comment or empty-Disallow block (adversarial-agent finding).
    const cleaned = c
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trimEnd())
      .join('\n');
    const blocks = cleaned.split(/\n\s*\n/);
    for (const block of blocks) {
      const uaLines = [...block.matchAll(/^User-agent:\s*(\S+)/gim)].map((m) => m[1]);
      if (uaLines.length === 0) continue;
      const fullDisallow = /^Disallow:\s*\/\s*$/im.test(block);
      if (!fullDisallow) continue;
      AI_CRAWLER_BOTS.forEach((bot) => {
        if (uaLines.some((ua) => ua.toLowerCase() === bot.toLowerCase())) {
          findings.push({
            id: `geo-block-${bot}`,
            probe: 'GEO Hygiene',
            title: `robots.txt blocks ${bot}`,
            severity: 'low',
            category: 'Misconfiguration',
            cwe: 'GEO-fundamentals',
            file: robotsFile.path,
            line: 1,
            evidence: `User-agent: ${bot} block contains "Disallow: /"`,
            remediation: `${bot} is the crawler for an AI search engine. Blocking it means your content cannot appear in AI-generated answers. If that is intentional, ignore. If you want to be cited, remove the Disallow.`,
          });
        }
      });
    }
  }

  if (htmlFile) {
    const head = (htmlFile.content.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || ['', ''])[1];
    // Freshness signal — JSON-LD with dateModified, OR a visible <time> element somewhere in the body.
    const hasDateModified = /"dateModified"\s*:\s*"\d{4}-\d{2}-\d{2}/.test(htmlFile.content);
    const hasTimeTag = /<time[^>]*\bdatetime\s*=/i.test(htmlFile.content);
    if (!hasDateModified && !hasTimeTag) {
      findings.push({
        id: 'geo-no-freshness',
        probe: 'GEO Hygiene',
        title: 'No freshness signal (dateModified in JSON-LD or <time datetime>) on the page',
        severity: 'low',
        category: 'Misconfiguration',
        cwe: 'GEO-fundamentals',
        file: htmlFile.path,
        line: 1,
        evidence:
          'Page has no dateModified in structured data and no <time datetime="..."> in markup',
        remediation:
          'AI search engines prioritize recently-updated content. Add either "dateModified": "YYYY-MM-DD" to your JSON-LD or a visible <time dateTime="YYYY-MM-DD">Updated YYYY-MM-DD</time> element. Both is better.',
      });
    }
    // FAQPage schema present but no visible FAQs anywhere in the project — schema drift risk.
    // For SPAs, the visible FAQ may live in a JSX file rendered at runtime; we accept that.
    const faqInSchema = /"@type"\s*:\s*"FAQPage"/.test(head);
    const visibleFaqHere = /<(?:dl|details|h2|h3)[^>]*>[\s\S]*?(?:question|faq|frequently)/i.test(
      htmlFile.content
    );
    const visibleFaqInJsx = files.some(
      (f) =>
        /\.[jt]sx$/i.test(f.path) &&
        (/aria-labelledby=["']faq-heading["']/i.test(f.content || '') ||
          /id=["']faq-heading["']/i.test(f.content || '') ||
          /<dl[^>]*>[\s\S]{0,300}<dt/i.test(f.content || ''))
    );
    if (faqInSchema && !visibleFaqHere && !visibleFaqInJsx) {
      findings.push({
        id: 'geo-schema-drift-faq',
        probe: 'GEO Hygiene',
        title: 'FAQPage JSON-LD with no visible FAQ section on the page',
        severity: 'medium',
        category: 'Misconfiguration',
        cwe: 'GEO-schema-drift',
        file: htmlFile.path,
        line: 1,
        evidence:
          '@type: FAQPage in JSON-LD; no <dl> / <details> / FAQ-headed section in DOM or JSX',
        remediation:
          'Google March 2026 update penalizes schema markup that contradicts visible content. Either remove the FAQPage schema or render the Q&As as visible HTML (a <dl> with <dt>/<dd> pairs works well).',
      });
    }
  }

  return findings;
}

// --- A11y Landmarks: img alt, button labels, input labels, html lang, target size ---
export function probeA11yLandmarks(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    const isHtml = /\.html?$/i.test(file.path);
    const isJsx = /\.[jt]sx$/i.test(file.path);
    const isVue = /\.vue$/i.test(file.path);
    const isSvelte = /\.svelte$/i.test(file.path);
    const isAstro = /\.astro$/i.test(file.path);
    if (!isHtml && !isJsx && !isVue && !isSvelte && !isAstro) return;
    const content = file.content || '';

    // <img> tags without an alt attribute (any image with no alt fails 1.1.1).
    // Vue / Svelte use :src / bind:src; check those file types via the same regex
    // since alt is universal (Vue/Svelte don't rename it).
    [...content.matchAll(/<img\s[^>]*\/?>/gi)].forEach((m) => {
      if (!/\balt\s*=/.test(m[0])) {
        const ln = content.slice(0, m.index).split('\n').length;
        findings.push({
          id: `a11y-img-no-alt-${file.path}-${m.index}`,
          probe: 'A11y Landmarks',
          title: '<img> without alt attribute',
          severity: 'medium',
          category: 'Misconfiguration',
          cwe: 'WCAG 1.1.1',
          file: file.path,
          line: ln,
          evidence: m[0].slice(0, 200),
          remediation:
            'Every <img> needs alt. For decorative images use alt="" (empty string) so screen readers skip them. For meaningful images, describe what the user would lose if the image failed to load.',
        });
      }
    });

    if (isHtml) {
      // Template fragments (Jinja {% extends %}, Django, ERB, etc.) inherit <html lang>
      // and the skip-link from their base template, so those two DOCUMENT-level checks
      // are pure false positive on a fragment. Element-level checks below (input without
      // label, img without alt, icon-only buttons) still need to run on fragments.
      const isFragment = isTemplateFragment(content);
      // <html lang="...">
      if (!isFragment && !/<html[^>]*\blang\s*=/i.test(content)) {
        findings.push({
          id: `a11y-html-no-lang-${file.path}`,
          probe: 'A11y Landmarks',
          title: '<html> missing lang attribute',
          severity: 'high',
          category: 'Misconfiguration',
          cwe: 'WCAG 3.1.1',
          file: file.path,
          line: 1,
          evidence: '<html> tag has no lang=',
          remediation:
            'Add lang="en" (or correct BCP47 code) so screen readers pronounce content with the right pronunciation engine. WCAG 3.1.1 Level A — failure here is a hard fail.',
        });
      }
      // <input type="text|email|search|password|number|tel|url"> without label / aria-label / aria-labelledby
      // Skip type=hidden / aria-hidden inputs — they're never user-facing (adversarial finding).
      [
        ...content.matchAll(
          /<input\s[^>]*\btype\s*=\s*["'](?:text|email|search|password|number|tel|url)["'][^>]*>/gi
        ),
      ].forEach((m) => {
        const tag = m[0];
        if (/\baria-hidden\s*=\s*["']true["']/i.test(tag)) return;
        if (
          /\bhidden\b(?!\s*=\s*["']false)/i.test(tag) &&
          !/\btype\s*=\s*["'](?:text|email)/i.test(
            tag.match(/type\s*=\s*["'][^"']+["']/i)?.[0] || ''
          )
        ) {
          // boolean hidden attribute on a non-text type: skip
          return;
        }
        const hasAriaLabel = /\baria-label\s*=\s*["']/i.test(tag);
        const hasAriaLabelledby = /\baria-labelledby\s*=\s*["']/i.test(tag);
        const idMatch = tag.match(/\bid\s*=\s*["']([^"']+)["']/i);
        const hasLabelFor = idMatch
          ? new RegExp(`<label[^>]*\\bfor\\s*=\\s*["']${idMatch[1]}["']`, 'i').test(content)
          : false;
        // Wrapping <label>…<input/>…</label> association
        const wrapping = new RegExp(
          `<label\\b[^>]*>(?:[^<]|<(?!input)[^>]*>)*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}`,
          's'
        );
        const hasWrappingLabel = wrapping.test(content);
        if (!hasAriaLabel && !hasAriaLabelledby && !hasLabelFor && !hasWrappingLabel) {
          const ln = content.slice(0, m.index).split('\n').length;
          findings.push({
            id: `a11y-input-no-label-${file.path}-${m.index}`,
            probe: 'A11y Landmarks',
            title: 'Form input without an associated label',
            severity: 'high',
            category: 'Misconfiguration',
            cwe: 'WCAG 1.3.1, 3.3.2',
            file: file.path,
            line: ln,
            evidence: tag.slice(0, 200),
            remediation:
              'Add one of: <label for="myid">…</label> + <input id="myid">, aria-label="…" on the input, or aria-labelledby="other-id". Without a label, screen readers announce the field as "edit" with no meaning.',
          });
        }
      });
      // Skip-link presence (a11y best practice — visible-on-focus link at top of <body>)
      const hasSkipLink = /<a\s[^>]*href=["']#(main|content)[^>]*>(skip|jump)/i.test(content);
      if (!isFragment && !hasSkipLink && /<body[^>]*>/i.test(content)) {
        findings.push({
          id: `a11y-no-skip-link-${file.path}`,
          probe: 'A11y Landmarks',
          title: 'No skip-to-content link at top of <body>',
          severity: 'low',
          category: 'Misconfiguration',
          cwe: 'WCAG 2.4.1',
          file: file.path,
          line: 1,
          evidence: 'No <a href="#main">Skip…</a> pattern found before main content',
          remediation:
            'Add <a href="#main" class="skip-link">Skip to main content</a> as the first element after <body>, styled to be visible only on keyboard focus. Lets keyboard users bypass repetitive nav.',
        });
      }
    }

    if (isJsx) {
      // <button> tags with only an icon child (no visible text, no aria-label).
      // This is a heuristic — looks for <button ...>\n? <Icon ... /> \n? </button> with no plain text.
      [...content.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].forEach((m) => {
        const attrs = m[1];
        const body = m[2];
        const hasAriaLabel = /\baria-label\s*=/.test(attrs);
        // Strip just the TAG TOKENS (open / close / self-closing) but preserve text and JSX
        // expressions between them. A button with a Chevron icon AND visible {finding.title}
        // text in a sibling div still has visible content — it must NOT be flagged. Marking
        // each JSX expression with a sentinel so we know "this likely resolves to text".
        const stripped = body
          .replace(/<\/?[A-Za-z][^<>]*\/?>/g, ' ') // tag tokens → space (keeps inner text)
          .replace(/\{[^}]+\}/g, ' __EXPR__ ') // JSX expressions → sentinel
          .replace(/\s+/g, ' ')
          .trim();
        const hasExpr = /\b__EXPR__\b/.test(stripped);
        const hasText = stripped.replace(/__EXPR__/g, '').trim().length > 0;
        const hasCapitalTag = /<[A-Z][A-Za-z0-9]*\b/.test(body);
        const hasOnlyIcon = hasCapitalTag && !hasText && !hasExpr;
        if (hasOnlyIcon && !hasAriaLabel) {
          const ln = content.slice(0, m.index).split('\n').length;
          findings.push({
            id: `a11y-button-icon-only-${file.path}-${m.index}`,
            probe: 'A11y Landmarks',
            title: 'Icon-only <button> without aria-label',
            severity: 'medium',
            category: 'Misconfiguration',
            cwe: 'WCAG 4.1.2',
            file: file.path,
            line: ln,
            evidence: m[0].slice(0, 200).replace(/\s+/g, ' '),
            remediation:
              'Add aria-label="…" so screen readers announce the button\'s purpose. Example: <button aria-label="Delete entry"><Trash /></button>. The visible icon alone has no accessible name.',
          });
        }
      });
    }
  });
  return findings;
}

// --- Code Quality: console statements, file size, unhandled promises, async/try ---
