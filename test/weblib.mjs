// weblib.mjs — unit tests for the pure front-end modules in web/public/lib/.
//
// These are the FIRST unit tests any front-end code in this repo has had. Until
// now `web/public/app.js` was a 2,000-line IIFE: every helper below was inline
// and unreachable from Node, so the only coverage was Playwright driving the
// whole UI — slow, and it only reaches the paths a click reaches.
//
// The extraction rule these enforce: pure decisions live in lib/, DOM wiring
// stays in app.js. If a test here needs `document`, the extraction was wrong.

import assert from 'node:assert';

import {
  escapeHtml, parseMessageParts, langToExt, LANG_EXT, colorDiffHtml,
  urlBase64ToUint8Array,
} from '../web/public/lib/text.js';
import { isNight, greetingFor, hueFor, MOOD_HUE } from '../web/public/lib/ambient.js';
import {
  engineOptionLabel, engineOptionValue, ladderOptionLabel, ladderOptionTitle, rungLineText,
} from '../web/public/lib/enginepicker.js';
import { fmtTok, statusLabel, burnLine, runMetaLine } from '../web/public/lib/burn.js';
import { linkRowHtml } from '../web/public/lib/joblink.js';
import { effectiveTheme, nextTheme, editorThemeFor, themeButtonGlyph } from '../web/public/lib/theme.js';

// `atob` is a browser global. Node 16+ provides it, but assert it exists rather
// than let one test fail cryptically if that ever changes.
assert.equal(typeof atob, 'function', 'atob must be available to test base64url decoding');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('WEB LIB SUITE');

// ── escapeHtml ─────────────────────────────────────────────────────────────
test('escapeHtml neutralises every HTML-significant character', () => {
  assert.equal(escapeHtml('<script>'), '&#60;script&#62;');
  assert.equal(escapeHtml('a & b'), 'a &#38; b');
  assert.equal(escapeHtml(`"'`), '&#34;&#39;');
});

test('escapeHtml escapes quotes, so it is safe inside an attribute', () => {
  // Named entities would not cover ' — numeric is why this is attribute-safe.
  const out = escapeHtml('" onload="alert(1)');
  assert.ok(!out.includes('"'), 'a raw double quote would break out of an attribute');
});

test('escapeHtml coerces non-strings instead of throwing', () => {
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(undefined), 'undefined');
});

test('escapeHtml is not double-escaping-safe, and that is intentional', () => {
  // Documents real behaviour so a future "fix" is a deliberate decision:
  // callers must escape exactly once.
  assert.equal(escapeHtml('&#60;'), '&#38;#60;');
});

// ── parseMessageParts ──────────────────────────────────────────────────────
test('parseMessageParts returns plain prose as a single text part', () => {
  const p = parseMessageParts('just talking');
  assert.deepEqual(p, [{ type: 'text', content: 'just talking', lang: '' }]);
});

test('parseMessageParts splits prose and a fenced block with a language tag', () => {
  const p = parseMessageParts('before\n```js\nconst a = 1;\n```\nafter');
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], { type: 'text', content: 'before\n', lang: '' });
  assert.deepEqual(p[1], { type: 'code', content: 'const a = 1;', lang: 'js' });
  assert.equal(p[2].type, 'text');
});

test('parseMessageParts treats a fence with no language as code, lang empty', () => {
  const p = parseMessageParts('```\nraw\n```');
  assert.equal(p[0].type, 'code');
  assert.equal(p[0].lang, '');
  assert.equal(p[0].content, 'raw');
});

test('parseMessageParts does NOT eat a first line that is real code', () => {
  // The guard is ^[\w+.-]{1,24}$ — "const a = 1;" has spaces so it is not a tag.
  const p = parseMessageParts('```const a = 1;\nmore\n```');
  assert.equal(p[0].content, 'const a = 1;\nmore');
  assert.equal(p[0].lang, '');
});

test('parseMessageParts accepts a 24-char tag exactly at the boundary', () => {
  // The tag sits ON the fence line — '```tag\ncode'. Writing '```\ntag' instead
  // makes the first line empty, which is a bare fence, not a tagged one.
  const tag = 'a'.repeat(24);
  const p = parseMessageParts('```' + tag + '\ncode\n```');
  assert.equal(p[0].lang, tag);
  assert.equal(p[0].content, 'code');
});

