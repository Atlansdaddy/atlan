// lib/text.js — pure text/markup helpers. NO DOM, NO fetch, NO globals.
//
// Everything here was inline in app.js's 2,000-line IIFE, where it could not be
// unit-tested at all: the browser-only harnesses (Playwright) exercise it
// through the UI, which is slow and only covers the paths a click reaches.
// Extracted so the *decisions* are testable in Node while the DOM wiring stays
// in app.js. The rule for this directory: if a function needs `document`, it
// does not belong here.

/**
 * Escape the five HTML-significant characters as numeric entities.
 * Numeric (not named) so it is correct inside attributes as well as text.
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Split an assistant message into prose and fenced code blocks.
 *
 * This is the parsing half of what `renderRichMessage` used to do inline; the
 * caller turns the result into DOM nodes. Splitting on ``` means EVEN indices
 * are prose and ODD indices are code — an unterminated fence therefore yields a
 * final code part, which is the forgiving behaviour we want mid-stream while a
 * model is still typing.
 *
 * A language tag counts only if the first line is a short bare word
 * (`^[\w+.-]{1,24}$`) — otherwise it is real code and must not be eaten.
 *
 * @returns {Array<{type:'text'|'code', content:string, lang:string}>}
 */
export function parseMessageParts(text) {
  const out = [];
  const parts = String(text).split('```');
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) out.push({ type: 'text', content: part, lang: '' });
      return;
    }
    let lang = '';
    let code = part;
    const nl = part.indexOf('\n');
    if (nl >= 0) {
      const first = part.slice(0, nl).trim();
      if (/^[\w+.-]{1,24}$/.test(first)) {
        lang = first;
        code = part.slice(nl + 1);
      } else if (first === '') {
        // BARE FENCE (```\ncode). The old inline version left the newline that
        // followed the fence marker on the front of the code, so an untagged
        // block rendered with a blank first line while a tagged one did not.
        // Caught by the extraction tests, 2026-08-02.
        code = part.slice(nl + 1);
      }
    }
    out.push({ type: 'code', content: code.replace(/\n$/, ''), lang });
  });
  return out;
}

/** Fence language hint → file extension, for the Editor's placeholder path. */
export const LANG_EXT = {
  javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx',
  python: 'py', py: 'py', html: 'html', css: 'css', json: 'json',
  bash: 'sh', sh: 'sh', shell: 'sh', go: 'go', rust: 'rs', rs: 'rs',
  java: 'java', c: 'c', cpp: 'cpp', ruby: 'rb', php: 'php', sql: 'sql',
  yaml: 'yml', md: 'md', markdown: 'md',
};

/**
 * Case-insensitive lookup; '' when the hint is unknown or absent.
 *
 * `Object.hasOwn` rather than a bare index: a plain `LANG_EXT[hint]` walks the
 * prototype chain, so a fence tagged ```constructor returned `Object` — which
 * then flowed into a filename placeholder. Found by the extraction tests,
 * 2026-08-02; it was live in app.js.
 */
export function langToExt(hint) {
  if (!hint) return '';
  const k = String(hint).toLowerCase();
  return Object.hasOwn(LANG_EXT, k) ? LANG_EXT[k] : '';
}

/**
 * Render a unified diff as class-tagged spans.
 *
 * `+++`/`---` are FILE HEADERS, not additions/deletions — the order of these
 * tests is load-bearing and is the thing most likely to regress silently, since
 * a wrong colour still looks like a working diff.
 */
export function colorDiffHtml(diff) {
  if (!diff) return '<span class="diff-context">(no changes)</span>';
  return String(diff).split('\n').map((l) => {
    const cls = l.startsWith('@@') ? 'diff-hdr'
      : (l.startsWith('+') && !l.startsWith('+++')) ? 'diff-add'
        : (l.startsWith('-') && !l.startsWith('---')) ? 'diff-del' : 'diff-context';
    return `<span class="${cls}">${escapeHtml(l)}</span>`;
  }).join('\n');
}

/**
 * base64url → Uint8Array, for the Web Push VAPID application key.
 * Standard base64 with `-_` swapped back to `+/` and padding restored.
 */
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
