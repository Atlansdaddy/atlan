// src/lib/probes/v05/manifest.js
//
// The v0.5 probe manifest aggregator. Composes XL family records + adapter
// records into PROBE_MANIFEST_V05, keyed by probe_id. v0.4 PROBES + PROBE_META
// stay exactly as they are; this is the parallel registry per the side-by-side
// decision in docs/v05-research/v05-architecture.md.
//
// Phase 0 ships with zero registered probes. The aggregator builds an empty
// manifest cleanly. Tests assert that.
//
// Validation is hard at build time: a malformed adapter or a missing fixture
// path throws. The dogfood scan exercises every fixture; if the manifest builds,
// the dogfood scan can run.

import {
  REQUIRED_ADAPTER_FIELDS,
  REQUIRED_FAMILY_FIELDS,
  LANGUAGES,
  CATEGORIES,
  SEVERITIES,
  CONFIDENCES,
  DETECTORS,
  AUTOFIX_TIERS,
  MATURITIES,
  PROBE_ID_RE,
  XL_FAMILY_RE,
  COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_RELATIONSHIPS,
} from './types.js';
import { FAMILIES } from './families/index.js';
import { ADAPTERS } from './adapters/index.js';

/** @type {Error & {field?: string, value?: unknown}} */
class ManifestError extends Error {
  constructor(message, field, value) {
    super(message);
    this.name = 'ManifestError';
    this.field = field;
    this.value = value;
  }
}

// ---------- Validators ----------

/**
 * Validate an XL family record. Throws on any shape problem.
 * @param {object} family
 */
export function validateFamily(family) {
  if (!family || typeof family !== 'object') {
    throw new ManifestError('family must be an object', 'family', family);
  }
  for (const field of REQUIRED_FAMILY_FIELDS) {
    if (family[field] === undefined || family[field] === null) {
      throw new ManifestError(`family missing required field: ${field}`, field);
    }
  }
  if (!XL_FAMILY_RE.test(family.xl_id)) {
    throw new ManifestError(
      `family.xl_id must match XL-NNN: got ${family.xl_id}`,
      'xl_id',
      family.xl_id
    );
  }
  if (!CATEGORIES.includes(family.category)) {
    throw new ManifestError(
      `family.category not in enum: ${family.category}`,
      'category',
      family.category
    );
  }
  if (!SEVERITIES.includes(family.severity_default)) {
    throw new ManifestError(
      `family.severity_default not in enum: ${family.severity_default}`,
      'severity_default',
      family.severity_default
    );
  }
  if (!AUTOFIX_TIERS.includes(family.autofix_v05)) {
    throw new ManifestError(
      `family.autofix_v05 not in enum: ${family.autofix_v05}`,
      'autofix_v05',
      family.autofix_v05
    );
  }
  if (!Array.isArray(family.fp_gates_v05_shared)) {
    throw new ManifestError('family.fp_gates_v05_shared must be an array', 'fp_gates_v05_shared');
  }
  if (
    !family.fixtures_v05_pattern ||
    typeof family.fixtures_v05_pattern.positive !== 'string' ||
    typeof family.fixtures_v05_pattern.negative !== 'string'
  ) {
    throw new ManifestError(
      'family.fixtures_v05_pattern must have positive and negative text fields',
      'fixtures_v05_pattern'
    );
  }
  // Family-level compliance mapping (the regulatory unit is the family,
  // not the per-language adapter). Optional; inherited by adapters in
  // buildManifest unless the adapter overrides it.
  validateComplianceRefs(family.compliance_refs, `family ${family.xl_id}`);
}

/**
 * Validate an adapter record. Throws on any shape problem. Does NOT verify
 * fixture files exist on disk — that's `validateFixturePaths()` below,
 * called separately by build tooling (the browser has no fs).
 * @param {object} adapter
 */