test('parseMessageParts rejects a 25-char tag on the fence line', () => {
  const tag = 'a'.repeat(25);
  const p = parseMessageParts('```' + tag + '\ncode\n```');
  assert.equal(p[0].lang, '', '25 chars exceeds the 24-char bound');
  assert.equal(p[0].content, tag + '\ncode', 'the over-long line stays as code');
});

test('parseMessageParts drops the newline after a BARE fence', () => {
  // Regression: the inline version left it, so untagged blocks rendered with a
  // leading blank line while tagged ones did not.
  assert.equal(parseMessageParts('```\nraw\n```')[0].content, 'raw');
  assert.equal(parseMessageParts('```   \nraw\n```')[0].content, 'raw', 'trailing spaces on the fence line still count as bare');
});

test('parseMessageParts keeps an UNTERMINATED fence as code (streaming)', () => {
  // While a model is mid-stream the closing fence has not arrived yet; showing
  // the partial block as code is the forgiving behaviour we want.
  const p = parseMessageParts('text\n```py\nprint(1)');
  assert.equal(p[1].type, 'code');
  assert.equal(p[1].lang, 'py');
  assert.equal(p[1].content, 'print(1)');
});

test('parseMessageParts drops empty prose segments but keeps empty code', () => {
  const p = parseMessageParts('```js\n```');
  assert.equal(p.length, 1, 'no empty text parts around the fence');
  assert.equal(p[0].type, 'code');
  assert.equal(p[0].content, '');
});

test('parseMessageParts handles several fenced blocks in one message', () => {
  const p = parseMessageParts('a```js\n1\n```b```py\n2\n```c');
  assert.deepEqual(p.map((x) => x.type), ['text', 'code', 'text', 'code', 'text']);
  assert.deepEqual(p.filter((x) => x.type === 'code').map((x) => x.lang), ['js', 'py']);
});

test('parseMessageParts strips exactly one trailing newline from code', () => {
  const p = parseMessageParts('```js\ncode\n\n```');
  assert.equal(p[0].content, 'code\n', 'only the final newline is removed');
});

test('parseMessageParts accepts dotted and plus language tags', () => {
  for (const tag of ['c++', 'objective-c', 'asp.net']) {
    const p = parseMessageParts('```' + tag + '\nx\n```');
    assert.equal(p[0].lang, tag, `should accept ${tag}`);
  }
});

test('parseMessageParts never throws on non-string input', () => {
  assert.doesNotThrow(() => parseMessageParts(null));
  assert.doesNotThrow(() => parseMessageParts(undefined));
  assert.doesNotThrow(() => parseMessageParts(7));
});

// ── langToExt ──────────────────────────────────────────────────────────────
test('langToExt maps known languages, case-insensitively', () => {
  assert.equal(langToExt('JavaScript'), 'js');
  assert.equal(langToExt('PY'), 'py');
  assert.equal(langToExt('markdown'), 'md');
});

test('langToExt returns empty string for unknown or missing hints', () => {
  assert.equal(langToExt('brainfuck'), '');
  assert.equal(langToExt(''), '');
  assert.equal(langToExt(undefined), '');
  assert.equal(langToExt(null), '');
});

test('langToExt cannot be tricked into returning an inherited Object property', () => {
  // A bare `LANG_EXT[hint]` lookup would return a function for 'constructor'.
  assert.equal(langToExt('constructor'), '');
  assert.equal(langToExt('toString'), '');
  assert.equal(langToExt('__proto__'), '');
});

test('every LANG_EXT value is a bare extension, no dot, no path', () => {
  for (const [k, v] of Object.entries(LANG_EXT)) {
    assert.match(v, /^[a-z0-9]+$/, `${k} → ${v} should be a bare extension`);
  }
});

// ── colorDiffHtml ──────────────────────────────────────────────────────────
test('colorDiffHtml labels added, removed, header and context lines', () => {
  const html = colorDiffHtml('@@ -1 +1 @@\n+added\n-removed\n unchanged');
  assert.ok(html.includes('class="diff-hdr"'));
  assert.ok(html.includes('class="diff-add"'));
  assert.ok(html.includes('class="diff-del"'));
  assert.ok(html.includes('class="diff-context"'));
});

