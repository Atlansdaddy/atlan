// src/lib/probes/v05/families/xl-004-tls-verification-disabled.js
//
// XL-004: TLS Verification Disabled. Pure metadata. Adapters reference via
// xl_family: "XL-004".

/** @type {import('../types.js').XLFamily} */
export const XL_004 = {
  xl_id: 'XL-004',
  name: 'TLS Verification Disabled',
  category: 'transport',
  severity_default: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: [],
  learn_more_slug: 'xl-tls-verification-disabled',
  why_ai_v05:
    'A corporate proxy or self-signed cert breaks the request; the first remediation in the training corpus is verify=False, not a CA bundle path. Almost every "fix my SSL error" answer the model learned from disables verification.',
  vibe_v05:
    '"It works when I turn off the cert check, so the cert check was the problem." The local-dev debugging shortcut survives into production because nothing fails loudly afterward.',
  fp_gates_v05_shared: [
    'code under test fixtures hitting a local self-signed server',
    'dev-only compile / environment flags that cannot reach production',
    'an explicit CA bundle path supplied alongside the disable flag',
  ],
  autofix_v05: 'review-needed',
  fixtures_v05_pattern: {
    positive: 'verify disabled on a client used against an https endpoint in app code',
    negative: 'default verification, or a ca-bundle path configured explicitly',
  },
  // Scan-scope regulatory mapping. Disabling certificate verification is
  // itself the clause failure for transmission-security controls, so the
  // HIPAA and PCI ties are 'direct'; the GDPR/SOC2 ties are 'indicative'
  // ("appropriate" encryption is risk-dependent).
  compliance_refs: [
    {
      framework: 'PCI-DSS',
      clause: 'Req 4.2.1 (strong cryptography for PAN in transit over open networks)',
      url: 'https://www.pcisecuritystandards.org/document_library/',
      relationship: 'direct',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'HIPAA',
      clause: '45 CFR 164.312(e)(1) Transmission security',
      url: 'https://www.ecfr.gov/current/title-45/section-164.312',
      relationship: 'direct',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'GDPR',
      clause: 'Art.32(1)(a) encryption of personal data',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'SOC2',
      clause: 'Trust Services Criteria CC6.7 (transmission of data)',
      url: 'https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
  ],
};