export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new ManifestError('adapter must be an object', 'adapter', adapter);
  }
  for (const field of REQUIRED_ADAPTER_FIELDS) {
    if (adapter[field] === undefined || adapter[field] === null) {
      throw new ManifestError(`adapter missing required field: ${field}`, field);
    }
  }
  if (!PROBE_ID_RE.test(adapter.probe_id)) {
    throw new ManifestError(
      `adapter.probe_id must match LANG-CATEGORY-NNN: got ${adapter.probe_id}`,
      'probe_id',
      adapter.probe_id
    );
  }
  if (adapter.xl_family != null && !XL_FAMILY_RE.test(adapter.xl_family)) {
    throw new ManifestError(
      `adapter.xl_family must match XL-NNN or be null: got ${adapter.xl_family}`,
      'xl_family',
      adapter.xl_family
    );
  }
  if (!LANGUAGES.includes(adapter.language)) {
    throw new ManifestError(
      `adapter.language not in enum: ${adapter.language}`,
      'language',
      adapter.language
    );
  }
  if (!CATEGORIES.includes(adapter.category)) {
    throw new ManifestError(
      `adapter.category not in enum: ${adapter.category}`,
      'category',
      adapter.category
    );
  }
  if (!SEVERITIES.includes(adapter.severity)) {
    throw new ManifestError(
      `adapter.severity not in enum: ${adapter.severity}`,
      'severity',
      adapter.severity
    );
  }
  if (!CONFIDENCES.includes(adapter.confidence)) {
    throw new ManifestError(
      `adapter.confidence not in enum: ${adapter.confidence}`,
      'confidence',
      adapter.confidence
    );
  }
  if (!DETECTORS.includes(adapter.detector)) {
    throw new ManifestError(
      `adapter.detector not in enum: ${adapter.detector}`,
      'detector',
      adapter.detector
    );
  }
  if (!AUTOFIX_TIERS.includes(adapter.autofix_v05)) {
    throw new ManifestError(
      `adapter.autofix_v05 not in enum: ${adapter.autofix_v05}`,
      'autofix_v05',
      adapter.autofix_v05
    );
  }
  if (!MATURITIES.includes(adapter.maturity)) {
    throw new ManifestError(
      `adapter.maturity not in enum: ${adapter.maturity}`,
      'maturity',
      adapter.maturity
    );
  }
  if (!Array.isArray(adapter.fp_gates_v05)) {
    throw new ManifestError('adapter.fp_gates_v05 must be an array', 'fp_gates_v05');
  }
  if (
    !adapter.fixtures_v05 ||
    typeof adapter.fixtures_v05.positive !== 'string' ||
    typeof adapter.fixtures_v05.negative !== 'string'
  ) {
    throw new ManifestError(
      `adapter.fixtures_v05 must declare positive and negative paths (got ${JSON.stringify(adapter.fixtures_v05)})`,
      'fixtures_v05',
      adapter.fixtures_v05
    );
  }
  if (typeof adapter.detect !== 'function') {
    throw new ManifestError('adapter.detect must be a function', 'detect');
  }
  // A standalone adapter (no XL family to inherit a Learn page from) must
  // declare its own learn_more_slug. Adapters with an xl_family resolve the
  // slug from the family in buildManifest(). Either way every adapter ends
  // up with a Learn page; an adapter that resolves to none fails the build.
  if (
    (adapter.xl_family == null || adapter.xl_family === undefined) &&
    (typeof adapter.learn_more_slug !== 'string' || adapter.learn_more_slug.length === 0)
  ) {
    throw new ManifestError(
      `adapter ${adapter.probe_id} has no xl_family and no learn_more_slug — every probe must resolve to a Learn page`,
      'learn_more_slug',
      adapter.learn_more_slug
    );
  }
  // compliance_refs is OPTIONAL. An adapter MAY carry its own, but the
  // common case (per the family-level mapping decision) is that it inherits
  // the XL family's compliance_refs in buildManifest. Either way, if present
  // on the adapter it must be well-formed.
  validateComplianceRefs(adapter.compliance_refs, `adapter ${adapter.probe_id}`);
}

