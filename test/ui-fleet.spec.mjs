// Playwright suite — FLEET + BUILD, the two tabs where Atlan spends money.
//
// Everything here runs at 412x900 (a phone) because that is the only viewport
// this product promises. What it covers, and why in this order:
//   · the spawn form and ⚓ Spawn — the control nothing in test/ ever clicked
//   · run cards, top-up, KILL ALL — the money + safety controls
//   · the burn meter — the one always-visible spend gauge
//   · routines CRUD end to end, including the MISSED path
//   · the Persona+ builder and the test harness
//   · the worker-hierarchy job builder (zero coverage before this file)
//   · the Build tab's client half, driven by injected frames
//
// SAFETY — this suite must be harmless against John's live cockpit:
//   · POST /api/fleet/run, /api/fleet/topup, /api/fleet/kill, /api/routines/fire,
//     /api/harness/run and /api/harness/escalate are ROUTE-INTERCEPTED. The click
//     is real, the wiring is asserted from the request body, and nothing spawns.
//   · #buildBtn is NEVER clicked — it pushes build.start down the live socket and
//     starts a real Gradle build. Its client half is exercised by injecting the
//     build.* frames the server would have sent.
//   · #jstart (hierarchy run) is asserted present + enabled only: it spends, and
//     it opens blocking window.prompt() dialogs.
//   · Routines/personas/commands/jobs the suite creates are deleted again, and
//     the last test fails if any artifact is left behind.
//   · Every routine is created with a 7-day cadence so the scheduler can never
//     fire it inside a test run.
//
// window.__inject(frame) is a captured handle on the app's own WebSocket: it
// dispatches a real MessageEvent at the real onmessage handler, so run cards,
// burn frames and build logs go through production code paths without a server
// that spends.
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
  catch (e) { results.push(['XX', name + ' — ' + String(e.message).split('\n')[0]]); fail++; }
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
// A control this suite cannot reach is a finding, not something to wait 30s for.
ctx.setDefaultTimeout(8000);
// Capture the app's socket before app.js runs so server frames can be replayed.
await ctx.addInitScript(() => {
  const Native = window.WebSocket;
  const Wrapped = function (...a) { const s = new Native(...a); window.__ws = s; return s; };
  Wrapped.prototype = Native.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Wrapped[k] = Native[k];
  window.WebSocket = Wrapped;
  window.__inject = (o) => window.__ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(o) }));
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
await page.goto(BASE);
await page.evaluate(async (pw) => {
  const s = await fetch('/api/auth/status').then((r) => r.json());
  const ep = s.configured ? '/api/auth/login' : '/api/auth/setup';
  await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
}, 'atlan-test-pw-8x');
await page.evaluate(() => localStorage.setItem('atlanTourDone', '1'));
await page.goto(BASE, { waitUntil: 'networkidle' });

// ── helpers ───────────────────────────────────────────────────────────────
const api = (p, body) => fetch(BASE + p, body
  ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  : undefined).then((r) => r.json());

