// src/lib/probes/v05/shadow.js
//
// Shadow-channel harness for Phase 2 dual-firing migrations. When a v0.5
// adapter is being validated against the v0.4 probe it replaces, the adapter
// runs but its findings are routed to an internal channel that is not
// user-visible. The diagnostics drawer can surface shadow-vs-production
// deltas for migration sign-off.
//
// Phase 0: the harness exists; no shadow adapters are registered yet.
// Phase 2: each migrated adapter is registered here with shadow:true. The
// flip (v0.4 probe -> shadow, v0.5 adapter -> production) is a one-field
// config change a maintainer makes once shadow output matches production
// output by stableId. There is no wall-clock dependency — how long to soak
// the comparison before flipping is a deployment-confidence judgment, not a
// barrier to shipping the code. See v05-architecture.md, execution gap #2.

import { validateAdapter } from './manifest.js';

/**
 * Run an adapter against a file set and return its findings without
 * affecting the user-visible scan results. The caller can compare these
 * to production findings using compareShadowToProduction().
 *
 * @param {object} adapter   AdapterRecord (must validate)
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<object>} findings
 */
export function runShadow(adapter, files) {
  validateAdapter(adapter);
  if (!Array.isArray(files)) {
    throw new TypeError('runShadow: files must be an array');
  }
  // Adapters are expected to be pure functions returning a findings array.
  const out = adapter.detect(files);
  if (!Array.isArray(out)) {
    throw new TypeError(
      `runShadow: adapter ${adapter.probe_id}.detect must return an array (got ${typeof out})`
    );
  }
  return out;
}

/**
 * Diff a shadow finding set against a production finding set. Compares by
 * stableId because that's the field users rely on for suppression
 * continuity; if shadow output preserves stableIds, the flip is safe.
 *
 * @param {Array<{stableId?: string, probe?: string, file?: string, line?: number}>} shadowFindings
 * @param {Array<{stableId?: string, probe?: string, file?: string, line?: number}>} productionFindings
 * @returns {{matched: number, onlyInShadow: object[], onlyInProduction: object[]}}
 */
export function compareShadowToProduction(shadowFindings, productionFindings) {
  const shadow = shadowFindings || [];
  const prod = productionFindings || [];

  // Build sets by stableId. If no stableId is present, fall back to a
  // composite key — but for parity assessment, missing stableId is itself a
  // signal that migration breaks suppression continuity.
  const keyOf = (f) => f.stableId || `__no-stableid__|${f.probe}|${f.file}|${f.line}`;

  const prodKeys = new Set(prod.map(keyOf));
  const shadowKeys = new Set(shadow.map(keyOf));

  let matched = 0;
  for (const k of shadowKeys) if (prodKeys.has(k)) matched++;

  return {
    matched,
    onlyInShadow: shadow.filter((f) => !prodKeys.has(keyOf(f))),
    onlyInProduction: prod.filter((f) => !shadowKeys.has(keyOf(f))),
  };
}
