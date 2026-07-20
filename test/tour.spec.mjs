// Onboarding receipts: drives the ENTIRE guided tour step by step — every
// step's target element must exist, be spotlit, and the card must show its
// text. Then the handbook: opens, searches, filters. If a UI change orphans a
// tour step, this suite goes red.
import pw from '/usr/lib/node_modules/playwright/index.js';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // S24 Ultra-ish
page.on('pageerror', (e) => { throw new Error('page error: ' + e); });
await page.addInitScript((t) => localStorage.setItem('atlanToken', t), TOKEN);

console.log('TOUR + HANDBOOK SUITE');

await test('first-run banner offers the tour to a fresh browser', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.ok(await page.locator('#firstRun').isVisible(), 'no first-run banner');
  assert.ok((await page.locator('#firstRun').innerText()).includes('tour'));
});

await test('banner "later" dismisses without marking done', async () => {
  await page.locator('#frNo').click();
  assert.equal(await page.locator('#firstRun').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('atlanTourDone')), null);
});

const stepCount = await page.evaluate(() => window._tour.STEPS.length);
await test(`tour has full coverage (${stepCount} steps ≥ 26)`, async () => {
  assert.ok(stepCount >= 26, `only ${stepCount} steps`);
});

await test('every tour step spotlights a real, visible element', async () => {
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
    assert.ok(await page.locator(st.el).first().isVisible(), `step ${i + 1}: ${st.el} not visible`);
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