const PROFILES = [
  { id: 'scout', label: 'Scout — read-only, no shell' },
  { id: 'builder', label: 'Builder — files + bash, writes scoped to project' },
  { id: 'verifier', label: 'Verifier — reads + runs checks, never edits what it grades' },
];
const mkRun = (o = {}) => ({
  id: 'run-a', prompt: 'summarise the fleet surface', profile: 'scout', cwd: '/root',
  model: 'claude-haiku-4-5-20251001', budget: 50000, tokens: 10000, cost: 0.02,
  status: 'running', startedAt: Date.now(), endedAt: null, lastLine: 'reading files',
  denials: 0, resultText: null, resumable: false, resumedFrom: null, source: null,
  cacheRead: 0, engine: 'claude', enforced: true, boundary: 'atlan',
  budgetEnforcement: 'mid-run', tokensKnown: true, proposal: null, ...o,
});
const fleetPayload = (o = {}) => ({
  runs: [], history: [], today: { tokens: 0, cost: 0, cacheRead: 0 },
  profiles: PROFILES, engines: [], pushSubs: 0, ...o,
});
// Serve a synthetic /api/fleet so run cards can be driven without spawning.
// The matcher is a stable reference — page.unroute() matches it by identity.
const IS_FLEET = (u) => u.pathname === '/api/fleet';
const IS_ROUTINES = (u) => u.pathname === '/api/routines';
async function mockFleet(payload) {
  await page.route(IS_FLEET, (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }));
}
const unmockFleet = () => page.unroute(IS_FLEET);
// Always land on a known pane: a test that fails part-way must not leave the
// next one looking at a hidden control.
const openFleet = async () => {
  await page.click('nav button[data-s="s-chat"]');
  await page.click('nav button[data-s="s-fleet"]');
  await page.click('#fleetSubnav button[data-p="fp-runs"]');
  await page.waitForTimeout(250);
};
const openPane = async (p) => {
  await page.click(`#fleetSubnav button[data-p="${p}"]`);
  await page.waitForTimeout(350);
};
const errCount = () => page.locator('#chatlog .msg.err').count();
// Record every request to a path and answer it, so a click can be proved
// without the real handler ever running.
async function capture(pathname, body = { ok: true }, status = 200) {
  const seen = [];
  const matcher = (u) => u.pathname === pathname;
  await page.route(matcher, (route) => {
    seen.push(route.request().postDataJSON());
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { seen, release: () => page.unroute(matcher) };
}

const CREATED = { routines: [], personas: [], commands: [], jobs: [] };

// ── 1. shell ──────────────────────────────────────────────────────────────
await test('Fleet sub-nav exposes all four panes and each one loads real content', async () => {
  await openFleet();
  const btns = await page.locator('#fleetSubnav button').evaluateAll((els) => els.map((e) => e.dataset.p));
  assert.deepEqual(btns, ['fp-runs', 'fp-routines', 'fp-builder', 'fp-hierarchy'], 'sub-nav panes drifted: ' + btns.join(','));
  for (const p of btns) {
    await openPane(p);
    const active = await page.locator('.fpane.active').evaluateAll((els) => els.map((e) => e.id));
    assert.deepEqual(active, [p], `expected only ${p} active, got ${active.join(',')}`);
    // Each pane must render SOMETHING — an empty <div> is the vacuous pass here.
    // textContent, not innerText: #perList lives inside a collapsed <details>.
    const box = { 'fp-runs': '#fleetRuns', 'fp-routines': '#routList', 'fp-builder': '#perList', 'fp-hierarchy': '#jobList' }[p];
    const txt = (await page.locator(box).textContent()).trim();
    assert.ok(txt.length > 0, `${p}: ${box} rendered blank — no cards and no empty-state copy`);
  }
  await openPane('fp-runs');
});

await test('spawn form is populated from the server — profiles, models, budgets, no placeholders', async () => {
  const profiles = await page.locator('#fleetProfile option').evaluateAll((els) => els.map((e) => ({ v: e.value, t: e.textContent.trim() })));
  assert.ok(profiles.length >= 3, `expected >=3 profiles, got ${profiles.length}`);
  for (const id of ['scout', 'builder', 'verifier']) {
    const p = profiles.find((x) => x.v === id);
    assert.ok(p, `profile "${id}" missing from #fleetProfile`);
    assert.ok(p.t.length > 4, `profile "${id}" has no label — /api/fleet profileList did not paint`);
  }
  const models = await page.locator('#fleetModel option').evaluateAll((els) => els.map((e) => e.value));
  assert.ok(models.length >= 5, `expected >=5 models, got ${models.length}`);
  assert.ok(models.every((m) => m.startsWith('claude-')), 'a fleet model option is not a claude model: ' + models.join(','));
  const budgets = await page.locator('#fleetBudget option').evaluateAll((els) => els.map((e) => Number(e.value)));
  assert.ok(budgets.length >= 3 && budgets.every((b) => b >= 50000), 'budget options must all be >= the 50k practical floor: ' + budgets.join(','));
  assert.ok(await page.locator('#fleetSpawn').isEnabled(), '⚓ Spawn is disabled');
});

// ── 2. spawn (intercepted — never reaches spawnRun) ───────────────────────
await test('⚓ Spawn posts the whole form and clears the prompt', async () => {
  const c = await capture('/api/fleet/run', { id: 'fake-run-1', status: 'running' });
  try {
    await page.fill('#fleetPrompt', 'list the files in web/public and stop');
    await page.selectOption('#fleetProfile', 'verifier');
    await page.selectOption('#fleetModel', 'claude-sonnet-5');
    await page.selectOption('#fleetBudget', '500000');
    const cwd = await page.locator('#projSel').inputValue();
    await page.click('#fleetSpawn');
    await page.waitForTimeout(400);
    assert.equal(c.seen.length, 1, `expected exactly 1 POST /api/fleet/run, got ${c.seen.length} — #fleetSpawn is unwired`);
    const b = c.seen[0];
    assert.equal(b.prompt, 'list the files in web/public and stop', 'prompt not sent');
    assert.equal(b.profile, 'verifier', 'profile picker not sent');
    assert.equal(b.model, 'claude-sonnet-5', 'model picker not sent (#fleetModel is the untested one)');
    assert.equal(b.budget, 500000, 'budget not sent as a number');
    assert.equal(b.cwd, cwd, 'run did not inherit the Chat tab project');
    assert.equal(await page.locator('#fleetPrompt').inputValue(), '', 'prompt box not cleared after a successful spawn');
  } finally { await c.release(); await page.selectOption('#fleetProfile', 'scout'); }
});

await test('⚓ Spawn with an empty prompt never posts', async () => {
  const c = await capture('/api/fleet/run', { id: 'should-not-happen' });
  try {
    await page.fill('#fleetPrompt', '   ');
    await page.click('#fleetSpawn');
    await page.waitForTimeout(400);
    assert.equal(c.seen.length, 0, 'an empty prompt spawned a run — that is a spend with no task');
  } finally { await c.release(); }
});

await test('a rejected spawn is surfaced and the typed prompt survives', async () => {
  const before = await errCount();
  const c = await capture('/api/fleet/run', { error: 'unknown profile: nope' });
  try {
    await page.fill('#fleetPrompt', 'work that must not be lost');
    await page.click('#fleetSpawn');
    await page.waitForTimeout(400);
    assert.equal(await errCount(), before + 1, 'server error from /api/fleet/run was swallowed — no message reached the user');
    const last = await page.locator('#chatlog .msg.err').last().innerText();
    assert.match(last, /unknown profile/, 'the error shown is not the one the server sent: ' + last);
    assert.equal(await page.locator('#fleetPrompt').inputValue(), 'work that must not be lost', 'a rejected spawn threw away the typed prompt');
  } finally { await c.release(); await page.fill('#fleetPrompt', ''); }
});

// ── 3. run cards / inbox ──────────────────────────────────────────────────
await test('run cards mirror server state — status, burn bar, kill only while running', async () => {
  await mockFleet(fleetPayload({
    runs: [
      mkRun({ id: 'run-live', prompt: 'live run', tokens: 25000, budget: 50000, status: 'running' }),
      mkRun({ id: 'run-halt', prompt: 'halted run', tokens: 50000, budget: 50000, status: 'halted-budget', resumable: true }),
    ],
    history: [mkRun({ id: 'run-done', prompt: 'finished run', status: 'done', resultText: 'REPORT: 3 findings, all minor.', endedAt: Date.now() })],
  }));
  {
    await openFleet();
    await page.waitForFunction(() => document.querySelectorAll('#fleetRuns .runcard').length === 3, { timeout: 5000 });
    const cards = await page.locator('#fleetRuns .runcard').evaluateAll((els) => els.map((e) => ({
      id: e.dataset.id,
      cls: e.className,
      prompt: e.querySelector('.rprompt').textContent,
      status: e.querySelector('.rstatus').textContent,
      meta: e.querySelector('.rmeta').textContent,
      burn: e.querySelector('.burn i').style.width,
      killShown: e.querySelector('.rkill').style.display !== 'none',
      topupShown: e.querySelector('.rtopup').style.display !== 'none',
    })));
    const by = Object.fromEntries(cards.map((c) => [c.id, c]));
    assert.equal(cards.length, 3, 'live runs + durable history must both land in the inbox');
    assert.equal(by['run-live'].status, 'running');
    assert.equal(by['run-halt'].status, 'BUDGET HALT', 'a budget halt must be labelled loudly, not "halted-budget"');
    assert.equal(by['run-done'].status, 'done');
    assert.equal(by['run-live'].prompt, 'live run', 'card does not carry the run prompt');
    assert.equal(by['run-live'].burn, '50%', 'burn bar does not reflect tokens/budget');
    assert.equal(by['run-halt'].burn, '100%');
    assert.match(by['run-live'].meta, /25\.0k \/ 50\.0k tok/, 'token meta line wrong: ' + by['run-live'].meta);
    assert.ok(by['run-live'].killShown, '✖ kill missing on a RUNNING run — the per-run stop is gone');
    assert.ok(!by['run-done'].killShown, 'kill offered on a finished run');
    assert.ok(by['run-live'].cls.includes('st-running') && by['run-halt'].cls.includes('st-halted-budget'), 'status class not applied: ' + by['run-halt'].cls);
  } // the mocked payload stays installed for the next three tests
});

await test('tapping a finished report opens it and shows the report text', async () => {
  const card = page.locator('#fleetRuns .runcard[data-id="run-done"]');
  await card.click();
  await page.waitForTimeout(150);
  assert.ok(await card.evaluate((e) => e.classList.contains('open')), 'card did not open on tap');
  const txt = await card.locator('.rresult').innerText();
  assert.match(txt, /REPORT: 3 findings/, 'the report body is not rendered inside the opened card');
  assert.ok(await card.locator('.rresult').isVisible(), 'report text is still hidden after opening the card');
  await card.click();
});

await test('top-up is offered only on a resumable halted run', async () => {
  const shown = await page.locator('#fleetRuns .runcard').evaluateAll((els) => Object.fromEntries(
    els.map((e) => [e.dataset.id, e.querySelector('.rtopup').style.display !== 'none'])));
  assert.ok(shown['run-halt'], '▲ top up missing on a halted, resumable run — the documented recovery path is gone');
  assert.ok(!shown['run-live'], 'top-up offered on a running run');
  assert.ok(!shown['run-done'], 'top-up offered on a finished run');
});

await test('top-up cannot be fired twice on the same halted run', async () => {
  // §4.3: topUpRun() spawns a NEW run and leaves the old one resumable, so the
  // button stays live. Two taps = two agents resuming the same session, each
  // with its own 100k budget. Nothing disables it client- or server-side.
  const c = await capture('/api/fleet/topup', { id: 'resumed-1', status: 'running' });
  try {
    const btn = page.locator('#fleetRuns .runcard[data-id="run-halt"] .rtopup');
    await btn.click();
    await page.waitForTimeout(400);
    assert.equal(c.seen.length, 1, 'first tap did not post a top-up');
    assert.equal(c.seen[0].id, 'run-halt', 'top-up posted the wrong run id');
    assert.ok(c.seen[0].extra > 0, 'top-up must carry the extra budget');
    const live = await btn.evaluate((e) => e.style.display !== 'none' && !e.disabled);
    assert.ok(!live, 'top-up is still armed after being used — a second tap resumes the SAME session again, double-spending its budget');
  } finally { await c.release(); }
});

await test('✖ KILL ALL RUNS sends the fleet-wide kill', async () => {
  const c = await capture('/api/fleet/kill', { killed: 2 });
  try {
    await page.click('#fleetKillAll');
    await page.waitForTimeout(400);
    assert.equal(c.seen.length, 1, 'KILL ALL did not post');
    assert.equal(c.seen[0].id, 'all', 'KILL ALL must post id:"all" — it posted ' + JSON.stringify(c.seen[0]));
  } finally { await c.release(); }
});

await test('a KILL ALL that fails tells the user', async () => {
  // §4.2: the handler is a bare fetch() with no .then and no .catch. On a 500,
  // an expired session or a dead server, the big red "immediate, always
  // available" button does nothing and says nothing.
  const before = await errCount();
  const c = await capture('/api/fleet/kill', { error: 'kill failed' }, 500);
  try {
    await page.click('#fleetKillAll');
    await page.waitForTimeout(1200);
    assert.equal(c.seen.length, 1, 'KILL ALL did not post');
    assert.ok(await errCount() > before, 'KILL ALL failed silently — no error reached the user, so a dead kill looks exactly like a successful one');
  } finally { await c.release(); }
});

// ── 4. the burn meter ─────────────────────────────────────────────────────
await test("the header burn meter reports today's burn on every tab", async () => {
  await unmockFleet();
  await mockFleet(fleetPayload({ today: { tokens: 123400, cost: 1.23, cacheRead: 8000 } }));
  await openFleet();
  await page.waitForFunction(() => document.getElementById('burnMeta').textContent.includes('123'), { timeout: 4000 });
  const t = await page.locator('#burnMeta').innerText();
  assert.match(t, /123k fresh tok/, 'burn meter does not show today\'s tokens: ' + t);
  assert.match(t, /\$1\.23/, 'burn meter does not show the API-equivalent cost: ' + t);
  assert.match(t, /8\.0k cached/, 'cache savings are not shown: ' + t);
  await page.click('nav button[data-s="s-chat"]');
  assert.ok((await page.locator('#burnMeta').innerText()).includes('123'), 'burn meter is not visible outside the Fleet tab');
});

await test('the header burn meter moves while a run is burning', async () => {
  // §4.6: fleet.burn frames only ever call paintRun(). #burnMeta — the one
  // always-visible spend gauge — is repainted on load and on fleet.done, so it
  // is frozen for exactly the window a user would be watching it.
  await openFleet();
  const before = await page.locator('#burnMeta').innerText();
  await page.evaluate((run) => window.__inject({ t: 'fleet.run', run }), mkRun({ id: 'burner', tokens: 0, budget: 1000000 }));
  await page.waitForTimeout(150);
  for (const tok of [80000, 160000, 240000]) {
    await page.evaluate((t) => window.__inject({ t: 'fleet.burn', id: 'burner', tokens: t, cost: t / 1e6, cacheRead: 0 }), tok);
    await page.waitForTimeout(120);
  }
  const cardMeta = await page.locator('#fleetRuns .runcard[data-id="burner"] .rmeta').textContent();
  assert.match(cardMeta, /240k \/ 1000k tok/, 'the run card itself did not take the burn frames: ' + cardMeta);
  const after = await page.locator('#burnMeta').innerText();
  assert.notEqual(after, before, `header burn meter frozen at "${before}" while a live run burned 240k tokens — the always-on spend gauge under-reports during the only moments it matters`);
});

// ── 5. push + KILL ALL as phone controls (cannot be clicked safely) ───────
await test('push + KILL ALL are real, separate tap targets inside the phone frame', async () => {
  // enablePush() needs a Notification permission prompt and writes a real
  // subscription, so it is asserted present + enabled only. The reload is
  // deliberate: loadFleet() HIDES #pushBtn permanently once the server reports
  // any subscription, so a fresh document is the only way to assert the
  // first-run state on an instance that already has push enabled.
  await unmockFleet();
  await mockFleet(fleetPayload());
  await page.reload({ waitUntil: 'networkidle' });
  await openFleet();
  const push = await page.locator('#pushBtn').boundingBox();
  const kill = await page.locator('#fleetKillAll').boundingBox();
  assert.ok(push && kill, 'push or KILL ALL is not rendered');
  assert.ok(await page.locator('#pushBtn').isEnabled() && await page.locator('#fleetKillAll').isEnabled(), 'a fleet control is disabled');
  for (const [n, b] of [['pushBtn', push], ['fleetKillAll', kill]]) {
    assert.ok(b.height >= 38, `${n} is ${Math.round(b.height)}px tall — below the 38px the stylesheet promises every .btn`);
    assert.ok(b.x >= 0 && b.x + b.width <= 412.5, `${n} runs off the 412px screen`);
  }
  const overlap = !(push.x + push.width <= kill.x + 0.5 || kill.x + kill.width <= push.x + 0.5)
    && !(push.y + push.height <= kill.y + 0.5 || kill.y + kill.height <= push.y + 0.5);
  assert.ok(!overlap, 'the 🔔 button and KILL ALL overlap — a mis-tap kills every running agent');
});

// ── 6. routines ───────────────────────────────────────────────────────────
await test('a routine can be created, disabled, re-enabled and deleted from the phone', async () => {
  await unmockFleet();
  await openFleet();
  await openPane('fp-routines');
  const name = 'atlan-ui-fleet-spec ' + Date.now();
  await page.click('#routNewBtn');
  assert.ok(await page.locator('#routForm').isVisible(), '＋ new routine did not open the form');
  await page.fill('#routName', name);
  await page.selectOption('#routKind', 'every');
  await page.fill('#routEvery', '10080');   // 7 days: the scheduler can never fire it mid-suite
  await page.fill('#routPrompt', 'no-op probe from the fleet UI spec — never fires');
  await page.selectOption('#routProfile', 'verifier');
  await page.selectOption('#routBudget', '50000');
  await page.click('#routSave');
  await page.waitForTimeout(600);
  assert.ok(!await page.locator('#routForm').isVisible(), 'the routine form stayed open after a successful save');

  const card = page.locator('#routList .runcard', { hasText: name });
  await card.waitFor({ timeout: 4000 });
  const created = (await api('/api/routines')).routines.find((r) => r.name === name);
  assert.ok(created, 'the routine never reached the server');
  CREATED.routines.push(created.id);
  assert.equal(created.profile, 'verifier', 'the profile picker was not saved (it silently coerces to scout)');
  assert.equal(created.budget, 50000, 'the budget picker was not saved');
  assert.equal(created.cadence.minutes, 10080, 'the cadence was not saved');
  // .rstatus is text-transform:uppercase — read textContent, never innerText.
  assert.match(await card.locator('.rstatus').textContent(), /every 168h/, 'the card does not show the cadence it will run on');
  assert.match(await card.locator('.rmeta').textContent(), /verifier · 50\.0k tok\/fire/, 'the card does not show profile + budget');
  assert.match(await card.locator('.rfire').textContent(), /run now/, 'a healthy routine must offer "▶ run now"');

  await card.locator('.rtoggle').click();
  await page.waitForTimeout(500);
  assert.equal((await api('/api/routines')).routines.find((r) => r.id === created.id).enabled, false, 'disable did not persist');
  assert.match(await card.locator('.rstatus').textContent(), /off/, 'a disabled routine still advertises its cadence');
  assert.match(await card.locator('.rtoggle').textContent(), /enable/, 'the toggle did not flip to "enable"');
  await card.locator('.rtoggle').click();
  await page.waitForTimeout(500);
  assert.equal((await api('/api/routines')).routines.find((r) => r.id === created.id).enabled, true, 're-enable did not persist');

  await card.locator('.rdel').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#routList .runcard', { hasText: name }).count(), 0, 'the deleted routine is still on screen');
  assert.ok(!(await api('/api/routines')).routines.some((r) => r.id === created.id), 'the routine survived delete on the server');
  CREATED.routines.length = 0;
});

await test('the routine form swaps interval for a clock time when the cadence is daily', async () => {
  await page.click('#routNewBtn');
  await page.selectOption('#routKind', 'daily');
  await page.waitForTimeout(150);
  assert.ok(!await page.locator('#routEvery').isVisible(), 'daily cadence still shows the "every N minutes" box');
  assert.ok(await page.locator('#routAt').isVisible(), 'daily cadence does not show the HH:MM picker');
  await page.selectOption('#routKind', 'every');
  await page.waitForTimeout(150);
  assert.ok(await page.locator('#routEvery').isVisible(), 'every-N cadence lost its interval box');
  assert.ok(!await page.locator('#routAt').isVisible(), 'every-N cadence still shows the clock');
  await page.click('#routCancel');
  assert.ok(!await page.locator('#routForm').isVisible(), 'cancel did not close the routine form');
});

await test('a MISSED routine says so and its "run late" fires as a late run', async () => {
  // The missed-run guarantee is the promise that a rebooting phone never
  // silently spends. The FIRE is intercepted — this asserts the wiring, not a run.
  const missed = {
    id: 'missed-fixture', name: 'nightly repo scan', cadence: { kind: 'every', minutes: 360 },
    prompt: 'scan the repo', personaId: null, profile: 'scout', cwd: '/root',
    model: 'claude-haiku-4-5-20251001', budget: 50000, enabled: true, missed: true,
    lastFireAt: Date.now(), lastRunId: null, createdAt: Date.now() - 9e6, nextDueAt: Date.now() + 9e6,
  };
  await page.route(IS_ROUTINES, (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routines: [missed], paused: false }) }));
  const c = await capture('/api/routines/fire', { id: 'late-run-1' });
  try {
    await openPane('fp-runs'); await openPane('fp-routines');
    const card = page.locator('#routList .runcard', { hasText: 'nightly repo scan' });
    await card.waitFor({ timeout: 4000 });
    assert.match(await card.locator('.rstatus').textContent(), /MISSED/, 'a missed routine does not announce itself — the user cannot tell a skipped slot from a healthy one');
    assert.match(await card.locator('.rfire').textContent(), /run late/, 'a missed routine must offer "▶ run late", not "run now"');
    assert.ok(await card.evaluate((e) => e.className.includes('st-halted-budget')), 'a missed routine card is not visually flagged');
    await card.locator('.rfire').click();
    await page.waitForTimeout(400);
    assert.equal(c.seen.length, 1, '"run late" did not post');
    assert.equal(c.seen[0].id, 'missed-fixture', 'the wrong routine was fired');
    assert.equal(c.seen[0].late, true, '"run late" did not send late:true — the run would be logged as a normal scheduled fire');
  } finally { await c.release(); await page.unroute(IS_ROUTINES); }
});

