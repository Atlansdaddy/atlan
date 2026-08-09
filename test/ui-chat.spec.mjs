// Playwright CHAT-SURFACE suite — drives the one screen a user lives on.
//
// Scope: the chat tab, the five-group engine switcher (incl. the new Escalate
// ladder), the project picker, attachment chips, voice controls, the session
// line, message rendering, permission cards, the working indicator and the
// thinking panel.
//
// ── SAFETY (this suite must be harmless against a LIVE cockpit) ────────────
// A `WebSocket` shim installed before app.js runs records every outbound frame
// and DROPS the ones that spend money or mutate the user's machine —
// `chat.send`, `build.*`, `fleet.*`, `pty.*`. So the send path is exercised
// end-to-end on the client (bubble, payload, disabled state) while NOTHING
// reaches an engine. Inbound frames are injected through the same shim using
// the exact protocol the server emits, so the renderers are under test rather
// than a stub of them.
//
// NOT exercised, on purpose (cannot be driven without spending tokens):
//   • a real Claude / Agent-CLI / brain turn
//   • the Escalate ladder actually climbing its rungs
// Those are asserted for PRESENCE and ENABLED-STATE only, and the wiring gap
// behind the ladder option is reported in the audit rather than tested here.
import pw from './lib/pw.mjs';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
const { chromium } = pw;
const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const _fetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => _fetch(url, { ...opts, headers: { ...(opts.headers ?? {}), 'x-atlan-token': TOKEN } });
let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['OK', name]); pass++; } catch (e) { results.push(['XX', name + ' — ' + e.message]); fail++; }
}
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

// The spend-blocking WS shim. Must be installed before the first navigation.
const WS_SHIM = () => {
  const Native = window.WebSocket;
  // Frames that cost money or touch the user's real machine never leave.
  const BLOCK = /^(chat\.send|build\.|fleet\.|pty\.|routine\.|hierarchy\.)/;
  window.__sent = [];    // every frame the app tried to send, in order
  window.__blocked = []; // the subset the shim swallowed
  window.WebSocket = class extends Native {
    constructor(...a) { super(...a); window.__ws = this; }
    send(data) {
      let t = '';
      try { t = JSON.parse(data).t ?? ''; } catch { /* non-JSON: pass through */ }
      window.__sent.push(data);
      if (BLOCK.test(t)) { window.__blocked.push(t); return; }
      return super.send(data);
    }
  };
  // Deliver a server frame to the app's own handler, unmodified.
  window.__inject = (frame) => { window.__ws?.onmessage?.({ data: JSON.stringify(frame) }); };
  window.__lastSent = (t) => {
    for (let i = window.__sent.length - 1; i >= 0; i--) {
      const f = JSON.parse(window.__sent[i]);
      if (!t || f.t === t) return f;
    }
    return null;
  };
};
await page.addInitScript(WS_SHIM);

await page.goto(BASE);
await page.evaluate(async (pwd) => {
  const s = await fetch('/api/auth/status').then((r) => r.json());
  const ep = s.configured ? '/api/auth/login' : '/api/auth/setup';
  await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
}, 'atlan-test-pw-8x');
await page.evaluate(() => localStorage.setItem('atlanTourDone', '1'));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.getElementById('connDot')?.classList.contains('on'), { timeout: 8000 });
// the switcher and picker are populated by three async fetches
await page.waitForFunction(() => document.querySelectorAll('#ogAgents option').length > 0
  && document.querySelectorAll('#ogLadder option').length > 0
  && document.querySelectorAll('#projSel option').length > 1, { timeout: 8000 });

const inject = (frame) => page.evaluate((f) => window.__inject(f), frame);
const TAP = 44; // the project's own --tap, style.css:27