/**
 * Validate a compliance_refs array (shared by validateAdapter +
 * validateFamily). Absent / null is valid (compliance is optional and
 * inherited). When present it must be an array of well-formed refs:
 * a SCAN-scope framework, non-empty clause + http(s) url, a
 * direct|indicative relationship, and an ISO last_reviewed date.
 *
 * SCAN scope only. FERPA / SOX / FDA / FTC / EU-AI-Act are education-scope
 * (taught via Learn pages) and are deliberately rejected here so the
 * scanner never claims to detect them.
 *
 * @param {unknown} refs
 * @param {string} owner  label for error messages (e.g. "family XL-006")
 */
export function validateComplianceRefs(refs, owner) {
  if (refs === undefined || refs === null) return;
  if (!Array.isArray(refs)) {
    throw new ManifestError(
      `${owner}: compliance_refs must be an array when present`,
      'compliance_refs',
      refs
    );
  }
  refs.forEach((ref, idx) => {
    const where = `compliance_refs[${idx}]`;
    if (!ref || typeof ref !== 'object') {
      throw new ManifestError(`${owner}: ${where} must be an object`, where, ref);
    }
    if (!COMPLIANCE_FRAMEWORKS.includes(ref.framework)) {
      throw new ManifestError(
        `${owner}: ${where}.framework not in scan-scope set ${JSON.stringify(COMPLIANCE_FRAMEWORKS)} (FERPA/SOX/FDA/FTC/AI-Act are education-scope, not scan-scope)`,
        `${where}.framework`,
        ref.framework
      );
    }
    if (typeof ref.clause !== 'string' || ref.clause.length === 0) {
      throw new ManifestError(
        `${owner}: ${where}.clause must be a non-empty string`,
        `${where}.clause`,
        ref.clause
      );
    }
    if (typeof ref.url !== 'string' || !/^https?:\/\//.test(ref.url)) {
      throw new ManifestError(
        `${owner}: ${where}.url must be an http(s) URL`,
        `${where}.url`,
        ref.url
      );
    }
    if (!COMPLIANCE_RELATIONSHIPS.includes(ref.relationship)) {
      throw new ManifestError(
        `${owner}: ${where}.relationship must be one of ${JSON.stringify(COMPLIANCE_RELATIONSHIPS)}`,
        `${where}.relationship`,
        ref.relationship
      );
    }
    if (typeof ref.last_reviewed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ref.last_reviewed)) {
      throw new ManifestError(
        `${owner}: ${where}.last_reviewed must be an ISO YYYY-MM-DD date (auditable provenance)`,
        `${where}.last_reviewed`,
        ref.last_reviewed
      );
    }
  });
}

/**
 * Verify the Learn pattern markdown for a probe exists and is not draft.
 * Browser-portable: caller supplies the existence + draft checks (build/test
 * tooling has fs + frontmatter access). Mirrors validateFixturePaths().
 *
 * @param {object} resolvedEntry  a manifest entry (post-resolution; has learn_more_slug)
 * @param {(slug: string) => boolean} patternExists
 * @param {(slug: string) => boolean} patternIsDraft
 * @throws when the Learn page is missing or still draft
 */
export function validateLearnContent(resolvedEntry, patternExists, patternIsDraft) {
  const slug = resolvedEntry.learn_more_slug;
  if (!slug) {
    throw new ManifestError(
      `adapter ${resolvedEntry.probe_id}: no learn_more_slug resolved`,
      'learn_more_slug'
    );
  }
  if (!patternExists(slug)) {
    throw new ManifestError(
      `adapter ${resolvedEntry.probe_id}: Learn pattern "${slug}" does not exist`,
      'learn_more_slug',
      slug
    );
  }
  if (patternIsDraft(slug)) {
    throw new ManifestError(
      `adapter ${resolvedEntry.probe_id}: Learn pattern "${slug}" is still draft — undraft it before shipping the probe`,
      'learn_more_slug',
      slug
    );
  }
}