// ── 7. Persona+ builder ───────────────────────────────────────────────────
const PNAME = 'SpecPersona ' + Date.now();
const CNAME = 'SPEC_CMD_' + Date.now();
await test('Builder: a persona and a typed command save and appear everywhere they are used', async () => {
  await openPane('fp-builder');
  await page.locator('#dPersona summary').click();
  await page.fill('#pName', PNAME);
  await page.fill('#pFocus', 'grading appliance estimates — scope is the moat');
  await page.fill('#pBio', 'a narrow, boring expert');
  await page.fill('#pSkills', 'estimating\nchecking');
  await page.fill('#pNoNos', 'never invent a part');
  await page.fill('#pInstr', 'answer in the template only');
  await page.selectOption('#pProfile', 'verifier');
  await page.click('#pSave');
  await page.waitForTimeout(600);
  const persona = (await api('/api/personas')).personas.find((p) => p.name === PNAME);
  assert.ok(persona, 'the persona never reached the server');
  CREATED.personas.push(persona.id);
  assert.equal(persona.profile, 'verifier', 'the persona fleet profile was not saved');
  assert.deepEqual(persona.skills, ['estimating', 'checking'], 'SKILLS did not compile to a list');
  assert.match(await page.locator('#perCount').innerText(), /\(\d+\)/, 'the persona count badge did not update');
  assert.ok(await page.locator('#perList .runcard', { hasText: PNAME }).count() > 0, 'the saved persona is not listed');
  assert.equal(await page.locator('#pName').inputValue(), '', 'the persona form was not cleared after save');

  await page.locator('#dCommand summary').click();
  await page.fill('#cName', CNAME);
  await page.selectOption('#cPersona', persona.id);
  await page.fill('#cFocus', 'produce a typed estimate');
  await page.fill('#cInstr', 'fill every field');
  await page.click('#varAdd');
  await page.locator('#varRows .rowedit').last().locator('[data-k="name"]').fill('appliance');
  await page.locator('#varRows .rowedit').last().locator('[data-k="description"]').fill('what broke');
  await page.click('#fieldAdd');
  await page.locator('#fieldRows .rowedit').last().locator('[data-k="name"]').fill('verdict');
  await page.click('#chkAdd');
  await page.locator('#chkRows .rowedit').last().locator('[data-k="kind"]').selectOption('not-empty');
  await page.locator('#chkRows .rowedit').last().locator('[data-k="field"]').fill('verdict');
  await page.click('#cSave');
  await page.waitForTimeout(700);
  const cmd = (await api('/api/personas')).commands.find((c) => c.name === CNAME);
  assert.ok(cmd, 'the command never reached the server');
  CREATED.commands.push(cmd.id);
  assert.equal(cmd.personaId, persona.id, 'the command lost its persona link — its system prompt would be empty');
  assert.deepEqual(cmd.variables.map((v) => v.name), ['appliance'], 'VARIABLES rows did not compile to parameters');
  assert.deepEqual(cmd.fields.map((f) => f.name), ['verdict'], 'TEMPLATE rows did not compile to fields');
  assert.equal(cmd.checkers.length, 1, 'the checker row was dropped — a guardrail that vanishes is worse than none');
  assert.ok(await page.locator('#cmdList .runcard', { hasText: CNAME }).count() > 0, 'the saved command is not listed');
  assert.match(await page.locator('#cmdList .runcard', { hasText: CNAME }).locator('.rstatus').textContent(), /1 vars · 1 fields · 1 checks/, 'the command card miscounts its own parts');
  const harnessOpts = await page.locator('#hCmd option').evaluateAll((els) => els.map((e) => e.textContent));
  assert.ok(harnessOpts.some((o) => o.includes(CNAME)), 'a saved command never reaches the harness picker');
});

