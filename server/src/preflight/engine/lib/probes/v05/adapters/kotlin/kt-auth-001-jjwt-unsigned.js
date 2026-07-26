// src/lib/probes/v05/adapters/kotlin/kt-auth-001-jjwt-unsigned.js
//
// XL-013 adapter for Kotlin. RX-based. jjwt parsed without signature
// verification: parseClaimsJwt (the explicitly-UNSIGNED parse), or
// SignatureAlgorithm.NONE when signing. Corpus Kotlin M3: "JWT with no
// signature verification (see jjwt patterns in Java)".
//
// Inherits the Phase 2 XL-013 Learn page (xl-auth-token-verification).

import { kotlinFiles, isKtCommentLine } from '../../shared-detectors/kotlin-scope.js';

const PROBE_NAME = 'Kotlin JWT Signature Not Verified (XL-013)';

// jjwt: parseClaimsJwt() parses an UNSIGNED token (no signature checked).
const PARSE_UNSIGNED_RE = /\.\s*parseClaimsJwt\s*\(/;
const ALG_NONE_RE = /\bSignatureAlgorithm\s*\.\s*NONE\b/;
// parser without a key then parse(): build().parse( with no setSigningKey/verifyWith on the line
const PARSER_NOKEY_RE =
  /\bJwts\s*\.\s*parser(?:Builder)?\s*\(\s*\)\s*\.\s*build\s*\(\s*\)\s*\.\s*parse(?:ClaimsJws)?\s*\(/;

export const KT_AUTH_001 = {
  probe_id: 'KT-AUTH-001',
  xl_family: 'XL-013',
  language: 'kotlin',
  name: PROBE_NAME,
  category: 'access',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-347',
  owasp_web: 'A07',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.kt',
  what_it_catches:
    'jjwt parseClaimsJwt (parses an unsigned JWT — no signature check), SignatureAlgorithm.NONE when signing, or a Jwts.parser().build().parse(...) chain with no signing key set on the call.',
  why_ai_v05:
    'parseClaimsJwt and parseClaimsJws look interchangeable; the unsigned one "works" in the demo because the demo never sends a forged token.',
  vibe_v05: '"The claims come back, so the token is valid." Decoding is not verifying.',
  detection_approach:
    'RX per line: .parseClaimsJwt(, SignatureAlgorithm.NONE, or Jwts.parser[Builder]().build().parse(...) with no key.',
  fp_gates_v05: [
    'comment lines',
    'parseClaimsJws / parseSignedClaims with setSigningKey / verifyWith',
    'a real SignatureAlgorithm (HS256/RS256) when signing',
    '*Test.kt / src/test / scanner self-source / fixture tree (kotlinFiles())',
  ],
  remediation:
    'Verify the signature: Jwts.parser().verifyWith(key).build().parseSignedClaims(token). Never parseClaimsJwt for trust decisions; never SignatureAlgorithm.NONE.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/KT-AUTH-001/positive.kt',
    negative: 'src/lib/probes/v05/fixtures/KT-AUTH-001/negative.kt',
  },
  known_incidents: 'CWE-347; OWASP A07 / Mobile M3; jjwt signed-vs-unsigned parse advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of kotlinFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isKtCommentLine(line)) return;
        if (!PARSE_UNSIGNED_RE.test(line) && !ALG_NONE_RE.test(line) && !PARSER_NOKEY_RE.test(line))
          return;
        findings.push({
          id: `kt-auth-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'JWT signature not verified (jjwt parseClaimsJwt / alg NONE)',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-347',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use verifyWith(key) + parseSignedClaims. Never parseClaimsJwt for trust, never SignatureAlgorithm.NONE.',
        });
      });
    }
    return findings;
  },
};
