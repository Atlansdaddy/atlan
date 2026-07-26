// src/lib/threat-intel.js
// Detection patterns + threat-intel constants. Pure data, no scanning logic.
// Updated as 2025-2026 incidents are published; sourced from CISA, official
// advisories (GHSA/CVE), affected-vendor postmortems, and independent IOC tracking.

import compromisedPackagesManifest from '../data/compromised-packages.js';

export const SECRET_PATTERNS = [
  {
    name: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'AWS Secret Access Key',
    regex: /aws[_\-]?secret[_\-]?(?:access[_\-]?)?key["'\s:=]+["']?([A-Za-z0-9/+=]{40})["']?/gi,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Stripe Live Secret Key',
    regex: /\bsk_live_[A-Za-z0-9]{20,}\b/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Stripe Test Secret Key',
    regex: /\bsk_test_[A-Za-z0-9]{20,}\b/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    // Pattern page (secret-scanner.md) specifies `sk-[A-Za-z0-9]{20,}` or
    // `sk-proj-...`. The previous 40-char floor was more conservative than
    // the spec and missed shorter modern OpenAI keys. Spec-honoring 20.
    name: 'OpenAI API Key',
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Anthropic API Key',
    regex: /\bsk-ant-[A-Za-z0-9_\-]{40,}\b/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Google API Key',
    regex: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  // GitHub fine-grained PAT (introduced 2022, common in 2026 projects). Format:
  // `github_pat_` + 22 alphanumeric/underscore + `_` + 59 alphanumeric. We
  // accept a relaxed length so future format tweaks still match.
  {
    name: 'GitHub Fine-Grained PAT',
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}_[A-Za-z0-9]{50,}\b/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Slack Webhook URL',
    regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Slack Bot Token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'SendGrid API Key',
    regex: /\bSG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}\b/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Hugging Face Token',
    regex: /\bhf_[A-Za-z0-9]{30,}\b/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Replicate API Token',
    regex: /\br8_[A-Za-z0-9]{30,}\b/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Groq API Key',
    regex: /\bgsk_[A-Za-z0-9]{40,}\b/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Perplexity API Key',
    regex: /\bpplx-[A-Za-z0-9]{40,}\b/g,
    severity: 'high',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  // ReDoS-safe: each segment forbids ':' and '@' so the user / pass / host parts can't ambiguously overlap.
  {
    name: 'Database Connection URL with Credentials',
    regex:
      /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>:@/]+:[^\s"'<>:@/]+@[^\s"'<>/]+/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    // Accepts the optional " BLOCK" suffix that PGP exports use:
    //   -----BEGIN PGP PRIVATE KEY BLOCK-----
    // Other formats (RSA, EC, DSA, OPENSSH, unqualified) keep their original
    // shape with no trailing BLOCK token.
    name: 'Private Key Block',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
    severity: 'critical',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
  {
    name: 'Generic Hardcoded Secret',
    regex: /(?:secret|password|passwd|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-!@#$%^&*]{16,}["']/gi,
    severity: 'medium',
    category: 'Data Breach',
    cwe: 'CWE-798',
  },
];

// ==========================================================================
// 2026 THREAT INTEL: known-compromised package versions
// Sources: CISA, GTIG/Mandiant, Socket, Wiz, Unit 42, OX Security, OWASP
// ==========================================================================

// NEXT_PUBLIC_* env-var name and value patterns used by probeNextPublic. Name match catches
// any variable whose identifier hints at secret material; value match catches secret-shaped
// values placed under a NEXT_PUBLIC_ prefix (always wrong — these get shipped to the browser).
// Depth round 3: expanded danger-name and danger-value lists per the
// next-public-misuse Learn pattern that already documented these but the
// regex missed: DATABASE_URL, JWT_SECRET, WEBHOOK_SECRET, ADMIN, signing/
// encryption keys, AWS_SECRET, GITHUB_TOKEN, plus a value-side widening
// for Postgres/MySQL/MongoDB/Redis connection strings, JWT shapes, AKIA
// AWS key shape, GitHub PATs (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_),
// Google AIza, xAI / Groq / OpenRouter prefixes, and PEM private-key
// headers.
export const NEXT_PUBLIC_DANGER_NAMES =
  /SECRET|PRIVATE|SERVICE_ROLE|TOKEN|PASSWORD|STRIPE_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|DATABASE_URL|DB_URL|REDIS_URL|MONGO_URI|MONGODB_URI|JWT_SECRET|WEBHOOK_SECRET|SIGNING_KEY|ENCRYPTION_KEY|AWS_SECRET|GITHUB_TOKEN/i;
export const NEXT_PUBLIC_DANGER_VALUES =
  /^sk_live_|^sk_test_|^sk-ant-|^sk-proj-|service_role|^eyJ[A-Za-z0-9_-]+\.eyJ|^postgres(?:ql)?:\/\/[^@\s]+:[^@\s]+@|^mysql:\/\/[^@\s]+:[^@\s]+@|^mongodb(?:\+srv)?:\/\/[^@\s]+:[^@\s]+@|^redis:\/\/[^@\s]*:[^@\s]+@|^AKIA[0-9A-Z]{16}|^ghp_[A-Za-z0-9]{20,}|^gho_[A-Za-z0-9]{20,}|^ghu_[A-Za-z0-9]{20,}|^ghs_[A-Za-z0-9]{20,}|^ghr_[A-Za-z0-9]{20,}|^github_pat_|^xai-[A-Za-z0-9]{20,}|^gsk_[A-Za-z0-9_-]{20,}|^sk-or-[A-Za-z0-9-]{20,}|-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/;
// Public-bundle prefix family — `NEXT_PUBLIC_` is Next.js; the same shape
// of bundle-inlining ships under different prefixes across the JS ecosystem.
// probeNextPublic gates on names matching this list AND a danger-name or
// danger-value match.
export const PUBLIC_ENV_PREFIXES =
  /^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_|GATSBY_|NUXT_PUBLIC_|PARCEL_PUBLIC_)/;

// Compromised npm/PyPI packages — sourced from src/data/compromised-packages.js.
// The data file is the single source of truth; this re-export strips meta-keys
// (_schema/_note/_lastReviewed) so probe code can iterate it as a flat map.
// Update the data file, not this object.
export const COMPROMISED_PACKAGES = Object.fromEntries(
  Object.entries(compromisedPackagesManifest).filter(([k]) => !k.startsWith('_'))
);

// Common typosquats targeting popular packages
export const TYPOSQUATS = {
  reactt: 'react',
  reactjs: 'react',
  lodahs: 'lodash',
  lodaash: 'lodash',
  lodashy: 'lodash',
  expreess: 'express',
  expres: 'express',
  crossenv: 'cross-env',
  'discord-js': 'discord.js',
  momnet: 'moment',
  momentjs: 'moment',
  noodejs: 'node',
  jsonwebtokenn: 'jsonwebtoken',
  colorss: 'colors',
};

// Generic-looking package name patterns common in LLM hallucinations (slopsquat)
export const SLOPSQUAT_GENERIC_RE =
  /^(auth|api|db|user|admin|util|helper|core|server|client|app|web|http|json|crypto|fast|smart|easy|simple|secure|pro|advanced)-(auth|api|util|utils|helper|helpers|core|client|server|tool|tools|kit|lib|js|ts|node|sdk|wrapper|manager)$/i;

// Bidirectional Unicode control characters (CVE-2021-42574 / Trojan Source).
// Built from \u escape codes (NOT literal characters) so this file itself doesn't trip our own
// Trojan Source probe when scanning the scanner. The codepoint ranges are:
//   U+202A-U+202E  LRE / RLE / PDF / LRO / RLO

export const BIDI_CONTROL_RE = new RegExp('[' + '\\u202A-\\u202E\\u2066-\\u2069' + ']');

// --- Test-file exclusion: pattern-matching probes should skip test files ---
// Test files legitimately demonstrate vulnerable patterns to verify detection. Running content-
// pattern probes against `*.test.{js,jsx,ts,tsx}`, `*.spec.*`, or anything under `test/`/`tests/`
// /`__tests__/` produces self-reference findings instead of real ones (the regression test for
// "we should detect eval()" is itself a string containing `eval(`).

// Includes the IANA-reserved example domains, common documentation strings, and RFC 5737
// reserved IP ranges (TEST-NET-1/2/3 — used in code samples and test fixtures).
export const URL_PLACEHOLDER_HOSTS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.io',
  'yourdomain.com',
  'yoursite.com',
  'mydomain.com',
  'somedomain.com',
  'foo.bar',
  'foo.baz',
  'host',
  '[::1]',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);