await test('the harness renders every deterministic check with its evidence', async () => {
  const cmdId = (await api('/api/personas')).commands.find((c) => c.name === CNAME).id;
  await page.selectOption('#hCmd', cmdId);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#hVars [data-v="appliance"]').count(), 1, 'the harness did not build an input for the command variable');
  await page.fill('#hVars [data-v="appliance"]', 'dryer');
  const c = await capture('/api/harness/run', {
    engine: 'local', ms: 812, tokens: 240, passed: false, parsed: { verdict: 'replace belt' },
    results: [
      { tier: 2, check: 'not-empty(verdict)', ok: true },
      { tier: 2, check: 'range(qty 0..10)', ok: false, got: 41 },
    ],
    escalatePrompt: 'redo this properly',
  });
  try {
    await page.selectOption('#hEngine', 'local');
    await page.click('#hRun');
    await page.waitForTimeout(600);
    assert.equal(c.seen.length, 1, '▶ Run through harness did not post');
    assert.equal(c.seen[0].engine, 'local', 'the engine picker was not sent');
    assert.deepEqual(c.seen[0].vars, { appliance: 'dryer' }, 'the typed variable was not sent: ' + JSON.stringify(c.seen[0].vars));
    const checks = await page.locator('#hOut .check').evaluateAll((els) => els.map((e) => ({
      what: e.querySelector('.what').textContent, how: e.querySelector('.how').textContent, pass: e.classList.contains('pass'),
    })));
    assert.equal(checks.length, 3, `expected a verdict line + 2 checks, got ${checks.length} — a dropped check is a guardrail nobody sees`);
    assert.equal(checks.filter((x) => x.pass).length, 1, 'pass/fail is not rendered per check');
    assert.match(checks[2].how, /41/, 'a failing check must show the evidence it failed on: ' + checks[2].how);
    assert.match(await page.locator('#hOut pre').innerText(), /replace belt/, 'the parsed answer is not shown');
    const esc = page.locator('#hOut button', { hasText: 'Escalate' });
    assert.equal(await esc.count(), 1, 'a failed harness run offers no escalation to the fleet');
    const e = await capture('/api/harness/escalate', { id: 'esc-run-1' });
    try {
      await esc.click();
      await page.waitForTimeout(400);
      assert.equal(e.seen.length, 1, 'escalate did not post');
      assert.equal(e.seen[0].prompt, 'redo this properly', 'escalate sent the wrong prompt');
      assert.match(await page.locator('#chatlog .msg').last().innerText(), /esc-run-1/, 'escalation gave the user no run id to follow');
    } finally { await e.release(); }
  } finally { await c.release(); }
});

