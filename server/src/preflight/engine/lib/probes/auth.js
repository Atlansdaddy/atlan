// src/lib/probes/auth.js
//
// Authentication and authorization probes: weak auth, admin routes, client-side auth storage, cookie flags, API-route auth.
//
// Extracted from the prior builtin.js monolith when it crossed the
// file-size HIGH threshold. Probe bodies are byte-identical to the
// originals; only the location moved. Public import surface is
// preserved by builtin.js, which is now a back-compat shim re-exporting
// every probe function from its new family file.

import { isTestFile, isScannerSelfSource } from '../file-filter.js';
import {
  collectSafeBindings,
  resolvesToConstant,
  collectFunctionBodies,
  expandCalledHelpers,
} from './_internal/const-eval.js';
import {
  SECRET_VALUE_PLACEHOLDER_RE,
  isMatchInPlaceholderNamedAssignment,
  maskBlockCommentsAndTemplateLiterals,
} from './_internal/masking.js';

// Strip a single line of `// ...` comments and `/* ... */` (within-line) before testing for code patterns.
// Heuristic — won't fool template literals or strings containing //, but kills the common false-positive
// of matching `eval()` or `algorithm: none` inside a TODO comment.
function stripLineComments(line) {
  // Remove block comments first.
  let s = line.replace(/\/\*[\s\S]*?\*\//g, '');
  // Find an unquoted // and chop.
  let inSingle = false,
    inDouble = false,
    inBack = false;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    const prev = j > 0 ? s[j - 1] : '';
    if (c === "'" && prev !== '\\' && !inDouble && !inBack) inSingle = !inSingle;
    else if (c === '"' && prev !== '\\' && !inSingle && !inBack) inDouble = !inDouble;
    else if (c === '`' && prev !== '\\' && !inSingle && !inDouble) inBack = !inBack;
    else if (c === '/' && s[j + 1] === '/' && !inSingle && !inDouble && !inBack) {
      return s.slice(0, j);
    }
  }
  return s;
}

// Known HTML sanitizers. A value wrapped in one of these has been through the
// escaping step the finding would have asked for, so flagging it is telling the
// author to do what they already did.
const HTML_SANITIZER_RE =
  /\b(?:DOMPurify\s*\.\s*sanitize|sanitizeHtml|sanitize_html|xss|he\s*\.\s*encode|escapeHtml|escape_html|validator\s*\.\s*escape|purify\s*\.\s*sanitize)\s*\(/;

// Pull the expression assigned to __html, following up to three lines so the
// common prettier-wrapped form is covered:
//   dangerouslySetInnerHTML={{
//     __html: value,
//   }}
// Returns null when no __html key is present on the line or its continuation.
function extractHtmlValue(line, lines, idx) {
  const span = lines
    .slice(idx, Math.min(lines.length, idx + 3))
    .join('\n')
    .replace(/\n\s*/g, ' ');
  const m = span.match(/__html\s*:\s*([\s\S]*?)(?:,\s*\}|\}\s*\}|\s*\}\s*$)/);
  if (!m) return null;
  return m[1].trim();
}

