// lib/enginepicker.js — how engines and ladder rungs are LABELLED. No DOM.
//
// Extracted from app.js on 2026-08-04 because the structural ratchet in
// test/docdrift.mjs caught the file growing past its ceiling on the very first
// merge after the rule was adopted. The honest response to a ratchet is to
// move code out, not to raise the number — so this is the ladder/engine label
// logic, which was pure all along and simply had nowhere to live.
//
// Everything here answers "what should this option SAY?". The caller creates
// the elements. If a function in this file needs `document`, it is in the
// wrong file.

/**
 * The label for one engine option in the switcher.
 *
 * Agent engines expose several model tiers, so a multi-tier engine is shown as
 * "Short · model" per tier while a single-tier one keeps its full label. An
 * engine that is not ready appends what it NEEDS — the honest-readiness rule:
 * the picker never silently offers a capability the user cannot use.
 */
export function engineOptionLabel(engine, model, tierCount) {
  const short = String(engine.label ?? '').split(' — ')[0];
  const base = tierCount > 1 ? `${short} · ${model}` : engine.label;
  return engine.ready ? base : `${base} — needs: ${engine.needs}`;
}

/** The `engine|model` value the chat send path parses back apart. */
export function engineOptionValue(engineId, model) {
  return `${engineId}|${model}`;
}

/**
 * Label for the ladder option: the rung chain, cheapest first.
 *
 * The arrows are the whole point — they show the climb at a glance. A label
 * without them means the rungs never arrived and the option is decorative,
 * which is what the UI test asserts against.
 */
export function ladderOptionLabel(rungs) {
  const chain = (rungs ?? []).map((r) => String(r.label ?? '').split(' (')[0]).join(' → ');
  return chain ? `Ladder · ${chain}` : 'Ladder · (rungs unavailable)';
}

/**
 * Tooltip for the ladder option. Leads with how many rungs are FREE, because on
 * a phone that is the deciding fact, then states the escalation triggers — and
 * states the limit, since the ladder cannot catch a confidently wrong answer.
 */
export function ladderOptionTitle(rungs) {
  const free = (rungs ?? []).filter((r) => r.free).length;
  return `Tries ${free} free rung(s) first and only spends if they can't answer. `
    + `Escalates on error, empty, truncated, or a stated "I can't" — never on a model grading itself.`;
}

/**
 * The one line shown in chat per rung attempt.
 *
 * A ladder that silently returns the frontier answer teaches the user nothing
 * about what their free tiers can already do, so every phase gets a line.
 */
export function rungLineText(m) {
  const label = m.label || m.tier;
  if (m.phase === 'start') return `▸ trying ${label}${m.free ? ' (free)' : ''}…`;
  if (m.phase === 'answered') return `✓ answered by ${label}${m.free ? ' — free' : ''}`;
  if (m.phase === 'escalating') return `↑ ${label}: ${m.reason} — climbing to ${m.next}`;
  return `⚠ ${label}: ${m.reason} — ladder exhausted, showing its best attempt`;
}
