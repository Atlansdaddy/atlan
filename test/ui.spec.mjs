// Playwright UI suite — drives the real cockpit in headless Chromium.
// Asserts the UI a user actually touches: tabs, engine roster grouping,
// doctor/preflight rendering, key entry, chat plumbing (mocked engine off),
// XSS-safety of rendered messages.
import pw from './lib/pw.mjs';
import assert from 'node:assert';
const { chromium } = pw;

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';

// auth: all API surfaces are token-gated now — tests authenticate like the app
import { readFileSync } from 'node:fs';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const _fetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => _fetch(url, { ...opts, headers: { ...(opts.headers ?? {}), 'x-atlan-token': TOKEN } });

let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['✓', name]); pass++; }
  catch (e) { results.push(['✗', name + ' — ' + e.message]); fail++; }
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

// Log in the real way (password → session cookie) so both fetch AND the WS
// upgrade are authed. On the throwaway test instance there's no password yet,
// so we set one; the cookie then rides every request.
await page.goto(BASE);
await page.evaluate(async (pw) => {
  const s = await fetch('/api/auth/status').then((r) => r.json());
  const ep = s.configured ? '/api/auth/login' : '/api/auth/setup';
  await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
}, 'atlan-test-pw-8x');
// dismiss the first-run tour banner — this suite tests the app, not onboarding
await page.evaluate(() => localStorage.setItem('atlanTourDone', '1'));
await page.goto(BASE, { waitUntil: 'networkidle' });

await test('loads with Atlan wordmark + bot', async () => {
  assert.equal((await page.locator('header .wordmark').innerText()).toLowerCase(), 'atlan');
  assert.ok(await page.locator('#atlanImg').isVisible(), 'bot logo missing');
});

await test('all tabs switch', async () => {
  for (const [tab, screen] of [['Preview', 's-preview'], ['Editor', 's-editor'], ['Term', 's-term'], ['Fleet', 's-fleet'], ['Build', 's-build'], ['Doctor', 's-doctor'], ['Chat', 's-chat']]) {
    await page.locator(`nav button:has-text("${tab}")`).click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#' + screen).evaluate((el) => el.classList.contains('active')), `${tab} did not activate`);
  }
});

await test('WS connects (dot goes green)', async () => {
  await page.waitForFunction(() => document.getElementById('connDot')?.classList.contains('on'), { timeout: 5000 });
});

await test('Fleet tab: profiles load, spawn form + KILL ALL present', async () => {
  await page.locator('nav button:has-text("Fleet")').click();
  await page.waitForFunction(() => document.querySelectorAll('#fleetProfile option').length >= 3, { timeout: 5000 });
  assert.ok(await page.locator('#fleetPrompt').isVisible(), 'no prompt box');
  assert.ok(await page.locator('#fleetKillAll').isVisible(), 'no KILL ALL');
  assert.ok(await page.locator('#pushBtn').isVisible(), 'no push enable button');
  await page.locator('nav button:has-text("Chat")').click();
});

await test('engine switcher has all five groups POPULATED', async () => {
  // Said "four groups" until 2026-08-04, after the Escalate/ladder group shipped
  // — so the new group could have rendered empty and nothing would have noticed.
  // Every group is now checked for CONTENT, not just presence: an optgroup with
  // zero options is exactly the vacuous pass this repo hunts.
  const groups = await page.locator('#modelSel optgroup').evaluateAll((els) =>
    els.map((e) => ({ label: e.label, n: e.children.length })));
  assert.equal(groups.length, 5, `expected 5 optgroups, got ${groups.length}: ${groups.map((g) => g.label).join(' | ')}`);
  const byLabel = Object.fromEntries(groups.map((g) => [g.label.split(' ')[0], g.n]));
  assert.ok(byLabel['Claude'] >= 4, 'missing Claude agents');
  assert.ok(groups.some((g) => g.label.startsWith('Agent') && g.n >= 2), 'missing agent CLIs');
  assert.ok(groups.some((g) => g.label.startsWith('On-phone')), 'missing local group');
  assert.ok(groups.some((g) => g.label.startsWith('Cloud')), 'missing cloud group');
  const ladder = groups.find((g) => g.label.startsWith('Escalate'));
  assert.ok(ladder, 'missing the Escalate/ladder group');
  assert.ok(ladder.n >= 1, 'ladder group rendered EMPTY — /api/ladder failed or loadLadder() threw');
});

