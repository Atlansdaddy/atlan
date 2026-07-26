// src/lib/scoring.js
// Severity ordering, per-severity weight, and the score calculation.
//
// The model: every finding subtracts its severity weight from 100. Critical
// and high are uncapped (a real exploitable issue should tank the number).
// Medium / low / info have a capped TOTAL contribution: a repo whose only
// problems are cosmetic (SEO meta, a missing canonical) cannot be dragged
// into "critical" territory by sheer count. Two early users reported a
// frontend repo scoring 32 ("CRITICAL") off nothing but sparse meta tags;
// that was this: unbounded subtraction of dozens of low-severity findings.
//
// The tier LABEL is additionally severity-aware (see riskTier in theme.js):
// a repo with no critical and no high findings is never labelled CRITICAL or
// HIGH, regardless of count. Score answers "how much"; severity answers
// "how bad". The label must reflect the worst real finding, not the volume.

export const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
export const SEV_WEIGHT = { critical: 25, high: 10, medium: 5, low: 2, info: 1 };

// Maximum TOTAL points each severity band may subtract. critical/high are
// intentionally uncapped. medium/low/info are bounded so noise can't sink
// the score: worst case from a cosmetic-only repo is -(30+12+5) = -47, i.e.
// it floors at 53 (MODERATE), never CRITICAL.
export const SEV_BAND_CAP = {
  critical: Infinity,
  high: Infinity,
  medium: 30,
  low: 12,
  info: 5,
};

// Categories that describe code health rather than security exposure. These
// are reported, and they are not scored.
//
// Real-scan finding 2026-07: a private cockpit with zero critical and zero
// high findings scored 53 and read as MODERATE RISK. 47 of its 78 mediums
// were cyclomatic-complexity opinions from the AI Codegen Bloat family, which
// is already exempt from OWASP mapping precisely because it is maintainability
// rather than security. A security score dragged to its floor by opinions
// about function shape is measuring the wrong thing, and it tells someone who
// has fixed every real defect that they are still at moderate risk.
//
// The honest split: security findings move the score, maintainability findings
// are advisory. isAdvisoryFinding is exported so the UI can show the count
// separately instead of silently dropping it.
// A finding is advisory when it does not move the security number: code
// health, accessibility, discoverability, and the classifiers. A missing or
// malformed finding is not advisory, it is not a finding at all.
export function isAdvisoryFinding(finding) {
  if (!finding || typeof finding !== 'object') return false;
  return axisForFinding(finding) !== 'security';
}

export function countAdvisoryFindings(findings) {
  return (findings || []).filter(isAdvisoryFinding).length;
}

// Repeat instances of the same problem cost less than the first one.
//
// The band caps this replaced protected against noise, and they worked: a repo
// with forty cosmetic findings could not be dragged to CRITICAL. But a hard cap
// creates a plateau where progress is invisible. A real scan went from 24
// false-positive XSS findings to 7 and the number did not move by a single
// point, because both counts sat past the cap. Someone who fixes two-thirds of
// a problem and sees no change learns that the score is not worth chasing.
//
// The model now: findings group into classes by probe and severity, because
// twenty instances of one pattern is one thing to go fix, not twenty. A class
// costs its severity weight times a multiplier that grows with the log of the
// instance count and stops at 3x. So the first instance carries most of the
// cost, the twentieth adds very little, and removing any instance always
// changes the total.
//
//   1 instance   1.0x     4 instances  2.0x     16 instances  3.0x (max)
//   2 instances  1.5x     8 instances  2.5x     50 instances  3.0x
// Class multiplier: count^0.6, then bent smoothly toward a ceiling it never
// actually reaches.
//
// The ceiling has to be asymptotic rather than a clamp. A hard `Math.min` was
// tried first and a test caught it immediately: 24 instances and 40 instances
// both pinned at the maximum and scored identically, which is the exact
// plateau this model replaced, just moved further out. Any flat region is a
// place where someone fixes real problems and the number tells them nothing.
//
// r = count^0.6 gives sublinear growth. m = MAX·r / (r + MAX − 1) bends it,
// equals 1 at count 1, and rises forever while staying under MAX.
//
//   1 instance  1.00x     12 instances  2.82x     100 instances  4.55x
//   3 instances 1.67x     24 instances  3.45x     500 instances  5.35x
//   7 instances 2.35x     40 instances  3.88x       ∞            → 6x
export const REPEAT_MULTIPLIER_MAX = 6;
export const REPEAT_EXPONENT = 0.6;

