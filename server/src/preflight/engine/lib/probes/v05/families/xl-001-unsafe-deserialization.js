// src/lib/probes/v05/families/xl-001-unsafe-deserialization.js
//
// XL-001: Unsafe Deserialization. Pure metadata per the composition decision
// in docs/v05-research/v05-architecture.md — this record owns no execution
// logic. Language adapters reference it via xl_family: "XL-001" and declare
// their own detection independently.

/** @type {import('../types.js').XLFamily} */
export const XL_001 = {
  xl_id: 'XL-001',
  name: 'Unsafe Deserialization',
  category: 'security',
  severity_default: 'critical',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: ['LLM03', 'LLM04'],
  // Family-level Learn page. Adapters inherit this slug unless they override
  // with a language-specific deep-dive. Build fails if the markdown is missing
  // or draft (validateLearnContent in manifest.js).
  learn_more_slug: 'xl-unsafe-deserialization',
  why_ai_v05:
    'AI tools treat deserialization as generic persistence and reach for the language-native API without checking input source. Tutorial corpora predate the secure alternatives (PyTorch weights_only default, safetensors, yaml.safe_load).',
  vibe_v05:
    '"Save object, load object." No concept of a trust boundary between local-trusted bytes and network-untrusted bytes — the same call that round-trips your own cache is reused on a request body.',
  fp_gates_v05_shared: [
    'loading own-generated artifacts from a trusted, constant disk path',
    'signed internal artifacts with a verified signer',
    'an allowlist filter applied to the deserialized type before use',
    'test fixtures that intentionally demonstrate the vulnerable call',
  ],
  autofix_v05: 'review-needed',
  fixtures_v05_pattern: {
    positive: 'a deserialize call whose input is a request body / socket / uploaded file',
    negative: 'a deserialize call against a constant local trusted path, or a safe loader',
  },
  // Scan-scope regulatory mapping. This is an INTERPRETATION layer over a
  // finding the scanner already emits, never a certification. relationship
  // is honest: 'indicative' = the pattern is associated with the clause but
  // a human must judge it in context (deserialization is an integrity /
  // injection risk whose regulatory weight depends on the data handled).
  compliance_refs: [
    {
      framework: 'PCI-DSS',
      clause: 'Req 6.2.4 (injection and insecure deserialization defenses)',
      url: 'https://www.pcisecuritystandards.org/document_library/',
      relationship: 'indicative',
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
      clause: 'Art.32(1)(b) integrity of processing systems',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679',
      relationship: 'indicative',
      last_reviewed: '2026-05-15',
    },
  ],
};