// ── 8. worker hierarchy (no browser coverage at all before this file) ─────
await test('Hierarchy: a job builds from real commands and real tiers, saves, and lists', async () => {
  await openPane('fp-hierarchy');
  await page.click('#jobNewBtn');
  assert.ok(await page.locator('#jobForm').isVisible(), '＋ new job did not open the form');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#linkRows .linkedit').count(), 1, 'a new job must start with one link row');
  const cmdOpts = await page.locator('#linkRows .linkedit [data-k="commandId"] option').evaluateAll((els) => els.map((e) => e.textContent));
  assert.ok(cmdOpts.length > 0, 'the link row offers NO commands — a job could never be built');
  assert.ok(cmdOpts.includes(CNAME), 'a command saved in the Builder does not reach the job builder');
  const tiers = await page.locator('#linkRows .linkedit [data-tier]').evaluateAll((els) => els.map((e) => e.dataset.tier));
  assert.ok(tiers.length >= 3 && tiers.includes('local') && tiers.includes('frontier'), 'the escalation ladder is not built from /api/hierarchy tiers: ' + tiers.join(','));

  await page.click('#linkAdd');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#linkRows .linkedit').count(), 2, '＋ link did not add a row');
  await page.locator('#linkRows .linkedit').last().locator('.linkdel').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#linkRows .linkedit').count(), 1, '✖ link did not remove the row');

  const title = 'spec job ' + Date.now();
  await page.fill('#jobTitle', title);
  await page.selectOption('#jobGate', 'each-link');
  await page.selectOption('#jobBudget', '100000');
  const cmdId = (await api('/api/personas')).commands.find((c) => c.name === CNAME).id;
  await page.locator('#linkRows .linkedit').first().locator('[data-k="commandId"]').selectOption(cmdId);
  await page.locator('#linkRows .linkedit').first().locator('[data-k="id"]').fill('extract');
  await page.locator('#linkRows .linkedit').first().locator('[data-k="inputsFrom"]').fill('job.input');
  await page.locator('#linkRows .linkedit').first().locator('[data-k="startTier"]').selectOption('local');
  await page.click('#jobSave');
  await page.waitForTimeout(700);
  const errs = await page.locator('#chatlog .msg.err').allTextContents();
  assert.ok(!await page.locator('#jobForm').isVisible(), 'the job form stayed open after save — last server error: ' + (errs.at(-1) ?? '(none)'));
  const job = (await api('/api/hierarchy')).jobs.find((j) => j.title === title);
  assert.ok(job, 'the job never reached the server');
  CREATED.jobs.push(job.id);
  assert.equal(job.humanGate, 'each-link', 'the human-gate policy was not saved — the gate is the whole point of the ladder');
  assert.equal(job.budget, 100000, 'the job budget was not saved');
  assert.equal(job.links[0].id, 'extract', 'the link id was not saved');
  assert.deepEqual(job.links[0].inputsFrom, ['job.input'], 'link inputs were not saved');
  const card = page.locator('#jobList .runcard', { hasText: title });
  await card.waitFor({ timeout: 4000 });
  assert.match(await card.locator('.rstatus').textContent(), /1 link · gate: each-link/, 'the job card misreports its own shape');
  assert.match(await card.locator('.rprompt').textContent(), new RegExp(CNAME), 'the job card does not name the command it will run');
  // ▶ run is asserted present + enabled only: it spends tokens and opens
  // blocking window.prompt() dialogs for every job variable.
  assert.ok(await card.locator('.jstart').isEnabled(), '▶ run is disabled — a saved job cannot be started');
  await card.locator('.jdel').click();
  await page.waitForTimeout(500);
  assert.ok(!(await api('/api/hierarchy')).jobs.some((j) => j.id === job.id), 'the job survived delete');
  CREATED.jobs.length = 0;
});

