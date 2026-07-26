// src/lib/probes/v05/types.js
//
// JSDoc typedefs for the v0.5 probe schema. Pure documentation: editors get
// shape validation, but there's no runtime code here. The real validation
// happens in manifest.js#validateAdapter at build time.
//
// Schema source: docs/v05-research/preflight_v05_probe_inventory.md
// Architecture decisions: docs/v05-research/v05-architecture.md

/**
 * XL family record. Pure metadata; owns no execution logic.
 *
 * @typedef {Object} XLFamily
 * @property {string} xl_id                       e.g. "XL-001"
 * @property {string} name                        e.g. "Unsafe Deserialization"
 * @property {Category} category                  shared category default
 * @property {Severity} severity_default          shared severity default
 * @property {string|null} cwe                    CWE-NNN
 * @property {string|null} owasp_web              A01..A10
 * @property {string[]} owasp_llm                 LLM01..LLM10 array
 * @property {string} why_ai_v05                  shared text
 * @property {string} vibe_v05                    shared text (adapters MAY override)
 * @property {string[]} fp_gates_v05_shared       cross-language fp gates
 * @property {AutofixTier} autofix_v05            shared default
 * @property {Object} fixtures_v05_pattern        conceptual pattern (not paths)
 * @property {string} fixtures_v05_pattern.positive  text describing the positive case
 * @property {string} fixtures_v05_pattern.negative  text describing the negative case
 * @property {ComplianceRef[]} [compliance_refs]  OPTIONAL scan-scope regulatory
 *   mapping at the family level (the family is the regulatory unit). Adapters
 *   inherit this in buildManifest unless they declare their own.
 */

/**
 * Adapter record. The unit of detection for a single probe in a single
 * language. May reference an XL family via `xl_family`, or stand alone.
 *
 * @typedef {Object} AdapterRecord
 * @property {string} probe_id                    human-facing, e.g. "PY-DESERIALIZE-001"
 * @property {string|null} xl_family              "XL-NNN" if this adapts a shared family
 * @property {Language} language
 * @property {string} name                        human-readable name; used in finding.probe and suppression UI
 * @property {Category} category
 * @property {Severity} severity
 * @property {Confidence} confidence
 * @property {string|null} cwe
 * @property {string|null} owasp_web              A01..A10
 * @property {string|null} owasp_llm              LLM01..LLM10 (single value; for multi-mapping, see XLFamily.owasp_llm)
 * @property {Detector} detector
 * @property {string} scope                       file glob, e.g. "**\/*.py"
 * @property {string} what_it_catches             plain-English description
 * @property {string} why_ai_v05                  why AI tools emit this (may inherit from XL family text)
 * @property {string} vibe_v05                    mental-model description
 * @property {string} detection_approach          concrete regex/AST expression
 * @property {string[]} fp_gates_v05              patterns that legitimately match but should not fire
 * @property {string} remediation                 specific fix with code example
 * @property {AutofixTier} autofix_v05
 * @property {Fixtures} fixtures_v05              real filesystem paths
 * @property {string|null} known_incidents        CVE numbers, campaign names
 * @property {string|null} ioc_bundle_ref         key into preflight_v05_iocs.json
 * @property {Maturity} maturity                  experimental | beta | stable | deprecated
 * @property {ComplianceRef[]} [compliance_refs]  OPTIONAL regulatory mapping; populated post-language per locked /goal
 * @property {boolean} [shadow]                   true = emits to internal channel only (default false)
 * @property {string|null} [legacy_finding_id_seed]  for migration stableId continuity; preserves v0.4 hashes
 * @property {(files: Array<{path: string, content: string}>) => Array<Finding>} detect
 */

/**
 * Per-emission finding shape. v0.4 fields are unchanged; v0.5 fields are
 * optional and populated by attachProbeMeta() when a manifest entry exists.
 *
 * @typedef {Object} Finding
 * @property {string} id                          byte-offset id (legacy)
 * @property {string} [stableId]                  hash-based stable id; survives reformats
 * @property {string} probe                       human-readable probe name (matches AdapterRecord.name)
 * @property {string} title
 * @property {Severity} severity
 * @property {string} category
 * @property {string|null} cwe
 * @property {string} file
 * @property {number} line
 * @property {string} evidence
 * @property {string} remediation
 * @property {Object} [snippet]                   {startLine, endLine, text}
 * @property {string[]} [owasp]                   OWASP codes from PROBE_OWASP_MAP
 * @property {Confidence} [confidence]            from PROBE_META or manifest
 * @property {AutofixTier} [autofix]              from PROBE_META or manifest
 * @property {string} [learn_more_slug]
 * // v0.5 fields copied by attachProbeMeta when manifest entry exists:
 * @property {string} [probe_id]
 * @property {string|null} [xl_family]
 * @property {Maturity} [maturity]
 * @property {string} [why_ai_v05]
 * @property {string} [vibe_v05]
 * @property {string[]} [fp_gates_v05]
 * @property {AutofixTier} [autofix_v05]
 */

/**
 * @typedef {"python" | "javascript" | "typescript" | "go" | "rust" | "java" |
 *          "kotlin" | "swift" | "csharp" | "c" | "cpp" | "ruby" | "php" |
 *          "scala" | "elixir" | "dart"} Language
 */

