// src/lib/probes/v05/adapters/csharp/cs-auth-001-tokenvalidation.js
//
// XL-013 adapter for C#. RX-based. JwtBearer TokenValidationParameters
// with a Validate* property set to false (signature/issuer/audience/
// lifetime/issuer-signing-key) or RequireSignedTokens = false. Corpus:
// "A07; JwtBearer with TokenValidationParameters { ValidateSignature =
// false } or ValidateIssuer = false".
//
// XL-013 is the Auth/Token-Verification family introduced in Phase 2;
// this adapter inherits its Learn page (xl-auth-token-verification).

import { csharpFiles, isCsCommentLine } from '../../shared-detectors/csharp-scope.js';

const PROBE_NAME = 'C# JWT Token Validation Disabled (XL-013)';

const VALIDATE_FALSE_RE =
  /\bValidate(?:Signature|Issuer|Audience|Lifetime|IssuerSigningKey|TokenReplay|Actor)\s*=\s*false\b/;
const REQUIRE_SIGNED_FALSE_RE = /\bRequireSignedTokens\s*=\s*false\b/;
const SIGVALIDATOR_BYPASS_RE = /\bSignatureValidator\s*=\s*\([^)]*\)\s*=>\s*[A-Za-z_]/;

export const CS_AUTH_001 = {
  probe_id: 'CS-AUTH-001',
  xl_family: 'XL-013',
  language: 'csharp',
  name: PROBE_NAME,
  category: 'access',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-347',
  owasp_web: 'A07',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.cs',
  what_it_catches:
    'TokenValidationParameters with ValidateSignature/ValidateIssuer/ValidateAudience/ValidateLifetime/ValidateIssuerSigningKey set to false, RequireSignedTokens = false, or a SignatureValidator lambda that returns the token unchecked.',
  why_ai_v05:
    'The token "works" in the demo whether or not the signature is checked; turning a Validate* flag off is the corpus fix for an issuer/audience/clock mismatch.',
  vibe_v05: '"The 401 went away when I set ValidateIssuer = false, so that was the problem."',
  detection_approach:
    'RX per line: Validate<X> = false on TokenValidationParameters, RequireSignedTokens = false, or a SignatureValidator bypass lambda.',
  fp_gates_v05: [
    'comment lines',
    'Validate* = true (the secure setting)',
    'a SignatureValidator that actually verifies and throws on failure',
    '*Tests.cs / src/test / scanner self-source / fixture tree (csharpFiles())',
  ],
  remediation:
    'Keep every Validate* flag true and supply the IssuerSigningKey/Issuer/Audience. Never RequireSignedTokens = false. A SignatureValidator must verify, not pass through.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CS-AUTH-001/positive.cs',
    negative: 'src/lib/probes/v05/fixtures/CS-AUTH-001/negative.cs',
  },
  known_incidents: 'CWE-347; OWASP A07; JWT signature-bypass advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of csharpFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCsCommentLine(line)) return;
        if (
          !VALIDATE_FALSE_RE.test(line) &&
          !REQUIRE_SIGNED_FALSE_RE.test(line) &&
          !SIGVALIDATOR_BYPASS_RE.test(line)
        )
          return;
        findings.push({
          id: `cs-auth-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'JWT validation disabled (TokenValidationParameters Validate* = false)',
          severity: 'critical',
          category: 'Auth & Access',
          cwe: 'CWE-347',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Keep all Validate* flags true and supply the signing key/issuer/audience. Never RequireSignedTokens = false.',
        });
      });
    }
    return findings;
  },
};