await test('the ladder option carries a real rung chain, not a placeholder', async () => {
  // Guards the whole /api/ladder → loadLadder() → <option> path. A label with no
  // arrow means the rungs never arrived and the option is decorative.
  const o = await page.locator('#ogLadder option').first()
    .evaluate((el) => ({ value: el.value, text: el.textContent, title: el.title }));
  assert.equal(o.value, 'ladder|', 'ladder option must be selectable as engine "ladder"');
  assert.match(o.text, /→/, 'label should chain the rungs, e.g. "Ladder · on-phone → Flash → Opus"');
  assert.match(o.title, /free/i, 'tooltip must say which rungs are free — the phone-relevant fact');
});

await test('opus-4.8 is selectable', async () => {
  const opts = await page.locator('#modelSel option').evaluateAll((els) => els.map((e) => e.value));
  assert.ok(opts.includes('claude|claude-opus-4-8'), 'opus-4.8 not in picker');
});

await test('Doctor renders checks with real status', async () => {
  await page.locator('nav button:has-text("Doctor")').click();
  await page.waitForSelector('#doctorList .check', { timeout: 5000 });
  const n = await page.locator('#doctorList .check').count();
  assert.ok(n >= 6, `expected >=6 doctor checks, got ${n}`);
  assert.ok(await page.locator('#doctorList .check.pass').count() >= 1, 'no passing checks');
});

await test('Preflight renders and shows honest verdict', async () => {
  await page.waitForSelector('#preflightList .check', { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('preflightVerdict')?.innerText.trim().length > 0, { timeout: 5000 });
  const verdict = await page.locator('#preflightVerdict').innerText();
  assert.ok(/loopback|blocker|safe to consider/i.test(verdict), 'unexpected verdict: ' + verdict);
});

await test('key entry field posts and refreshes without leaking', async () => {
  await page.locator('nav button:has-text("Doctor")').click(); // self-contained, don't rely on prior state
  await page.waitForSelector('#keysList .keyrow');
  await page.waitForTimeout(400); // let the async key list settle so nodes don't detach mid-action
  const row = page.locator('#keysList .keyrow', { hasText: 'DeepSeek' });
  await row.locator('input').fill('sk-uitest-SECRET-999');
  await row.locator('button:has-text("Save")').click(); // Playwright auto-scrolls + auto-retries on detach
  await page.waitForTimeout(600);
  // after save, field cleared and no plaintext of the key anywhere in the DOM
  const html = await page.content();
  assert.ok(!html.includes('sk-uitest-SECRET-999'), 'key plaintext leaked into DOM');
});

await test('rendered chat message is XSS-safe', async () => {
  // inject a hostile message straight through the client renderer path
  await page.locator('nav button:has-text("Chat")').click();
  await page.evaluate(() => {
    const log = document.getElementById('chatlog');
    const d = document.createElement('div');
    d.className = 'msg claude';
    d.append(document.createTextNode('<img src=x onerror="window.__pwned=1">'));
    log.append(d);
  });
  await page.waitForTimeout(100);
  const pwned = await page.evaluate(() => window.__pwned);
  assert.ok(!pwned, 'XSS executed from message content');
});

await test('inline-AI whole-file rewrite becomes a PROPOSAL — Save is inert until a path is chosen', async () => {
  // REGRESSION (review 2026-08-04): the no-selection path used to drop the
  // AI's output over the live buffer while KEEPING edCurrentPath, so one
  // reflexive Save wrote unreviewed AI output over the real file. The contract
  // now matches sendToEditor: whole-file results arrive path-less. Both
  // endpoints are stubbed so this exercises pure client behaviour.
  await page.route('**/api/file*', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: { path: '/root/proj/x.js', name: 'x.js', content: 'const original = 1;\n' } })
    : route.continue());
  await page.route('**/api/editor/ai-edit', (route) =>
    route.fulfill({ json: { ok: true, content: 'const rewritten = 2;\n' } }));

  await page.locator('nav button:has-text("Editor")').click();
  await page.fill('#edPath', '/root/proj/x.js');
  await page.locator('#edOpen').click();
  await page.waitForFunction(() => document.getElementById('edName')?.textContent === 'x.js');

  await page.locator('#edInlineAi').click();
  await page.fill('#aiModalInput', 'rewrite it');
  await page.locator('#aiModalSubmit').click();
  await page.waitForFunction(() =>
    document.querySelector('#editor .CodeMirror')?.CodeMirror.getValue().includes('rewritten'), { timeout: 4000 });

  assert.equal(await page.locator('#edName').innerText(), 'AI rewrite · review, then Save');
  assert.equal(await page.inputValue('#edPath'), '', 'path survived — reflexive Save would hit the real file');
  assert.ok((await page.locator('#edPath').getAttribute('placeholder')).includes('/root/proj/x.js'),
    'original path not shown as the suggested destination');
  // the teeth: Save without a path must refuse, not write
  await page.locator('#edSave').click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#chatlog .msg')].some((m) => m.textContent.includes('set a path to save')), { timeout: 3000 });
  await page.unroute('**/api/file*');
  await page.unroute('**/api/editor/ai-edit');
});

