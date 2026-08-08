// peerlimit.js — stopping two agents talking to each other forever.
//
// THE HAZARD IS NOT HYPOTHETICAL AND IT IS NOT SYMMETRIC WITH A HUMAN TYPING.
// A person sending a chat-to-chat message sends one. Two agents given the same
// ability answer each other, and each answer is a turn: tokens spent, a CLI
// spawned, a phone kept awake. The failure mode is not "annoying", it is a
// budget and a battery drained overnight with nobody watching. Anthropic's own
// cross-session messaging ships throttling, identical-repeat dropping and a
// capped unread queue for exactly this reason.
//
// FOUR LIMITS, EACH FOR A DIFFERENT RUNAWAY:
//   rate      — a sender hammering one recipient (a retry loop)
//   dedup     — the same text again and again (a stuck agent)
//   backlog   — messages piling into a conversation nobody is reading
//   hops      — A tells B, B tells C, C tells A (a relay that never converges)
//
// The hop limit is the one that matters most once agents can send these
// themselves, because the other three are per-pair and a ring of three agents
// defeats all of them.
//
// STATE IS IN MEMORY AND THAT IS DELIBERATE. A restart clearing the counters is
// correct: the runaway it was throttling died with the process. Persisting them
// would mean a phone that OOM-restarts wakes up still refusing legitimate mail.

/** Messages one sender may deliver to one recipient inside the window. */
export const RATE_MAX = 6;
export const RATE_WINDOW_MS = 60_000;
/** Identical text from the same sender to the same recipient is dropped inside this window. */
export const DEDUP_WINDOW_MS = 120_000;
/** Peer messages allowed to pile up in a conversation with nobody reading it. */
export const MAX_BACKLOG = 50;
/** How far a message may be relayed: A->B is 1. Beyond this it is a ring. */
export const MAX_HOPS = 3;

const rate = new Map();     // `${from}->${to}` -> number[] (timestamps)
const lastText = new Map(); // `${from}->${to}` -> { text, at }
const backlog = new Map();  // convId -> number

/** Delivered messages that the recipient has now seen; called when a chat opens. */
export function clearBacklog(convId) { backlog.delete(convId); }

/** For the Doctor and for tests — never used to make a decision. */
export function peerLimitState() {
  return { pairs: rate.size, backlogs: [...backlog.entries()].map(([id, n]) => ({ id, n })) };
}

export function resetPeerLimits() { rate.clear(); lastText.clear(); backlog.clear(); }

/**
 * May this message be delivered?
 *
 * Returns `{ ok }` or `{ ok:false, reason }` — a REASON, always, because a
 * silently dropped message is indistinguishable from a broken feature. The
 * caller shows it.
 *
 * @param {object} o
 * @param {string} o.from     sender id (a conversation, or a human label)
 * @param {string} o.to       recipient conversation id
 * @param {string} o.text
 * @param {number} [o.hops]   how many relays deep this already is
 * @param {boolean} [o.live]  is anyone actually reading the recipient right now
 * @param {number} [o.now]    injectable clock, so tests do not sleep
 */
export function checkPeerMessage({ from, to, text, hops = 0, live = false, now = Date.now() }) {
  if (hops >= MAX_HOPS) {
    return { ok: false, reason: `relay depth ${hops} reached the limit of ${MAX_HOPS} — this looks like a loop, not a conversation` };
  }

  const key = `${from}->${to}`;

  // Identical repeat. Checked BEFORE the rate window so a stuck agent repeating
  // itself gets the accurate reason rather than a generic "too many".
  const prev = lastText.get(key);
  if (prev && prev.text === text && now - prev.at < DEDUP_WINDOW_MS) {
    return { ok: false, reason: 'identical to the last message you sent there, within two minutes — dropped' };
  }

  const hits = (rate.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    return { ok: false, reason: `${RATE_MAX} messages a minute to the same conversation is the limit — wait a moment` };
  }

  // Backlog only counts where nobody is reading. A live conversation is being
  // watched by a human, and throttling mail they can see is just breakage.
  if (!live) {
    const queued = backlog.get(to) ?? 0;
    if (queued >= MAX_BACKLOG) {
      return { ok: false, reason: `${MAX_BACKLOG} unread messages are already waiting in that conversation — open it before sending more` };
    }
  }

  return { ok: true };
}

/** Record a delivery. Separate from the check so a refused message never counts against anyone. */
export function recordPeerMessage({ from, to, text, live = false, now = Date.now() }) {
  const key = `${from}->${to}`;
  const hits = (rate.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rate.set(key, hits);
  lastText.set(key, { text, at: now });
  if (!live) backlog.set(to, (backlog.get(to) ?? 0) + 1);
}
