// src/lib/suppression.js
// localStorage-backed suppression store keyed by stableId. Three dispositions:
//   - false-positive  the probe is wrong for this codepath
//   - wont-fix        real but deferred (debt with documented reason)
//   - accepted-risk   real and understood; we choose to live with it
// Suppressed findings stay visible in the UI (the parent toggles ) and
// their severity is excluded from the live score recalculation.

export const SUPPRESSION_KEY = 'audit-app:suppressions:v1';
export const SUPPRESSION_DISPOSITIONS = ['false-positive', 'wont-fix', 'accepted-risk'];

export function loadSuppressions() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(SUPPRESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveSuppressions(map) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SUPPRESSION_KEY, JSON.stringify(map));
      return true;
    }
  } catch {}
  return false;
}

export function suppressFinding(map, stableIdKey, disposition, note = '') {
  if (!stableIdKey) return map;
  if (!SUPPRESSION_DISPOSITIONS.includes(disposition)) return map;
  return { ...map, [stableIdKey]: { disposition, note, at: new Date().toISOString() } };
}

export function unsuppressFinding(map, stableIdKey) {
  if (!stableIdKey || !map[stableIdKey]) return map;
  const { [stableIdKey]: _gone, ...rest } = map;
  return rest;
}

// Returns { visible, suppressed } partition. visible[].suppression is undefined,
// suppressed[].suppression carries the disposition + note + timestamp.
export function partitionFindings(findings, suppressions) {
  const visible = [];
  const suppressed = [];
  findings.forEach((f) => {
    const s = f.stableId ? suppressions[f.stableId] : undefined;
    if (s) {
      suppressed.push({ ...f, suppression: s });
    } else {
      visible.push(f);
    }
  });
  return { visible, suppressed };
}