// RFC 5737 ranges: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 — reserved for documentation.
export const URL_PLACEHOLDER_IP_RE = /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/;

export const URL_SAFE_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'example.com',
  'example.org',
  'test.com',
  'github.com',
  'githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'npmjs.com',
  'pypi.org',
  'rubygems.org',
  'go.dev',
  'google.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'gstatic.com',
  'microsoft.com',
  'azure.com',
  'aws.amazon.com',
  'amazonaws.com',
  'cloudflare.com',
  'cloudflareinsights.com',
  'jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'mozilla.org',
  'developer.mozilla.org',
  'w3.org',
  'schema.org',
  'owasp.org',
  'genai.owasp.org',
  'cwe.mitre.org',
  'cisa.gov',
  'cheatsheetseries.owasp.org',
  'pnpm.io',
  'yarnpkg.com',
  // Established AI / LLM provider hosts. Documented endpoints, owned by
  // well-known companies, used by the PreFlight BYOK integration in src/lib/ai.js.
  // Criterion for inclusion: the host appears in the provider's official
  // developer documentation as the canonical API base, the company has a
  // verifiable corporate identity, and the host has been stable for 12+ months.
  'openai.com',
  'api.openai.com',
  'platform.openai.com',
  'developers.openai.com',
  'anthropic.com',
  'api.anthropic.com',
  'console.anthropic.com',
  'docs.anthropic.com',
  'x.ai',
  'api.x.ai',
  'docs.x.ai',
  'console.x.ai',
  'mistral.ai',
  'api.mistral.ai',
  'console.mistral.ai',
  'deepseek.com',
  'api.deepseek.com',
  'platform.deepseek.com',
  'groq.com',
  'api.groq.com',
  'console.groq.com',
  'openrouter.ai',
  'cohere.com',
  'cohere.ai',
  'api.cohere.ai',
  'dashboard.cohere.com',
  'google.dev',
  'ai.google.dev',
  'aistudio.google.com',
  'generativelanguage.googleapis.com',
  'huggingface.co',
  'replicate.com',
  'stripe.com',
  'twilio.com',
  'sendgrid.com',
  'vercel.com',
  'netlify.com',
  'render.com',
  'fly.io',
  'supabase.co',
  'supabase.com',
  'firebase.google.com',
  'firebaseio.com',
  'googleapis.com',
  'apple.com',
  'icloud.com',
  'tailwindcss.com',
  'reactjs.org',
  'react.dev',
  'nextjs.org',
  'vuejs.org',
]);
export const URL_SUSPICIOUS_TLD_RE =
  /\.(tk|ml|ga|cf|gq|top|xyz|click|loan|work|men|surf|cyou|rest|zip|mov|wang|country|kim|science|date|stream)$/i;
