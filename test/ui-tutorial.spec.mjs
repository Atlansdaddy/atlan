// TUTORIAL SUITE — audits the two onboarding surfaces end to end at phone size:
//   1. the spotlight TOUR (guide.js STEPS) — driven from the array itself at
//      runtime, so a UI change can never silently outrun the test.
//   2. the searchable HANDBOOK (<details> in index.html).
//
// Complements test/tour.spec.mjs (which walks the steps). This suite adds the
// things that suite cannot see: tab/pane correctness per step, ring-over-target,
// Next reachable WITHOUT scrolling inside the card, first-run persistence across
// dismissal paths and across ORIGINS, handbook filter hygiene, and the tour's
// own headline claim — "every control in the cockpit".
//
// SAFETY: this suite never spawns a fleet run, never sends a chat turn, never
// presses Build/Scan/Commit/Push. Nothing here spends a token or writes a file.
import pw from '/usr/lib/node_modules/playwright/index.js';
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
  try { await fn(); results.push(['OK', name]); pass++; }
  catch (e) { results.push(['XX', name + ' — ' + e.message]); fail++; }
}
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
await page.goto(BASE);
await page.evaluate(async (pw) => {
  const s = await fetch('/api/auth/status').then((r) => r.json());
  const ep = s.configured ? '/api/auth/login' : '/api/auth/setup';
  await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
}, 'atlan-test-pw-8x');
// NOTE: deliberately NOT pre-setting localStorage 'atlanTourDone' — onboarding
// itself is the system under test, so each test controls that flag explicitly.
await page.goto(BASE, { waitUntil: 'networkidle' });

const VW = 412, VH = 900;

/**
 * Onboarding state has TWO homes and the server one is authoritative:
 * guide.js only calls offerTour() when /api/prefs comes back without a tour
 * flag, and localStorage is a per-origin cache in front of it (§1b). Clearing
 * only localStorage therefore does NOT make a browser fresh — the server still
 * says "seen", the banner correctly stays away, and a test that clears one
 * side is asserting against an architecture the cockpit no longer has.
 */
async function setTourState(value) {
  await page.evaluate(async (v) => {
    if (v) localStorage.setItem('atlanTourDone', v);
    else localStorage.removeItem('atlanTourDone');
    await fetch('/api/prefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'tour', value: v }),
    });
  }, value);
  await page.goto(BASE, { waitUntil: 'networkidle' });
}
/** Reload as a browser that has never seen Atlan (both homes cleared). */
const freshBrowser = () => setTourState('');
/** Reload as a browser that has already finished onboarding. */
const returningBrowser = () => setTourState('1');
/**
 * Wait until the tour has finished moving, then report what it painted.
 *
 * show() defers place() by 120ms and .tour-ring has a 250ms CSS transition, so
 * anything measured earlier is mid-animation. Rather than sleep a magic number
 * (which would make this suite fail for how it measures, not for what is
 * broken), poll until title + ring box + card box are byte-identical across
 * three consecutive samples. Async panes that populate late — the Doctor lists —
 * are covered by the same stability window.
 */
async function settle(timeout = 8000) {
  await page.evaluate(() => { window.__settle = null; });
  await page.waitForFunction(() => {
    const t = document.getElementById('tourTitle').textContent;
    const c = document.getElementById('tourCount').textContent;
    const r = document.getElementById('tourRing').getBoundingClientRect();
    const d = document.getElementById('tourCard').getBoundingClientRect();
    const key = [t, c, r.x, r.y, r.width, r.height, d.y, d.height].map((v) => Math.round(Number(v) || 0)).join('|');
    const s = window.__settle;
    if (!s || s.key !== key) { window.__settle = { key, n: 0 }; return false; }
    s.n += 1;
    return s.n >= 3 && t.length > 0 && r.width > 8 && r.height > 8;
  }, null, { timeout, polling: 90 });
}