/**
 * @typedef {"security" | "supply" | "llm" | "misconfig" | "memory" |
 *          "resource" | "build" | "access" | "crypto" | "transport"} Category
 */

/** @typedef {"critical" | "high" | "medium" | "low" | "info"} Severity */

/** @typedef {"high" | "medium" | "low"} Confidence */

/** @typedef {"rx" | "ast" | "manifest" | "config" | "mixed"} Detector */

/** @typedef {"mechanical" | "review-needed" | "manual"} AutofixTier */

/** @typedef {"experimental" | "beta" | "stable" | "deprecated"} Maturity */

/**
 * @typedef {Object} Fixtures
 * @property {string} positive                    path relative to repo root
 * @property {string} negative                    path relative to repo root
 * @property {string} [adversarial]               optional adversarial fixture
 */

/**
 * One regulatory citation attached to a probe. The probe does not change;
 * this is an interpretation layer over a finding the scanner already emits.
 *
 * @typedef {Object} ComplianceRef
 * @property {"HIPAA"|"PCI-DSS"|"GDPR"|"SOC2"} framework
 * @property {string} clause                      e.g. "164.312(a)(2)(iv)", "Art.32(1)(a)", "3.5.1"
 * @property {string} url                         link to the primary regulatory text
 * @property {"direct"|"indicative"} relationship direct = the pattern is the violation; indicative = needs human judgment
 * @property {string} last_reviewed               ISO date the mapping was verified against current regulatory text
 */

// Constant exports for runtime use (validators reference these).
export const LANGUAGES = Object.freeze([
  'python',
  'javascript',
  'typescript',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'csharp',
  'c',
  'cpp',
  'ruby',
  'php',
  'scala',
  'elixir',
  'dart',
]);

export const CATEGORIES = Object.freeze([
  'security',
  'supply',
  'llm',
  'misconfig',
  'memory',
  'resource',
  'build',
  'access',
  'crypto',
  'transport',
]);

export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);

export const CONFIDENCES = Object.freeze(['high', 'medium', 'low']);

export const DETECTORS = Object.freeze(['rx', 'ast', 'manifest', 'config', 'mixed']);

export const AUTOFIX_TIERS = Object.freeze(['mechanical', 'review-needed', 'manual']);

export const MATURITIES = Object.freeze(['experimental', 'beta', 'stable', 'deprecated']);

// Compliance axis. Forward-compat per the locked /goal: the field is added to
// the schema NOW so the manifest is regulation-ready, but compliance mapping
// is populated AFTER the language buildout. compliance_refs is OPTIONAL — it
// is deliberately NOT in REQUIRED_ADAPTER_FIELDS, so the language work never
// has to touch it and absent compliance data is valid.
//
// SCAN-scope frameworks only (code-detectable technical safeguards). FERPA /
// SOX / FDA / FTC / EU-AI-Act are NOT scan-scope — they are education-scope
// (Learn pages teach them; the scanner does not claim to detect them). Do
// not add them here.
export const COMPLIANCE_FRAMEWORKS = Object.freeze(['HIPAA', 'PCI-DSS', 'GDPR', 'SOC2']);

// 'direct'     — the pattern is itself the clause violation (e.g. plaintext
//                PHI in a log directly trips HIPAA 164.312(b)).
// 'indicative' — the pattern is associated with the clause but needs human
//                judgment in context. Never render an indicative ref as a
//                confirmed violation. This distinction is a load-bearing
//                legal constraint, not a tone choice.
export const COMPLIANCE_RELATIONSHIPS = Object.freeze(['direct', 'indicative']);

// Required fields on every adapter record. Used by validateAdapter().
export const REQUIRED_ADAPTER_FIELDS = Object.freeze([
  'probe_id',
  'language',
  'name',
  'category',
  'severity',
  'confidence',
  'detector',
  'scope',
  'what_it_catches',
  'why_ai_v05',
  'vibe_v05',
  'detection_approach',
  'fp_gates_v05',
  'remediation',
  'autofix_v05',
  'fixtures_v05',
  'maturity',
  'detect',
]);

// Required fields on every XL family record. learn_more_slug is mandatory:
// a probe family with no Learn page is half a product. The build fails
// (validateLearnContent) if the markdown is missing or still draft.
export const REQUIRED_FAMILY_FIELDS = Object.freeze([
  'xl_id',
  'name',
  'category',
  'severity_default',
  'why_ai_v05',
  'vibe_v05',
  'fp_gates_v05_shared',
  'autofix_v05',
  'fixtures_v05_pattern',
  'learn_more_slug',
]);

// probe_id format: LANG-CATEGORY-NNN. e.g. PY-DESERIALIZE-001.
// Enforced at validation. Decoupled from xl_family by design so taxonomy
// restructures don't break suppression comments referencing probe_id.
export const PROBE_ID_RE = /^[A-Z]{2,3}-[A-Z][A-Z0-9-]*[A-Z0-9]-\d{3}$/;

// xl_family format: XL-NNN. Opaque taxonomy reference.
export const XL_FAMILY_RE = /^XL-\d{3}$/;
