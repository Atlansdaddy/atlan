// One line in the preview console.
//
// Built with createElement and textContent rather than innerHTML on purpose:
// this text comes from the previewed page, which is UNTRUSTED — it is whatever
// the app being developed logged, and those lines are auto-attached to the
// agent's next turn. Interpolating it as markup would make console.log() a
// script-injection vector into the cockpit itself.

export const MAX_LINES = 80;

/** @returns the appended element, so callers can assert on it. */
export function appendConsoleLine(box, level, text, now = new Date()) {
  if (box.firstChild?.classList?.contains('hint')) box.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'cl ' + level;
  const t = document.createElement('span');
  t.className = 'ct';
  t.textContent = now.toLocaleTimeString([], { hour12: false });
  div.append(t, document.createTextNode(String(text ?? '')));
  box.append(div);
  // Bounded: a page in a render loop can log thousands of lines a second, and an
  // unbounded list takes the cockpit down with it.
  while (box.children.length > MAX_LINES) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
  return div;
}
