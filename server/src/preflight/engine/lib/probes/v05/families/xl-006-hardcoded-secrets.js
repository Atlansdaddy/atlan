// src/lib/probes/v05/families/xl-006-hardcoded-secrets.js
//
// XL-006: Hardcoded Secrets and Policy Text. Pure metadata. Adapters
// reference via xl_family: "XL-006". The v0.4 Secret Scanner is the
// migration target for this family (Phase 2).

/** @type {import('../types.js').XLFamily} */
export const XL_006 = {
  xl_id: 'XL-006',
  name: 'Hardcoded Secrets and Policy Text',
  category: 'crypto',
  severity_default: 'high',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: ['LLM02', 'LLM07'],
  learn_more_slug: 'xl-hardcoded-secrets',
  why_ai_v05:
    'AI inlines a placeholder key to make the prototype run, and the placeholder gets forgotten before rotation. Lovable/Bolt/Replit emit pasted keys inline; Copilot autocompletes from clipboard.',
  vibe_v05:
    '"Just hard-code it for now, I will move it to an env var later." Later never arrives, and the prototype ships with the literal in source.',
  fp_gates_v05_shared: [
    '.example / .sample / .template files',
    'documentation and tutorial snippets',
    'obvious placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme)',
    'env-loaded references (os.environ, getenv) rather than literals',
    'test fixtures with fake key shapes',
  ],
  autofix_v05: 'review-needed',
  fixtures_v05_pattern: {
    positive: 'a provider-key-shaped literal assigned in source or passed to a client ctor',
    negative: 'the key read from an environment variable / secret manager',
  },
  // Scan-scope regulatory mapping. A hardcoded credential is associated
  // with credential-protection and access-control clauses, but whether it
  // is a finding depends on what the key unlocks, so the ties are
  // 'indicative' (a human judges blast radius).
  compliance_refs: [
    {
      framework: 'PCI-DSS',
      clause: 'Req 8.3.1 / 8.6.2 (do not hard-code authentication credentials)',
      url: 'https://www.pcisecuritystandards.org/document_library/',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'HIPAA',
      clause: '45 CFR 164.312(d) Person or entity authentication',
      url: 'https://www.ecfr.gov/current/title-45/section-164.312',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'GDPR',
      clause: 'Art.32(1)(b) confidentiality of processing systems',
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
