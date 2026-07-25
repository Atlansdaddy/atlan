// src/lib/compliance-scope.js
//
// The user's DECLARED regulatory scope. Compliance mapping is opt-in:
// empty by default, so an un-regulated app gets zero compliance output.
// Selecting a regime is the user asserting their app processes that
// regulated data — the tool maps clauses given the assertion, it never
// decides the regime applies.
//
// Persisted in localStorage like suppressions: a declaration is a
// property of the project, not a single scan.

import { COMPLIANCE_FRAMEWORKS } from './probes/v05/types.js';

// The four code-detectable (scan-scope) regimes the picker offers.
export const SELECTABLE_FRAMEWORKS = COMPLIANCE_FRAMEWORKS;

export const COMPLIANCE_SCOPE_KEY = 'preflight.complianceScope.v1';

/**
 * @returns {string[]} declared frameworks (subset of SELECTABLE_FRAMEWORKS)
 */
export function loadComplianceScope() {
  try {
    const raw = globalThis.localStorage?.getItem(COMPLIANCE_SCOPE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((f) => SELECTABLE_FRAMEWORKS.includes(f));
  } catch {
    return [];
  }
}

/**
 * @param {string[]} scope
 * @returns {string[]} the sanitized scope that was persisted
 */
export function saveComplianceScope(scope) {
  const clean = (Array.isArray(scope) ? scope : []).filter((f) =>
    SELECTABLE_FRAMEWORKS.includes(f)
  );
  try {
    globalThis.localStorage?.setItem(COMPLIANCE_SCOPE_KEY, JSON.stringify(clean));
  } catch {
    /* localStorage unavailable (private mode / SSR) — scope just won't persist */
  }
  return clean;
}
