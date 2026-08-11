// autoapprove.js — the chat's pre-approval gate, as a decision rather than DOM.
//
// Atlan asks before every tool on the Claude path, because claudeEngine sets
// `settingSources: []` — a deliberate security boundary that stops the SDK from
// loading ~/.claude and settings.local.json, whose accumulated "always allow"
// rules let tools run without ever reaching canUseTool. That honesty is exactly
// what makes the cockpit tiring to drive by hand.
//
// The answer is not to re-open that door, because those rules are invisible and
// cumulative. It is to pre-approve a CLASS of work, out loud, using the same
// profiles the fleet already runs behind and walls.mjs already tests.

/** Profiles a chat may arm. Anything else means off — never "some other gate". */
export const CHAT_PROFILES = ['scout', 'verifier', 'builder'];

/**
 * The profile to send on the wire.
 *
 * Anything unrecognised — a stale localStorage value, a hand-edited option, a
 * profile removed from the server — becomes null, which is ask-every-time.
 * Failing to OFF is the only safe direction: an unknown string must never be
 * mistaken for "armed with something".
 */
export function normalizeProfile(v) {
  return CHAT_PROFILES.includes(v) ? v : null;
}

/** localStorage key. Per conversation, so arming one does not arm the next. */
export const autoKey = (conv) => `atlanAuto:${conv}`;

/**
 * What the composer should say about the current state.
 *
 * Armed is stated plainly, including the fact that forbidden tools are REFUSED
 * rather than escalated to a prompt. A gate whose armed state reads as a mild
 * preference is one people arm without meaning to.
 */
export function armedLabel(profile) {
  const p = normalizeProfile(profile);
  if (!p) return 'off — every tool asks first';
  return `armed: ${p} — allowed tools run, everything else is refused`;
}

/**
 * Wire the composer control: restore this conversation's choice, show whether it
 * is armed, remember changes.
 *
 * DOM wiring, in lib/ rather than app.js, following initPreviewMax and
 * initComposerHint — the app.js ceiling ratchet asked for it and the precedent
 * was already here. `conv` is a FUNCTION, not a value: the conversation id
 * changes when + New is tapped, and capturing it once would carry one chat's
 * armed state into the next.
 *
 * `fallback` is the per-provider default from the Doctor's gate panel. It
 * applies ONLY to a conversation with no stored choice: localStorage null
 * means "never chose", '' means "explicitly off", and an explicit off must
 * keep beating any default — a gate the user shut that reopens itself on the
 * next visit is exactly the self-arming gate the comment above the markup
 * forbids. The default itself is still a choice someone made out loud, in the
 * gates panel, so honoring it on unchosen conversations keeps the principle.
 */
export function initAutoApprove({ select, conv, fallback }) {
  if (!select) return;
  const wrap = select.parentElement;
  const paint = () => {
    const p = normalizeProfile(select.value);
    wrap?.classList.toggle('armed', !!p);
    select.title = armedLabel(p);
  };
  const read = () => {
    try { return localStorage.getItem(autoKey(conv())); } catch { return null; }
  };
  const restore = () => {
    const stored = read();
    select.value = stored === null
      ? (normalizeProfile(fallback?.()) ?? '')
      : (normalizeProfile(stored) ?? '');
    paint();
  };
  restore();
  select.addEventListener('change', () => {
    const p = normalizeProfile(select.value);
    select.value = p ?? '';
    // Swallowed on purpose: private-browsing localStorage throws on write, and
    // an armed gate that works for the session is better than one that errors.
    try { localStorage.setItem(autoKey(conv()), p ?? ''); } catch { /* session-only */ }
    paint();
  });
  return { refresh: restore };
}