test('colorDiffHtml treats +++ and --- as FILE HEADERS, not add/delete', () => {
  // The most likely silent regression: a wrong colour still looks like a diff.
  const html = colorDiffHtml('--- a/x.js\n+++ b/x.js');
  assert.ok(!html.includes('diff-add'), '+++ is a header, not an addition');
  assert.ok(!html.includes('diff-del'), '--- is a header, not a deletion');
  assert.equal((html.match(/diff-context/g) || []).length, 2);
});

test('colorDiffHtml escapes diff content — a diff can contain HTML', () => {
  const html = colorDiffHtml('+<img onerror=alert(1)>');
  assert.ok(!html.includes('<img'), 'diff payload must not become live markup');
  assert.ok(html.includes('&#60;img'));
});

test('colorDiffHtml reports empty input rather than rendering nothing', () => {
  assert.ok(colorDiffHtml('').includes('(no changes)'));
  assert.ok(colorDiffHtml(null).includes('(no changes)'));
  assert.ok(colorDiffHtml(undefined).includes('(no changes)'));
});

test('colorDiffHtml preserves line count', () => {
  const src = 'a\nb\nc\nd';
  assert.equal(colorDiffHtml(src).split('\n').length, 4);
});

// ── urlBase64ToUint8Array ──────────────────────────────────────────────────
test('urlBase64ToUint8Array decodes unpadded base64url', () => {
  // "hi" → base64 "aGk=" → base64url "aGk" (padding stripped)
  const out = urlBase64ToUint8Array('aGk');
  assert.deepEqual(Array.from(out), [104, 105]);
});

test('urlBase64ToUint8Array translates the -_ alphabet back to +/', () => {
  // bytes [251, 255] → base64 "+/8=" → base64url "-_8"
  const out = urlBase64ToUint8Array('-_8');
  assert.deepEqual(Array.from(out), [251, 255]);
});

test('urlBase64ToUint8Array returns a real Uint8Array of the right length', () => {
  const out = urlBase64ToUint8Array('aGVsbG8'); // "hello"
  assert.ok(out instanceof Uint8Array);
  assert.equal(out.length, 5);
});

// ── ambient: isNight ───────────────────────────────────────────────────────
test('isNight covers 22:00 through 06:30 across the midnight wrap', () => {
  assert.equal(isNight(22), true, '22:00 is the first night hour');
  assert.equal(isNight(23.9), true);
  assert.equal(isNight(0), true, 'midnight is night — the wrap is the bug-prone part');
  assert.equal(isNight(6.49), true);
});

test('isNight excludes the day, with exact boundaries', () => {
  assert.equal(isNight(6.5), false, '06:30 exactly is already day');
  assert.equal(isNight(12), false);
  assert.equal(isNight(21.99), false, '21:59 is still day');
});

// ── ambient: greetingFor ───────────────────────────────────────────────────
test('greetingFor returns a distinct line for each band', () => {
  const bands = [0, 5, 12, 18, 22].map(greetingFor);
  assert.equal(new Set(bands).size, 5, 'all five bands differ');
});

test('greetingFor boundaries land in the later band', () => {
  assert.notEqual(greetingFor(4), greetingFor(5));
  assert.notEqual(greetingFor(11), greetingFor(12));
  assert.notEqual(greetingFor(17), greetingFor(18));
  assert.notEqual(greetingFor(21), greetingFor(22));
});

test('greetingFor covers all 24 hours with no gap', () => {
  for (let h = 0; h < 24; h++) {
    assert.ok(typeof greetingFor(h) === 'string' && greetingFor(h).length > 0, `hour ${h}`);
  }
});

// ── ambient: hueFor ────────────────────────────────────────────────────────
test('hueFor returns the mood hue, and falls back to calm when unknown', () => {
  assert.equal(hueFor('alarmed'), MOOD_HUE.alarmed);
  assert.equal(hueFor('nonsense'), MOOD_HUE.calm);
  assert.equal(hueFor(undefined), MOOD_HUE.calm);
});

test('every MOOD_HUE value is a valid RGB triplet', () => {
  for (const [mood, hue] of Object.entries(MOOD_HUE)) {
    assert.match(hue, /^\d{1,3},\d{1,3},\d{1,3}$/, `${mood} → ${hue}`);
    for (const n of hue.split(',')) assert.ok(Number(n) >= 0 && Number(n) <= 255, `${mood} channel ${n}`);
  }
});