// True when the value could carry attacker-controlled HTML. A literal the
// author typed cannot; anything computed might.
//
// `bindings` is the same-file constant map from collectSafeBindings. Real-scan
// finding 2026-07 (Atlan cockpit): without it, every one of a 22-finding XSS
// report was a false positive, because the classifier could see that a value
// was an expression but not that the expression resolves to a constant.
function isTaintableHtmlValue(value, bindings) {
  if (!value) return false;
  // Sanitized at the sink by a well-known library.
  if (HTML_SANITIZER_RE.test(value)) return false;
  // A plain string literal with no interpolation. Empty string included.
  if (/^'[^']*'$/.test(value) || /^"[^"]*"$/.test(value)) return false;
  // A template literal with no ${} substitution is still a constant.
  if (/^`[^`]*`$/.test(value) && !/\$\{/.test(value)) return false;
  // Resolves to something the author wrote: a const literal, a numeric value,
  // the author's own escaper, or a function that only returns literals.
  if (resolvesToConstant(value, bindings)) return false;
  return true;
}

export function probeAuthWeakness(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    // Hardcoded password in YAML / JSON / .env / config. Separate handler
    // because these file types don't have the JS comment/template semantics
    // the rest of this probe assumes. Match `password: 'literal'` (YAML),
    // `"password": "literal"` (JSON), `DB_PASSWORD=value` (.env), all with
    // placeholder filtering.
    const isConfigFile =
      /\.(?:ya?ml|json|properties|toml|conf|cfg|ini)$/i.test(file.path) ||
      /(?:^|\/)\.env(?:\.\w+)?$/i.test(file.path);
    if (isConfigFile) {
      const lines = file.content.split('\n');
      lines.forEach((rawLine, i) => {
        // JSON/YAML/TOML: `"password": "value"` or `password: 'value'`. Allow
        // an optional close-quote on the key.
        // .env: `DB_PASSWORD=value` (no quotes around the value typically).
        const m = rawLine.match(
          /\b(\w*(?:password|passwd|pwd|secret|api[_-]?password))\b["']?\s*[:=]\s*["']?([^"'\s\n,}]{3,})["']?/i
        );
        if (!m) return;
        const value = m[2];
        if (SECRET_VALUE_PLACEHOLDER_RE.test(value)) return;
        if (/^[$!#]/.test(value)) return;
        if (/^(?:\$\{|process\.env\.)/.test(value)) return;
        // skip comment-only lines in YAML/TOML/.env
        if (/^\s*[#;]/.test(rawLine)) return;
        findings.push({
          id: `auth-hardcodedpwd-config-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'Hardcoded password in config file',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-798',
          file: file.path,
          line: i + 1,
          evidence: rawLine.trim().slice(0, 200),
          remediation:
            'Configs checked into git ship with the password. Use env interpolation (${DB_PASSWORD}), a secret manager reference, or move the secret out of the config entirely. Rotate the leaked value.',
        });
      });
      return;
    }
    if (!/\.[jt]sx?$/.test(file.path)) return;
    // Mask the whole content so block comments AND template-literal documentation
    // snippets (e.g. Demi persona spec strings) no longer trip the regexes.
    // The mask preserves indices and newlines, so per-line iteration and the
    // emitted line numbers stay correct.
    // Narrow mask: blanks block comments, line comments, and backtick template
    // literals. Single/double-quoted string content stays visible so the
    // regexes can still see real auth-token-name string literals.
    const maskedContent = maskBlockCommentsAndTemplateLiterals(file.content);
    // Same-file constants, numeric bindings, local escapers and literal-only
    // functions, resolved once per file for the HTML sink classifier below.
    const safeBindings = collectSafeBindings(file.content);
    const maskedLines = maskedContent.split('\n');
    const originalLines = file.content.split('\n');
    maskedLines.forEach((rawLine, i) => {
      const line = stripLineComments(rawLine);
      const realLine = originalLines[i] || '';
      // Match quoted OR unquoted "none" — agent FN: `algorithm: none` (no quotes) used to evade.
      if (/(?:algorithm|alg)\s*:\s*['"]?none['"]?(?:\s|,|$)/i.test(line)) {
        findings.push({
          id: `auth-algnone-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'JWT signed with algorithm "none"',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-327',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim(),
          remediation: `alg: none means tokens are unsigned. Anyone can forge a token claiming to be any user. Use HS256 with a strong secret or RS256 with a key pair.`,
        });
      }
      if (/jwt\.verify\([^,)]+\)/.test(line) && !/secret|publicKey|key/.test(line)) {
        findings.push({
          id: `auth-noverify-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'jwt.verify called without secret argument',
          severity: 'high',
          category: 'Auth & Access',
          cwe: 'CWE-347',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim(),
          remediation: `Verify with an explicit secret or public key. Without one, signature validation may be skipped depending on the library, allowing forged tokens.`,
        });
      }
      if (/eval\s*\(/.test(line) && !/eslint-disable/.test(line)) {
        findings.push({
          id: `code-eval-${file.path}-${i}`,
          probe: 'Code Injection',
          title: 'eval() usage detected',
          severity: 'high',
          category: 'Code Injection',
          cwe: 'CWE-95',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation: `eval() executes arbitrary code. If the input is ever user-controlled, this is RCE. Replace with safe alternatives: JSON.parse for data, a real expression parser, or a switch statement for known operations.`,
        });
      }
      // dangerouslySetInnerHTML: fire on the VALUE, not on the mention.
      //
      // Adversarial round 2026-07: this used to fire on any line containing the
      // identifier, which flagged `__html: ""`, `__html: "<b>ok</b>"` and
      // `__html: DOMPurify.sanitize(x)`. The last one is the worst: our own
      // remediation text tells people to sanitize with DOMPurify, and then we
      // flagged them for having done it. That is the single largest
      // false-positive class this probe produced.
      //
      // A constant cannot carry an injection. Only a value the author did not
      // fully write is a sink.
      if (/dangerouslySetInnerHTML/.test(line)) {
        const htmlValue = extractHtmlValue(realLine, originalLines, i);
        if (htmlValue !== null && isTaintableHtmlValue(htmlValue, safeBindings)) {
          findings.push({
            id: `code-dsih-${file.path}-${i}`,
            probe: 'Code Injection',
            title: 'dangerouslySetInnerHTML receives a non-constant value',
            severity: 'medium',
            category: 'Code Injection',
            cwe: 'CWE-79',
            file: file.path,
            line: i + 1,
            evidence: realLine.trim().slice(0, 200),
            remediation: `dangerouslySetInnerHTML bypasses React's escaping and parses its input as HTML. The value here is computed rather than written literally, so whether this is XSS depends entirely on where it came from. Sanitize at the boundary with DOMPurify.sanitize(value), or render the text through normal JSX so React escapes it. A string literal written in the source is not flagged, because a constant cannot carry an injection.`,
          });
        }
      }
      // XSS depth round 2 (2026-06-05): the original probe knew one sink. Real
      // XSS surface is 25+ sinks across DOM, framework HTML bypasses, and
      // Trusted-Types disabling. Add the API-contract-unsafe sinks (always
      // unsafe by API definition regardless of source) at medium. Sanitizer-
      // wrapped values (DOMPurify, sanitize-html, xss, validator.escape, he)
      // are suppressed by the masked-line scan we already apply earlier.
      const XSS_SANITIZED_RE =
        /\b(?:DOMPurify\.sanitize|sanitizeHtml|xss\s*\(|he\.encode|escapeHtml|validator\.escape)\s*\(/;
      if (!XSS_SANITIZED_RE.test(line)) {
        // DOM API sinks. innerHTML/outerHTML assigning a NON-literal value;
        // insertAdjacentHTML; document.write/writeln; setHTMLUnsafe;
        // parseHTMLUnsafe; createContextualFragment; jQuery .html() / $.parseHTML;
        // javascript: URL assignment.
        const xssDomRe =
          /\.\s*insertAdjacentHTML\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(|\.\s*setHTMLUnsafe\s*\(|\b(?:Document|Element)\s*\.\s*parseHTMLUnsafe\s*\(|\.\s*createContextualFragment\s*\(|\$\([^)]*\)\s*\.\s*html\s*\(|\$\s*\.\s*parseHTML\s*\(/;
        // innerHTML/outerHTML assignment. Capture the right-hand side and
        // classify it, rather than guarding with a negative lookahead.
        //
        // Adversarial round 2026-07: the old guard was
        //   /...\s*\+?=\s*(?!['"`][^'"`]{0,80}['"`]\s*[;,)\]]?\s*$)/
        // and it inverted. The `\s*` before the lookahead can backtrack to
        // zero width, which evaluates the lookahead against the SPACE after
        // `=` instead of the quote. The quote test then fails, so the negative
        // lookahead succeeds, so `el.innerHTML = "static"` matched. The guard
        // was there the whole time and had never worked.
        // Detect on the MASKED line so an assignment quoted inside a block
        // comment or a doc template literal still cannot fire. Classify the
        // value from the ORIGINAL line, because the mask blanks template
        // literal contents, which turns `<p>${x}</p>` into a substitution-free
        // string and would read a tainted interpolation as a constant.
        const INNER_HTML_ASSIGN = /\b(?:innerHTML|outerHTML)\s*\+?=\s*([\s\S]+?)\s*;?\s*$/;
        const innerHtmlAssignMatch = line.match(INNER_HTML_ASSIGN);
        const innerHtmlRealMatch = realLine.match(INNER_HTML_ASSIGN);
        const xssInnerHTMLAssignHit =
          innerHtmlAssignMatch !== null &&
          isTaintableHtmlValue((innerHtmlRealMatch || innerHtmlAssignMatch)[1], safeBindings);
        const xssFrameworkRe =
          /\bv-html\s*=\s*["']|\{@html\s+|<\w[^>]*\sinnerHTML\s*=\s*\{|\[\s*innerHTML\s*\]\s*=\s*["']|\.\s*bypassSecurityTrust(?:Html|Script|Style|Url|ResourceUrl)\s*\(|\bng-bind-html\s*=\s*["']|\$sce\s*\.\s*trustAs(?:Html|Js|Css|Url|ResourceUrl)\s*\(|\bunsafe(?:HTML|SVG|Static)\s*\(|\{\{\{[^}]+\}\}\}/;
        const xssJsUrlRe =
          /\b(?:location(?:\.href|\.assign)?|window\.location|\.href|\.src)\s*=\s*['"`]\s*javascript:/i;
        const xssTrustedTypesBypassRe = /trustedTypes\s*\.\s*createPolicy\s*\(\s*['"]default['"]/;
        if (
          xssDomRe.test(line) ||
          xssInnerHTMLAssignHit ||
          xssFrameworkRe.test(line) ||
          xssJsUrlRe.test(line) ||
          xssTrustedTypesBypassRe.test(line)
        ) {
          findings.push({
            id: `code-xss-${file.path}-${i}`,
            probe: 'Code Injection',
            title: 'Unsafe HTML/JS sink (XSS surface)',
            severity: 'medium',
            category: 'Code Injection',
            cwe: 'CWE-79',
            file: file.path,
            line: i + 1,
            evidence: realLine.trim().slice(0, 200),
            remediation:
              'This sink parses its input as HTML or JS at runtime. If the value can reach this from request, storage, message, or third-party fetch, it is XSS. Sanitize with DOMPurify (HTML) or escape (text). For frameworks: prefer text bindings; avoid v-html, {@html}, [innerHTML], bypassSecurityTrustHtml, unsafeHTML, Handlebars triple-stache. For JS-URL sinks: validate the protocol explicitly.',
          });
        }
      }
      // EXPANSION (Thread 6, 2026-06-05): the documented 4 shapes above are
      // far from the full A07 surface. The shapes below are the most common
      // shapes AI-generated code produces and that cause real auth breaks.
      //
      // Plaintext password comparison: `req.body.password === user.password`
      // or against a `.password`/`storedPassword` field. The defining shape is
      // equality (=== or ==) against an identifier whose name ends in
      // `password` (case-insensitive). Real auth uses bcrypt.compare or
      // argon2.verify, which look completely different.
      if (
        (/(?:\b\w*(?:password|passwd|pwd)\b)\s*(?:===|==)\s*\w+(?:\.\w+)*\b/i.test(line) ||
          /\w+(?:\.\w+)*\s*(?:===|==)\s*\b\w*(?:password|passwd|pwd)\b/i.test(line)) &&
        // Self-test / fixture values: `retrieved === testPassword` in a
        // keychain round-trip check is not an auth path. FP triage 2026-07.
        !/\b(?:test|dummy|mock|sample|expected|fake|placeholder)_?(?:password|passwd|pwd)\b/i.test(
          line
        )
      ) {
        findings.push({
          id: `auth-plainpasswordcompare-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'Plaintext password comparison',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-261',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'Never compare passwords with === / ==. That implies the password is stored in plaintext or compared as raw input. Use bcrypt.compare(input, hash) or argon2.verify(hash, input) — both are constant-time and force you to store a real hash.',
        });
      }
      // Weak password hashing: md5 / sha1 / sha256 (no KDF) applied to a value
      // named password/passwd/pwd. Cryptographic hashes are designed to be fast;
      // password hashes (bcrypt/argon2/scrypt) are designed to be slow with a
      // tunable work factor. Using a plain hash for passwords is an OWASP A02
      // classic.
      if (
        /\b(?:md5|sha1)\s*\([^)]*\b\w*(?:password|passwd|pwd|pw)\b/i.test(line) ||
        /createHash\(\s*['"](?:md5|sha1)['"]\s*\)\s*\.\s*update\s*\(\s*[^)]*?\b(?:password|passwd|pwd|pw)\b/i.test(
          line
        )
      ) {
        findings.push({
          id: `auth-weakhash-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'Weak password hash (MD5/SHA1)',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-916',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'MD5 and SHA1 are designed to be fast — that is exactly wrong for password hashing. Modern attackers crack them at billions of attempts per second on commodity GPUs. Use bcrypt (cost factor 12+), argon2id (memory cost 19 MiB+), or scrypt.',
        });
      }
      // sha256 used for password hashing (without a KDF wrapper like
      // PBKDF2/HKDF): still cryptographic, still wrong for passwords. Same
      // reason as MD5/SHA1 — too fast, no work factor.
      if (
        /createHash\(\s*['"]sha256['"]\s*\)\s*\.\s*update\s*\(\s*\b\w*(?:password|passwd|pwd)\b/i.test(
          line
        ) ||
        /\bsha256\s*\(\s*\b\w*(?:password|passwd|pwd)\b/i.test(line)
      ) {
        // Only fire if PBKDF2/HKDF/scrypt/bcrypt/argon2 is NOT in the same file.
        // If the developer is wrapping sha256 in a real KDF, it's defensible.
        const fileHasKdf = /pbkdf2|hkdf|scrypt|bcrypt|argon2/i.test(file.content);
        if (!fileHasKdf) {
          findings.push({
            id: `auth-sha256pwd-${file.path}-${i}`,
            probe: 'Auth Weakness',
            title: 'SHA-256 used for password hashing without a KDF',
            severity: 'high',
            category: 'Auth & Access',
            cwe: 'CWE-916',
            file: file.path,
            line: i + 1,
            evidence: realLine.trim().slice(0, 200),
            remediation:
              'SHA-256 alone is still a fast hash. Wrap it in PBKDF2 (Node crypto.pbkdf2 with at least 600,000 iterations) or switch to bcrypt/argon2id/scrypt. Adding a salt does not fix the speed problem.',
          });
        }
      }
      // Default credentials: admin/admin, root/root, test/test123,
      // user/password patterns in source. Strong "this was never updated"
      // signal in AI-generated code. Match the pattern as a kv-pair where the
      // key is admin/root/test/user/etc. and the value is the same word, a
      // single digit, or a known weak default.
      if (
        /(['"])(admin|root|test|user|guest)\1\s*[,:]\s*(['"])(\2|admin|root|password|123456|test123|password1|guest)\3/i.test(
          line
        ) ||
        /(?:user(?:name)?|login)\s*[:=]\s*['"](?:admin|root|test)['"][\s\S]{0,40}?(?:password|pass|pwd)\s*[:=]\s*['"](?:admin|root|password|123456|test123|password1)['"]/i.test(
          line
        )
      ) {
        findings.push({
          id: `auth-defaultcreds-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'Default credentials in source',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-798',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'admin/admin, root/root, test/test123 — these are the first guesses an attacker tries. Defaults baked into source mean every clone of this repo ships with the same backdoor. Generate per-deploy credentials with a real secret manager; require rotation on first login.',
        });
      }
      // Session token in URL. Putting an auth token in the query string puts
      // it in browser history, in the Referer header sent to third parties,
      // in server access logs, and in any analytics SDK the page loads. The
      // shape: a literal or template-string URL containing ?token= /
      // ?sessionId= / ?accessToken= / ?jwt= with a real-looking value.
      // Use realLine because the URL contains `//` that stripLineComments
      // would chop. Template literals in realLine still trigger here (the
      // FP risk on documentation strings is acceptable for this check).
      if (
        /[?&](?:token|sessionId|session_id|accessToken|access_token|jwt|auth(?:Token)?)=/i.test(
          realLine
        ) &&
        /(?:fetch|axios|http|location\.href|window\.location|new\s+URL|navigate|router\.push|redirect)/i.test(
          realLine
        )
      ) {
        findings.push({
          id: `auth-tokeninurl-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'Auth token passed in URL query string',
          severity: 'high',
          category: 'Auth & Access',
          cwe: 'CWE-598',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'Query strings leak: browser history, server access logs, the Referer header sent to every third-party resource the page loads, analytics SDKs. Send tokens in an Authorization: Bearer header or an httpOnly cookie. Never as ?token=.',
        });
      }
      // Hardcoded password literal in a const/let/var. probeSecrets handles
      // known provider patterns (sk_live_, AKIA, etc.); a bare
      // `const PASSWORD = 'admin123'` is a different shape. The placeholder-
      // name filter (SAMPLE_/EXAMPLE_/FAKE_/TEST_KEY etc., reused from
      // probeSecrets via isMatchInPlaceholderNamedAssignment) suppresses
      // sample/test fixtures; the secret-value placeholder filter suppresses
      // CHANGEME/REPLACE/etc. values.
      // Object-literal credential fields: `password: 'literal'`,
      // `pass: 'literal'`, `username: 'admin', password: 'admin'` in a JS
      // config object. Match the key-value pair on a single line. (Multi-line
      // is handled by the whole-content pass below.)
      {
        const objLiteralCred = /\b(?:password|passwd|pwd|pass|secret)\s*:\s*(['"])([^'"\n]{3,})\1/i;
        const m = line.match(objLiteralCred);
        if (m) {
          const value = m[2];
          const matchIdx = file.content.indexOf(realLine);
          const inPlaceholderCtx =
            matchIdx >= 0 && isMatchInPlaceholderNamedAssignment(file.content, matchIdx);
          const valueIsPlaceholder = SECRET_VALUE_PLACEHOLDER_RE.test(value);
          if (!inPlaceholderCtx && !valueIsPlaceholder) {
            findings.push({
              id: `auth-objpwd-${file.path}-${i}`,
              probe: 'Auth Weakness',
              title: 'Hardcoded password in object literal',
              severity: 'critical',
              category: 'Auth & Access',
              cwe: 'CWE-798',
              file: file.path,
              line: i + 1,
              evidence: realLine.trim().slice(0, 200),
              remediation:
                'Object-literal passwords (auth: { user, pass: "literal" }) ship with the repo. Use env vars (process.env.SMTP_PASSWORD), a secret manager reference, or runtime injection. Rotate the leaked value.',
            });
          }
        }
      }
      // Basic auth header: `Authorization: 'Basic ' + Buffer.from('user:pass')`,
      // `const AUTH = 'Basic <base64>'`. Both are hardcoded creds in HTTP headers.
      // A single title-case word after "Basic" is prose ('Basic Controls',
      // 'Basic Authentication'), not a base64 credential — base64 of any
      // user:pass starts lowercase or mixes in digits/+/=. FP triage 2026-07.
      const basicTok = realLine.match(/['"]Basic\s+([A-Za-z0-9+/=]{8,})['"]/);
      const basicIsProse = basicTok !== null && /^[A-Z][a-z]+$/.test(basicTok[1]);
      if (
        /Buffer\.from\s*\(\s*['"][^'"\n]+:[^'"\n]+['"]\s*\)\s*\.\s*toString\s*\(\s*['"]base64/i.test(
          realLine
        ) ||
        (basicTok !== null && !basicIsProse)
      ) {
        findings.push({
          id: `auth-basicheader-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'Hardcoded Basic auth credentials in HTTP header',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-798',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'Basic auth strings encoded inline ship the credentials with the repo. Load user:pass from env / secret manager and encode at runtime, or use a Bearer token from a real auth flow.',
        });
      }
      // Plaintext password persisted to DB. Two shapes:
      //  - `INSERT INTO users (..., password) VALUES (..., 'literal')`
      //  - ORM: `db.user.create({ data: { ..., password: req.body.password } })`
      // The second is plaintext-from-request — taint flow.
      if (
        /INSERT\s+INTO\s+[\w.]+\s*\([^)]*\bpassword\b[^)]*\)\s*VALUES\s*\([^)]*['"][^'"]{3,}['"]/i.test(
          realLine
        ) ||
        /(?:\.create|\.update|\.insert|\.save)\s*\([^)]*\bpassword\s*:\s*(?:req\.body\.\w*|input\.\w*|userInput|user\.password)/i.test(
          realLine
        )
      ) {
        findings.push({
          id: `auth-plainpwdstore-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'Plaintext password persisted to database',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-256',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'Storing raw passwords means any DB read compromises every account. Hash with bcrypt.hash(password, 12) / argon2.hash / scrypt before insert, store the hash, never the plaintext. Constant-time compare at login time.',
        });
      }
      {
        // Match the assignment RHS specifically. Only fire if the value
        // IMMEDIATELY after `=` is a string literal (not a function call,
        // not a process.env access, not a logical-or default chain). The
        // canonical leak is `const PASSWORD = 'literal'` — exactly that.
        // Identifier must end in PASSWORD/PASSWD/PWD/SECRET, possibly with
        // a prefix like API_, DB_, JWT_ (all-caps + underscore + suffix).
        const credLiteral =
          /(?:const|let|var)\s+((?:[A-Z][A-Z0-9_]*_)?(?:PASSWORD|PASSWD|PWD|SECRET))\b\s*[:=]\s*(['"])([^'"\n]{3,})\2\s*[;,)\]}\s]*$/;
        const m = line.match(credLiteral);
        if (m) {
          const varName = m[1];
          const value = m[3];
          const matchIdx = file.content.indexOf(realLine);
          const inPlaceholderCtx =
            matchIdx >= 0 && isMatchInPlaceholderNamedAssignment(file.content, matchIdx);
          const valueIsPlaceholder = SECRET_VALUE_PLACEHOLDER_RE.test(value);
          if (!inPlaceholderCtx && !valueIsPlaceholder) {
            findings.push({
              id: `auth-hardcodedpwd-${file.path}-${i}`,
              probe: 'Auth Weakness',
              title: `Hardcoded password literal (${varName})`,
              severity: 'critical',
              category: 'Auth & Access',
              cwe: 'CWE-798',
              file: file.path,
              line: i + 1,
              evidence: realLine.trim().slice(0, 200),
              remediation:
                'Passwords pasted into source are committed to git history forever and shipped to every developer who clones the repo. Load from a secret manager (Doppler, 1Password, Vault, AWS Secrets Manager) or environment variable, NEVER a literal.',
            });
          }
        }
      }
      // JWT signing with a literal short secret. jwt.sign(payload, 'literal').
      // Short literal secrets (typically <32 chars) are brute-forceable in
      // hours on a laptop. Use `[^)]*?` so the regex backtracks past commas
      // INSIDE the payload object (e.g. `jwt.sign({sub, role}, 'secret')`).
      if (/jwt\.sign\s*\([^)]*?,\s*['"][^'"]{1,31}['"]\s*[\),]/.test(line)) {
        findings.push({
          id: `auth-weakjwtsecret-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'JWT signed with a short literal secret',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-321',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'A 6-character literal secret is brute-forceable in seconds. Use crypto.randomBytes(64).toString("hex") at minimum, loaded from env / secret manager. The secret must be unguessable.',
        });
      }
      // JWT verify with empty-string secret: `jwt.verify(token, '')`. Some
      // legacy library versions accept this and skip verification entirely.
      if (/jwt\.verify\s*\(\s*[^,)]+,\s*(['"])\1\s*[\),]/.test(line)) {
        findings.push({
          id: `auth-emptyjwtsecret-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'jwt.verify called with empty-string secret',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-347',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'An empty string is not a secret. Some library versions treat empty-string secrets as "skip verification" — every forged token verifies as authentic. Load the real secret from env / secret manager and assert it is non-empty before passing.',
        });
      }
      // Default credentials inside a connection-string URL:
      // `mysql://root:root@host`, `postgres://admin:admin@host`. Same identifier
      // for user AND password is the strongest "this was never changed" signal.
      // Use realLine — stripLineComments mangles the `//` in the URL scheme.
      if (
        /(?:mysql|postgres(?:ql)?|mongodb|mongo|redis|amqp|http|https|ftp|smtp|imap):\/\/(\w+):(\w+)@/i.test(
          realLine
        )
      ) {
        const urlMatch = realLine.match(
          /(?:mysql|postgres(?:ql)?|mongodb|mongo|redis|amqp|http|https|ftp|smtp|imap):\/\/(\w+):(\w+)@/i
        );
        if (urlMatch && urlMatch[1].toLowerCase() === urlMatch[2].toLowerCase()) {
          findings.push({
            id: `auth-defaultcredsurl-${file.path}-${i}`,
            probe: 'Auth Weakness',
            title: 'Default credentials in connection string (user == password)',
            severity: 'critical',
            category: 'Auth & Access',
            cwe: 'CWE-798',
            file: file.path,
            line: i + 1,
            evidence: realLine.trim().slice(0, 200),
            remediation:
              'Same identifier for both user AND password (root:root, admin:admin) is the strongest "this is the install default" signal. Set per-deploy credentials at provisioning time.',
          });
        }
      }
      // Express handler writes to DB with no req.user / auth check on the
      // same line — match the destructive db call and confirm the file has
      // NO auth signals anywhere.
      if (
        /\b(?:db|prisma|knex|sequelize)\s*\.\s*\w+\s*\.\s*(?:delete|update|create|destroy|findAll|findMany|getAll)\s*\(/.test(
          line
        )
      ) {
        const fileNoAuth =
          !/(?:req\.user|req\.session|req\.auth|getServerSession|getUser|currentUser|withAuth|requireAuth|authenticate|jwt\.verify\s*\([^,)]+,)/i.test(
            file.content
          );
        const inExpressOrNext =
          /\b(?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(/.test(file.content) ||
          /export\s+(?:async\s+)?(?:function|const)\s+(?:GET|POST|PUT|PATCH|DELETE)\b/.test(
            file.content
          ) ||
          // Next.js Pages Router uses `export default async function handler(req, res)`.
          /export\s+default\s+(?:async\s+)?function\s+\w+\s*\(\s*req\b/.test(file.content) ||
          /pages\/api\//.test(file.path);
        if (fileNoAuth && inExpressOrNext) {
          findings.push({
            id: `auth-noauthcheck-${file.path}-${i}`,
            probe: 'Auth Weakness',
            title: 'DB mutation in handler with no auth check anywhere in the file',
            severity: 'high',
            category: 'Auth & Access',
            cwe: 'CWE-306',
            file: file.path,
            line: i + 1,
            evidence: realLine.trim().slice(0, 200),
            remediation:
              'A handler that mutates the database with no auth gate is open to anyone. Add req.user / getServerSession() / passport.authenticate at the top of the handler, return 401 if absent, then check ownership of the target row before the mutation.',
          });
        }
      }
      // JWT no-expiresIn (CWE-613): the token is valid forever. Both this
      // production probe AND the JS-AUTH-001 shadow probe emit identical
      // findings (same id, title, severity) so the v05-phase2 parity test
      // stays green. Sync the emission shape if one is changed.
      if (/jwt\.sign\s*\(/.test(line)) {
        const startIdx = file.content.indexOf(realLine);
        const around = startIdx >= 0 ? file.content.slice(startIdx, startIdx + 400) : line;
        if (!/expiresIn\s*:|\bexp\s*:/.test(around)) {
          findings.push({
            id: `auth-noexpiry-${file.path}-${i}`,
            probe: 'Auth Weakness',
            title: 'JWT minted without expiresIn',
            severity: 'medium',
            category: 'Auth & Access',
            cwe: 'CWE-613',
            file: file.path,
            line: i + 1,
            evidence: realLine.trim(),
            remediation:
              'A JWT without expiresIn is valid forever. Stolen tokens remain valid until the secret is rotated. Pass { expiresIn: "15m" } (access) or short windows appropriate to the use case, and issue refresh tokens separately.',
          });
        }
      }
      // JWT verify accepting algorithms allowlist containing 'none'. Even if
      // the developer remembered to allowlist, including 'none' defeats the
      // entire point — an attacker just sends an unsigned token.
      if (
        /jwt\.verify\s*\([^)]*algorithms\s*:\s*\[[^\]]*['"]none['"]/i.test(line) ||
        /jwt\.verify\s*\([^)]*algorithms\s*:\s*\[[^\]]*['"]None['"]/.test(line)
      ) {
        findings.push({
          id: `auth-noneinallowlist-${file.path}-${i}`,
          probe: 'Auth Weakness',
          title: 'JWT verify algorithms allowlist includes "none"',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-327',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'Allowlisting "none" defeats the allowlist. Remove "none" from the algorithms array. Pin to one strong algorithm like HS256 with a strong secret or RS256 with a key pair.',
        });
      }
    });
  });
  return findings;
}

export function probeAdminRoutes(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$/.test(file.path)) return;
    if (!/(admin|dashboard|internal)/i.test(file.path)) return;
    // Exclude obvious marketing/preview routes that happen to contain "dashboard" in the path.
    if (/(marketing|landing|public|preview|sample|demo|docs?|example)/i.test(file.path)) return;
    // Next.js route groups in parens are layout-only, not user-routable: app/(marketing)/... .
    if (/\(([a-z_-]+)\)/i.test(file.path) && /(marketing|public|landing)/i.test(file.path)) return;
    // Depth round 3: latent bug fix — `auth\(\)` was substring-matching
    // inside `useAuth()`, so any client-only file with `useAuth()` was
    // silently treated as having server-check coverage. Anchor with a
    // non-word boundary before `auth`. Also widened the server-check token
    // list per the audit (requireUser, currentUser, getServerAuthSession,
    // assertAuth/Session/Admin, protect, supabase.auth.getUser, Clerk's
    // `auth.protect`).
    const hasServerCheck =
      /(?:getServerSession|getServerAuthSession|unstable_getServerSession|currentUser|requireAuth|requireUser|requireAdmin|requireRole|assertAuth|assertSession|assertAdmin|withAuth|verifyToken|createServerClient|supabase\.auth\.getUser)/.test(
        file.content
      ) ||
      /[^A-Za-z_$]auth\s*\(\s*\)/.test(file.content) ||
      /\bauth\.protect\s*\(/.test(file.content) ||
      /\bprotect\s*\(/.test(file.content);
    // Cross-file: if a sibling middleware.ts exists with an auth-shaped
    // wrapper, the route is gated at the middleware layer.
    const hasCorpusMiddleware = files.some(
      (mf) =>
        /(^|\/)(src\/)?middleware\.[jt]sx?$/.test(mf.path) &&
        typeof mf.content === 'string' &&
        /(clerkMiddleware|withAuth|getServerSession|currentUser|requireAuth|\bauth\s*\(|verifyToken)/i.test(
          mf.content
        )
    );
    const hasClientOnlyCheck = /(\buseUser\b|\buseSession\b|\buseAuth\b)/.test(file.content);
    if (!hasServerCheck && !hasCorpusMiddleware && hasClientOnlyCheck) {
      findings.push({
        id: `admin-clientonly-${file.path}`,
        probe: 'Admin Route Exposure',
        title: 'Admin route appears to rely on client-side auth check only',
        severity: 'high',
        category: 'Auth & Access',
        cwe: 'CWE-602',
        file: file.path,
        line: 1,
        evidence: `Path matches admin pattern, contains client hooks (useUser/useSession), no server-side check detected`,
        remediation: `Client-side auth checks (useUser, useSession) only hide the UI. The route is still accessible by direct fetch. Add a server-side check via middleware.ts, getServerSession, or a route handler that verifies auth and role before returning data. This is a manual review finding; verify by hitting the route directly without authentication.`,
      });
    }
  });
  return findings;
}

// The _headers/vercel/firebase/netlify parsers, host classifier, the FP-3/8/9/10
// disambiguation helpers, and CANONICAL_SECURITY_HEADERS live in transport.js
// next to probeSecurityHeaders, their only caller. The builtin.js split left a
// dead duplicate of all of them here; removed.

export function probeClientAuthStorage(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$/.test(file.path)) return;
    // Mask comments + string literals so the anti-pattern shape inside
    // documentation comments, JSDoc warnings, and code-as-string snippets
    // (teaching examples) no longer trips the regex. Indices preserved so the
    // emitted line numbers stay correct against the real source.
    // Narrow mask: blanks block comments, line comments, and backtick template
    // literals. Single/double-quoted string content stays visible so the
    // regexes can still see real auth-token-name string literals.
    const maskedContent = maskBlockCommentsAndTemplateLiterals(file.content);
    const maskedLines = maskedContent.split('\n');
    const originalLines = file.content.split('\n');
    // Common auth-name regex for storage keys. The keyword family must
    // appear as a substring inside a quoted key. Underscored forms
    // (auth_token, access_token) and camelCase forms (authToken) both
    // match without imposing word-boundary constraints.
    const AUTH_KEY_RE =
      /['"`][^'"`]*(?:token|jwt|auth|session|bearer|access_?token|refresh_?token|api[_-]?key)[^'"`]*['"`]/i;
    // Build a tiny constant-fold map for the common obfuscation shape
    // `const KEY = 'tok' + 'en';` (or 'au' + 'th', etc.) and check whether
    // the folded value contains an auth keyword. Then when
    // `localStorage.setItem(KEY, ...)` is seen, we treat it the same as a
    // string-literal auth-key write. Bounded to 4-segment concats and to
    // top-of-file declarations to keep this tight.
    const folded = new Map();
    {
      const declRe =
        /\b(?:const|let|var)\s+(\w+)\s*=\s*(['"`])([^'"`\n]*)\2(?:\s*\+\s*(['"`])([^'"`\n]*)\4)?(?:\s*\+\s*(['"`])([^'"`\n]*)\6)?(?:\s*\+\s*(['"`])([^'"`\n]*)\8)?/g;
      let dm;
      while ((dm = declRe.exec(maskedContent)) !== null) {
        const name = dm[1];
        // Skip placeholder/sample variable names — these are intentional
        // fixture identifiers, not real credentials.
        if (/^(?:SAMPLE|EXAMPLE|FAKE|DUMMY|MOCK|FIXTURE|PLACEHOLDER|STUB)[_A-Z0-9]*$/.test(name)) {
          continue;
        }
        const value = (dm[3] || '') + (dm[5] || '') + (dm[7] || '') + (dm[9] || '');
        if (!value) continue;
        if (
          /(?:token|jwt|auth|session|bearer|access_?token|refresh_?token|api[_-]?key)/i.test(value)
        ) {
          folded.set(name, value);
        }
      }
    }
    const AUTH_FOLDED_VAR_RE = folded.size
      ? new RegExp('\\b(?:' + Array.from(folded.keys()).join('|') + ')\\b')
      : null;
    // Exclude OAuth/PKCE flow values that are PUBLIC by RFC 7636 design —
    // state, nonce, code_verifier, pkce. Storing these in sessionStorage is
    // intentional CSRF protection, not a credential leak.
    const OAUTH_PUBLIC_RE = /\b(?:oauth_?state|state|nonce|code_?verifier|pkce_?verifier)\b/i;
    maskedLines.forEach((maskedLine, i) => {
      const realLine = originalLines[i] || '';
      // localStorage.setItem('jwt', ...)
      if (/localStorage\.setItem\s*\(\s*[^,)]*\)/i.test(maskedLine) === false) {
        // skip
      }
      const lineRefsFoldedAuthVar =
        AUTH_FOLDED_VAR_RE &&
        /localStorage\.setItem\s*\(\s*(\w+)/.test(maskedLine) &&
        AUTH_FOLDED_VAR_RE.test(maskedLine);
      if (
        /localStorage\.setItem\s*\(/i.test(maskedLine) &&
        (AUTH_KEY_RE.test(maskedLine) || lineRefsFoldedAuthVar)
      ) {
        findings.push({
          id: `auth-localstorage-${file.path}-${i}`,
          probe: 'Client Auth Storage',
          title: 'Auth token stored in localStorage',
          severity: 'medium',
          category: 'Auth & Access',
          cwe: 'CWE-922',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'localStorage is readable by any JS on the page, including third-party scripts and successful XSS. Use httpOnly secure SameSite cookies set server-side. If JS-readable storage is necessary, accept the risk explicitly and harden CSP.',
        });
      }
      // sessionStorage.setItem — slightly better than localStorage (cleared on
      // tab close) but still XSS-readable. Same XSS-readable threat model.
      // Excludes OAuth state/nonce/PKCE — RFC 7636 SPEC requires the client
      // to remember these across the redirect, and they are not credentials.
      if (
        /sessionStorage\.setItem\s*\(/i.test(maskedLine) &&
        AUTH_KEY_RE.test(maskedLine) &&
        !OAUTH_PUBLIC_RE.test(maskedLine)
      ) {
        findings.push({
          id: `auth-sessionstorage-${file.path}-${i}`,
          probe: 'Client Auth Storage',
          title: 'Auth token stored in sessionStorage',
          severity: 'medium',
          category: 'Auth & Access',
          cwe: 'CWE-922',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'sessionStorage is XSS-readable just like localStorage. The only difference is it clears on tab close. Same fix: httpOnly secure SameSite cookies set server-side.',
        });
      }
      // IndexedDB writes carrying auth: db.put('auth', ...), objectStore.put(
      // { token: ... }), idb-keyval set('jwt', ...), tx.objectStore('x').
      // put({ jwt: value }). The bare-key object form (`{ jwt: ... }`) is
      // not quoted, so AUTH_KEY_RE misses it — detect explicit-key shapes.
      const idbAuthMethodOnLine =
        /\.(?:put|add)\s*\(/.test(maskedLine) ||
        /\bidb(?:Keyval)?\.set\s*\(/.test(maskedLine) ||
        /\bset\s*\(\s*['"`][^'"`]*(?:token|jwt|auth|session|bearer)/i.test(maskedLine);
      const idbAuthKeyInObject =
        /\{\s*[^}]*\b(?:jwt|authToken|accessToken|refreshToken|bearer|sessionId)\s*:/i.test(
          maskedLine
        );
      // File-level IDB signal: any of the canonical IDB API names, OR a
      // `store.add/put({...})` shape (idb-keyval wrappers and raw IDB code
      // typically introduce a `store` variable from objectStore() or openDB()).
      const idbFileSignal =
        /indexedDB|objectStore|idb|openDB|IDBObjectStore|IDBDatabase/i.test(file.content) ||
        /\bstore\s*\.\s*(?:add|put)\s*\(/.test(file.content);
      if (
        idbAuthMethodOnLine &&
        idbFileSignal &&
        (AUTH_KEY_RE.test(maskedLine) || idbAuthKeyInObject)
      ) {
        findings.push({
          id: `auth-indexeddb-${file.path}-${i}`,
          probe: 'Client Auth Storage',
          title: 'Auth token stored in IndexedDB',
          severity: 'medium',
          category: 'Auth & Access',
          cwe: 'CWE-922',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'IndexedDB is JavaScript-readable, same XSS exposure as localStorage. Use httpOnly cookies set by the server.',
        });
      }
      // document.cookie = 'token=...' WITHOUT HttpOnly. Setting a cookie from
      // JS cannot set HttpOnly (browsers refuse). Any token cookie set from
      // client JS is XSS-readable by construction. Same risk as localStorage.
      // Use realLine — the cookie name and value may span template literal
      // interpolations that the narrow mask DOES blank (it masks template
      // bodies). Suppress if the line OR the file content explicitly says
      // HttpOnly somewhere near (server-side cookies set by middleware should
      // be using res.cookie, not document.cookie — but Koa ctx.cookies.set
      // with httpOnly=true is server-side, so check the ctx.cookies form).
      const cookieAuthShape =
        /document\.cookie\s*=\s*['"`][^=]*?(?:token|jwt|auth|session|bearer|access[_-]?token|refresh[_-]?token)/i.test(
          realLine
        ) ||
        /\bCookies\.set\s*\(\s*['"`][^'"`]*(?:token|jwt|auth|session|bearer|access[_-]?token|refresh[_-]?token)/i.test(
          realLine
        );
      // Koa / Express ctx.cookies.set + httpOnly is SERVER-SIDE and correct;
      // do not flag this shape under the client-side rule.
      const isServerSideCtxCookies = /\bctx\.cookies\.set\b|\bres\.cookie\b/i.test(realLine);
      if (cookieAuthShape && !isServerSideCtxCookies) {
        findings.push({
          id: `auth-clientcookie-${file.path}-${i}`,
          probe: 'Client Auth Storage',
          title: 'Auth cookie set from client JS (HttpOnly impossible)',
          severity: 'high',
          category: 'Auth & Access',
          cwe: 'CWE-1004',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'Cookies set via document.cookie from client JS CANNOT be HttpOnly — browsers reject the flag. The cookie is XSS-readable by definition. Set the cookie server-side with Set-Cookie: ...; HttpOnly; Secure; SameSite=Strict.',
        });
      }
      // window.* / globalThis.* token globals: window.authToken = ...,
      // window.__JWT__ = ... (underscore-wrapped). Persisted in JS scope,
      // XSS-readable.
      if (
        /(?:window|globalThis|self)\s*\.\s*_*(?:token|jwt|auth(?:Token)?|session(?:Id)?|access_?token|refresh_?token|bearer)_*\s*=/i.test(
          maskedLine
        )
      ) {
        findings.push({
          id: `auth-windowglobal-${file.path}-${i}`,
          probe: 'Client Auth Storage',
          title: 'Auth token stored on window / globalThis',
          severity: 'high',
          category: 'Auth & Access',
          cwe: 'CWE-922',
          file: file.path,
          line: i + 1,
          evidence: realLine.trim().slice(0, 200),
          remediation:
            'Window-scoped globals are reachable by any script on the page — including third-party tags, browser extensions in some contexts, and any XSS payload. Hold tokens in closure-scoped variables; for persistence use httpOnly cookies.',
        });
      }
    });
    // Cache Storage API auth caching. The Cache Storage API is available in
    // BOTH service worker scope AND window/document scope. Either way, the
    // cache is JS-readable persistent storage on the origin. Fire when:
    //   1. The file uses caches.open(...) / cache.put(...) / caches.match
    //   2. The file body mentions an auth signal (Authorization, Set-Cookie,
    //      bearer, token, jwt, authHeader)
    // The SW-specific path/event check is broadened to include any sw-prefixed
    // filename and any `self.addEventListener` regardless of event type. Plus
    // a generic any-file Cache API check for window-scoped code.
    const cacheApiInUse = /\bcaches\.(?:open|match|put)\s*\(|\bcache\.put\s*\(/i.test(file.content);
    const fileHasAuthSignal =
      /\bAuthorization\b|\bSet-Cookie\b|\bbearer\b|\btoken\b|\bjwt\b|\bauthHeader\b/i.test(
        file.content
      );
    if (cacheApiInUse && fileHasAuthSignal) {
      const swLines = maskedContent.split('\n');
      swLines.forEach((swLine, i) => {
        if (/\bcaches?\.put\s*\(|\bcache\.put\s*\(|\bcaches\.open\s*\(/.test(swLine)) {
          findings.push({
            id: `auth-swcachewrite-${file.path}-${i}`,
            probe: 'Client Auth Storage',
            title: 'Service worker may cache a response containing auth headers',
            severity: 'high',
            category: 'Auth & Access',
            cwe: 'CWE-922',
            file: file.path,
            line: i + 1,
            evidence: (originalLines[i] || '').trim().slice(0, 200),
            remediation:
              'Cached responses live in JS-readable Cache Storage. If the response carries Authorization or Set-Cookie headers, the token is now persistent and XSS-readable. Strip auth-related headers from the Response before caches.put, or exclude authed requests from the cache entirely.',
          });
        }
      });
    }

    // Multi-line / library patterns where the regex needs to see ACROSS lines.
    // Redux/Zustand/Jotai persist middleware: persist({ name: 'auth-store', ... })
    // commonly defaults to localStorage. Match the construct on the masked
    // whole content to allow newlines between persist( and the name field.
    {
      const masked = maskedContent;
      // persist({ name: 'auth' }) or persist(<state>, { name: 'auth' }). Also
      // catches redux-persist's `key:` form, and the common
      // `const persistConfig = { key: 'auth', storage }` pattern where the
      // config is a separate variable.
      const persistRe =
        /(?:persist|persistReducer|persistConfig)\s*[(=]\s*\(?\{?([\s\S]{0,400}?)\b(?:name|key)\s*:\s*['"][^'"]*(?:auth|jwt|token|session|user)/i;
      const pm = masked.match(persistRe);
      if (pm) {
        // Locate the line in the original
        const idx = masked.indexOf(pm[0]);
        const ln = idx >= 0 ? masked.slice(0, idx).split('\n').length : 1;
        findings.push({
          id: `auth-reduxpersist-${file.path}-${ln}`,
          probe: 'Client Auth Storage',
          title: 'State store persisted with auth-named slice (likely localStorage)',
          severity: 'medium',
          category: 'Auth & Access',
          cwe: 'CWE-922',
          file: file.path,
          line: ln,
          evidence: (originalLines[ln - 1] || '').trim().slice(0, 200),
          remediation:
            'Redux/Zustand/Jotai `persist` middleware defaults to localStorage. Auth-named slices written there are XSS-readable. Exclude the auth slice from persistence (zustand `partialize`, redux-persist `whitelist`/`blacklist`) and hold tokens in httpOnly cookies.',
        });
      }
      // jotai atomWithStorage('jwt', ...) — same persistence default.
      const atomRe = /atomWithStorage\s*\(\s*['"][^'"]*\b(?:token|jwt|auth|session)\b/i;
      const am = masked.match(atomRe);
      if (am) {
        const idx = masked.indexOf(am[0]);
        const ln = idx >= 0 ? masked.slice(0, idx).split('\n').length : 1;
        findings.push({
          id: `auth-atomstorage-${file.path}-${ln}`,
          probe: 'Client Auth Storage',
          title: 'jotai atomWithStorage holds an auth-named value',
          severity: 'medium',
          category: 'Auth & Access',
          cwe: 'CWE-922',
          file: file.path,
          line: ln,
          evidence: (originalLines[ln - 1] || '').trim().slice(0, 200),
          remediation:
            'atomWithStorage defaults to localStorage. Auth-named atoms are XSS-readable. Use a server-side session for tokens.',
        });
      }
    }
  });
  return findings;
}

// --- SSRF / Open Redirect ---

export function probeCookieFlags(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$|\.py$/.test(file.path)) return;
    const lines = file.content.split('\n');
    // Same-file helper bodies. Apps commonly build the Set-Cookie value in a
    // cookieHeader() / buildSessionCookie() helper, which puts the flags
    // outside the call-site window and produced a confident "missing httpOnly,
    // secure" on code that set all three (real-scan finding 2026-07).
    const helperBodies = collectFunctionBodies(file.content);
    lines.forEach((line, i) => {
      // Depth round 2: widened cookie-set detector. Adds Python `set_cookie`,
      // Next.js App Router `cookies().set(...)` (parens break the literal
      // `cookies.set` match), Hono `setSignedCookie`, NestJS `response.cookie`.
      const isCookieSet =
        /(?:setCookie|setSignedCookie|cookies\.set|cookies\(\)\.set|res\.cookie|response\.cookie|reply\.setCookie|reply\.cookie|Astro\.cookies\.set|ctx\.cookies\.set|event\.cookies\.set|set_cookie|Set-Cookie)/i.test(
          line
        );
      if (!isCookieSet) return;
      // Auth-cookie name signal widened: connect.sid, PHPSESSID, JSESSIONID,
      // __Host-*, __Secure-*, oauth/sso/bearer/sid/uid/login/account/
      // remember/appSession/sb-access-token (Supabase) / clerk-session.
      const isAuthNamed =
        /(?:session|auth|token|jwt|csrf|connect\.sid|PHPSESSID|JSESSIONID|__Host-|__Secure-|sb-(?:access|refresh)-token|appSession|clerk-session|remember|access[_-]?code|bearer|sso)/i.test(
          line
        );
      if (!isAuthNamed) return;
      // OAuth public-flow values (state, nonce, code_verifier) are NOT
      // credentials per RFC 7636. Skip them.
      if (/\b(?:oauth[_-]?state|nonce|code[_-]?verifier|pkce[_-]?verifier)\b/i.test(line)) return;
      // CSRF double-submit cookies MUST be JS-readable. If the cookie name
      // contains 'csrf', do not flag missing httpOnly.
      const isCsrfDoubleSubmit = /\bcsrf\b/i.test(line);
      // Wider window — multi-line option objects span 8+ lines on prettier.
      const windowText = lines.slice(i, Math.min(lines.length, i + 10)).join(' ');
      // Widen through any same-file helper this line calls, one hop. Only
      // widens when there IS a call, so an inline cookie set with no flags
      // still fires.
      const ctx = expandCalledHelpers(windowText, helperBodies);
      const missing = [];
      if (
        !isCsrfDoubleSubmit &&
        !/httpOnly\s*[:=]\s*(?:true|True)|HttpOnly|httponly\s*=\s*True/i.test(ctx)
      )
        missing.push('httpOnly');
      if (!/secure\s*[:=]\s*(?:true|True)|;\s*Secure|secure\s*=\s*True/i.test(ctx))
        missing.push('secure');
      if (!/sameSite|same[_-]?site|samesite/i.test(ctx)) missing.push('sameSite');
      // SameSite=None without Secure is the canonical dangerous combo.
      const sameSiteNoneNoSecure =
        /sameSite\s*[:=]\s*['"]none['"]|samesite\s*=\s*['"]none['"]/i.test(ctx) &&
        !/secure\s*[:=]\s*(?:true|True)|;\s*Secure/i.test(ctx);
      if (missing.length >= 2 || sameSiteNoneNoSecure) {
        findings.push({
          id: `cookie-${file.path}-${i}`,
          probe: 'Cookie Security',
          title: `Auth cookie missing ${missing.join(', ')}`,
          severity: 'medium',
          category: 'Auth & Access',
          cwe: 'CWE-1004',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Auth cookies should set httpOnly (blocks JS access, mitigates XSS token theft), secure (HTTPS only), and sameSite: "lax" or "strict" (mitigates CSRF). Without these, one XSS becomes account takeover.',
        });
      }
    });
  });
  return findings;
}

// --- API Route Auth ---

export function probeAPIRouteAuth(files) {
  const findings = [];
  // Corpus-level signal: a Next.js middleware.ts/.js at the project root (or
  // src/) that matches /api/* paths is the canonical place to enforce auth
  // across many routes. When present, per-route findings would be
  // false positives — the route IS gated, just from a sibling file. We can't
  // verify the matcher actually covers each route without parsing config, so
  // this is a corpus-aware downgrade: if a middleware file exists and contains
  // an auth-shaped call, every route is treated as having auth at the corpus
  // level.
  const hasCorpusMiddleware = files.some((mf) => {
    if (!/(^|\/)(src\/)?middleware\.[jt]sx?$/.test(mf.path)) return false;
    if (typeof mf.content !== 'string') return false;
    // In a middleware file the call site is intentional auth, so accept
    // `auth(` with arguments (e.g. `export default auth((req) => ...)` is the
    // canonical NextAuth v5 / Auth.js v5 wrapper shape).
    return /(clerkMiddleware|withAuth|getServerSession|getUser|currentUser|requireAuth|\bauth\s*\(|verifyToken|jwt\.verify\s*\([^,)]+,)/i.test(
      mf.content
    );
  });
  // Corpus-level Express / Hono / Koa app-wide auth middleware. The shapes:
  //   app.use(authMiddleware)
  //   app.use('/api', authMiddleware)
  //   app.use(passport.authenticate('jwt', { session: false }))
  //   honoApp.use('*', jwt({ secret }))
  // If any file in the corpus registers an auth-shaped middleware app-wide,
  // routes in the same project are considered gated for THIS probe.
  const hasAppWideAuthMiddleware = files.some((mf) => {
    if (typeof mf.content !== 'string') return false;
    if (isTestFile(mf.path)) return false;
    return (
      /\b(?:app|router)\.use\s*\(\s*(?:['"`][^'"`]*['"`]\s*,\s*)?(?:authenticate|authMiddleware|requireAuth|isAuthenticated|verifyJWT|verifyToken|protect|guard|passport\.authenticate|clerkMiddleware|withAuth)/i.test(
        mf.content
      ) ||
      /\bapp\.use\s*\(\s*['"`]\*['"`]\s*,\s*(?:jwt|bearerAuth|basicAuth|auth)\s*\(/i.test(
        mf.content
      )
    );
  });
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$/.test(file.path)) return;
    if (hasCorpusMiddleware) return; // gated at the middleware layer
    if (hasAppWideAuthMiddleware) return; // gated by Express/Hono/Koa app.use
    const c = file.content;
    // jwt.verify alone is NOT proof of valid auth — it must be called with a secret/key as a 2nd arg.
    const hasJwtVerifyWithSecret = /jwt\.verify\s*\(\s*[^,)]+,\s*[^)]+\)/.test(c);
    // Generic auth signals applicable across frameworks. Add SvelteKit/Hono/
    // CF Worker / Astro / Fastify / Express hook shapes.
    const hasAuth =
      // Require `(` after the keyword so substring matches inside identifiers
      // (e.g. `targetUserId` contained `getUser` and tripped this) no longer
      // produce a false negative on missing-auth.
      /(?:getServerSession|requireAuth|getUser|currentUser|withAuth|createServerClient)\s*\(/i.test(
        c
      ) ||
      /(?<!\w)auth\s*\(\s*\)/.test(c) ||
      /verifyToken\s*\(/.test(c) ||
      hasJwtVerifyWithSecret ||
      // Common framework auth signals:
      /\blocals\.(?:user|session|auth)\b/.test(c) || // SvelteKit / Astro locals
      /c\.get\s*\(\s*['"](?:user|session|auth|jwt)['"]/i.test(c) || // Hono context
      /\bclerkClient\b|\bauthenticatedFetch\b/i.test(c) ||
      /\brequireUser\s*\(|\brequireRole\s*\(/.test(c) ||
      /\bensureAuthenticated\b|\bisAuthenticated\b/.test(c) ||
      /passport\.authenticate\s*\(/.test(c) ||
      /supabase\.auth\.getUser\s*\(/.test(c) ||
      // Express middleware ordering: route declared with auth middleware arg
      /\.(?:get|post|put|patch|delete|all)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*(?:authenticate|authMiddleware|requireAuth|isAuthenticated|verifyJWT|verifyToken|protect|guard|cors\s*\([^)]*\),\s*auth)/i.test(
        c
      ) ||
      // Fastify route options: { preHandler: authHook } or onRequest: authHook
      /(?:preHandler|onRequest)\s*:\s*(?:\[?\s*)?(?:authenticate|authMiddleware|requireAuth|verifyJWT|verifyToken|protect|isAuthenticated|authHook)/i.test(
        c
      ) ||
      /\b(?:fastify|app)\.register\s*\(\s*(?:fastifyAuth|fastifyJwt|fastifyJWT|fastifyBearerAuth)/i.test(
        c
      ) ||
      // Webhook signature verification IS the auth (Stripe, GitHub, Slack)
      /(?:stripe\.webhooks\.constructEvent|x-hub-signature|x-slack-signature|wh\.verify|webhookCallback)/i.test(
        c
      ) ||
      // GraphQL: resolver context.user check
      /\bcontext(?:\.\w+)?\.(?:user|userId|currentUser|session)\b/.test(c) ||
      // The route is itself an OAuth callback or public auth endpoint
      /\/(?:auth\/callback|auth\/signin|auth\/login|sign-in|sign-up|register|forgot-password)\//.test(
        file.path
      );

    // Route-shape detection across frameworks. We classify by the file
    // content shape, not the path alone, so backend-only Express apps with
    // no `pages/api` are covered.
    const isNextRoute = /(?:\/api\/.*route\.[jt]sx?$|pages\/api\/)/.test(file.path);
    const isSvelteKitEndpoint = /(?:\/routes\/.*\/\+server\.[jt]sx?$)/.test(file.path);
    const isAstroEndpoint =
      /(?:\/pages\/api\/.*\.[jt]sx?$|\/src\/pages\/.*\.[jt]sx?$)/.test(file.path) &&
      /\bexport\s+(?:async\s+)?(?:const|function)\s+(?:GET|POST|PUT|PATCH|DELETE|ALL)\b/.test(c);
    // Express-style: app.METHOD(path, handler) or router.METHOD(...). Drop
    // the framework-keyword guard — real Express files often skip the
    // `import express` if it's imported elsewhere (server.js entry), and
    // the app.METHOD pattern alone is a strong route-shape signal that we
    // gate on auth separately.
    const isExpressLike =
      /\b(?:app|router)\s*\.\s*(?:get|post|put|patch|delete|use|all)\s*\(\s*['"`]/.test(c);
    const isFastify =
      /\bfastify\s*\.\s*(?:get|post|put|patch|delete|register|route)\s*\(/i.test(c) ||
      /\brequire\s*\(\s*['"]fastify['"]/.test(c) ||
      /\bimport\s+[^;]*\bfastify\b/i.test(c);
    const isHono =
      /\bnew\s+Hono\s*\(/.test(c) ||
      /import\s+[^;]*\bHono\b\s+from\s+['"]hono/.test(c) ||
      /\bapp\.(?:get|post|put|patch|delete)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*\(?\s*c\s*[:,)]/i.test(
        c
      );
    const isCFWorker =
      /\baddEventListener\s*\(\s*['"]fetch['"]/.test(c) ||
      /export\s+default\s*\{[\s\S]{0,60}?\bfetch\s*\(/i.test(c);
    // GraphQL: any Mutation field is a mutating endpoint; the resolver name
    // (e.g. promoteToAdmin / refundOrder) is arbitrary. Detect a Mutation
    // block containing ANY resolver field with an async/handler function.
    const isGraphQLResolver =
      /\bMutation\s*:\s*\{[\s\S]{0,2000}?\b\w+\s*:\s*(?:async\s*)?\(/i.test(c) &&
      /\b(?:resolvers|makeExecutableSchema|gql|graphql|typeDefs|apollo)\b/i.test(c);

    const isAnyRoute =
      isNextRoute ||
      isSvelteKitEndpoint ||
      isAstroEndpoint ||
      isExpressLike ||
      isFastify ||
      isHono ||
      isCFWorker ||
      isGraphQLResolver;
    if (!isAnyRoute) return;

    // Sensitivity heuristics. Path patterns first. For Express-style routes
    // the path lives in the route string (`app.post('/api/admin/...')`), not
    // the file path — check BOTH.
    const sensitiveKw =
      /(admin|internal|delete|update|create|user|payment|checkout|billing|dashboard|invoice|impersonate|promote|refund|settings|moderate)/i;
    const isSensitivePath =
      sensitiveKw.test(file.path) ||
      (isExpressLike &&
        /\b(?:app|router)\s*\.\s*(?:get|post|put|patch|delete|use|all)\s*\(\s*['"`][^'"`]*(?:admin|internal|delete|update|user|payment|checkout|billing|dashboard|invoice|impersonate|promote|refund|settings|moderate)/i.test(
          c
        ));
    const hasDestructiveVerb =
      /export\s+(?:async\s+)?(?:function|const)\s+(?:DELETE|PUT|PATCH)/.test(c) ||
      /\b(?:app|router|fastify|hono?)\s*\.\s*(?:delete|put|patch)\s*\(/i.test(c) ||
      /\.(?:delete|update|create|remove)\w*\s*\(/.test(c) || // ORM/DB call signal
      // CF Worker: request.method === 'POST'|'PUT'|'DELETE'|'PATCH' is a
      // state-changing handler.
      (isCFWorker && /\brequest\.method\s*===?\s*['"](?:POST|PUT|DELETE|PATCH)['"]/i.test(c)) ||
      // CF Worker: env.DB.prepare('INSERT...|UPDATE...|DELETE...') is a
      // direct destructive SQL call (no taint-flow needed; the SQL is literal).
      (isCFWorker && /\benv\.[A-Z_]+\.prepare\s*\(\s*['"`](?:INSERT|UPDATE|DELETE)/i.test(c));

    // If the dev marked the gap with a TODO/FIXME/XXX comment about auth,
    // they've ACKNOWLEDGED the gap. Still fire (TODO comments don't add
    // auth), but downgrade severity one band — the signal is "tracked, not
    // yet fixed" rather than "nobody noticed". External CDN/edge-auth
    // mentions (Cloudflare Access, Vercel Authentication, Zero Trust)
    // count the same — out-of-band auth that exists but is not statically
    // verifiable in source.
    const hasAuthAcknowledgmentComment =
      /\/\/\s*(?:TODO|FIXME|XXX|HACK)[^\n]*\bauth\b/i.test(c) ||
      /\/\*\s*(?:TODO|FIXME|XXX|HACK)[^*]*\bauth\b/i.test(c) ||
      /\bgated by\s+(?:Cloudflare(?:\s+Access)?|Vercel\s+Authentication|Zero[\s-]?Trust|Akamai|reverse[\s-]?proxy)/i.test(
        c
      );
    const sensitiveSeverity = hasAuthAcknowledgmentComment ? 'medium' : 'critical';
    const destructiveSeverity = hasAuthAcknowledgmentComment ? 'medium' : 'high';

    if (isSensitivePath && !hasAuth) {
      findings.push({
        id: `api-noauth-${file.path}`,
        probe: 'API Route Auth',
        title: hasAuthAcknowledgmentComment
          ? 'Sensitive API route without static auth check (TODO/FIXME/CDN-gated)'
          : 'Sensitive API route without auth check',
        severity: sensitiveSeverity,
        category: 'Auth & Access',
        cwe: 'CWE-306',
        file: file.path,
        line: 1,
        evidence: hasAuthAcknowledgmentComment
          ? `Path matches sensitive pattern, no in-source auth call (gap acknowledged by comment or external gating mention)`
          : `Path matches sensitive pattern, no auth function call detected`,
        remediation:
          'API routes are reachable by direct fetch from anywhere. Verify auth at the top of the handler: getServerSession (Next), locals.user (SvelteKit), c.get("user") (Hono), passport.authenticate (Express). Then check role and resource ownership. Manual review recommended if auth lives in middleware not visible here.',
      });
    }
    if (hasDestructiveVerb && !hasAuth) {
      findings.push({
        id: `api-destructive-${file.path}`,
        probe: 'API Route Auth',
        title: hasAuthAcknowledgmentComment
          ? 'Destructive HTTP handler (DELETE/PUT/PATCH) without static auth check (TODO/FIXME/CDN-gated)'
          : 'Destructive HTTP handler (DELETE/PUT/PATCH) without auth check',
        severity: destructiveSeverity,
        category: 'Auth & Access',
        cwe: 'CWE-306',
        file: file.path,
        line: 1,
        evidence: hasAuthAcknowledgmentComment
          ? 'Destructive handler / mutation export found, no in-source auth (gap acknowledged by comment or external gating mention)'
          : 'Destructive handler / mutation export found, no auth call in same file',
        remediation:
          'Mutation endpoints must verify the caller is authenticated AND authorized for the specific resource. Otherwise an unauthenticated curl can delete or modify any record. The May 2025 Lovable BOLA incident (CVE-2025-48757) is an instance of this class.',
      });
    }
  });
  return findings;
}

// --- 2026: Known compromised package versions ---
