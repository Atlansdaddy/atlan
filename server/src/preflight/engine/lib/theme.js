// src/lib/theme.js
// Mid-Atlantic AI brand palette + font stacks, plus the risk-tier mapping that pairs
// a numeric score with the brand color used to surface it.
//
// Palette source: official brand kit (navy / white / mint cyan / orange / grays).
// Every text color carries the contrast ratio it produces against the navy background
// — these were tuned to clear WCAG AA at minimum (most clear AAA).

export const T = {
  bg: '#0a1226', // deep brand navy (darker than logo navy for AA contrast)
  bgGrid: 'rgba(159, 229, 221, 0.03)', // faint mint tint, echoes the eye color
  panel: '#11192e',
  panelAlt: '#172143',
  panelHover: '#1d294d',
  border: '#1f2a44',
  borderAlt: '#2c3a5e',
  text: '#f5f7fa', // contrast 17.7:1 on bg — WCAG AAA
  textDim: '#a8b1c5', // contrast 8.94:1 on bg — AAA
  textMuted: '#8a96b0', // contrast 6.5:1 on bg — AA (was #6b7693 = 4.15:1, failed AA)
  accent: '#f26b1f', // brand orange (antenna lights) — 6.18:1 on bg = AA Large
  accentDim: '#c2541a',
  accentAlt: '#9fe5dd', // brand mint (robot eyes) — for friendly highlights
  navy: '#1b2d52', // brand navy (logo body) — for chrome accents
  good: '#9fe5dd', // success uses the brand mint
  sev: {
    critical: {
      bg: '#1f0e1a',
      fg: '#fb7185',
      border: '#7f1d1d',
      glow: 'rgba(251, 113, 133, 0.15)',
    },
    high: { bg: '#1f140a', fg: '#f97316', border: '#9a3412', glow: 'rgba(249, 115, 22, 0.15)' },
    medium: { bg: '#1f1a0a', fg: '#fbbf24', border: '#854d0e', glow: 'rgba(251, 191, 36, 0.12)' },
    low: { bg: '#0e1a30', fg: '#60a5fa', border: '#1e3a8a', glow: 'rgba(96, 165, 250, 0.12)' },
    info: { bg: '#0d1d2c', fg: '#9fe5dd', border: '#3b6e69', glow: 'rgba(159, 229, 221, 0.12)' },
  },
  cat: {
    'Data Breach': '#f97316',
    'Code Injection': '#fbbf24',
    'Supply Chain': '#a78bfa',
    'Auth & Access': '#fb7185',
    'AI/LLM Security': '#9fe5dd',
    Misconfiguration: '#60a5fa',
  },
};

export const fontDisplay = "'Rubik', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const fontUI = "'Roboto', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const fontCondensed = "'Roboto Condensed', 'Roboto', 'Helvetica Neue', Arial, sans-serif";
export const fontEyebrow = "'Impact', 'Haettenschweiler', 'Arial Narrow Bold', sans-serif";
export const fontMono = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Roboto Mono', monospace";

const TIER = {
  low: { label: 'LOW RISK', color: T.good, ring: T.good },
  moderate: { label: 'MODERATE RISK', color: T.sev.medium.fg, ring: T.sev.medium.fg },
  high: { label: 'HIGH RISK', color: T.sev.high.fg, ring: T.sev.high.fg },
  critical: { label: 'CRITICAL RISK', color: T.sev.critical.fg, ring: T.sev.critical.fg },
};

// Risk tier label. The score answers "how much"; severity answers "how bad".
// When severity context is supplied (the headline + exports do this), the
// label is clamped to the worst real finding so a repo whose only issues are
// cosmetic (SEO meta, missing canonical) is never shown as CRITICAL/HIGH
// "what attackers can do right now", and a repo with a real critical is
// never softened to LOW/MODERATE by a high numeric score.
//
// opts is optional: callers that pass only a score (history rows, the gauge
// colour band) keep the original purely-numeric mapping unchanged.
export function riskTier(score, opts) {
  if (opts) {
    if (opts.hasCritical) return TIER.critical;
    if (opts.hasHigh) return TIER.high;
    // No critical and no high: cosmetic / medium / low / info only. Cannot
    // be HIGH or CRITICAL no matter the count. Score splits LOW vs MODERATE.
    return score >= 80 ? TIER.low : TIER.moderate;
  }
  if (score >= 80) return TIER.low;
  if (score >= 60) return TIER.moderate;
  if (score >= 40) return TIER.high;
  return TIER.critical;
}