// ── lib/enginepicker.js ────────────────────────────────────────────────────
// Extracted 2026-08-04 because the app.js ratchet caught the file growing past
// its ceiling on the first merge after the rule was adopted. Moving code out is
// the honest response to a ratchet; raising the number is not.

test('engineOptionLabel shows model tiers only when there is more than one', () => {
  const e = { label: 'Codex — GPT-5.6', ready: true };
  assert.equal(engineOptionLabel(e, 'gpt-5.6-sol', 3), 'Codex · gpt-5.6-sol');
  assert.equal(engineOptionLabel(e, 'gpt-5.6-sol', 1), 'Codex — GPT-5.6', 'single tier keeps the full label');
});

test('engineOptionLabel appends what an unready engine NEEDS', () => {
  // Honest readiness: the picker never offers a capability the user cannot use
  // without saying what would unlock it.
  const e = { label: 'Gemini', ready: false, needs: 'GEMINI_API_KEY' };
  assert.match(engineOptionLabel(e, 'gemini-3.6-flash', 1), /needs: GEMINI_API_KEY/);
});

test('engineOptionValue builds the engine|model pair the send path parses', () => {
  assert.equal(engineOptionValue('claude', 'claude-opus-5'), 'claude|claude-opus-5');
});

test('ladderOptionLabel chains the rungs with arrows', () => {
  const label = ladderOptionLabel([
    { label: 'on-phone Qwen (free)' }, { label: 'Gemini Flash (free tier)' }, { label: 'Claude Opus 5 (frontier)' },
  ]);
  assert.equal(label, 'Ladder · on-phone Qwen → Gemini Flash → Claude Opus 5');
});

test('ladderOptionLabel degrades honestly when rungs never arrived', () => {
  // NOT vacuous: an empty chain must SAY it is empty, not render a bare
  // "Ladder ·" that looks like a working option.
  assert.match(ladderOptionLabel([]), /unavailable/);
  assert.match(ladderOptionLabel(undefined), /unavailable/);
});

test('ladderOptionTitle leads with the free count and states the limit', () => {
  const t = ladderOptionTitle([{ free: true }, { free: true }, { free: false }]);
  assert.match(t, /2 free rung/, 'the free count is the phone-relevant fact');
  assert.match(t, /never on a model grading itself/, 'the honest limit must ride along');
});

test('rungLineText renders every phase distinctly', () => {
  const base = { tier: 'local', label: 'on-phone Qwen' };
  const lines = ['start', 'answered', 'escalating', 'exhausted']
    .map((phase) => rungLineText({ ...base, phase, reason: 'empty response', next: 'Gemini Flash' }));
  assert.equal(new Set(lines).size, 4, 'all four phases must be visually distinct');
  assert.match(lines[1], /answered by/);
  assert.match(lines[2], /climbing to Gemini Flash/);
});

test('rungLineText marks free rungs, and falls back to the tier id', () => {
  assert.match(rungLineText({ tier: 'local', label: 'Qwen', phase: 'answered', free: true }), /free/);
  assert.match(rungLineText({ tier: 'local', phase: 'start' }), /local/, 'no label → use the tier id');
});

// ── lib/burn.js ────────────────────────────────────────────────────────────
// The wording here is load-bearing: on a subscription the dollar figure is the
// SDK's ESTIMATE at public API rates, not money leaving the account. These
// tests pin that so it cannot drift into reading like a charge.

test('fmtTok abbreviates thousands and drops decimals past 100k', () => {
  assert.equal(fmtTok(999), '999');
  assert.equal(fmtTok(1234), '1.2k');
  assert.equal(fmtTok(120000), '120k');
});

test('fmtTok survives null/undefined without printing NaN', () => {
  for (const v of [null, undefined, 0]) assert.equal(fmtTok(v), '0', String(v));
});

test('burnLine labels the dollar figure API-equiv, never as a charge', () => {
  const line = burnLine({ tokens: 40000, cost: 0.43 });
  assert.match(line, /API-equiv/, 'must not read as money leaving the account');
  assert.match(line, /40\.0k fresh tok/);
  assert.ok(!/\bspent\b|\bcharged\b|\bbilled\b/i.test(line), 'no charge language');
});

test('burnLine shows the cache saving only when there is one', () => {
  assert.match(burnLine({ tokens: 100, cacheRead: 90000 }), /90\.0k cached/);
  assert.ok(!/cached/.test(burnLine({ tokens: 100 })), 'no cache read → no cache clause');
});