/**
 * Verify the fixture files declared by an adapter exist on disk. The browser
 * runtime has no filesystem, so this is called by build/test tooling that has
 * Node fs access. Phase 0 ships with no adapters; the function is in place so
 * it's ready when the first adapter lands.
 *
 * @param {object} adapter
 * @param {(path: string) => boolean} existsSync  caller-supplied existence check
 * @throws on any missing fixture file
 */
export function validateFixturePaths(adapter, existsSync) {
  const fx = adapter.fixtures_v05;
  for (const key of ['positive', 'negative', 'adversarial']) {
    const p = fx?.[key];
    if (!p) continue; // adversarial is optional
    if (!existsSync(p)) {
      throw new ManifestError(
        `adapter ${adapter.probe_id}: fixture file "${p}" (${key}) does not exist on disk`,
        `fixtures_v05.${key}`,
        p
      );
    }
  }
}

// ---------- Aggregator ----------

/**
 * Build PROBE_MANIFEST_V05 from a list of XL families + adapters. Pure
 * function — caller supplies inputs, gets a frozen object back.
 *
 * @param {object[]} families
 * @param {object[]} adapters
 * @returns {Object<string, object>} keyed by probe_id
 */
export function buildManifest(families, adapters) {
  if (!Array.isArray(families)) {
    throw new ManifestError('buildManifest: families must be an array', 'families');
  }
  if (!Array.isArray(adapters)) {
    throw new ManifestError('buildManifest: adapters must be an array', 'adapters');
  }

  // Index families by xl_id so adapters can reference them. Validate first so
  // a malformed family fails before adapter validation produces confusing
  // downstream errors.
  const familyById = {};
  for (const family of families) {
    validateFamily(family);
    if (familyById[family.xl_id]) {
      throw new ManifestError(`duplicate XL family: ${family.xl_id}`, 'xl_id', family.xl_id);
    }
    familyById[family.xl_id] = family;
  }

  const manifest = {};
  for (const adapter of adapters) {
    validateAdapter(adapter);
    if (manifest[adapter.probe_id]) {
      throw new ManifestError(
        `duplicate adapter probe_id: ${adapter.probe_id}`,
        'probe_id',
        adapter.probe_id
      );
    }
    const family = adapter.xl_family ? familyById[adapter.xl_family] : null;
    if (adapter.xl_family && !family) {
      throw new ManifestError(
        `adapter ${adapter.probe_id} references unknown XL family: ${adapter.xl_family}`,
        'xl_family',
        adapter.xl_family
      );
    }
    // Resolve the Learn slug: adapter's own override wins, else inherit from
    // the family. validateAdapter already guaranteed a standalone adapter
    // (no family) carries its own slug, so resolution always yields a string.
    const resolvedSlug = adapter.learn_more_slug || family?.learn_more_slug || null;
    if (!resolvedSlug) {
      throw new ManifestError(
        `adapter ${adapter.probe_id}: could not resolve a learn_more_slug from adapter or family`,
        'learn_more_slug'
      );
    }
    // Compliance mapping is family-level (the regulatory unit is the
    // family). An adapter MAY override with its own; otherwise it inherits
    // the family's. Absent on both = null (compliance is optional; most
    // probes have no scan-scope regulatory mapping).
    const resolvedCompliance = adapter.compliance_refs || family?.compliance_refs || null;
    manifest[adapter.probe_id] = Object.freeze({
      ...adapter,
      learn_more_slug: resolvedSlug,
      compliance_refs: resolvedCompliance,
    });
  }

  return Object.freeze(manifest);
}

