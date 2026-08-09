// Onboarding receipts: drives the ENTIRE guided tour step by step — every
// step's target element must exist, be spotlit, and the card must show its
// text. Then the handbook: opens, searches, filters. If a UI change orphans a
// tour step, this suite goes red.
import pw from './lib/pw.mjs';
import assert from 'node:assert';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
// No bearer here on purpose: this spec logs in the real way, password → session
// cookie, a few lines below. A TOKEN read from .auth-token was left over from
// when it used the header, and it read a credential file this spec never needed.

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // S24 Ultra-ish
page.on('pageerror', (e) => { throw new Error('page error: ' + e); });
// Log in the real way (password → session cookie) so fetch + WS are authed.
await page.goto(BASE);
await page.evaluate(async (pw) => {
  const s = await fetch('/api/auth/status').then((r) => r.json());
  const ep = s.configured ? '/api/auth/login' : '/api/auth/setup';
  await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
}, 'atlan-test-pw-8x');
// Tour state is SERVER-side now (per-origin localStorage re-showed the bar on
// every other origin) — so "fresh browser" needs a fresh server pref too: the
// UI suite ran first against this same throwaway server and may have synced
// its own localStorage flag forward. Empty value deletes the pref.
await page.evaluate(() => fetch('/api/prefs', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'tour', value: '' }),
}));

console.log('TOUR + HANDBOOK SUITE');

await test('first-run banner offers the tour to a fresh browser', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.ok(await page.locator('#firstRun').isVisible(), 'no first-run banner');
  assert.ok((await page.locator('#firstRun').innerText()).includes('tour'));
});

await test('banner "later" is remembered — server-side, distinct from done', async () => {
  await page.locator('#frNo').click();
  assert.equal(await page.locator('#firstRun').count(), 0);
  // 'dismissed', not '1': silences the bar but stays distinguishable from a
  // completed tour, so a future gentle nudge remains possible.
  assert.equal(await page.evaluate(() => localStorage.getItem('atlanTourDone')), 'dismissed');
  // and it must land in /api/prefs — that's what keeps the OTHER origin quiet
  await page.waitForFunction(async () => {
    const p = await fetch('/api/prefs').then((r) => r.json());
    return p.tour === 'dismissed';
  }, { timeout: 4000 });
});

await test('dismissal survives reload even with EMPTY localStorage (cross-origin case)', async () => {
  // wiping localStorage simulates arriving on the cockpit's other origin
  // (loopback vs tailnet) — only the server pref can keep the bar away here
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#firstRun').count(), 0, 'bar came back after "later"');
});

const stepCount = await page.evaluate(() => window._tour.STEPS.length);
await test(`tour has full coverage (${stepCount} steps ≥ 26)`, async () => {
  assert.ok(stepCount >= 26, `only ${stepCount} steps`);
});

await test('every tour step spotlights a real, visible element + card fits portrait', async () => {
  const vw = page.viewportSize().width, vh = page.viewportSize().height;
  await page.evaluate(() => window._tour.show(0));
  for (let i = 0; i < stepCount; i++) {
    await page.waitForTimeout(260);
    const st = await page.evaluate((n) => window._tour.STEPS[n], i);
    assert.ok(await page.locator('#tourOverlay').isVisible(), `step ${i + 1}: overlay gone`);
    const title = await page.locator('#tourTitle').innerText();
    assert.equal(title, st.h, `step ${i + 1}: card shows "${title}" not "${st.h}" (target ${st.el} missing → auto-skipped?)`);
    assert.ok((await page.locator('#tourText').innerText()).length > 40, `step ${i + 1}: text too thin`);
    const ring = await page.locator('#tourRing').boundingBox();
    assert.ok(ring && ring.width > 8 && ring.height > 8, `step ${i + 1}: ring not placed`);
    // the spotlit element really is the declared one, visible on the right tab
    // (wait for it — some targets populate async, e.g. the Doctor lists)
    await page.locator(st.el).first().waitFor({ state: 'visible', timeout: 4000 })
      .catch(() => { throw new Error(`step ${i + 1}: ${st.el} not visible`); });
    // the card must sit FULLY within the viewport in portrait — no clipped cards
    const c = await page.locator('#tourCard').boundingBox();
    assert.ok(c.y >= -1 && c.y + c.height <= vh + 1, `step ${i + 1}: card clipped vertically (y=${c.y.toFixed(0)}, bottom=${(c.y + c.height).toFixed(0)}, vh=${vh})`);
    assert.ok(c.x >= -1 && c.x + c.width <= vw + 1, `step ${i + 1}: card clipped horizontally`);
    assert.ok(await page.locator('#tourNext').isVisible(), `step ${i + 1}: Next button not reachable`);
    if (i < stepCount - 1) await page.locator('#tourNext').click();
  }
});

await test('finishing the tour marks it done and closes the overlay', async () => {
  await page.locator('#tourNext').click(); // "✓ Finish"
  assert.ok(!(await page.locator('#tourOverlay').isVisible()));
  assert.equal(await page.evaluate(() => localStorage.getItem('atlanTourDone')), '1');
});

await test('no first-run banner on revisit after completion', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#firstRun').count(), 0);
});

await test('? opens the handbook with all sections', async () => {
  await page.locator('#helpBtn').click();
  assert.ok(await page.locator('#guideOverlay').isVisible());
  const n = await page.locator('#guideOverlay details').count();
  assert.ok(n >= 12, `only ${n} handbook sections`);
});

await test('handbook search filters and auto-opens matches', async () => {
  await page.fill('#guideSearch', 'phantom');
  await page.waitForTimeout(150);
  const visible = await page.locator('#guideOverlay details:visible').count();
  assert.ok(visible >= 1 && visible < 12, `filter left ${visible} visible`);
  assert.ok(await page.locator('#guideOverlay details:visible').first().getAttribute('open') !== null);
  await page.fill('#guideSearch', '');
});

await test('handbook can relaunch the tour', async () => {
  await page.locator('#guideTour').click();
  await page.waitForTimeout(300);
  assert.ok(await page.locator('#tourOverlay').isVisible());
  await page.locator('#tourSkip').click();
});

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