test('runMetaLine shows spend against budget, and omits absent parts', () => {
  const full = runMetaLine({ tokens: 1500, budget: 60000, cacheRead: 800, cost: 0.0123, denials: 2 });
  assert.match(full, /1\.5k \/ 60\.0k tok/);
  assert.match(full, /800 cached/);
  assert.match(full, /2 denied/);
  const bare = runMetaLine({ tokens: 10, budget: 100 });
  assert.ok(!/cached|denied|\$/.test(bare), 'absent fields must not render empty clauses');
});

test('statusLabel words known states and SHOWS unknown ones', () => {
  assert.equal(statusLabel('halted-budget'), 'BUDGET HALT');
  assert.equal(statusLabel('done'), 'done');
  // NOT vacuous: an unknown status must surface itself, not render blank —
  // a run whose state the UI cannot name is exactly what you want to see.
  assert.equal(statusLabel('quantum'), 'quantum');
  assert.equal(statusLabel(undefined), 'unknown');
});

test('statusLabel cannot be tricked by prototype keys', () => {
  assert.equal(statusLabel('constructor'), 'constructor');
  assert.equal(statusLabel('toString'), 'toString');
});

// ── linkRowHtml ────────────────────────────────────────────────────────────
test('the command picker has NO empty option — which is why assigning "" blanks it', () => {
  // Not a style note. app.js built a new job's first row from `{}`, took the
  // "restore a saved link" branch, and assigned commandId '' here. With no empty
  // option that drives selectedIndex to -1, the picker renders blank, and Save
  // then refuses the job for having no link while one is on screen.
  const html = linkRowHtml([{ id: 'c1', name: 'extract' }], [{ id: 'local' }]);
  const sel = html.slice(html.indexOf('data-k="commandId"'));
  const body = sel.slice(0, sel.indexOf('</select>'));
  assert.ok(body.includes('value="c1"'), 'the command must be offered');
  assert.ok(!/value=""/.test(body), 'an empty option would change what "" means for every caller');
});

test('linkRowHtml escapes command names and tier ids', () => {
  const html = linkRowHtml([{ id: 'x"><script>', name: '<img onerror=1>' }], [{ id: 'a"b' }]);
  assert.ok(!html.includes('<script>'), 'a command name must not become live markup');
  assert.ok(!html.includes('<img'), 'a command name must not become live markup');
  assert.ok(!/data-tier="a"b"/.test(html), 'an unescaped tier id would break out of the attribute');
});

test('linkRowHtml survives an empty cockpit without throwing', () => {
  const html = linkRowHtml();
  assert.ok(html.includes('data-k="commandId"'), 'the row must still render its controls');
});

test('a topped-up run reads as topped up, never as finished', () => {
  // fleet.js marks a spent budget halt 'resumed'. It must not borrow 'done':
  // the run did not finish, it handed its session to the run in `resumedInto`.
  assert.equal(statusLabel('resumed'), 'topped up →');
  assert.notEqual(statusLabel('resumed'), statusLabel('done'));
});

// ── theme ──────────────────────────────────────────────────────────────────
test('effectiveTheme: an explicit choice beats the system preference', () => {
  assert.equal(effectiveTheme('dark', true), 'dark');
  assert.equal(effectiveTheme('light', false), 'light');
});

test('effectiveTheme: no choice → follow the system; dark is the native fallback', () => {
  assert.equal(effectiveTheme(null, true), 'light');
  assert.equal(effectiveTheme(null, false), 'dark');
  // garbage in storage must not become a theme
  assert.equal(effectiveTheme('solarized', false), 'dark');
  assert.equal(effectiveTheme('', true), 'light');
});

test('nextTheme is a strict two-state flip, whatever the input', () => {
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'light');
  assert.equal(nextTheme(undefined), 'light'); // unknown ≠ light → flips to light
});

test('editor skin follows the axis', () => {
  assert.equal(editorThemeFor('light'), 'default');
  assert.equal(editorThemeFor('dark'), 'material-darker');
});

test('theme button shows the DESTINATION, not the state', () => {
  assert.equal(themeButtonGlyph('light'), '🌙');
  assert.equal(themeButtonGlyph('dark'), '☀️');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
