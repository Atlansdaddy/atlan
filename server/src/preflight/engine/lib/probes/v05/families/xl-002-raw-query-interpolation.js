// src/lib/probes/v05/families/xl-002-raw-query-interpolation.js
//
// XL-002: Raw Query Interpolation. Pure metadata. Adapters reference via
// xl_family: "XL-002".

/** @type {import('../types.js').XLFamily} */
export const XL_002 = {
  xl_id: 'XL-002',
  name: 'Raw Query Interpolation',
  category: 'security',
  severity_default: 'critical',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: [],
  learn_more_slug: 'xl-raw-query-interpolation',
  why_ai_v05:
    'Autocomplete emits interpolation because it is shorter and more legible than parameterization. "Filter where column equals a user value" produces an f-string before it produces a bound parameter.',
  vibe_v05:
    '"The query is just a string and the value goes in the string." No model of parse-time vs bind-time — the user value is treated as text to format, not data to bind.',
  fp_gates_v05_shared: [
    'literal-constant queries with no interpolated expression',
    'internal migration files',
    'allowlisted sort-direction / column-name fragments validated against a set',
    'test fixtures demonstrating the vulnerable call',
  ],
  autofix_v05: 'review-needed',
  fixtures_v05_pattern: {
    positive: 'an f-string / concat feeding a query / execute / raw method',
    negative: 'a parameterized query with bound placeholders',
  },
  // Scan-scope regulatory mapping. Interpretation layer, not certification.
  // SQL injection is the canonical injection class; PCI 6.2.4 names it
  // directly. The HIPAA/GDPR ties are 'indicative' (data-dependent).
  compliance_refs: [
    {
      framework: 'PCI-DSS',
      clause: 'Req 6.2.4 (injection-flaw defenses, incl. SQL injection)',
      url: 'https://www.pcisecuritystandards.org/document_library/',
      relationship: 'direct',
      last_reviewed: '2026-05-15',
    },
    {
      framework: 'HIPAA',
      clause: '45 CFR 164.312(c)(1) Integrity',
      url: 'https://www.ecfr.gov/current/title-45/section-164.312',
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
  ],
};
