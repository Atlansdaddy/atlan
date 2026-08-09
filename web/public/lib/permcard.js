// permcard.js — the Allow/Deny card, and the one place it can be answered.
//
// This is the manual half of the same gate lib/autoapprove.js arms. It moved out
// of app.js when the ceiling ratchet objected to the auto-approve work, and it
// belongs here for a better reason than line count: the card IS the boundary on
// the Claude path. claudeEngine sets `settingSources: []` precisely so no
// accumulated "always allow" rule can run a tool without reaching it, which
// makes this small function the thing that decision rests on.

import { escapeHtml } from './text.js';

/**
 * Build a permission card.
 *
 * `onAnswer(approved)` is called at most ONCE. The buttons disable themselves on
 * the first answer, because two taps on Allow would send two perm.reply frames
 * for one id — and the second would resolve nothing, or worse, land against a
 * later request that reused the slot.
 */
export function permCard({ tool, input }, onAnswer) {
  const div = document.createElement('div');
  div.className = 'perm';
  div.innerHTML = `<div class="plabel">Permission — ${escapeHtml(tool)}</div><code></code>
      <div class="row"><button class="btn hot">Allow</button><button class="btn ghost">Deny</button></div>`;
  // textContent, not innerHTML: the tool's input is model-authored and lands in
  // the DOM of an authenticated page.
  div.querySelector('code').textContent = input;
  const [allow, deny] = div.querySelectorAll('button');
  let answered = false;
  const answer = (ok) => {
    if (answered) return;
    answered = true;
    div.classList.add('answered');
    allow.disabled = deny.disabled = true;
    onAnswer(ok);
  };
  allow.addEventListener('click', () => answer(true));
  deny.addEventListener('click', () => answer(false));
  return div;
}