await test('Hierarchy: a new job\'s first link comes with a command already selected', async () => {
  // editJob(null) does `(jb?.links ?? [{}]).forEach(addLinkRow)`. The {} is
  // truthy, so addLinkRow takes the "restore a saved link" branch and assigns
  // commandId = '' to a <select> that has no empty option — selectedIndex goes
  // to -1 and the picker renders blank. Save then posts a link with no
  // commandId, upsertJob filters it out, and the user is told "a job needs at
  // least one link" while looking straight at one. Rows added with ＋ link do
  // not have this problem, which is what makes it a bug rather than a choice.
  await page.click('#jobNewBtn');
  await page.waitForTimeout(250);
  const first = await page.locator('#linkRows .linkedit [data-k="commandId"]').first().evaluate((el) => ({
    n: el.options.length, idx: el.selectedIndex, value: el.value,
  }));
  assert.ok(first.n > 0, 'the link row has no commands to choose from');
  assert.ok(first.idx >= 0 && first.value !== '',
    `a new job's link row shows a BLANK command picker (selectedIndex=${first.idx}) even though ${first.n} commands are loaded — saving it is rejected with "a job needs at least one link"`);
  await page.click('#jobCancel');
});

// ── 9. Build tab ──────────────────────────────────────────────────────────
await test('Build tab: the trigger is armed and tracks the Chat project', async () => {
  // #buildBtn is NEVER clicked here — it pushes build.start down the live
  // socket and starts a real ~10 minute Gradle build on the user's machine.
  // The project is switched on the Chat tab, which is where #projSel lives —
  // the Build tab is supposed to follow it.
  await page.click('nav button[data-s="s-chat"]');
  const opts0 = await page.locator('#projSel option').evaluateAll((els) => els.map((e) => e.value));
  assert.ok(opts0.length >= 2, 'need >=2 projects to prove the Build tab tracks the picker');
  const cur0 = await page.locator('#projSel').inputValue();
  const other0 = opts0.find((o) => o !== cur0);
  await page.selectOption('#projSel', other0);
  await page.waitForTimeout(200);
  await page.click('nav button[data-s="s-build"]');
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#s-build').evaluate((e) => e.classList.contains('active')), 'Build tab did not activate');
  const btn = page.locator('#buildBtn');
  assert.ok(await btn.isEnabled(), 'the Build button is disabled with no build running');
  const b = await btn.boundingBox();
  assert.ok(b.height >= 38 && b.x >= 0 && b.x + b.width <= 412.5, 'the Build button does not fit the 412px screen');
  assert.ok((await page.locator('#buildLog').textContent()).trim().length > 0, '#buildLog is blank — no explicit empty state');
  assert.ok((await page.locator('#apkCard').textContent()).trim().length > 0, '#apkCard is blank — no explicit empty state');
  assert.equal((await page.locator('#buildProj').textContent()).trim(), other0, 'the Build tab still names the OLD project — a build would surface the wrong app');
});

