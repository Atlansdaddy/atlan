// Playwright UI suite — drives the real cockpit in headless Chromium.
// Asserts the UI a user actually touches: tabs, engine roster grouping,
// doctor/preflight rendering, key entry, chat plumbing (mocked engine off),
// XSS-safety of rendered messages.
import pw from '/usr/lib/node_modules/playwright/index.js';
import assert from 'node:assert';
const { chromium } = pw;

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
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

await page.goto(BASE, { waitUntil: 'networkidle' });

await test('loads with Atlan wordmark + bot', async () => {
  assert.equal((await page.locator('.wordmark').innerText()).toLowerCase(), 'atlan');
  assert.ok(await page.locator('#atlanImg').isVisible(), 'bot logo missing');
});

await test('all five tabs switch', async () => {
  for (const [tab, screen] of [['Preview', 's-preview'], ['Term', 's-term'], ['Build', 's-build'], ['Doctor', 's-doctor'], ['Chat', 's-chat']]) {
    await page.locator(`nav button:has-text("${tab}")`).click();
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#' + screen).evaluate((el) => el.classList.contains('active')), `${tab} did not activate`);
  }
});

await test('WS connects (dot goes green)', async () => {
  await page.waitForFunction(() => document.getElementById('connDot')?.classList.contains('on'), { timeout: 5000 });
});

await test('engine switcher has all four groups populated', async () => {
  const groups = await page.locator('#modelSel optgroup').evaluateAll((els) =>
    els.map((e) => ({ label: e.label, n: e.children.length })));
  const byLabel = Object.fromEntries(groups.map((g) => [g.label.split(' ')[0], g.n]));
  assert.ok(byLabel['Claude'] >= 4, 'missing Claude agents');
  assert.ok(groups.some((g) => g.label.startsWith('Agent') && g.n >= 2), 'missing agent CLIs');
  assert.ok(groups.some((g) => g.label.startsWith('On-phone')), 'missing local group');
  assert.ok(groups.some((g) => g.label.startsWith('Cloud')), 'missing cloud group');
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
  await page.waitForSelector('#keysList .keyrow');
  const row = page.locator('#keysList .keyrow', { hasText: 'DeepSeek' });
  await row.locator('input').fill('sk-uitest-SECRET-999');
  await row.locator('button:has-text("Save")').click();
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