/** Settle, then report what the tour is showing. */
async function currentStep() {
  await settle();
  return page.evaluate(() => {
    const box = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
    const card = document.getElementById('tourCard');
    return {
      title: document.getElementById('tourTitle').textContent,
      text: document.getElementById('tourText').textContent,
      count: document.getElementById('tourCount').textContent,
      screen: document.querySelector('section.screen.active')?.id ?? null,
      pane: document.querySelector('#s-fleet .fpane.active')?.id ?? null,
      ring: box(document.getElementById('tourRing')),
      card: box(card),
      cardScrollH: card.scrollHeight,
      cardClientH: card.clientHeight,
      next: box(document.getElementById('tourNext')),
      backVisible: getComputedStyle(document.getElementById('tourBack')).visibility === 'visible',
      nav: box(document.querySelector('nav')),
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
  });
}

const STEPS = await page.evaluate(() => window._tour?.STEPS?.map((s) => ({ s: s.s, fp: s.fp ?? null, el: s.el, h: s.h })) ?? null);
assert.ok(Array.isArray(STEPS) && STEPS.length > 0, 'guide.js did not expose window._tour.STEPS — the tour is not drivable');
const N = STEPS.length;

// ── 1. first run ────────────────────────────────────────────────────────────
await test('a browser that has never seen Atlan is OFFERED the tour (not forced)', async () => {
  await freshBrowser();
  const bar = page.locator('#firstRun');
  assert.equal(await bar.count(), 1, 'no first-run banner for a fresh browser');
  assert.ok(await bar.isVisible(), 'first-run banner present but not visible');
  assert.match(await bar.innerText(), /tour/i, 'banner does not offer the tour');
  // offered, not forced: both an accept and a decline exist, and the tour is NOT
  // already running.
  assert.equal(await page.locator('#frGo').count(), 1, 'no "take the tour" button');
  assert.equal(await page.locator('#frNo').count(), 1, 'no "later" button');
  assert.ok(!(await page.locator('#tourOverlay').isVisible()), 'tour auto-started — it must be offered, not forced');
});

await test('the first-run banner fits a 412x900 phone and clears the tab bar', async () => {
  const g = await page.evaluate(() => {
    const b = document.getElementById('firstRun').getBoundingClientRect();
    const n = document.querySelector('nav').getBoundingClientRect();
    return { b: { x: b.x, y: b.y, right: b.right, bottom: b.bottom, h: b.height }, navTop: n.top,
      docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
  });
  assert.ok(g.b.x >= -1 && g.b.right <= VW + 1, `banner overflows horizontally (x=${g.b.x} right=${g.b.right} vw=${VW})`);
  assert.ok(g.b.y >= -1 && g.b.bottom <= VH + 1, `banner clipped vertically (y=${g.b.y} bottom=${g.b.bottom} vh=${VH})`);
  assert.ok(g.b.bottom <= g.navTop + 1, `banner covers the bottom tab bar (bottom=${g.b.bottom} navTop=${g.navTop})`);
  assert.ok(g.docScrollW <= g.docClientW + 1, `page scrolls horizontally at 412px (${g.docScrollW} > ${g.docClientW})`);
});

await test('"take the tour" starts the tour at step 1 of ' + N, async () => {
  await page.click('#frGo');
  assert.equal(await page.locator('#firstRun').count(), 0, 'banner did not clear when the tour started');
  assert.ok(await page.locator('#tourOverlay').isVisible(), 'tour overlay did not open');
  const st = await currentStep();
  assert.equal(st.count, `1 / ${N}`, `tour opened on "${st.count}", not step 1`);
  assert.equal(st.title, STEPS[0].h, `step 1 shows "${st.title}", expected "${STEPS[0].h}"`);
  assert.ok(!st.backVisible, 'Back is offered on step 1 — there is nothing behind it');
});

// ── 2. every step, driven from the STEPS array itself ───────────────────────
// One walk, three independent verdicts, so a geometry failure and a targeting
// failure are never confused for each other.
const walk = [];
{
  await page.evaluate(() => window._tour.show(0));
  for (let i = 0; i < N; i++) {
    const st = await currentStep();
    const tgt = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { x: b.x, y: b.y, w: b.width, h: b.height,
        tag: el.tagName, options: el.tagName === 'SELECT' ? el.options.length : null,
        kids: el.children.length, textLen: (el.textContent ?? '').trim().length,
        shown: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0,
        onActiveScreen: !!el.closest('section.screen.active') || !el.closest('section.screen') };
    }, STEPS[i].el);
    walk.push({ i, want: STEPS[i], got: st, tgt });
    if (i < N - 1) await page.click('#tourNext');
  }
}