// Established developer and infrastructure platforms that happen to sit on a
// TLD in the list above. The TLD heuristic is a weak signal by itself, and
// firing it on somebody's model-inference provider or package host is the kind
// of finding that gets a scanner dismissed wholesale. Real-scan finding
// 2026-07: api.together.xyz reported as a suspicious host.
//
// Entries are anchored to the registrable domain and allow subdomains. Keep
// this list short and specific: it is an exemption from a security check, so
// every addition should be a platform a developer would knowingly depend on.
export const URL_KNOWN_GOOD_HOST_RE =
  /(?:^|\.)(?:together\.xyz|nomic\.xyz|ethers\.xyz|opensea\.xyz|hf\.co|jsdelivr\.xyz|nx\.dev|blob\.vercel-storage\.com|r2\.cloudflarestorage\.xyz)$/i;

export const URL_RAW_IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
export const URL_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  't.co',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'shorte.st',
  'cutt.ly',
]);

// Returns true if host is in URL_SAFE_HOSTS or is a subdomain of any entry.
// Subdomain check protects against  and  while still
// catching deceptive look-alikes that just share a suffix.
export function isHostInSafeList(host) {
  if (URL_SAFE_HOSTS.has(host)) return true;
  for (const safe of URL_SAFE_HOSTS) {
    if (host.endsWith('.' + safe)) return true;
  }
  return false;
}

// --- GEO Hygiene: AI-search visibility ---
export const AI_CRAWLER_BOTS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'anthropic-ai',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
];

// File-size severity ladder. Four bands map directly to PreFlight's four
// severity levels. The dogfood gate fails on critical+high, so the HIGH band
// is what actually enforces "split this monolith now" — that's why the
// thresholds are tighter than the prior two-band info/info layout, which
// silently capped a 4,999-line file at "consider splitting" with no gate
// engagement. The 3,000-line HIGH bar lines up with the empirical point
// where single-file modules stop being one responsibility, hurt code
// review, and start hiding security-relevant logic in noise. The 5,000
// CRITICAL bar matches PreFlight's own past dogfood failure on the
// pre-split probes.js. Names kept for back-compat (App.jsx + tests).
export const FILE_SIZE_WARN_LINES = 1500; // -> severity: low
export const FILE_SIZE_MED_LINES = 2000; // -> severity: medium
export const FILE_SIZE_HIGH_LINES = 3000; // -> severity: high (gates dogfood)
export const FILE_SIZE_CRIT_LINES = 5000; // -> severity: critical
// Kept under the original name so existing callers compile; semantics now =
// the gating HIGH threshold. Any new code should prefer FILE_SIZE_HIGH_LINES.
export const FILE_SIZE_FAIL_LINES = FILE_SIZE_HIGH_LINES;
