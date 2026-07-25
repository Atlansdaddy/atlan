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

function scoreOf(findings) {
  const perBand = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach((f) => {
    const w = SEV_WEIGHT[f.severity];
    if (w) perBand[f.severity] += w;
  });
  let deduction = 0;
  for (const sev of SEV_ORDER) {
    deduction += Math.min(perBand[sev], SEV_BAND_CAP[sev]);
  }
  return Math.max(0, 100 - deduction);
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
