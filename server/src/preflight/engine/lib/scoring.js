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

export function computeScore(findings) {
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
