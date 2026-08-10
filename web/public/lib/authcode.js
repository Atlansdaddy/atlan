// authcode.js — pulling the sign-in URL and code out of a terminal stream.
//
// A device-code flow prints a link and a short code and expects you to move both
// into a browser. On a phone that is where the whole thing stalls: xterm.js
// renders to a canvas, so selection is barely usable with a thumb, tmux swallows
// a bare `c`, and there is nothing to copy from. The code is RIGHT THERE and
// cannot be picked up, which is a stupid place for "build anything, anywhere" to
// end.
//
// So the text is read as it arrives and offered as buttons. Pure functions and
// no DOM, because the interesting part is the parsing and it should be testable
// without a terminal or a live login.

// Escapes are written \uXXXX, never as literal control bytes. Literals do not
// survive being moved between editors, shells and heredocs — one was silently
// eaten while this file was first written — and eslint flags the survivors as
// irregular whitespace. A mangled escape here stops colour being stripped, which
// breaks every match below without breaking anything visibly.
const ESC = '\\u001b';
const ANSI = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]` // CSI: colour, cursor moves, erases
  + `|${ESC}\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)` // OSC: title sets, hyperlinks
  + `|${ESC}[@-Z\\\\-_]`, // two-character escapes
  'g',
);
// Leftover control bytes: bell, backspace, NUL and friends. Newline and tab
// are kept deliberately, because they are the line structure every matcher
// below relies on.
// eslint-disable-next-line no-control-regex -- matching control characters IS the job
const CTRL = new RegExp('[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]', 'g');

/** Terminal output minus escape sequences, box drawing and carriage returns. */
export function plain(text) {
  return String(text ?? '')
    .replace(ANSI, '')
    .replace(CTRL, '')
    // Every CLI banner draws a box. Those characters are not content, and they
    // land against a URL whenever a link wraps inside one.
    .replace(/[─-╿▀-▟]/g, ' ')
    .replace(/\r/g, '\n');
}

/**
 * The last sign-in URL in the text, or null.
 *
 * LAST, not first: these flows reprint the link on retry, and the freshest one
 * is the live one. Trailing punctuation is trimmed — a URL at the end of a
 * sentence collects the period, and one inside a banner collects the border.
 */
export function extractAuthUrl(text) {
  const found = plain(text).match(/https?:\/\/[^\s<>"'`|)\]]+/g);
  if (!found) return null;
  const url = found[found.length - 1].replace(/[.,;:!?]+$/, '');
  return url.length > 8 ? url : null;
}

/**
 * The device code, or null.
 *
 * Shapes seen in the wild, most confident first:
 *   code: XY7Q-4RT2   explicitly labelled
 *   ABCD-EFGH         GitHub / Copilot, and the common OAuth device-code form
 *   AB12-CD34-EF56    longer grouped variants
 *
 * A bare word is deliberately NOT matched. Terminal banners are full of short
 * uppercase tokens, and offering the wrong string as "your code" is worse than
 * offering none: it sends someone to paste a value that gets rejected with no
 * hint why.
 */
export function extractAuthCode(text) {
  const t = plain(text);
  const labelled = t.match(/\bcode\s*[:=]?\s*([A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8})+)\b/i);
  if (labelled) return labelled[1];
  const grouped = t.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}(?:-[A-Z0-9]{4})*\b/g);
  return grouped ? grouped[grouped.length - 1] : null;
}

/**
 * Both, from a rolling buffer. Null when there is nothing worth showing, so a
 * caller can treat "no card" and "no match" as the same thing.
 */
export function findAuthPrompt(text) {
  const url = extractAuthUrl(text);
  const code = extractAuthCode(text);
  return url || code ? { url, code } : null;
}