await test('Build tab: a build that streams and finishes surfaces an installable APK', async () => {
  // Driven by injected build.* frames: the real click is unsafe, but every line
  // below is the exact frame runBuild() emits.
  await page.evaluate(() => window.__inject({ t: 'build.start', proj: '/root/atlan', stamp: 'spec-stamp' }));
  await page.waitForTimeout(150);
  assert.ok(!await page.locator('#buildBtn').isEnabled(), 'the Build button stayed live during a build — a second tap would race the first');
  await page.evaluate(() => {
    for (const line of ['> Task :app:assembleDebug', 'BUILD SUCCESSFUL in 41s']) window.__inject({ t: 'build.log', line });
  });
  await page.waitForTimeout(150);
  const log = await page.locator('#buildLog').innerText();
  assert.match(log, /assembleDebug/, 'build log lines are not streaming into #buildLog');
  assert.match(log, /BUILD SUCCESSFUL/, 'the success line never reached the log');
  assert.ok(await page.locator('#buildLog .bl-ok').count() >= 1, 'success lines are not highlighted');
  await page.evaluate(() => window.__inject({
    t: 'build.done', name: 'atlan-spec-1.apk', mb: '12.4', secs: '41', stamp: 'spec-stamp', url: '/apk/atlan-spec-1.apk',
  }));
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#buildBtn').isEnabled(), 'the Build button never came back after build.done');
  const link = page.locator('#apkCard a[download]');
  assert.equal(await link.count(), 1, 'a finished build produced no install link — the APK is unreachable from the UI');
  assert.equal(await link.getAttribute('href'), '/apk/atlan-spec-1.apk', 'the install link points at the wrong file');
  assert.match(await page.locator('#apkCard').innerText(), /atlan-spec-1\.apk/, 'the APK card does not name the file');
  assert.match(await page.locator('#apkCard').innerText(), /spec-stamp/, 'the build stamp (the stale-cache dodge) is not shown');
  const lb = await link.boundingBox();
  assert.ok(lb.x + lb.width <= 412.5, 'the install link runs off the 412px screen');
});

await test('Build tab: a failed build re-arms the button and says why', async () => {
  await page.evaluate(() => window.__inject({ t: 'build.start', proj: '/root/atlan', stamp: 'spec-stamp-2' }));
  await page.waitForTimeout(150);
  assert.ok(!await page.locator('#buildBtn').isEnabled(), 'build.start did not disable the button');
  await page.evaluate(() => window.__inject({ t: 'build.err', msg: 'aapt2 shim missing — see Doctor' }));
  await page.waitForTimeout(200);
  assert.ok(await page.locator('#buildBtn').isEnabled(), 'a failed build left the Build button permanently dead — only a reload recovers it');
  assert.match(await page.locator('#buildLog').innerText(), /aapt2 shim missing/, 'the build error is not shown in the log');
});