// ── the surfaces added this session, driven for the first time ─────────────
await test('preview MAXIMISES and comes back', async () => {
  // The failure mode this guards is nasty: a pane that fills the screen with no
  // visible way out. Escape and the button must BOTH work, because the
  // Fullscreen API is refused on some platforms and the class does the work.
  await page.locator('nav button:has-text("Preview")').click();
  await page.waitForTimeout(200);
  const section = page.locator('#s-preview');
  assert.ok(!(await section.evaluate((el) => el.classList.contains('maxed'))), 'should not start maximised');

  await page.locator('#previewMax').click();
  await page.waitForTimeout(250);
  assert.ok(await section.evaluate((el) => el.classList.contains('maxed')), 'the pane did not maximise');
  assert.ok(await page.evaluate(() => document.body.classList.contains('preview-maxed')), 'the tab bar was not hidden');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  assert.ok(!(await section.evaluate((el) => el.classList.contains('maxed'))), 'Escape must restore the pane');
  assert.ok(!(await page.evaluate(() => document.body.classList.contains('preview-maxed'))), 'the tab bar must come back');

  await page.locator('#previewMax').click();
  await page.waitForTimeout(200);
  await page.locator('#previewMax').click();
  await page.waitForTimeout(200);
  assert.ok(!(await section.evaluate((el) => el.classList.contains('maxed'))), 'the button must toggle back, not be a one-way door');
});

await test('chat history opens, searches, and closes', async () => {
  await page.locator('nav button:has-text("Chat")').click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#histPanel').isHidden(), 'the panel starts closed');

  await page.locator('#histBtn').click();
  await page.waitForTimeout(400);
  assert.ok(await page.locator('#histPanel').isVisible(), 'History did not open');
  assert.ok(await page.locator('.hist-search').isVisible(), 'a list you scroll is a list you stop using — the search box must be there');

  // Filtering must not throw on an EMPTY store, which is the state a new
  // install is in and therefore the one most likely to ship broken.
  await page.locator('.hist-search').fill('zzz-nothing-matches-this');
  await page.waitForTimeout(250);

  await page.locator('.hist-head button:has-text("close")').click();
  await page.waitForTimeout(250);
  assert.ok(await page.locator('#histPanel').isHidden(), 'close did not close it');
});

await test('the composer names the engine you selected', async () => {
  // Regression guard for the copy fix: it said "Message Claude Code…" with Grok
  // selected, then said nothing useful at all, and now follows the picker.
  const ph = await page.locator('#chatInput').getAttribute('placeholder');
  assert.match(ph, /^Message .+…$/, `the placeholder should name a target, got ${JSON.stringify(ph)}`);
});

await test('a PEER message renders attributed, never as the user', async () => {
  await page.evaluate(() => {
    const log = document.getElementById('chatlog');
    const div = document.createElement('div');
    div.className = 'msg peer';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = '✉ from auth chat';
    div.append(who, document.createTextNode('peer test message'));
    log.append(div);
  });
  const peer = page.locator('.msg.peer').last();
  assert.ok(await peer.isVisible(), 'the peer bubble must render');
  assert.ok(!/\buser\b/.test(await peer.getAttribute('class')), 'a peer message must never carry the user class');
  assert.match(await peer.locator('.who').innerText(), /from/, 'it must say where it came from');
});

await test('doctor renders GROUPED, containment findable by name', async () => {
  // The point of the restructure: someone looking for "how contained is an agent
  // here" should find it by reading, not by scrolling seventeen rows.
  await page.locator('nav button:has-text("Doctor")').click();
  await page.waitForTimeout(3000);   // the checks actually run
  assert.ok(await page.locator('.docgroup').count() >= 3, 'expected grouped checks');
  const text = await page.locator('#doctorList').innerText();
  assert.match(text, /Containment/i, 'the containment group must be named');
  assert.ok(await page.locator('#doctorCopy').isVisible(), 'the copy-report button must be there');
});

await test('no uncaught page errors during the run', async () => {
  assert.equal(consoleErrors.length, 0, 'page errors: ' + consoleErrors.join('; '));
});

// cleanup the ui test key
await fetch(BASE + '/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ env: 'DEEPSEEK_API_KEY', value: '' }) });

await browser.close();
console.log('\nPLAYWRIGHT UI SUITE');
for (const [s, n] of results) console.log(' ', s, n);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
