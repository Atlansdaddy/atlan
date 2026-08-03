// ladder.js — the escalation ladder, for CHAT.
//
// The worker hierarchy already climbs local → cloud-sm → frontier, but only for
// schema-locked jobs: `callTier` demands JSON so deterministic checkers can
// grade it. Chat is prose, so none of those checkers apply — which is why the
// ladder has never been reachable from the one surface used most, and on a
// phone that is the setting that matters most (free local first, climb only
// when it isn't enough).
//
// ── THE HONEST PROBLEM ────────────────────────────────────────────────────
// In the hierarchy, escalation is gated by CODE. In free-form chat there is no
// deterministic way to ask "is this answer good?" — that judgement is exactly
// what we have no wall for.
//
// So this module does NOT invent one. It never asks a model to grade itself
// (`MACHINE.md` §8: no self-critique as a wall), and it never claims a quality
// verdict it cannot support. It escalates on **observable facts about the
// response** — it failed, it was empty, it was truncated, it said it could not
// do the thing — plus an explicit human tap. Everything else stays where it
// lands, and the UI says which rung answered so the user can climb deliberately.
//
// That is a weaker promise than the hierarchy's, and stating it plainly is the
// point: an escalation trigger that pretended to measure quality would be a
// vacuous gate (`GROUNDING.md` §2) wearing a ladder's clothes.
//
// Research note (`MULTI-MODEL.md`): escalate-then-stop is the second
// best-evidenced multi-model mode, behind routing to a specialist. It is
// deliberately NOT a council, NOT a debate, and NOT a mixture — the evidence
// says those are worse, not better, for correctness.

import { TIERS } from './hierarchy.js';

/** Below this many characters, an answer is treated as non-substantive. */
export const MIN_USEFUL_CHARS = 24;

/**
 * Phrases that mean "this rung could not do it".
 *
 * These are CAPABILITY signals, not quality ones. A model saying it lacks the
 * knowledge or ability is reporting a fact about itself, which is a legitimate
 * reason to climb. A model producing a confidently wrong answer is NOT caught
 * here and cannot be — that is the honest limit of this design, stated rather
 * than papered over.
 */
export const INCAPACITY_PATTERNS = [
  /\bI (?:do not|don't) (?:have|know)\b/i,
  /\bI (?:cannot|can't|am unable to)\b/i,
  /\bI'm not able to\b/i,
  /\bbeyond my (?:capabilities|training|knowledge)\b/i,
  /\binsufficient (?:context|information)\b/i,
  /\bI would need (?:more|additional)\b/i,
];

/**
 * Decide whether a rung's response warrants climbing.
 *
 * Pure and synchronous, so it is unit-testable without a model. Returns the
 * REASON as well as the verdict — the UI shows it, because "escalated" with no
 * cause is indistinguishable from a system that always escalates.
 *
 * @returns {{escalate: boolean, reason: string|null}}
 */
export function shouldEscalate({ text, error = null, truncated = false }) {
  if (error) return { escalate: true, reason: `this rung errored: ${String(error).slice(0, 120)}` };

  const t = String(text ?? '').trim();
  if (!t) return { escalate: true, reason: 'empty response' };
  if (t.length < MIN_USEFUL_CHARS) {
    return { escalate: true, reason: `response was ${t.length} chars — too short to be an answer` };
  }
  if (truncated) return { escalate: true, reason: 'response was cut off mid-answer' };

  for (const re of INCAPACITY_PATTERNS) {
    if (re.test(t)) return { escalate: true, reason: 'this rung said it could not answer' };
  }
  return { escalate: false, reason: null };
}

/**
 * The default chat ladder.
 *
 * `agentic` is deliberately absent — it is a step SIDEWAYS into a rung with
 * hands, not up the intelligence ladder, and nothing should silently start
 * routing chat through a second vendor with filesystem access. A caller opts
 * into it by name, exactly as the hierarchy requires.
 */
export const CHAT_LADDER = ['local', 'cloud-sm', 'frontier'];

/** Validate and normalise a caller-supplied ladder. Throws rather than guessing. */
export function normaliseLadder(rungs) {
  const list = Array.isArray(rungs) && rungs.length ? rungs : CHAT_LADDER;
  for (const r of list) {
    if (!Object.hasOwn(TIERS, r)) {
      throw new Error(`unknown tier: ${r} — one of ${Object.keys(TIERS).join(', ')}`);
    }
  }
  if (new Set(list).size !== list.length) throw new Error('ladder has a repeated tier');
  return list;
}

/**
 * Human-readable description of a rung, for the UI.
 * Reads from TIERS so it can never drift from what actually runs.
 */
export function describeRung(id) {
  const t = TIERS[id];
  if (!t) return null;
  return { id, label: t.label, engine: t.engine, model: t.model, free: id === 'local' || id === 'cloud-sm' };
}

export function ladderRungs(rungs) {
  return normaliseLadder(rungs).map(describeRung);
}

/**
 * Climb the ladder for one chat turn.
 *
 * Runs the cheapest rung, applies `shouldEscalate` to its OBSERVABLE result,
 * and climbs only when that says so. Emits a `chat.rung` frame per attempt so
 * the UI can show the climb as it happens — a ladder that silently returns the
 * frontier answer teaches the user nothing about what their free tiers can do.
 *
 * `runRung` is injected rather than imported, which keeps this function free of
 * engine wiring and makes the climb logic testable without a model.
 *
 * @param {object}   o
 * @param {string}   o.text        the user's prompt
 * @param {string[]} o.rungs       tier ids, cheapest first
 * @param {Function} o.runRung     async (tierId, text) => {text, tokens, truncated?}
 * @param {Function} o.send        WS emitter
 * @returns {Promise<{text, tier, tokens, attempts}>}
 */
export async function runLadder({ text, rungs, runRung, send = () => {} }) {
  const ladder = normaliseLadder(rungs);
  const attempts = [];
  let last = null;

  for (let i = 0; i < ladder.length; i++) {
    const tierId = ladder[i];
    const rung = describeRung(tierId);
    send({ t: 'chat.rung', phase: 'start', tier: tierId, label: rung.label, free: rung.free, index: i, of: ladder.length });

    let result, error = null;
    try {
      result = await runRung(tierId, text);
    } catch (err) {
      error = String(err?.message ?? err);
      result = { text: '', tokens: 0 };
    }

    const verdict = shouldEscalate({ text: result.text, error, truncated: result.truncated });
    attempts.push({ tier: tierId, tokens: result.tokens ?? 0, escalated: verdict.escalate, reason: verdict.reason });
    last = { ...result, tier: tierId };

    if (!verdict.escalate) {
      send({ t: 'chat.rung', phase: 'answered', tier: tierId, label: rung.label, free: rung.free });
      return { text: result.text, tier: tierId, tokens: result.tokens ?? 0, attempts };
    }

    const isLast = i === ladder.length - 1;
    send({
      t: 'chat.rung',
      phase: isLast ? 'exhausted' : 'escalating',
      tier: tierId,
      label: rung.label,
      reason: verdict.reason,
      next: isLast ? null : describeRung(ladder[i + 1]).label,
    });
  }

  // Ladder exhausted. Return the top rung's answer rather than nothing — a
  // weak answer the user can see beats a silent failure, and `attempts` carries
  // the full record of why every rung was rejected.
  return {
    text: last?.text || '',
    tier: last?.tier ?? ladder[ladder.length - 1],
    tokens: last?.tokens ?? 0,
    attempts,
    exhausted: true,
  };
}