// ── 1. the surface itself ──────────────────────────────────────────────────
await test('chat is the screen that loads, and every composer control is live', async () => {
  assert.ok(await page.locator('#s-chat').evaluate((el) => el.classList.contains('active')), 'chat is not the default screen');
  for (const id of ['projSel', 'modelSel', 'chatInput', 'sendBtn', 'micBtn', 'attachBtn', 'attachRefPath', 'attachRefBtn', 'voiceBtn', 'helpBtn', 'chatlog']) {
    assert.ok(await page.locator('#' + id).isVisible(), `#${id} is not visible on the chat surface`);
  }
  // a disabled send button on a fresh load = the composer arrived bricked
  assert.equal(await page.locator('#sendBtn').isDisabled(), false, '#sendBtn starts disabled');
  assert.equal(await page.locator('#chatInput').isDisabled(), false, '#chatInput starts disabled');
  // the log ships with Atlan's opening message — never an empty box
  assert.ok((await page.locator('#chatlog .msg').count()) >= 1, '#chatlog rendered nothing at all');
  assert.deepEqual(consoleErrors, [], 'uncaught page errors on load');
});

// ── 2-5. the engine switcher ───────────────────────────────────────────────
await test('engine switcher has all five groups, ladder first, none of them empty', async () => {
  const groups = await page.locator('#modelSel optgroup').evaluateAll((gs) =>
    gs.map((g) => ({ id: g.id || null, label: g.label, n: g.querySelectorAll('option').length })));
  assert.equal(groups.length, 5, `expected 5 optgroups, got ${groups.length}: ${groups.map((g) => g.label).join(' | ')}`);
  // Escalate sits first on purpose: on a phone "free first, climb if needed"
  // is the right default, and the tour teaches it as the first thing you see.
  assert.equal(groups[0].id, 'ogLadder', `first group is "${groups[0].label}", not the Escalate ladder`);
  const ids = groups.map((g) => g.id);
  for (const want of ['ogLadder', 'ogAgents', 'ogLocal', 'ogCloud']) {
    assert.ok(ids.includes(want), `#${want} optgroup is missing from the switcher`);
  }
  // a group that renders but is empty is a switcher that silently lost engines
  for (const g of groups) assert.ok(g.n > 0, `optgroup "${g.label}" rendered with zero options`);
});

await test('every engine option is a unique wire identity (engine|model)', async () => {
  // `engine|model` IS the chat.send payload. Two options sharing one value are
  // indistinguishable to the server, so one of the two labels is a lie.
  const values = await page.locator('#modelSel option').evaluateAll((os) =>
    os.map((o) => ({ v: o.value, label: o.textContent, group: o.parentElement.label })));
  const seen = new Map();
  const dupes = [];
  for (const o of values) {
    if (seen.has(o.v)) dupes.push(`${o.v} → "${seen.get(o.v).group}: ${seen.get(o.v).label}" AND "${o.group}: ${o.label}"`);
    else seen.set(o.v, o);
  }
  assert.deepEqual(dupes, [], `ambiguous engine options:\n    ${dupes.join('\n    ')}`);
});

