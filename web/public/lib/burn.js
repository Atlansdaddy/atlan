// lib/burn.js — how spend and run state are WORDED. No DOM.
//
// This is the ledger's display layer, and the wording is load-bearing: on a
// Claude subscription the dollar figure is the SDK's ESTIMATE at public API
// rates, not money leaving the account. Labelling it as a charge would be a
// quiet lie about cost, so the "API-equiv" wording is asserted by tests rather
// than left to whoever edits the template next.
//
// Extracted from app.js on 2026-08-04 under the structural ratchet.

/** 1234 → "1.2k", 120000 → "120k", small numbers unchanged. */
export function fmtTok(n) {
  const v = Number(n ?? 0);
  return v >= 1000 ? (v / 1000).toFixed(v >= 100000 ? 0 : 1) + 'k' : String(v || 0);
}

export const STATUS_LABEL = {
  running: 'running', done: 'done', 'halted-budget': 'BUDGET HALT',
  killed: 'killed', error: 'error',
  // A budget halt that was topped up. Distinct from 'done' on purpose: the run
  // did not finish, it handed its session to the run named in `resumedInto`.
  resumed: 'topped up →',
};

/** A run's status in human words; unknown states show themselves rather than blank. */
export function statusLabel(status) {
  return Object.hasOwn(STATUS_LABEL, status) ? STATUS_LABEL[status] : String(status ?? 'unknown');
}

/**
 * Today's burn line.
 *
 * Tokens are the real currency on a subscription — they meter the plan's usage
 * limits. `cacheRead` is input served from the prompt cache at ~0.1x and is
 * shown so the caching win is visible rather than invisible.
 */
export function burnLine(t = {}) {
  const cache = t.cacheRead ? ` · ${fmtTok(t.cacheRead)} cached` : '';
  return `burn today: ${fmtTok(t.tokens)} fresh tok${cache} · ≈$${Number(t.cost ?? 0).toFixed(2)} API-equiv`;
}

/** The per-run meta line: spend against budget, cache savings, denials. */
export function runMetaLine(r = {}) {
  return `${fmtTok(r.tokens)} / ${fmtTok(r.budget)} tok`
    + (r.cacheRead ? ` · ${fmtTok(r.cacheRead)} cached` : '')
    + (r.cost ? ` · ≈$${Number(r.cost).toFixed(4)}` : '')
    + (r.denials ? ` · ${r.denials} denied` : '');
}