// ── 10. the phone itself ──────────────────────────────────────────────────
await test('412px: the Fleet surface never scrolls sideways, in any pane', async () => {
  await page.click('nav button[data-s="s-fleet"]');
  await page.waitForTimeout(250);
  for (const p of ['fp-runs', 'fp-routines', 'fp-builder', 'fp-hierarchy']) {
    await openPane(p);
    const m = await page.evaluate((pane) => ({
      doc: document.documentElement.scrollWidth,
      screenScroll: document.getElementById('s-fleet').scrollWidth,
      screenClient: document.getElementById('s-fleet').clientWidth,
      paneScroll: document.getElementById(pane).scrollWidth,
      paneClient: document.getElementById(pane).clientWidth,
    }), p);
    assert.ok(m.doc <= 412, `${p}: the page scrolls sideways (${m.doc}px)`);
    assert.ok(m.screenScroll <= m.screenClient, `${p}: #s-fleet overflows (${m.screenScroll} > ${m.screenClient})`);
    assert.ok(m.paneScroll <= m.paneClient, `${p}: the pane overflows (${m.paneScroll} > ${m.paneClient}) — content is clipped, not scrollable`);
  }
  await openPane('fp-runs');
});

await test('412px: the nav bar survives the unseen-report badge', async () => {
  await page.click('nav button[data-s="s-chat"]');
  await page.evaluate(() => {
    const run = {
      id: 'x', prompt: 'p', profile: 'scout', cwd: '/root', model: 'claude-haiku-4-5-20251001',
      budget: 50000, tokens: 1000, cost: 0, status: 'done', denials: 0, resultText: 'ok', resumable: false, cacheRead: 0,
    };
    for (let i = 0; i < 12; i++) window.__inject({ t: 'fleet.done', run: { ...run, id: 'done-' + i } });
  });
  await page.waitForTimeout(300);
  // nav .lb is text-transform:uppercase — textContent is the untransformed label.
  const label = await page.locator('nav button[data-s="s-fleet"] .lb').textContent();
  assert.match(label, /Fleet \(12\)/, 'the Fleet tab did not count 12 unseen reports: ' + label);
  const m = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    const btns = [...nav.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { lb: b.querySelector('.lb').textContent, x: r.x, w: r.width, right: r.x + r.width };
    });
    return { scrollW: nav.scrollWidth, clientW: nav.clientWidth, btns, vw: window.innerWidth };
  });
  assert.ok(m.scrollW <= m.clientW, `the nav bar overflows with a badge (${m.scrollW} > ${m.clientW}) and .phone clips it — a tab becomes unreachable`);
  assert.ok(m.btns.at(-1).right <= m.vw + 0.5, `the last tab (${m.btns.at(-1).lb}) is pushed off screen at ${Math.round(m.btns.at(-1).right)}px`);
  for (const b of m.btns) {
    assert.ok(b.w >= 44, `nav tab "${b.lb}" shrank to ${Math.round(b.w)}px — below the 44px minimum tap target`);
  }
  await page.click('nav button[data-s="s-fleet"]');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('nav button[data-s="s-fleet"] .lb').textContent(), 'Fleet', 'opening Fleet did not clear the unseen badge');
});

await test('412px: every Builder row field is wide enough to read what you typed', async () => {
  // The VARIABLES/CHECKERS rows are the most-typed forms in the app. .rowedit is
  // display:flex with NO flex-wrap and min-width:0 on the children, so each extra
  // control steals width from the rest. 90px is not an arbitrary bar: it is what
  // the CHECKERS row in this same form already achieves (97-99px), and it leaves
  // ~72px of text at the row's 12.5px font — about nine characters of an
  // identifier like "unit_price".
  await openPane('fp-builder');
  await page.evaluate(() => { document.getElementById('dCommand').open = true; });
  await page.click('#varAdd');
  await page.click('#fieldAdd');
  await page.click('#chkAdd');
  await page.waitForTimeout(200);
  const rows = await page.evaluate(() => ['varRows', 'fieldRows', 'chkRows'].map((box) => {
    const row = document.getElementById(box).querySelector('.rowedit');
    return {
      box,
      overflow: row.scrollWidth > row.clientWidth,
      fields: [...row.querySelectorAll('input:not([type=checkbox]), select')].map((el) => ({
        k: el.dataset.k, w: Math.round(el.getBoundingClientRect().width),
      })),
    };
  }));
  const narrow = [];
  for (const r of rows) {
    assert.ok(!r.overflow, `${r.box}: the row is clipped — .screen is overflow-x:hidden, so the cut-off control cannot be reached`);
    assert.ok(r.fields.length > 0, `${r.box}: the row rendered no fields`);
    for (const f of r.fields) if (f.w < 90) narrow.push(`${r.box}.${f.k}=${f.w}px`);
  }
  await page.click('#varRows .rowedit .rowdel');
  await page.click('#fieldRows .rowedit .rowdel');
  await page.click('#chkRows .rowedit .rowdel');
  assert.equal(narrow.length, 0, 'Builder row fields are too narrow to type into on a 412px phone: ' + narrow.join(', '));
});

// ── 11. hygiene ───────────────────────────────────────────────────────────
await test('the suite left no routines, personas, commands or jobs behind', async () => {
  for (const id of CREATED.routines) await api('/api/routines/delete', { id });
  for (const id of CREATED.commands) await api('/api/commands/delete', { id });
  for (const id of CREATED.personas) await api('/api/personas/delete', { id });
  for (const id of CREATED.jobs) await api('/api/hierarchy/job/delete', { id });
  const { personas, commands } = await api('/api/personas');
  assert.ok(!personas.some((p) => p.name === PNAME), 'the spec persona is still on the server');
  assert.ok(!commands.some((c) => c.name === CNAME), 'the spec command is still on the server');
  assert.ok(!(await api('/api/routines')).routines.some((r) => r.name.startsWith('atlan-ui-fleet-spec')), 'a spec routine is still scheduled');
  assert.ok(!(await api('/api/hierarchy')).jobs.some((j) => j.title.startsWith('spec job')), 'a spec job is still stored');
});

await test('no uncaught page errors while driving Fleet + Build', async () => {
  assert.equal(consoleErrors.length, 0, 'page errors: ' + consoleErrors.join('; '));
});

await browser.close();
console.log('\nFLEET + BUILD UI SUITE');
for (const [s, n] of results) console.log(' ', s, n);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