await test('dynamic groups match /api/engines exactly — nothing misrouted into Cloud', async () => {
  // Guards the `(groups[e.group] ?? groups.cloud)` fallback: a roster entry
  // with a group the UI does not know silently lands under "chat only" and is
  // mislabelled as handless. Counting per group catches that loudly.
  const roster = await page.evaluate(() => fetch('/api/engines').then((r) => r.json()));
  assert.ok(Array.isArray(roster) && roster.length > 0, '/api/engines returned nothing');
  const want = { agent: 0, local: 0, cloud: 0 };
  for (const e of roster) {
    assert.ok(e.group in want, `roster entry ${e.id} has group "${e.group}" which the switcher has no group for`);
    const models = Array.isArray(e.models) && e.models.length ? e.models : [e.model];
    want[e.group] += e.ready ? models.length : 1; // un-ready engines get one disabled hint row
  }
  const got = await page.evaluate(() => ({
    agent: document.querySelectorAll('#ogAgents option').length,
    local: document.querySelectorAll('#ogLocal option').length,
    cloud: document.querySelectorAll('#ogCloud option').length,
  }));
  assert.deepEqual(got, want, `group population drifted from the roster: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  // un-ready engines must be unselectable AND say what they need
  const notReady = roster.filter((e) => !e.ready);
  if (notReady.length) {
    const disabled = await page.locator('#modelSel option:disabled').evaluateAll((os) => os.map((o) => o.textContent));
    assert.equal(disabled.length, notReady.length, 'un-ready engines are not all disabled in the switcher');
    for (const t of disabled) assert.match(t, /needs:/, `disabled option "${t}" does not say what it needs`);
  }
});

await test('the Escalate option is built from /api/ladder and names every rung', async () => {
  const j = await page.evaluate(() => fetch('/api/ladder').then((r) => r.json()));
  assert.ok(Array.isArray(j.rungs) && j.rungs.length > 0, '/api/ladder returned no rungs');
  assert.ok(j.rungs.some((r) => r.free), 'ladder advertises no free rung — the whole point is free-first');
  const opt = page.locator('#ogLadder option').first();
  assert.equal(await opt.getAttribute('value'), 'ladder|', 'ladder option no longer carries the ladder engine id');
  const label = await opt.textContent();
  for (const r of j.rungs) {
    const short = r.label.split(' (')[0];
    assert.ok(label.includes(short), `ladder option does not name the "${short}" rung: "${label}"`);
  }
  // the honest limit has to be reachable, not just documented in the repo
  const title = await opt.getAttribute('title');
  assert.match(title ?? '', /free/i, 'ladder option never mentions what it tries for free');
  assert.match(title ?? '', /grad/i, 'ladder option drops the "never grades itself" limit');
  // NOT exercised: actually running a ladder turn climbs to a paid frontier
  // rung, so this suite stops at presence + enabled-state.
  assert.equal(await opt.isDisabled(), false, 'ladder option is disabled');
});

// ── 6-7. the project picker ────────────────────────────────────────────────
await test('the header names the selected project on first paint', async () => {
  const [value, header, count] = await page.evaluate(() => [
    document.getElementById('projSel').value,
    document.getElementById('projName').textContent.trim(),
    document.getElementById('projSel').options.length,
  ]);
  assert.ok(count > 1, 'project picker only holds its hardcoded fallback — /api/projects never landed');
  const expect = value.split('/').pop() || value;
  // chat.send already carries this cwd; a header that disagrees is a lie about
  // which project the next turn will run in.
  assert.equal(header, expect, `header says "${header}" while the picker is on "${value}" (cwd sent with every turn)`);
});

await test('changing project retitles the header and repoints the build target', async () => {
  await page.selectOption('#projSel', '/root/atlan');
  await page.waitForFunction(() => document.getElementById('projName').textContent.trim() === 'atlan', { timeout: 3000 });
  assert.equal((await page.locator('#projName').textContent()).trim(), 'atlan');
  assert.equal((await page.locator('#buildProj').textContent()).trim(), '/root/atlan', 'build target did not follow the project');
});

// ── 8-10. the send path and the streaming pipeline ─────────────────────────
await test('send composes a complete chat.send and hands the composer back empty', async () => {
  await page.selectOption('#modelSel', 'claude|claude-haiku-4-5-20251001');
  const before = await page.locator('#chatlog .msg.user').count();
  await page.fill('#chatInput', 'atlan chat suite probe');
  await page.click('#sendBtn');
  await page.waitForFunction((n) => document.querySelectorAll('#chatlog .msg.user').length === n + 1, before, { timeout: 3000 });
  assert.match(await page.locator('#chatlog .msg.user').last().textContent(), /atlan chat suite probe/);
  assert.equal(await page.inputValue('#chatInput'), '', 'input was not cleared after send');
  assert.equal(await page.locator('#attachChips .achip').count(), 0, 'attachment chips survived the send');
  // in-flight state: the button must lock so a double-tap cannot double-spend
  assert.equal(await page.locator('#sendBtn').isDisabled(), true, '#sendBtn did not lock while the turn is in flight');
  const frame = await page.evaluate(() => window.__lastSent('chat.send'));
  assert.ok(frame, 'no chat.send frame was ever emitted');
  assert.equal(frame.text, 'atlan chat suite probe');
  assert.equal(frame.cwd, '/root/atlan', 'chat.send did not carry the picked project as cwd');
  assert.equal(frame.engine, 'claude');
  assert.equal(frame.model, 'claude-haiku-4-5-20251001', 'chat.send did not carry the picked model');
  assert.deepEqual(frame.attachments, []);
  // proof this suite spent nothing: the frame was swallowed by the shim
  assert.ok((await page.evaluate(() => window.__blocked)).includes('chat.send'), 'chat.send escaped the safety shim');
});

await test('a full streaming turn renders in order and hands the composer back', async () => {
  // Exact frame sequence claudeEngine.js emits for one turn.
  await inject({ t: 'chat.turnstart' });
  assert.equal(await page.locator('#chatlog .working').count(), 1, 'no working indicator after chat.turnstart');
  assert.ok(await page.locator('#chatlog .working').isVisible(), 'working indicator is not visible');

  await inject({ t: 'tool.use', name: 'Read', input: '/root/atlan/package.json' });
  const chip = page.locator('#chatlog .toolchip').last();
  assert.equal((await chip.locator('.tname').textContent()).trim(), 'Read', 'tool chip lost the tool name');

  await inject({ t: 'chat.thinkstart' });
  const think = page.locator('#chatlog details.thinking').last();
  assert.equal(await think.count(), 1, 'no thinking panel after chat.thinkstart');
  assert.equal(await think.evaluate((el) => el.open), true, 'thinking panel did not open live');
  await inject({ t: 'chat.think', text: 'weighing the options' });
  assert.match(await think.locator('.tbody').textContent(), /weighing the options/, 'thinking text never rendered');

  await inject({ t: 'chat.textstart' });
  // reasoning is over once real text starts — the panel must collapse itself
  assert.equal(await think.evaluate((el) => el.open), false, 'thinking panel stayed open after the answer started');
  assert.match(await think.locator('summary').textContent(), /thought process/, 'thinking summary never flipped past "thinking…"');

  await inject({ t: 'chat.delta', text: 'Hello ' });
  await inject({ t: 'chat.delta', text: 'from the mock turn.' });
  const bubble = page.locator('#chatlog .msg.claude').last();
  assert.match(await bubble.textContent(), /Hello from the mock turn\./, 'streamed deltas did not accumulate into one bubble');

  await inject({ t: 'chat.session', id: 'abcdef0123456789' });
  assert.match(await page.locator('#sessMeta').textContent(), /session abcdef01/, 'session id never reached the header');

  await inject({ t: 'chat.result', session: 'abcdef0123456789', cost: 0.0123 });
  assert.equal(await page.locator('#chatlog .working').count(), 0, 'working indicator survived the end of the turn');
  const sess = page.locator('#chatlog .sessline').last();
  assert.match(await sess.textContent(), /claude --resume abcdef01/, 'session line does not offer the resume command');
  assert.match(await sess.textContent(), /\$0\.0123/, 'session line dropped the turn cost');
  assert.equal(await page.locator('#sendBtn').isDisabled(), false, '#sendBtn was not handed back after chat.result');
});

await test('an engine error hands the composer back and stops the working line', async () => {
  // The exact frame brains.js:146 emits for an un-keyed cloud brain — the most
  // likely first-run failure there is. Injected rather than provoked so the
  // suite never touches a real engine.
  await page.fill('#chatInput', 'this turn will fail');
  await page.click('#sendBtn');
  assert.equal(await page.locator('#sendBtn').isDisabled(), true, 'precondition: send should be locked in flight');
  await inject({ t: 'chat.turnstart' });
  await inject({ t: 'chat.err', msg: 'DeepSeek needs a key — drop it in Doctor → Engine keys.' });
  assert.match(await page.locator('#chatlog .msg.err').last().textContent(), /needs a key/, 'the error was never shown to the user');
  await page.waitForTimeout(300); // give any deferred recovery a chance to land
  // Both symptoms are one missing recovery in `case 'chat.err'`, so report both
  // rather than stopping at whichever assert happens to run first.
  const broken = [];
  if (await page.locator('#chatlog .working').count() !== 0) {
    broken.push('the working indicator is still animating next to the error bubble — the UI claims Atlan is working when the turn is dead');
  }
  if (await page.locator('#sendBtn').isDisabled()) {
    broken.push('#sendBtn stays disabled after chat.err — chat is bricked until a full page reload');
  }
  assert.deepEqual(broken, [], 'an engine error leaves the surface lying:\n    - ' + broken.join('\n    - '));
});
// restore a usable composer for the tests below regardless of the outcome above
await inject({ t: 'chat.result', brain: 'suite-reset' });

// ── 11-12. rendering ───────────────────────────────────────────────────────
await test('every chat renderer escapes hostile content instead of executing it', async () => {
  // Drives the REAL renderers through the REAL frames: addMsg, renderRichMessage
  // + buildCodeBlock (brain role), addTool, addPerm, addRungLine.
  const XSS = '<img src=x onerror="window.__pwned=1">';
  await page.evaluate(() => { delete window.__pwned; });
  await inject({ t: 'chat.msg', role: 'claude', text: XSS });
  await inject({ t: 'chat.msg', role: 'brain', engine: XSS, text: 'before\n```' + XSS + '\n' + XSS + '\n```\nafter' });
  await inject({ t: 'tool.use', name: XSS, input: XSS });
  await inject({ t: 'chat.rung', phase: 'start', label: XSS, free: true });
  await inject({ t: 'perm.req', id: 'xss-probe', tool: XSS, input: XSS });
  await page.waitForTimeout(200); // an injected <img> would have fired onerror by now
  assert.equal(await page.evaluate(() => window.__pwned), undefined, 'injected markup EXECUTED — a renderer is using innerHTML on server text');
  assert.equal(await page.locator('#chatlog img').count(), 0, 'hostile markup became a real element in the log');
  // and it must still be shown, as text — silently swallowing it is its own bug
  assert.ok((await page.locator('#chatlog').textContent()).includes('onerror='), 'the hostile string was dropped instead of shown literally');
  // clear the probe permission card so it cannot confuse the next test
  await page.locator('#chatlog .perm').last().locator('button').nth(1).click();
});

await test('a permission card renders, answers the server, and locks itself', async () => {
  const before = await page.evaluate(() => window.__sent.length);
  await inject({ t: 'perm.req', id: 'perm-suite-1', tool: 'Bash', input: 'rm -rf /root/atlan' });
  const card = page.locator('#chatlog .perm').last();
  assert.equal(await card.count(), 1, 'perm.req rendered no permission card');
  assert.match(await card.locator('.plabel').textContent(), /Bash/, 'the card does not name the tool it is asking about');
  assert.match(await card.locator('code').textContent(), /rm -rf \/root\/atlan/, 'the card hides what the tool would actually do');
  const [allow, deny] = [card.locator('button').nth(0), card.locator('button').nth(1)];
  assert.equal(await allow.textContent(), 'Allow');
  assert.equal(await deny.textContent(), 'Deny');
  await allow.click();
  const frames = await page.evaluate((n) => window.__sent.slice(n).map((s) => JSON.parse(s)), before);
  const reply = frames.find((f) => f.t === 'perm.reply');
  assert.ok(reply, 'tapping Allow emitted no perm.reply frame — the agent is never told');
  assert.equal(reply.id, 'perm-suite-1', 'perm.reply answered the wrong request id');
  assert.equal(reply.approved, true, 'Allow did not send approved:true');
  // once answered the card must not be re-answerable
  assert.ok(await card.evaluate((el) => el.classList.contains('answered')), 'answered card is not marked answered');
  assert.equal(await allow.isDisabled(), true, 'Allow stayed clickable after answering');
  assert.equal(await deny.isDisabled(), true, 'Deny stayed clickable after answering');
});

// ── 13-15. attachments ─────────────────────────────────────────────────────
await test('a project path attaches as a chip that names the file and can be removed', async () => {
  await page.fill('#attachRefPath', '/root/atlan/package.json');
  await page.click('#attachRefBtn');
  await page.waitForFunction(() => document.querySelectorAll('#attachChips .achip').length === 1, { timeout: 4000 });
  const chip = page.locator('#attachChips .achip').first();
  assert.equal((await chip.locator('.aname').textContent()).trim(), 'package.json', 'chip does not name the attached file');
  assert.match(await chip.locator('.aroute').textContent(), /read/i, 'chip does not say how the file reaches the model');
  assert.equal(await page.inputValue('#attachRefPath'), '', 'the path field kept its value after a successful attach');
  await chip.locator('.ax').click();
  await page.waitForFunction(() => document.querySelectorAll('#attachChips .achip').length === 0, { timeout: 2000 });
});

await test('attach-by-path is reachable from the phone keyboard (Enter/Go)', async () => {
  // Phone-first: the on-screen keyboard's Go key is the primary commit gesture.
  // #previewUrl (app.js:864) and #edPath (app.js:806) both bind Enter; this
  // field is the odd one out, and there is no enterkeyhint on it either.
  await page.fill('#attachRefPath', '/root/atlan/package.json');
  await page.press('#attachRefPath', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#attachChips .achip').length === 1, { timeout: 3000 })
    .catch(() => { throw new Error('pressing Enter in #attachRefPath does nothing — on a phone the keyboard Go key is a dead key here'); });
  await page.locator('#attachChips .achip .ax').first().click();
});

await test('a rejected upload leaves no ghost chip claiming a file is attached', async () => {
  const match = (url) => new URL(url).pathname === '/api/attach';
  await page.route(match, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ error: 'refused by the chat suite' }),
  }));
  try {
    await page.setInputFiles('#attachFile', { name: 'ghost.txt', mimeType: 'text/plain', buffer: Buffer.from('chat suite probe') });
    // the placeholder chip appears immediately, then the server refuses
    await page.waitForFunction(() => [...document.querySelectorAll('#chatlog .msg.err')].some((e) => e.textContent.includes('refused by the chat suite')), { timeout: 5000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#attachChips .achip').count(), 0,
      'the chip for a file the server REFUSED is still on screen — the UI shows an attachment that does not exist and will not be sent');
  } finally {
    await page.unroute(match);
  }
});

// ── 16-17. canary + voice ──────────────────────────────────────────────────
await test('the waffle canary fires locally and never reaches an engine', async () => {
  // app.js:691 — John's provenance trap street. A refactor must not quietly
  // delete it, and it must never become a billable turn.
  const before = await page.evaluate(() => window.__sent.filter((s) => s.includes('"chat.send"')).length);
  await page.fill('#chatInput', 'waffles');
  await page.press('#chatInput', 'Enter');
  await page.waitForSelector('.waffles-egg', { timeout: 3000 });
  assert.ok((await page.locator('.waffles-egg span').count()) > 0, 'the waffle layer rendered with no waffles in it');
  assert.equal(await page.inputValue('#chatInput'), '', 'the canary left the input dirty');
  const after = await page.evaluate(() => window.__sent.filter((s) => s.includes('"chat.send"')).length);
  assert.equal(after, before, 'typing "waffles" emitted a chat.send — the easter egg is now a billable turn');
  assert.match(await page.locator('#atlanLine').textContent(), /Mid-Atlantic AI/, 'the attribution line was lost');
});

await test('the voice toggle is honest, persists, and hides what it cannot do', async () => {
  const btn = page.locator('#voiceBtn');
  const startOn = (await btn.getAttribute('aria-pressed')) === 'true';
  await btn.click();
  assert.equal(await btn.getAttribute('aria-pressed'), String(!startOn), 'aria-pressed did not follow the toggle');
  assert.equal((await btn.textContent()).trim(), !startOn ? '🔊' : '🔈', 'the glyph does not match the state');
  assert.equal(await page.evaluate(() => localStorage.getItem('atlanVoice')), !startOn ? '1' : '0', 'the choice was not persisted');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('connDot')?.classList.contains('on'), { timeout: 8000 });
  assert.equal(await page.locator('#voiceBtn').getAttribute('aria-pressed'), String(!startOn), 'the voice choice did not survive a reload');
  assert.equal((await page.locator('#voiceBtn').textContent()).trim(), !startOn ? '🔊' : '🔈', 'the glyph did not survive a reload');
  if (!startOn) await page.locator('#voiceBtn').click(); // leave it as we found it

  // the mic is a browser capability, not a promise: with no SpeechRecognition
  // the button must disappear rather than sit there doing nothing.
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(600);
  assert.equal(await p2.locator('#micBtn').isVisible(), false, 'the mic button is offered in a browser with no speech recognition');
  await p2.close();
});

// ── 18-20. the phone (412px) ───────────────────────────────────────────────
await test('412px: the chat surface never scrolls sideways and clips nothing', async () => {
  const vw = 412;
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    screen: document.getElementById('s-chat').scrollWidth,
    log: document.getElementById('chatlog').scrollWidth,
  }));
  assert.ok(overflow.doc <= vw, `the page scrolls sideways at 412px (scrollWidth ${overflow.doc})`);
  assert.ok(overflow.body <= vw, `body scrolls sideways at 412px (scrollWidth ${overflow.body})`);
  assert.ok(overflow.screen <= vw, `#s-chat scrolls sideways at 412px (scrollWidth ${overflow.screen})`);
  assert.ok(overflow.log <= vw, `#chatlog scrolls sideways at 412px (scrollWidth ${overflow.log})`);
  // and every control has to be fully on screen, not merely non-overflowing
  const boxes = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return [id, { l: r.left, r: r.right, w: r.width, h: r.height }];
  })), ['projSel', 'modelSel', 'chatInput', 'sendBtn', 'micBtn', 'attachBtn', 'attachRefPath', 'attachRefBtn', 'voiceBtn', 'helpBtn', 'themeBtn', 'sessInfo']);
  for (const [id, b] of Object.entries(boxes)) {
    assert.ok(b.w > 0 && b.h > 0, `#${id} has collapsed to zero size at 412px`);
    assert.ok(b.l >= 0, `#${id} is clipped off the left edge at 412px (left ${b.l})`);
    assert.ok(b.r <= vw, `#${id} is clipped off the right edge at 412px (right ${b.r})`);
  }
});

