// msgstyle.js — which bubble is this, and whose name goes on it.
//
// Extracted from app.js so it can be TESTED. It was two inline ternaries, and
// the thing they decide is a security property, not a cosmetic one: a message
// that arrived from another conversation must never be mistakable for something
// the user typed or something the agent concluded. Agents here run full-auto, so
// an unattributed channel between them is an agent-to-agent prompt-injection
// path, and the attribution IS the control.
//
// Roles on the wire: 'user', 'assistant' (any engine), 'brain' (chat-only
// model), 'peer' (another conversation), 'err'. 'claude' is the OLD name for
// 'assistant' and is still accepted — transcripts written before the rename
// exist on disk and have to keep rendering.

const ASSISTANT = new Set(['assistant', 'claude']);

/**
 * The bubble class. Anything unrecognised styles as an assistant, never as the user.
 *
 * Returns 'assistant', not 'claude'. The CSS hook was named after one vendor, so
 * every reply from every engine — and every message Atlan spoke itself — wore a
 * class called `claude`. 'claude' stays ACCEPTED as an input role because
 * transcripts written before the rename are on disk and have to keep rendering;
 * it is simply no longer produced.
 */
export function msgClass(role) {
  if (role === 'user') return 'user';
  if (role === 'err') return 'err';
  if (role === 'peer') return 'peer';
  return 'assistant';
}

/**
 * The byline above the bubble, or null when the bubble carries none.
 *
 * The user's own messages get no byline — they know who they are. Everything
 * that did NOT come from them gets one, which is the rule that makes an
 * unattributed message impossible rather than merely unlikely.
 */
export function whoLabel(role, engineLabel) {
  if (role === 'peer') return `✉ from ${engineLabel || 'another chat'}`;
  if (role === 'brain') return `${engineLabel || 'brain'} · chat only`;
  if (ASSISTANT.has(role)) return engineLabel || 'assistant';
  return null;
}

/** True when this bubble came from somewhere other than the person typing. */
export function isThirdParty(role) {
  return role === 'peer';
}

/**
 * The line under a finished turn: what it cost, and how to pick it back up.
 *
 * `resume` arrives from the ENGINE on chat.result. app.js used to assemble
 * `claude --resume ${id}` itself, so one vendor's CLI syntax was a property of
 * the front end, rendered under a composer that might be set to any engine. An
 * engine with no VERIFIED resume command sends null and no hint appears —
 * putting a command that does not work into someone's clipboard is worse than
 * offering none.
 */
export function sessionLine({ cost, resume }) {
  const spend = typeof cost === 'number' ? ` · $${cost.toFixed(4)}` : '';
  if (!resume) return { text: `— turn done${spend} —`, copy: null };
  return { text: `— turn done${spend} · tap to copy: ${resume.slice(0, 40)}… —`, copy: resume };
}