await test(`all ${N} steps paint in order — none is silently auto-skipped`, async () => {
  const bad = walk.filter((w) => w.got.count !== `${w.i + 1} / ${N}` || w.got.title !== w.want.h);
  assert.equal(bad.length, 0, bad.map((w) =>
    `step ${w.i + 1} (${w.want.el}) showed "${w.got.count}" / "${w.got.title}" — expected "${w.i + 1} / ${N}" / "${w.want.h}" (target missing → place() auto-skipped it)`).join('; '));
});

await test(`all ${N} steps land on the tab (and fleet pane) the step declares`, async () => {
  const bad = walk.filter((w) => w.got.screen !== w.want.s || (w.want.fp && w.got.pane !== w.want.fp));
  assert.equal(bad.length, 0, bad.map((w) =>
    `step ${w.i + 1}: declares ${w.want.s}${w.want.fp ? '/' + w.want.fp : ''} but the app is on ${w.got.screen}${w.got.pane ? '/' + w.got.pane : ''}`).join('; '));
});

await test(`all ${N} spotlight targets exist and are visible on the active screen`, async () => {
  const bad = [];
  for (const w of walk) {
    if (!w.tgt) bad.push(`step ${w.i + 1}: ${w.want.el} does not exist in the DOM`);
    else if (!w.tgt.shown) bad.push(`step ${w.i + 1}: ${w.want.el} exists but is not visible`);
    else if (!w.tgt.onActiveScreen) bad.push(`step ${w.i + 1}: ${w.want.el} is not on the active screen`);
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

await test(`the spotlight ring actually surrounds its target at all ${N} steps`, async () => {
  // guide.js:64 draws the ring at the target's box inflated 6px on every side.
  // A ring that is not there is a tour pointing at the wrong control — the one
  // failure mode a "does the element exist" check cannot see. Measured after
  // settle(), so this is not the 250ms ring transition.
  //
  // KNOWN FAILURE (steps 26-28): guide.js:46 openTab() clicks the nav button on
  // EVERY step, even when already on that tab, and app.js:82 re-runs the Doctor
  // probe on every Doctor nav click — blanking #doctorList to a 22px "running
  // checks…" hint. guide.js:83 then measures 120ms later, inside that collapsed
  // window, and nothing re-places the ring when the lists come back ~240ms on
  // (the only re-place hook is `resize`, guide.js:94). The ring is left 799px
  // above its target. If this ever goes green, confirm the fix rather than the
  // race: a Doctor endpoint faster than 120ms would also hide the bug.
  const bad = [];
  for (const w of walk) {
    if (!w.tgt) continue; // already reported above
    const off = {
      x: w.got.ring.x - (w.tgt.x - 6), y: w.got.ring.y - (w.tgt.y - 6),
      w: w.got.ring.w - (w.tgt.w + 12), h: w.got.ring.h - (w.tgt.h + 12),
    };
    const worst = Math.max(...Object.values(off).map(Math.abs));
    if (worst > 3) {
      bad.push(`step ${w.i + 1} (${w.want.el}, "${w.want.h}"): ring is ${off.y.toFixed(0)}px off vertically / ${off.h.toFixed(0)}px wrong in height — ring box (${w.got.ring.x.toFixed(0)},${w.got.ring.y.toFixed(0)} ${w.got.ring.w.toFixed(0)}x${w.got.ring.h.toFixed(0)}) vs target (${w.tgt.x.toFixed(0)},${w.tgt.y.toFixed(0)} ${w.tgt.w.toFixed(0)}x${w.tgt.h.toFixed(0)})`);
    }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

await test(`the card fits 412x900 at all ${N} steps and never covers the tab bar`, async () => {
  const bad = [];
  for (const w of walk) {
    const c = w.got.card;
    if (c.x < -1 || c.right > VW + 1) bad.push(`step ${w.i + 1}: card overflows horizontally (x=${c.x.toFixed(0)} right=${c.right.toFixed(0)})`);
    if (c.y < -1 || c.bottom > VH + 1) bad.push(`step ${w.i + 1}: card clipped vertically (y=${c.y.toFixed(0)} bottom=${c.bottom.toFixed(0)})`);
    if (c.bottom > w.got.nav.y + 1) bad.push(`step ${w.i + 1}: card covers the bottom tab bar (bottom=${c.bottom.toFixed(0)} navTop=${w.got.nav.y.toFixed(0)})`);
    if (w.got.docScrollW > w.got.docClientW + 1) bad.push(`step ${w.i + 1}: page scrolls horizontally (${w.got.docScrollW} > ${w.got.docClientW})`);
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

await test(`"Next" is reachable at all ${N} steps without scrolling inside the card`, async () => {
  // .tour-card is max-height:72vh; overflow-y:auto — the buttons live INSIDE that
  // scroller, so a long step can push Next below the card's visible area. On a
  // phone that reads as a dead end. Presence/CSS-visibility would not catch it.
  const bad = [];
  for (const w of walk) {
    const { next, card } = w.got;
    if (next.bottom > card.bottom + 1 || next.y < card.y - 1) {
      bad.push(`step ${w.i + 1} (${w.want.el}, ${w.want.h}): Next sits outside the visible card — card ${w.got.cardScrollH}px of content in a ${w.got.cardClientH}px box`);
    }
    if (next.bottom > VH + 1 || next.y < -1) bad.push(`step ${w.i + 1}: Next is off-screen (y=${next.y.toFixed(0)} bottom=${next.bottom.toFixed(0)})`);
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

await test('no step teaches against an EMPTY control', async () => {
  // A tour step that rings an unpopulated <select> or a blank list looks fine to
  // any "does the element exist" check while teaching the user nothing. Pickers
  // must have options; containers must have rows or an explicit empty-state.
  const bad = [];
  for (const w of walk) {
    if (!w.tgt) continue;
    if (w.tgt.tag === 'SELECT' && w.tgt.options === 0) {
      bad.push(`step ${w.i + 1} (${w.want.el}, "${w.want.h}"): the picker the step explains has zero options`);
    } else if (w.tgt.kids === 0 && w.tgt.textLen === 0 && w.tgt.tag !== 'INPUT' && w.tgt.tag !== 'TEXTAREA') {
      bad.push(`step ${w.i + 1} (${w.want.el}, "${w.want.h}"): target is empty — no rows and no empty-state text`);
    }
  }
  assert.equal(bad.length, 0, bad.join('; '));
});

await test('every step carries real teaching copy, not a placeholder', async () => {
  const thin = walk.filter((w) => w.got.text.trim().length < 60);
  assert.equal(thin.length, 0, thin.map((w) => `step ${w.i + 1} (${w.want.h}): only ${w.got.text.trim().length} chars of body copy`).join('; '));
});

// ── 3. navigation controls ──────────────────────────────────────────────────
await test('Back steps backwards and reappears once there is somewhere to go', async () => {
  await page.evaluate(() => window._tour.show(2));
  let st = await currentStep();
  assert.equal(st.count, `3 / ${N}`);
  assert.ok(st.backVisible, 'Back hidden on step 3');
  await page.click('#tourBack');
  st = await currentStep();
  assert.equal(st.count, `2 / ${N}`, `Back from step 3 landed on "${st.count}"`);
  assert.equal(st.title, STEPS[1].h);
  await page.click('#tourBack');
  st = await currentStep();
  assert.equal(st.count, `1 / ${N}`, `Back from step 2 landed on "${st.count}"`);
  assert.ok(!st.backVisible, 'Back still offered on step 1');
});

await test('the last step offers Finish, and Finish closes the tour + marks it done', async () => {
  await page.evaluate(() => localStorage.removeItem('atlanTourDone'));
  await page.evaluate((n) => window._tour.show(n - 1), N);
  const st = await currentStep();
  assert.equal(st.count, `${N} / ${N}`);
  assert.match(await page.locator('#tourNext').innerText(), /finish/i, 'last step still says "Next"');
  await page.click('#tourNext');
  assert.ok(!(await page.locator('#tourOverlay').isVisible()), 'overlay still open after Finish');
  assert.equal(await page.evaluate(() => localStorage.getItem('atlanTourDone')), '1', 'Finish did not set atlanTourDone');
});

await test('a completed tour does not come back on the next visit', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => localStorage.getItem('atlanTourDone')), '1', 'done flag lost across reload');
  assert.equal(await page.locator('#firstRun').count(), 0, 'first-run banner returned after the tour was completed');
  assert.ok(!(await page.locator('#tourOverlay').isVisible()), 'tour re-opened after completion');
});

await test('"skip" mid-tour ends it and it stays ended', async () => {
  await freshBrowser();
  await page.click('#frGo');
  await currentStep();
  await page.click('#tourNext');
  await currentStep();
  await page.click('#tourSkip');
  assert.ok(!(await page.locator('#tourOverlay').isVisible()), 'skip did not close the overlay');
  assert.equal(await page.evaluate(() => localStorage.getItem('atlanTourDone')), '1', 'skip did not persist — the tour will nag on every reload');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#firstRun').count(), 0, 'banner returned after skip');
});

// ── 4. first-run persistence: the documented bug ────────────────────────────
await test('REGRESSION(TUTORIAL-OVERHAUL.md §1): "later" must be remembered, not re-asked forever', async () => {
  await freshBrowser();
  assert.equal(await page.locator('#firstRun').count(), 1, 'precondition: no banner to decline');
  await page.click('#frNo');
  assert.equal(await page.locator('#firstRun').count(), 0, 'banner did not clear on "later"');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#firstRun').count(), 0,
    'declining with "later" is not persisted — every exit from the bar must markTour(), or the banner returns on EVERY reload forever');
});

await test('REGRESSION(TUTORIAL-OVERHAUL.md §1b): onboarding survives a change of origin', async () => {
  await returningBrowser(); // finished on 127.0.0.1
  assert.equal(await page.locator('#firstRun').count(), 0, 'precondition: banner should be gone on the primary origin');
  const alt = BASE.replace('127.0.0.1', 'localhost');
  assert.notEqual(alt, BASE, 'could not derive a second origin from ATLAN_BASE');
  await page.goto(alt, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav button[data-s="s-chat"]');
  const flag = await page.evaluate(() => localStorage.getItem('atlanTourDone'));
  const back = await page.locator('#firstRun').count();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  assert.equal(back, 0,
    `the same cockpit on a second origin (${alt}) re-offers onboarding (flag=${flag}) — loopback vs tailnet must not each nag once, so /api/prefs stays the source of truth and localStorage is only its per-origin cache`);
});

// ── 5. the handbook ─────────────────────────────────────────────────────────
await test('? opens the handbook and every section carries real content', async () => {
  await returningBrowser();
  await page.click('#helpBtn');
  assert.ok(await page.locator('#guideOverlay').isVisible(), 'handbook did not open');
  const secs = await page.$$eval('#guideOverlay details', (ds) => ds.map((d) => ({
    summary: d.querySelector('summary')?.textContent.trim() ?? '',
    body: (d.textContent ?? '').replace(d.querySelector('summary')?.textContent ?? '', '').trim().length,
  })));
  assert.ok(secs.length >= 12, `handbook has only ${secs.length} sections`);
  const empty = secs.filter((s) => !s.summary || s.body < 80);
  assert.equal(empty.length, 0, `sections with no real body: ${empty.map((s) => s.summary || '(untitled)').join(', ')}`);
});

await test('handbook search filters to matches, auto-opens them, and clearing restores all', async () => {
  const total = await page.locator('#guideOverlay details').count();
  await page.fill('#guideSearch', 'bubblewrap zzz-no-such-term');
  await page.waitForFunction((t) => [...document.querySelectorAll('#guideOverlay details')]
    .filter((d) => d.style.display !== 'none').length < t, total, { timeout: 3000 })
    .catch(() => { throw new Error('a nonsense query filtered nothing — search is not wired'); });
  assert.equal(await page.locator('#guideOverlay details:visible').count(), 0, 'a nonsense query still matched sections');

  await page.fill('#guideSearch', 'phantom-process');
  await page.waitForTimeout(120);
  const hits = await page.locator('#guideOverlay details:visible').count();
  assert.ok(hits >= 1 && hits < total, `"phantom-process" left ${hits}/${total} sections visible — no real filtering`);
  const allOpen = await page.$$eval('#guideOverlay details', (ds) =>
    ds.filter((d) => d.style.display !== 'none').every((d) => d.open));
  assert.ok(allOpen, 'matched sections were not auto-opened — the hit is buried behind a closed <summary>');

  await page.fill('#guideSearch', '');
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#guideOverlay details:visible').count(), total, 'clearing the search did not restore every section');
});

await test('BUG: the handbook filter survives close/reopen — ? reopens a filtered handbook', async () => {
  await page.fill('#guideSearch', 'phantom-process');
  await page.waitForTimeout(120);
  const filtered = await page.locator('#guideOverlay details:visible').count();
  const total = await page.locator('#guideOverlay details').count();
  assert.ok(filtered < total, 'precondition: search did not filter');
  await page.click('#guideClose');
  await page.click('#helpBtn');
  await page.waitForTimeout(120);
  const reopened = await page.locator('#guideOverlay details:visible').count();
  const box = await page.inputValue('#guideSearch');
  // reset so later tests see a clean handbook
  await page.fill('#guideSearch', '');
  await page.click('#guideClose');
  assert.equal(reopened, total,
    `reopening ? shows only ${reopened}/${total} sections with "${box}" still in the search box — guideClose/helpBtn never reset #guideSearch (guide.js:98-99), so the reference silently hides ${total - reopened} sections`);
});

await test('the handbook can relaunch the full tour from step 1', async () => {
  await page.click('#helpBtn');
  await page.click('#guideTour');
  assert.ok(!(await page.locator('#guideOverlay').isVisible()), 'handbook stayed open behind the tour');
  const st = await currentStep();
  assert.equal(st.count, `1 / ${N}`, `relaunch opened on "${st.count}"`);
  assert.equal(st.title, STEPS[0].h);
  await page.click('#tourSkip');
});

// ── 6. the tour's own claim: "every control in the cockpit" ─────────────────
await test('CLAIM: the tour visits every tab in the bottom nav', async () => {
  const tabs = await page.$$eval('nav button[data-s]', (bs) => bs.map((b) => ({ id: b.dataset.s, label: b.querySelector('.lb')?.textContent.trim() ?? b.dataset.s })));
  assert.ok(tabs.length >= 8, `only ${tabs.length} nav tabs found`);
  const covered = new Set(STEPS.map((s) => s.s));
  const missed = tabs.filter((t) => !covered.has(t.id));
  assert.equal(missed.length, 0,
    `guide.js says it walks "EVERY control in the cockpit" but ${missed.length} of ${tabs.length} tabs get zero steps: ${missed.map((t) => `${t.label} (${t.id})`).join(', ')}`);
});

await test('CLAIM: the tour visits every Fleet sub-pane', async () => {
  await page.click('nav button[data-s="s-fleet"]');
  const panes = await page.$$eval('#fleetSubnav button[data-p]', (bs) => bs.map((b) => ({ id: b.dataset.p, label: b.textContent.trim() })));
  assert.ok(panes.length >= 4, `only ${panes.length} fleet panes found`);
  const covered = new Set(STEPS.filter((s) => s.fp).map((s) => s.fp));
  const missed = panes.filter((p) => !covered.has(p.id));
  assert.equal(missed.length, 0,
    `Fleet sub-panes with zero tour steps: ${missed.map((p) => `${p.label} (${p.id})`).join(', ')}`);
});

await test('PARITY: every tab the cockpit ships has a handbook section', async () => {
  const tabs = await page.$$eval('nav button[data-s] .lb', (ls) => ls.map((l) => l.textContent.trim()));
  const summaries = await page.$$eval('#guideOverlay details summary', (ss) => ss.map((s) => s.textContent.toLowerCase()));
  const missed = tabs.filter((t) => !summaries.some((s) => s.includes(t.toLowerCase())));
  assert.equal(missed.length, 0,
    `handbook has no section for: ${missed.join(', ')} — the handbook is meant to be the same knowledge as the tour, reference-shaped (${summaries.length} sections present)`);
});

// ── 7. the untutored surfaces are LIVE, so the gaps above are real ──────────
await test('the untaught Scan tab is a working surface, not a stub', async () => {
  // PRESENCE + ENABLED-STATE ONLY: pressing "Run scan" walks the user's real
  // project tree. Never clicked here.
  await page.click('nav button[data-s="s-scan"]');
  await page.waitForSelector('#s-scan.active');
  assert.ok(await page.locator('#scanBtn').isVisible(), 'Run scan button not visible');
  assert.ok(await page.locator('#scanBtn').isEnabled(), 'Run scan button disabled');
  // the picker fills from /api/projects — wait for the fetch, don't race it
  await page.waitForFunction(() => document.querySelectorAll('#scanProjSel option').length > 0, null, { timeout: 6000 })
    .catch(() => { throw new Error('Scan project picker never populated — cannot tell a live feature from a stub'); });
  const opts = await page.locator('#scanProjSel option').count();
  assert.ok(opts > 0, 'Scan project picker is empty — cannot tell a live feature from a stub');
  const b = await page.locator('#s-scan').boundingBox();
  assert.ok(b.width <= VW + 1, `Scan tab overflows 412px (${b.width})`);
  assert.equal(STEPS.filter((s) => s.s === 's-scan').length, 0); // documents WHY this test exists
});

await test('the untaught Git screen is a working surface reachable only from the Editor', async () => {
  // Reached the real way: Editor toolbar -> "⑂ Git". initGit() only READS git
  // status; nothing here stages, commits, pulls or pushes.
  await page.click('nav button[data-s="s-editor"]');
  await page.waitForSelector('#s-editor.active');
  assert.ok(await page.locator('#edGit').isVisible(), 'Editor has no route to the Git screen');
  await page.click('#edGit');
  await page.waitForSelector('#s-git.active', { timeout: 5000 });
  assert.ok(await page.locator('#gitCommitBtn').isVisible(), 'Git screen rendered without its commit control');
  assert.ok(await page.locator('#gitFilesList > *').count() > 0, 'Git file list has neither entries nor an empty-state');
  const b = await page.locator('#s-git').boundingBox();
  assert.ok(b.width <= VW + 1, `Git screen overflows 412px (${b.width})`);
  assert.equal(await page.$$eval('nav button[data-s]', (bs) => bs.filter((b2) => b2.dataset.s === 's-git').length), 0,
    'Git is in the nav now — the tour/handbook gap should be re-measured');
  await page.click('#gitBack');
});

// ── 8. nothing threw along the way ──────────────────────────────────────────
await test('no uncaught page errors during the whole onboarding walk', async () => {
  assert.equal(consoleErrors.length, 0, consoleErrors.join(' | '));
});

await browser.close();
console.log('\nTUTORIAL SUITE — tour + handbook');
for (const [s, n] of results) console.log(' ', s, n);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