await test('412px: every chat control clears the WCAG 2.5.8 24px target floor', async () => {
  const MIN = 24; // WCAG 2.2 Target Size (Minimum), AA
  const boxes = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return [id, { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }];
  })), ['projSel', 'modelSel', 'chatInput', 'sendBtn', 'micBtn', 'attachBtn', 'attachRefPath', 'attachRefBtn', 'voiceBtn', 'helpBtn', 'themeBtn']);
  const tooSmall = Object.entries(boxes).filter(([, b]) => b.w < MIN || b.h < MIN).map(([id, b]) => `#${id} ${b.w}x${b.h}`);
  assert.deepEqual(tooSmall, [], `below the ${MIN}px AA target floor on a phone: ${tooSmall.join(', ')}`);
});

await test('412px: the composer honours the stylesheet\'s own --tap on icon buttons', async () => {
  // style.css:399 declares `.iconbtn,.send{min-width:var(--tap);min-height:var(--tap)}`
  // for exactly these controls. This asserts the app's own stated WCAG 2.5.5
  // rule against the app, nothing invented here.
  const tap = Number((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tap'))).replace('px', '').trim());
  assert.equal(tap, TAP, `--tap is ${tap}px, expected ${TAP}px`);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#s-chat .iconbtn, #s-chat .send, #s-chat .composer input')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.id || el.className, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  }));
  assert.ok(boxes.length >= 4, `expected the composer's icon buttons + input, found ${boxes.length}`);
  const short = boxes.filter((b) => b.w < tap || b.h < tap).map((b) => `#${b.id} ${b.w}x${b.h}`);
  assert.deepEqual(short, [], `smaller than the --tap the stylesheet declares for them: ${short.join(', ')}`);
});

await browser.close();
console.log('\nATLAN CHAT SURFACE');
for (const [s, n] of results) console.log(' ', s, n);
if (consoleErrors.length) { console.log('\n  uncaught page errors:'); for (const e of consoleErrors) console.log('   !', e); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
