// src/lib/probes/v05/families/xl-013-auth-token-verification.js
//
// XL-013: Authentication and Token Verification Weakness. Pure metadata.
//
// Not one of the original XL-001..XL-012 research families. v05-architecture.md
// ("Phase 2 — Migrate overlapping v0.4 probes") sanctions a NEW family for the
// Auth Weakness split: the v0.4 "Auth Weakness" probe is a grab-bag emitting
// JWT-verification findings (alg:none, jwt.verify with no key) under one
// identity and code-injection findings (eval, dangerouslySetInnerHTML) under
// another. XL-013 owns the JWT/token-verification half. The code-injection
// half stays with the v0.4 probe and maps to a code-injection family later.

/** @type {import('../types.js').XLFamily} */
export const XL_013 = {
  xl_id: 'XL-013',
  name: 'Authentication and Token Verification Weakness',
  category: 'access',
  severity_default: 'critical',
  cwe: 'CWE-347',
  owasp_web: 'A07',
  owasp_llm: [],
  learn_more_slug: 'xl-auth-token-verification',
  why_ai_v05:
    'Asked to "make auth work," models reach for the shortest path that returns a token. alg:none and a key-less verify call both make the demo log in, and neither throws, so the failure is invisible until someone forges a token.',
  vibe_v05:
    '"The token decodes and the user object comes back, so auth works." No model of the difference between decoding a token and verifying its signature.',
  fp_gates_v05_shared: [
    'test files and fixtures demonstrating the vulnerable call',
    'comment-only lines (stripped before matching)',
    'verify calls that pass an explicit secret / publicKey / key argument',
  ],
  autofix_v05: 'review-needed',
  fixtures_v05_pattern: {
    positive: 'a JWT signed with alg:none, or jwt.verify(token) with no key argument',
    negative: 'jwt.verify(token, secret) / a signed algorithm (HS256, RS256)',
  },
  // Scan-scope regulatory mapping. Not verifying a token signature
  // directly defeats entity authentication, so the HIPAA tie is 'direct';
  // the PCI/GDPR/SOC2 ties are 'indicative' (authentication-strength
  // requirements judged in context).
  compliance_refs: [
    {
      framework: 'HIPAA',
      clause: '45 CFR 164.312(d) Person or entity authentication',
      url: 'https://www.ecfr.gov/current/title-45/section-164.312',
      relationship: 'direct',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'PCI-DSS',
      clause: 'Req 8.3 (strong authentication for users and administrators)',
      url: 'https://www.pcisecuritystandards.org/document_library/',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'GDPR',
      clause: 'Art.32 security of processing',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'SOC2',
      clause: 'Trust Services Criteria CC6.1 (logical access controls)',
      url: 'https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
  ],
};
