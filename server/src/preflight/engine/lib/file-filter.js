// src/lib/file-filter.js
// File inclusion / exclusion rules + the four helper predicates used by probes:
//   - shouldScanFile(path)        does any FILE_INCLUDE regex match, no FILE_EXCLUDE hit
//   - isTestFile(path)            is this a *.test.* / *.spec.* / under tests/ / __tests__/
//   - isScannerSelfSource(path)   is this src/lib/probes.{js,jsx,ts,tsx} or a bundled dist/*.js
//   - isMetaDocFile(path)         is this llms.txt / robots.txt / sitemap.xml / .preflight.*

// Pattern-matching probes use the exclusion helpers to avoid self-references and noisy
// test-file matches; file-size / structural probes still see those files (the LOC count
// is real either way).

// Structural probes that count whole-project facts (missing .npmrc, architecture
// classification) still see test files; per-file code-shape probes (including the
// Code Quality cluster) skip them.
export function isTestFile(path) {
  if (!path) return false;
  if (/\.(test|spec|eval)\.[jt]sx?$/i.test(path)) return true;
  // Directory names: exact test/fixture/mock dirs plus hyphen/underscore
  // compounds (integration-tests/, memory-tests/, test-fixtures/, evals/).
  // FP triage 2026-07 (gemini-cli-fork scan): the literal alternation missed
  // every compound form, so eval fixtures and integration-test HTML fired
  // LLM Security / SEO / A11y findings.
  if (
    /(^|\/)((?:[\w.]+[-_])?tests?|__tests__|(?:[\w.]+[-_])?fixtures?|testdata|cypress|e2e|playwright|__mocks__|mocks?|evals?)\//i.test(
      path
    )
  )
    return true;
  return false;
}

// True for project markdown documentation files. The secret scanner pattern
// page explicitly promises: "PreFlight skips ... markdown documentation files
// where the key is part of an example." A user's README.md, docs/*.md, or
// guidance markdown that demonstrates the shape of an AWS/Stripe/OpenAI key is
// not a leak; it's documentation. Real secrets pasted into markdown files are
// vanishingly rare relative to documentation references to the shapes. Skip.
export function isDocumentationMarkdownFile(path) {
  if (!path) return false;
  return /\.md$/i.test(path);
}

// --- Self-source exclusion: pattern-matching probes should skip scanner internals ---
// The scanner's own regex literals and remediation copy contain the exact patterns it looks
// for (eval, PythonREPL, dangerouslySetInnerHTML, algorithm: 'none'). Without an exclusion,
// every pattern-matching probe finds itself in src/lib/probes.js and in the production
// bundle (dist/) which inlines probes.js. These aren't real vulnerabilities; they're the
// scanner's definitions of what real vulnerabilities look like.
// --- Self-scan mode: OFF by default, and that default is the whole point ---
//
// The exclusions below are a list of PreFlight's OWN paths. They exist so that
// when PreFlight scans itself, pattern-matching probes do not flag the scanner's
// own regex literals and IOC strings as if they were real vulnerabilities.
//
// Until 2026-07 this was applied unconditionally, on path alone, to every scan.
// That silently blinded USER scans too: any project with `src/components/settings/`,
// `src/learn/`, `src/lib/probes/`, or a built `dist/` had those files skipped by
// the Secret Scanner, Auth Weakness, Client Auth Storage and every other
// pattern probe. A settings directory is exactly where API keys and auth config
// live, so this was a false negative in one of the highest-value places in a
// typical app, reported to the user as silence.
//
// The exclusion is now identity-based: it applies only when the caller declares
// that this scan is PreFlight scanning itself. The browser never sets it. The
// dogfood and self-audit runs do.
let selfScanMode = false;

export function setSelfScanMode(on) {
  selfScanMode = Boolean(on);
}

export function isSelfScanMode() {
  return selfScanMode;
}