export function classMultiplier(count) {
  if (count <= 1) return 1;
  const r = Math.pow(count, REPEAT_EXPONENT);
  return (REPEAT_MULTIPLIER_MAX * r) / (r + REPEAT_MULTIPLIER_MAX - 1);
}

function scoreOf(findings) {
  // class key -> instance count
  const classes = new Map();
  findings.forEach((f) => {
    if (!SEV_WEIGHT[f.severity]) return;
    const key = `${f.probe || 'unknown'}::${f.severity}`;
    classes.set(key, (classes.get(key) || 0) + 1);
  });
  let deduction = 0;
  for (const [key, count] of classes) {
    const severity = key.slice(key.lastIndexOf('::') + 2);
    deduction += SEV_WEIGHT[severity] * classMultiplier(count);
  }
  return Math.max(0, Math.round(100 - deduction));
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE AXES
// ─────────────────────────────────────────────────────────────────────────────
//
// One number cannot answer "is this safe to ship" and "is this pleasant to
// maintain" at the same time, and trying made both answers worse. A private
// cockpit with no exploitable defects read MODERATE RISK because complexity
// opinions and SEO hygiene were subtracting from its security score.
//
// The axes are keyed on PROBE NAME rather than finding category, because
// category is not a reliable discriminator here: `Misconfiguration` covers
// SEO meta tags, accessibility landmarks and genuine security misconfig alike.
// Probe name is exact, and probe-coverage.test.js already fails when a probe
// is registered without being accounted for, so a new probe cannot silently
// land in the wrong axis.
//
// Anything not listed is security. That default is deliberate: a probe added
// without thought about its axis should count toward the number that matters
// most, not disappear into an advisory bucket.
export const SCORE_AXES = ['security', 'health', 'accessibility', 'discoverability'];

const AXIS_BY_PROBE = {
  'AI Codegen Bloat': 'health',
  'Code Quality': 'health',
  'AI Code Smells': 'health',
  'A11y Landmarks': 'accessibility',
  'SEO Hygiene': 'discoverability',
  'GEO Hygiene': 'discoverability',
};

// Classifiers describe the project rather than judging it. They emit info
// findings by design and must not move any number.
const CLASSIFIER_PROBES = new Set(['Architecture', 'Host Detection']);

export function axisForFinding(finding) {
  if (!finding || CLASSIFIER_PROBES.has(finding.probe)) return null;
  return AXIS_BY_PROBE[finding.probe] || 'security';
}

/**
 * Per-axis scores plus the finding count behind each one.
 *
 * A count of zero with a score of 100 means "nothing found", which is not the
 * same claim as "measured and perfect". Callers that know whether an axis was
 * applicable (an API with no HTML has no accessibility surface) should say so
 * in the UI rather than showing a confident 100.
 *
 * @returns {{security:{score:number,findings:number}, health:{...}, accessibility:{...}, discoverability:{...}}}
 */
export function computeScores(findings) {
  const buckets = { security: [], health: [], accessibility: [], discoverability: [] };
  (findings || []).forEach((f) => {
    const axis = axisForFinding(f);
    if (axis && buckets[axis]) buckets[axis].push(f);
  });
  const out = {};
  for (const axis of SCORE_AXES) {
    out[axis] = { score: scoreOf(buckets[axis]), findings: buckets[axis].length };
  }
  return out;
}

/**
 * The headline number. Security only: it is the one that answers "is it safe
 * to ship". Kept as the default export shape so every existing caller keeps
 * working unchanged.
 */
export function computeScore(findings) {
  return scoreOf((findings || []).filter((f) => axisForFinding(f) === 'security'));
}