/**
 * Project the v0.5 manifest into the v0.4 PROBE_OWASP_MAP shape so the
 * existing OwaspCoverageView consumer doesn't need to change.
 *
 * Returns: `{A01: [adapter.name, ...], LLM01: [...], ...}`
 *
 * @param {Object<string, object>} manifest
 * @returns {Object<string, string[]>}
 */
/**
 * Is this adapter LIVE (user-visible, executed in the real scan)?
 *
 * Two gates:
 *  - shadow:false — the maintainer has promoted it.
 *  - legacy_finding_id_seed == null — it is net-new detection. An adapter
 *    that carries a legacy seed is a v0.4 *migration*; it stays out of the
 *    live set until the v0.4 probe it replaces is retired (the branch-merge
 *    cutover), otherwise the v0.4 probe and the adapter double-fire on the
 *    same code. Until then it is still exercised by the parity test.
 *
 * The OWASP-map projection and the live-PROBES projection MUST use this
 * same predicate, or probe-coverage breaks (a name in the OWASP map that
 * is not a registered probe).
 *
 * @param {object} adapter
 * @returns {boolean}
 */
export function isLiveAdapter(adapter) {
  return !adapter.shadow && adapter.legacy_finding_id_seed == null;
}

export function buildOwaspMapFromManifest(manifest) {
  const out = {};
  for (const adapter of Object.values(manifest)) {
    // Only LIVE adapters appear in the user-visible OWASP coverage map.
    if (!isLiveAdapter(adapter)) continue;
    for (const codeField of ['owasp_web', 'owasp_llm']) {
      const code = adapter[codeField];
      if (!code) continue;
      if (!out[code]) out[code] = [];
      if (!out[code].includes(adapter.name)) out[code].push(adapter.name);
    }
  }
  return out;
}

/**
 * Merge a hand-coded v0.4 OWASP map with the manifest-derived v0.5 map.
 * Manifest wins on probe-name conflict (a migrated probe should appear only
 * in the manifest, not the hand-coded map). For Phase 0 the manifest map is
 * empty so the merge is a no-op clone of the hand-coded input.
 *
 * @param {Object<string, string[]>} handCoded
 * @param {Object<string, string[]>} fromManifest
 * @returns {Object<string, string[]>}
 */
export function mergeOwaspMaps(handCoded, fromManifest) {
  const out = {};
  const codes = new Set([...Object.keys(handCoded || {}), ...Object.keys(fromManifest || {})]);
  for (const code of codes) {
    const merged = [];
    for (const name of handCoded?.[code] || []) {
      if (!merged.includes(name)) merged.push(name);
    }
    for (const name of fromManifest?.[code] || []) {
      if (!merged.includes(name)) merged.push(name);
    }
    out[code] = merged;
  }
  return out;
}

// ---------- The live manifest ----------

// v1 promotion: every adapter is shadow:false. The net-new language
// adapters are LIVE (executed in the real scan, user-visible). The three
// v0.4 migration adapters (legacy_finding_id_seed set) are held out of the
// live set by isLiveAdapter until the v0.4 probes they replace are retired
// at the branch-merge cutover — otherwise they double-fire. They remain
// exercised by the v05-phase2 parity test.

/** @type {Readonly<Object<string, object>>} */
export const PROBE_MANIFEST_V05 = buildManifest(FAMILIES, ADAPTERS);

// Re-export for stable-id.js consumption.
export const MANIFEST_OWASP_MAP = buildOwaspMapFromManifest(PROBE_MANIFEST_V05);

// The live adapters projected into the v0.4 probe shape ({name, fn}) so
// the existing scan loop (App.jsx handleScan) executes them with no
// pipeline change. probes.js appends these to PROBES.
/** @type {ReadonlyArray<{name: string, fn: (files: Array<{path:string,content:string}>) => object[]}>} */
export const MANIFEST_LIVE_PROBES = Object.freeze(
  Object.values(PROBE_MANIFEST_V05)
    .filter(isLiveAdapter)
    .map((a) => Object.freeze({ name: a.name, fn: a.detect }))
);