export function isScannerSelfSource(path) {
  if (!selfScanMode) return false;
  if (!path) return false;
  // The scanner's own probe modules + the threat-intel manifests + the file/suppression
  // helpers ALL contain pattern literals and IOC strings that pattern-matching probes
  // would otherwise flag against themselves.
  if (/(^|\/)src\/lib\/probes\.[jt]sx?$/i.test(path)) return true;
  if (/(^|\/)src\/lib\/probes\//i.test(path)) return true;
  // Breakers catalogue: by definition full of attack-shaped payload strings
  // (SQL injection literals, traversal paths, eval examples, JWT alg-none
  // tokens, bidi control characters). Excluded from pattern-matching probes
  // so PreFlight scanning its own source doesn't false-positive on the
  // adversarial-input catalogue it ships to users.
  if (/(^|\/)src\/lib\/breakers\.[jt]sx?$/i.test(path)) return true;
  if (/(^|\/)src\/lib\/threat-intel\.[jt]sx?$/i.test(path)) return true;
  if (/(^|\/)src\/lib\/file-filter\.[jt]sx?$/i.test(path)) return true;
  if (/(^|\/)src\/lib\/stable-id\.[jt]sx?$/i.test(path)) return true;
  if (/(^|\/)src\/lib\/suppression\.[jt]sx?$/i.test(path)) return true;
  if (/(^|\/)src\/data\/compromised-packages\.[jt]s$/i.test(path)) return true;
  // v0.4: Learn content (markdown) + the components that render Settings / Learn pages
  // routinely contain pattern strings, sample IOC text, and reference URLs in their
  // teaching copy. They're not real code — exclude from pattern-matching probes.
  if (/(^|\/)src\/learn\//i.test(path)) return true;
  if (/(^|\/)src\/components\/learn\//i.test(path)) return true;
  if (/(^|\/)src\/components\/settings\//i.test(path)) return true;
  if (/(^|\/)src\/lib\/learn-content\.[jt]s$/i.test(path)) return true;
  // The Vite-bundled JS in dist/ contains the inlined probe source.
  if (/(^|\/)dist\/.*\.js$/i.test(path)) return true;
  return false;
}

// --- Template-fragment detection: server-rendered templates aren't full HTML documents ---
// Jinja2 / Django / ERB / Handlebars / Pug / Liquid / Vue templates often end up with the
// `.html` extension but begin with `{% extends "base.html" %}` (or similar inheritance
// directives) — meaning they're FRAGMENTS, not full documents. The `<html>`, `<head>`,
// and CSP `<meta>` live in the base template they extend.
//
// Probes that check for `<html lang>`, CSP meta tags, or skip-link presence produce
// false positives on these fragments because the directive they're checking for lives
// one layer up in the base.
//
// Detection: the file has no `<html ` tag at all, OR begins (after whitespace) with a
// template inheritance / include directive.
const TEMPLATE_INHERITANCE_RE =
  /^\s*(?:{%\s*extends|{%\s*block|{#|<%@|---\s*\n|@extends|@section)/i;
export function isTemplateFragment(content) {
  if (!content) return false;
  if (TEMPLATE_INHERITANCE_RE.test(content)) return true;
  // No <html ...> tag anywhere → fragment (or partial / include).
  if (!/<html\b/i.test(content)) return true;
  return false;
}

// --- Meta-doc exclusion: discoverability files inherently contain URL references ---
// llms.txt, robots.txt, sitemap.xml, .preflight.yml/json are documentation/metadata files
// that legitimately list URLs as content (sitemap entries, llms.txt outbound links, suppress-
// rule reasons that quote probe titles). Pattern-matching probes scanning them produce noise:
// URL Reputation hits every documented help-link, and content probes can match suppress-rule
// title-patterns. We want these files visible to SEO/GEO probes (which target them by name)
// but invisible to generic content probes.
export function isMetaDocFile(path) {
  if (!path) return false;
  if (/(^|\/)llms\.txt$/i.test(path)) return true;
  if (/(^|\/)robots\.txt$/i.test(path)) return true;
  if (/(^|\/)sitemap\.xml$/i.test(path)) return true;
  if (/(^|\/)\.preflight\.(ya?ml|json)$/i.test(path)) return true;
  return false;
}

// True for the conventional ".env documentation" filenames: a template that
// is SUPPOSED to be committed and holds placeholder values, not secrets.
// Covers every common separator and marker we have seen in the wild:
//   .env.example  .env-example  .env_example  .env.sample  .env.template
//   .env.dist  .env.defaults  .env.tpl  .env.local.example  env.example
// A real ".env" / ".env.local" / ".env.production" is NOT a template and
// must still be flagged. An early user hit this: a template named
// `.env-example` was classed high risk because the old check only matched a
// dot before "example". Presence of a template file is normal and safe;
// a real secret accidentally pasted into one is still caught by the secret
// scanner, which inspects content independently.
const ENV_TEMPLATE_MARKER = /(?:example|sample|template|dist|defaults|tpl|placeholder)/i;
export function isEnvTemplateFile(path) {
  if (!path) return false;
  const base = path.split('/').pop() || '';
  if (!/^\.?env(?=$|[.\-_])/i.test(base)) return false;
  // Strip the leading ".env" / "env" then look for a template marker token
  // among the remaining dot/dash/underscore-separated segments.
  const rest = base.replace(/^\.?env/i, '');
  if (!rest) return false; // bare ".env" / "env" is NOT a template
  return ENV_TEMPLATE_MARKER.test(rest);
}

export const FILE_INCLUDE = [
  /(^|\/)\.env(\..+)?$/i,
  /package\.json$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /(^|\/)\.npmrc$/,
  /\.tsx?$/,
  /\.jsx?$/,
  /\.mjs$/,
  /\.cjs$/,
  /\.py$/,
  /\.go$/,
  /\.rb$/,
  /\.php$/,
  /\.java$/,
  /\.html?$/i,
  /\.vue$/,
  /\.svelte$/,
  /\.astro$/,
  /firestore\.rules$/,
  /storage\.rules$/,
  /firebase\.json$/,
  /(^|\/)supabase\/.*\.sql$/,
  /migrations\/.*\.sql$/,
  /next\.config\.(js|mjs|ts)$/,
  /vercel\.json$/,
  /netlify\.toml$/,
  /\.config\.[jt]s$/,
  /Dockerfile$/,
  /docker-compose\.ya?ml$/,
  // SEO / GEO / discoverability files
  /(^|\/)llms\.txt$/i,
  /(^|\/)robots\.txt$/i,
  /(^|\/)sitemap\.xml$/i,
  // Repo-local PreFlight config so the suppression workflow loads on GitHub URL scans
  /(^|\/)\.preflight\.(ya?ml|json)$/i,
  // 2026 additions: AI tooling configs, MCP servers, CI workflows
  /\.github\/workflows\/.+\.ya?ml$/,
  /(^|\/)\.cursorrules$/,
  /\.cursor\/rules\/.+\.(mdc?|md|txt)$/,
  /(^|\/)\.windsurfrules$/,
  /(^|\/)CLAUDE\.md$/,
  /claude_desktop_config\.json$/,
  /(^|\/)\.mcp\.json$/,
  /(^|\/)mcp\.json$/,
  // Mini Shai-Hulud post-infection artifacts (May 11, 2026 TanStack campaign):
  // the worm writes itself into .claude/* and .vscode/* to survive npm uninstall.
  /(^|\/)\.claude\/settings\.json$/,
  /(^|\/)\.claude\/setup\.mjs$/,
  /(^|\/)\.claude\/router_runtime\.js$/,
  /(^|\/)\.vscode\/tasks\.json$/,
  /(^|\/)\.vscode\/setup\.mjs$/,
  /(^|\/)tanstack_runner\.js$/,
  /(^|\/)router_init\.js$/,
];

export const FILE_EXCLUDE = [
  /node_modules/,
  /(^|\/)\.git\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)coverage\//,
  /(^|\/)\.cache\//,
  /(^|\/)\.turbo\//,
];

export function shouldScanFile(path) {
  if (FILE_EXCLUDE.some((p) => p.test(path))) return false;
  return FILE_INCLUDE.some((p) => p.test(path));
}

// ==========================================================================
// PROBE MODULES
