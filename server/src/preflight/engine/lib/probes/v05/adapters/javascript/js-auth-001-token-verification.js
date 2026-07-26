// src/lib/probes/v05/adapters/javascript/js-auth-001-token-verification.js
//
// XL-013 adapter for JavaScript / TypeScript. Phase 2 migration of the
// JWT/token-verification half of the v0.4 "Auth Weakness" probe
// (probeAuthWeakness in src/lib/probes.js): alg:none and jwt.verify() with
// no key argument. The eval / dangerouslySetInnerHTML facets of that probe
// emit under probe:'Code Injection' and are intentionally NOT migrated here
// — different finding identity, different (future) family.
//
// shadow:true — the v0.4 probe stays authoritative.
// legacy_finding_id_seed:'Auth Weakness' keeps stableId() byte-identical to
// the v0.4 probe for the migrated findings, so a future shadow:false flip
// preserves suppressions. The v05-phase2 parity test guards drift.

import { javascriptFiles, stripJsLineComments } from '../../shared-detectors/javascript-scope.js';

const PROBE_NAME = 'JS Auth Token Verification (XL-013)';

export const JS_AUTH_001 = {
  probe_id: 'JS-AUTH-001',
  xl_family: 'XL-013',
  language: 'javascript',
  name: PROBE_NAME,
  category: 'access',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-347',
  owasp_web: 'A07',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.{js,jsx,ts,tsx,mjs,cjs}',
  what_it_catches:
    'A JWT configured with algorithm "none" (quoted or unquoted), or jwt.verify(token) called with no secret / publicKey / key argument, or jwt.sign(...) called with no expiresIn option (forever-valid token, CWE-613). Each let a forged or stolen token remain effective indefinitely.',
  why_ai_v05:
    'The shortest code that returns a usable token is the one the model emits. alg:none and a key-less verify both produce a working login in the demo and neither throws, so the hole is invisible without a forged-token test.',
  vibe_v05:
    '"The token decodes and the user comes back, so auth works." No mental model separating decode from signature verification.',
  detection_approach:
    'Per line (JS/TS slice), comments stripped: (1) /(?:algorithm|alg)\\s*:\\s*[\\\'"]?none[\\\'"]?/i → critical CWE-327; (2) jwt.verify(<args with no comma>) with no secret/publicKey/key on the line → high CWE-347. Identical logic to the v0.4 Auth Weakness probe.',
  fp_gates_v05: [
    'comment-only / commented-out code (stripJsLineComments)',
    'jwt.verify calls that pass an explicit secret / publicKey / key',
    'test files / scanner self-source / fixture tree (javascriptFiles())',
  ],
  remediation:
    'Sign and verify with a real algorithm and key. alg:none means unsigned tokens anyone can forge — use HS256 with a strong secret or RS256 with a key pair. Always pass the secret/public key to jwt.verify(token, key).',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/JS-AUTH-001/positive.js',
    negative: 'src/lib/probes/v05/fixtures/JS-AUTH-001/negative.js',
  },
  known_incidents: 'CWE-327 (alg:none); CWE-347 (missing signature verification); OWASP A07',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: 'Auth Weakness',
  detect(files) {
    const findings = [];
    for (const file of javascriptFiles(files)) {
      const lines = file.content.split('\n');
      lines.forEach((rawLine, i) => {
        const line = stripJsLineComments(rawLine);
        if (/(?:algorithm|alg)\s*:\s*['"]?none['"]?(?:\s|,|$)/i.test(line)) {
          findings.push({
            id: `auth-algnone-${file.path}-${i}`,
            probe: PROBE_NAME,
            title: 'JWT signed with algorithm "none"',
            severity: 'critical',
            category: 'Auth & Access',
            cwe: 'CWE-327',
            file: file.path,
            line: i + 1,
            evidence: line.trim(),
            remediation: `alg: none means tokens are unsigned. Anyone can forge a token claiming to be any user. Use HS256 with a strong secret or RS256 with a key pair.`,
          });
        }
        if (/jwt\.verify\([^,)]+\)/.test(line) && !/secret|publicKey|key/.test(line)) {
          findings.push({
            id: `auth-noverify-${file.path}-${i}`,
            probe: PROBE_NAME,
            title: 'jwt.verify called without secret argument',
            severity: 'high',
            category: 'Auth & Access',
            cwe: 'CWE-347',
            file: file.path,
            line: i + 1,
            evidence: line.trim(),
            remediation: `Verify with an explicit secret or public key. Without one, signature validation may be skipped depending on the library, allowing forged tokens.`,
          });
        }
        // CWE-613: jwt.sign called without expiresIn. The token is valid
        // forever. Look at the file content from this line's start through
        // the next ~400 chars to allow multi-line options objects.
        if (/jwt\.sign\s*\(/.test(line)) {
          const startIdx = file.content.indexOf(rawLine);
          const around = startIdx >= 0 ? file.content.slice(startIdx, startIdx + 400) : line;
          if (!/expiresIn\s*:|\bexp\s*:/.test(around)) {
            findings.push({
              id: `auth-noexpiry-${file.path}-${i}`,
              probe: PROBE_NAME,
              title: 'JWT minted without expiresIn',
              severity: 'medium',
              category: 'Auth & Access',
              cwe: 'CWE-613',
              file: file.path,
              line: i + 1,
              evidence: line.trim(),
              remediation: `A JWT without expiresIn is valid forever. Stolen tokens remain valid until the secret is rotated. Pass { expiresIn: "15m" } (access) or short windows appropriate to the use case, and issue refresh tokens separately.`,
            });
          }
        }
      });
    }
    return findings;
  },
};
