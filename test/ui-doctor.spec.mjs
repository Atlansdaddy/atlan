// Playwright E2E — Doctor · Scan · Preview · Term, driven at 412×900 (a phone).
//
// SCOPE: the four surfaces a user hits when something is wrong — the Doctor tab
// (checks, engine keys, local-model picker, voice picker, preflight gate,
// session controls), the Scan tab (SAST run, findings list, finding → editor),
// the Preview tab (url bar, load, console, snapshot) and the Term tab.
//
// SAFETY RULES THIS FILE OBEYS — it must be harmless even against a live cockpit:
//   • never POSTs /api/keys (that would overwrite a real engine key)
//   • never submits /api/auth/password (it revokes EVERY session, see index.js:110)
//   • never POSTs /api/local/models (that restarts llama-server)
//   • never sends pty.input (on a live box the Term shares the user's real
//     `atlan-main` tmux session — typing there is typing in their shell)
//   • never sends a chat message, spawns a fleet run, or saves an editor buffer
//   • the ONE piece of server state it touches is the preview target; it is read
//     first and restored at the end.
// Controls that cannot be fired safely are asserted for PRESENCE + ENABLED-STATE
// and the reason is stated inline.
//
// NOTE (test-suite footgun, carried over from ui.spec.mjs:9): BASE defaults to
// the LIVE cockpit on :4589, and the harness below sets/uses a known password.
// Run this with an explicit ATLAN_BASE pointing at a throwaway instance.
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
await page.goto(BASE);
await page.evaluate(async (pw) => {
  const s = await fetch('/api/auth/status').then((r) => r.json());
  const ep = s.configured ? '/api/auth/login' : '/api/auth/setup';
  await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
}, 'atlan-test-pw-8x');
await page.evaluate(() => localStorage.setItem('atlanTourDone', '1'));
await page.goto(BASE, { waitUntil: 'networkidle' });

// ── shared helpers ────────────────────────────────────────────────────────────
const SCREENS = ['s-doctor', 's-scan', 's-preview', 's-term'];
const SNAP_IDLE = '📸 Snapshot → Claude';

const netlog = [];
page.on('request', (r) => netlog.push(r.method() + ' ' + r.url()));
// Accept, don't dismiss: lib/editorguard.js confirms before discarding unsaved
// work, and tapping a scan finding MEANS to open that file. Dismissing would
// cancel the open and read as a bug that isn't there. The scan-finding test
// asserts the cockpit ASKED, not what was answered.
let lastDialog = null;
page.on('dialog', (d) => { lastDialog = d.message(); d.accept().catch(() => {}); });

async function tab(id) {
  await page.click(`nav button[data-s="${id}"]`);
  await page.waitForFunction((s) => document.getElementById(s)?.classList.contains('active'), id, { timeout: 5000 });
}

// The editor refuses Atlan's OWN repo (files.js:13 blockAppRoot), so a scan of
// the cockpit produces findings that cannot open. Split the project list on that
// exact behaviour instead of hardcoding a path — a fork moves the repo.
let projectSplit = null;
async function projects() {
  if (projectSplit) return projectSplit;
  projectSplit = await page.evaluate(async () => {
    const list = await fetch('/api/projects').then((r) => r.json());
    const out = { openable: [], refused: [] };
    for (const p of list) {
      const j = await fetch('/api/file?path=' + encodeURIComponent(p.path)).then((r) => r.json());
      // a directory that passes the guard reports "that is a folder"; the app
      // root is rejected earlier, by the blockAppRoot branch.
      if (/that is a folder/i.test(j.error || '')) out.openable.push(p.path);
      else if (/editable here/i.test(j.error || '')) out.refused.push(p.path);
    }
    return out;
  });
  return projectSplit;
}

// Runs a scan of `root` and waits for a rendered result (findings or the
// explicit clean empty-state). Read-only: /api/scan only reads files.
async function runScan(root) {
  await tab('s-scan');
  await page.waitForFunction(() => document.querySelectorAll('#scanProjSel option').length > 0, null, { timeout: 10000 });
  await page.selectOption('#scanProjSel', root);
  await page.click('#scanBtn');
  await page.waitForSelector('#scanList .scanrow, #scanList .hint', { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('scanBtn').disabled, null, { timeout: 120000 });
}
const rowLocs = () => page.locator('#scanList .scanrow .sloc').evaluateAll((els) => els.map((e) => e.textContent));

// Preview target is the only server state this suite writes; capture it now and
// put it back at the end so a live cockpit is left exactly as it was found.
const originalTarget = (await page.evaluate(() => fetch('/api/preview/target').then((r) => r.json()))).url;

// ══════════════════════════════════════════════════════════════════════════════
// DOCTOR
// ══════════════════════════════════════════════════════════════════════════════

await test('Doctor: every card renders REAL content, not an empty shell', async () => {
  await tab('s-doctor');
  await page.waitForSelector('#doctorList .check', { timeout: 10000 });
  await page.waitForSelector('#keysList .keyrow', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('#voiceProviderSel option').length > 0, null, { timeout: 10000 });
  const s = await page.evaluate(() => ({
    keyRows: document.querySelectorAll('#keysList .keyrow').length,
    keyInputsAllPassword: [...document.querySelectorAll('#keysList .keyrow input')].every((i) => i.type === 'password'),
    voiceOpts: document.getElementById('voiceProviderSel').options.length,
    voiceReady: [...document.getElementById('voiceProviderSel').options].filter((o) => !o.disabled).length,
    voiceNote: document.getElementById('voiceProviderNote').textContent.trim().length,
    tplOpts: document.getElementById('templateSel').options.length,
    checks: document.querySelectorAll('#doctorList .check').length,
    passing: document.querySelectorAll('#doctorList .check.pass').length,
    blankLabel: [...document.querySelectorAll('#doctorList .check')].filter((c) => !c.querySelector('.what').textContent.trim()).length,
    blankDetail: [...document.querySelectorAll('#doctorList .check')].filter((c) => !c.querySelector('.how').textContent.trim()).length,
  }));
  assert.ok(s.keyRows >= 8, `engine-key list nearly empty: ${s.keyRows} rows`);
  assert.ok(s.keyInputsAllPassword, 'an engine-key field is not type=password — keys would render in the clear');
  assert.ok(s.voiceOpts >= 3, `voice roster too short: ${s.voiceOpts}`);
  assert.ok(s.voiceReady >= 1, 'no voice provider is usable — the free browser voice must always be ready');
  assert.ok(s.voiceNote > 0, 'voice note is blank');
  assert.ok(s.tplOpts >= 2, `template picker has ${s.tplOpts} options`);
  assert.ok(s.checks >= 6, `expected >=6 doctor checks, got ${s.checks}`);
  assert.ok(s.passing >= 1, 'no doctor check passes — the list is decorative');
  assert.equal(s.blankLabel, 0, 'a doctor check rendered with no label');
  assert.equal(s.blankDetail, 0, 'a doctor check rendered with no detail — the "how" is the whole point');
});

await test('engine keys: grouped LLM vs voice, badge on the tin, collapse remembered', async () => {
  await tab('s-doctor');
  await page.waitForSelector('#keysList .keygroup', { timeout: 10000 });
  const s = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('#keysList details.keygroup')];
    return {
      count: groups.length,
      names: groups.map((g) => g.querySelector('.docgroup-name').textContent),
      open: groups.map((g) => g.open),
      badges: groups.map((g) => g.querySelector('.docgroup-badge').textContent),
      rowsPerGroup: groups.map((g) => g.querySelectorAll('.keyrow').length),
    };
  });
  assert.equal(s.count, 2, `expected exactly LLM + voice key groups, got ${s.count}`);
  assert.ok(/llm/i.test(s.names[0]) && /voice/i.test(s.names[1]), 'group order/names: ' + s.names.join(', '));
  assert.ok(s.open[0] === true && s.open[1] === false, 'LLM opens by default, voice starts closed');
  assert.ok(s.rowsPerGroup.every((n) => n >= 3), 'a key group rendered nearly empty: ' + s.rowsPerGroup.join('/'));
  assert.ok(s.badges.every((b) => /\d+ of \d+ set/.test(b)), 'badges must say how many are set: ' + s.badges.join(', '));
  // Collapse LLM, reload — the device must remember the choice.
  await page.evaluate(() => { document.querySelector('#keysList details.keygroup').open = false; });
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-doctor');
  await page.waitForSelector('#keysList .keygroup', { timeout: 10000 });
  const stillClosed = await page.evaluate(() => !document.querySelector('#keysList details.keygroup').open);
  assert.ok(stillClosed, 'a collapsed key group must stay collapsed across reload');
  // Put the default back so later tests (and the next human) find LLM open.
  await page.evaluate(() => { document.querySelector('#keysList details.keygroup').open = true; });
});

await test('permission gates: one row per provider, saved server-side, ask is claude-only', async () => {
  await tab('s-doctor');
  await page.waitForSelector('#gatesList .gaterow', { timeout: 10000 });
  const s = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#gatesList .gaterow')];
    return {
      providers: rows.map((r) => r.querySelector('.kname').textContent),
      askRows: rows.filter((r) => [...r.querySelector('select').options].some((o) => o.value === 'ask'))
        .map((r) => r.querySelector('.kname').textContent),
    };
  });
  assert.deepEqual(s.providers, ['claude', 'codex', 'grok', 'copilot', 'antigravity'], 'provider roster: ' + s.providers.join(','));
  assert.deepEqual(s.askRows, ['claude'], '"ask every time" only exists where a per-tool card exists to back it');
  // Save a default through the real API, reload, and see it come back.
  const before = await page.evaluate(() => fetch('/api/prefs').then((r) => r.json()).then((p) => p['gate.codex'] ?? ''));
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#gatesList .gaterow')].find((r) => r.querySelector('.kname').textContent === 'codex');
    const sel = row.querySelector('select');
    sel.value = 'verifier';
    sel.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-doctor');
  await page.waitForSelector('#gatesList .gaterow', { timeout: 10000 });
  const kept = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#gatesList .gaterow')].find((r) => r.querySelector('.kname').textContent === 'codex');
    return row.querySelector('select').value;
  });
  assert.equal(kept, 'verifier', 'a gate default must survive a reload — it lives server-side, not in this tab');
  // A garbage value must be refused by the server, not stored.
  const bad = await page.evaluate(() => fetch('/api/prefs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'gate.codex', value: 'yolo-unrestricted' }),
  }).then((r) => r.status));
  assert.equal(bad, 400, 'an off-roster gate value must 400, never persist');
  // Leave the store the way this test found it.
  await page.evaluate((v) => fetch('/api/prefs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'gate.codex', value: v }),
  }), before);
});

await test('doctor evidence: clamps to two lines, expands on tap, keyboard-reachable', async () => {
  await tab('s-doctor');
  await page.waitForSelector('#doctorList .check', { timeout: 10000 });
  const m = await page.evaluate(() => {
    // Synthetic long row driven through the real classes — deterministic on any
    // host, whatever this machine's live checks happen to say.
    const list = document.getElementById('doctorList');
    const div = document.createElement('div');
    div.className = 'check';
    div.innerHTML = '<span class="sig"></span><div><div class="what">synthetic</div><div class="how clamp"></div></div>';
    div.querySelector('.how').textContent = 'evidence '.repeat(80);
    list.append(div);
    const how = div.querySelector('.how');
    const clamped = how.clientHeight;
    how.classList.add('open');
    const expanded = how.clientHeight;
    div.remove();
    // And the renderer must mark every real clamped row keyboard-reachable.
    const real = [...document.querySelectorAll('#doctorList .how.clamp')];
    return { clamped, expanded, realButtons: real.every((h) => h.getAttribute('role') === 'button' && h.getAttribute('tabindex') === '0') };
  });
  assert.ok(m.clamped < m.expanded, `clamp must actually shorten the row: ${m.clamped} vs ${m.expanded}`);
  assert.ok(m.realButtons, 'a clamped evidence row is not reachable as a button');
});

await test('Doctor: "Run doctor again" really re-runs /api/doctor', async () => {
  // The audit found #doctorBtn is never clicked by any existing test, so a dead
  // listener would go unnoticed. Stub a DIFFERENT check set and prove the list
  // actually changes — presence of the button proves nothing.
  await tab('s-doctor');
  await page.waitForSelector('#doctorList .check', { timeout: 10000 });
  const before = await page.locator('#doctorList .check').count();
  await page.route('**/api/doctor', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ label: 'PROBE-RERUN-MARKER', detail: 'stubbed by ui-doctor.spec', ok: true }]),
  }));
  try {
    assert.ok(before !== 1, 'cannot distinguish a re-run from the initial render on this host');
    await page.click('#doctorBtn');
    await page.waitForFunction(() => /PROBE-RERUN-MARKER/.test(document.getElementById('doctorList').textContent), null, { timeout: 8000 });
    const after = await page.evaluate(() => ({
      n: document.querySelectorAll('#doctorList .check').length,
      detail: document.querySelector('#doctorList .check .how')?.textContent ?? '',
    }));
    assert.equal(after.n, 1, `#doctorBtn re-rendered ${after.n} checks — it did not re-fetch /api/doctor`);
    assert.match(after.detail, /stubbed by ui-doctor/, 'the re-run rendered stale detail text');
  } finally { await page.unroute('**/api/doctor'); }
});

await test('Preflight: the rendered gate matches what /api/preflight actually returned', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-doctor');
  await page.waitForSelector('#preflightList .check', { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('preflightVerdict').textContent.trim().length > 0, null, { timeout: 8000 });
  const s = await page.evaluate(async () => {
    const api = await fetch('/api/preflight').then((r) => r.json());
    return {
      apiChecks: api.checks.length, apiPass: api.checks.filter((c) => c.ok).length, apiReady: api.ready,
      uiChecks: document.querySelectorAll('#preflightList .check').length,
      uiPass: document.querySelectorAll('#preflightList .check.pass').length,
      verdict: document.getElementById('preflightVerdict').textContent,
    };
  });
  assert.ok(s.apiChecks > 0, 'preflight endpoint returned no checks at all');
  assert.equal(s.uiChecks, s.apiChecks, 'the gate on screen has a different number of checks than the API returned');
  assert.equal(s.uiPass, s.apiPass, 'green rows on screen do not match the checks the API marked ok');
  // The verdict is a security statement — it must agree with `ready`, not just be text.
  if (s.apiReady) assert.match(s.verdict, /safe to consider/i, 'API says ready but the verdict does not');
  else assert.match(s.verdict, /blocker/i, `API reports blockers but the verdict reads: ${s.verdict}`);
});

await test('Preflight: a FAILED re-run must not leave the previous verdict on screen', async () => {
  // A security gate that keeps showing green after its check failed is worse
  // than one that shows nothing. loadDoctor() gets this right (app.js:1431);
  // loadPreflight() ends in a bare `.catch(() => {})` at app.js:1451.
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-doctor');
  await page.waitForSelector('#preflightList .check', { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('preflightVerdict').textContent.trim().length > 0, null, { timeout: 8000 });
  const before = await page.locator('#preflightVerdict').innerText();
  await page.route('**/api/preflight', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"preflight unavailable"}' }));
  try {
    await page.click('#doctorBtn');
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({
      verdict: document.getElementById('preflightVerdict').textContent.trim(),
      checks: document.querySelectorAll('#preflightList .check').length,
    }));
    assert.notEqual(after.verdict, before.trim(),
      `preflight failed but the old verdict is still displayed: "${after.verdict}" (and ${after.checks} check rows remain)`);
    assert.ok(after.verdict.length > 0, 'verdict went blank — the user needs to be told the gate could not run');
  } finally { await page.unroute('**/api/preflight'); }
});

await test('Doctor: the local-brain card is all-or-nothing', async () => {
  // Half a card is a broken button. app.js:1253-1254 promises the card stays
  // hidden where the node does not manage llama-server. Both directions asserted
  // with a stubbed roster so the result is the same on a phone and a home node.
  const readCard = () => page.evaluate(() => {
    const vis = (id) => document.getElementById(id).getClientRects().length > 0;
    return {
      head: vis('lmHead'), bar: vis('lmBar'), sel: vis('lmSel'), apply: vis('lmApply'), note: vis('lmNote'),
      opts: document.getElementById('lmSel').options.length,
      applyEnabled: !document.getElementById('lmApply').disabled,
      noteText: document.getElementById('lmNote').textContent.trim().length,
    };
  });

  // (a) host manages local models → the whole card is there and usable
  await page.route('**/api/local/models', (r) => r.request().method() === 'GET'
    ? r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ supported: true, active: 'probe-a.gguf', models: [{ name: 'probe-a.gguf', gb: 1.1, args: '', active: true }, { name: 'probe-b.gguf', gb: 2.2, args: '', active: false }] }),
    })
    : r.abort()); // never let a real POST through — it restarts llama-server
  try {
    await page.reload({ waitUntil: 'networkidle' });
    await tab('s-doctor');
    await page.waitForFunction(() => document.querySelectorAll('#lmSel option').length > 0, null, { timeout: 8000 });
    const on = await readCard();
    assert.ok(on.head && on.bar && on.sel && on.apply && on.note, `supported:true but part of the card is hidden: ${JSON.stringify(on)}`);
    assert.ok(on.opts >= 2, 'model picker rendered empty while the host reported models');
    assert.ok(on.applyEnabled, 'Swap is disabled with a model selected');
    assert.ok(on.noteText > 0, 'the "swapping restarts llama-server" warning is missing');
  } finally { await page.unroute('**/api/local/models'); }

  // (b) host does not manage local models → NOTHING of the card may render
  await page.route('**/api/local/models', (r) => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supported: false }) })
    : r.abort());
  try {
    await page.reload({ waitUntil: 'networkidle' });
    await tab('s-doctor');
    await page.waitForTimeout(1500);
    const off = await readCard();
    assert.ok(!off.bar && !off.sel && !off.apply,
      `supported:false but the picker still renders (bar=${off.bar} sel=${off.sel} swap=${off.apply}) — an unlabeled empty select plus a Swap button that silently no-ops`);
    assert.ok(!off.head && !off.note, 'heading/note visible with no card behind them');
  } finally { await page.unroute('**/api/local/models'); }
});

await test('Doctor: unfireable controls are present, enabled and honest', async () => {
  // Deliberately NOT exercised: POST /api/keys would overwrite a real engine key
  // and #pwSave revokes every session (index.js:110). Presence + enabled-state
  // + safety properties only. The change-password TOGGLE is safe, so it is real.
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-doctor');
  await page.waitForSelector('#keysList .keyrow', { timeout: 10000 });
  const s = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#keysList .keyrow')];
    const links = [...document.querySelectorAll('#keysList a.khelp')];
    const f = document.getElementById('pwForm');
    const shown = () => getComputedStyle(f).display !== 'none';
    const closed0 = shown();
    document.getElementById('changePwBtn').click();
    const opened = shown();
    document.getElementById('changePwBtn').click();
    const closed1 = shown();
    const tpl = document.getElementById('templateSel');
    const tplWas = tpl.value;
    const alt = [...tpl.options].map((o) => o.value).find((v) => v && v !== tplWas);
    tpl.value = alt; tpl.dispatchEvent(new Event('change'));
    const applied = document.documentElement.getAttribute('data-template');
    tpl.value = tplWas; tpl.dispatchEvent(new Event('change'));
    return {
      rows: rows.length,
      allHaveSave: rows.every((r) => /save/i.test(r.querySelector('button')?.textContent ?? '')),
      allSaveEnabled: rows.every((r) => !r.querySelector('button').disabled),
      links: links.length,
      linksHttps: links.every((a) => a.href.startsWith('https://')),
      linksNoopener: links.every((a) => (a.rel || '').includes('noopener')),
      closed0, opened, closed1,
      pwTypes: ['pwCurrent', 'pwNext'].map((i) => document.getElementById(i).type),
      pwEmpty: ['pwCurrent', 'pwNext'].every((i) => document.getElementById(i).value === ''),
      pwSaveEnabled: !document.getElementById('pwSave').disabled,
      logoutEnabled: !document.getElementById('logoutBtn').disabled,
      alt, applied, reverted: document.documentElement.getAttribute('data-template'),
    };
  });
  assert.ok(s.rows >= 8 && s.allHaveSave && s.allSaveEnabled, 'engine-key rows are missing a working Save');
  assert.equal(s.links, s.rows, 'every key row must carry its own "how to get" link — a key you cannot obtain is a dead field');
  assert.ok(s.linksHttps, 'a "how to get" link is not https');
  assert.ok(s.linksNoopener, 'a "how to get" link opens in a new tab without rel=noopener');
  assert.equal(s.closed0, false, 'password form should start closed');
  assert.equal(s.opened, true, '#changePwBtn did not open #pwForm');
  assert.equal(s.closed1, false, '#changePwBtn did not close #pwForm again');
  assert.deepEqual(s.pwTypes, ['password', 'password'], 'a password field is not masked');
  assert.ok(s.pwEmpty, 'password fields are pre-filled');
  assert.ok(s.pwSaveEnabled && s.logoutEnabled, 'session controls are disabled');
  assert.ok(s.alt, 'template picker offers no alternative skin');
  assert.equal(s.applied, s.alt, 'picking a template did not apply it to the document');
  assert.ok(!s.reverted, 'template did not revert to Atlan Classic');
});

await test('Doctor: log out really ends the session', async () => {
  // Runs in a THROWAWAY browser context so the suite's own session survives.
  // dropSession() only kills this cookie (auth.js:87), never the user's others.
  const c2 = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const p2 = await c2.newPage();
  try {
    await p2.goto(BASE);
    const loggedIn = await p2.evaluate(async (pw) => {
      const s = await fetch('/api/auth/status').then((r) => r.json());
      const ep = s.configured ? '/api/auth/login' : '/api/auth/setup';
      return (await fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) })).ok;
    }, 'atlan-test-pw-8x');
    assert.ok(loggedIn, 'could not establish a second session to log out of');
    await p2.evaluate(() => localStorage.setItem('atlanTourDone', '1'));
    await p2.goto(BASE, { waitUntil: 'networkidle' });
    assert.equal(await p2.evaluate(() => fetch('/api/keys').then((r) => r.status)), 200, 'second context was not authed to begin with');
    await p2.click('nav button[data-s="s-doctor"]');
    await p2.click('#logoutBtn');
    await p2.waitForFunction(() => document.getElementById('authOverlay')?.getClientRects().length > 0, null, { timeout: 8000 });
    assert.equal(await p2.evaluate(() => fetch('/api/keys').then((r) => r.status)), 401,
      'logout reloaded the page but the session cookie still opens /api/keys');
  } finally { await c2.close(); }
  // and the suite's own session is untouched
  assert.equal(await page.evaluate(() => fetch('/api/keys').then((r) => r.status)), 200,
    'logging out of one session killed another one');
});

// ══════════════════════════════════════════════════════════════════════════════
// SCAN
// ══════════════════════════════════════════════════════════════════════════════

await test('Scan: the picker resolves to a real, selectable project', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-scan');
  await page.waitForFunction(() => document.querySelectorAll('#scanProjSel option').length > 0, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => {
    const sel = document.getElementById('scanProjSel');
    return { value: sel.value, idx: sel.selectedIndex, opts: [...sel.options].map((o) => o.value) };
  });
  assert.ok(s.opts.length > 0, '/api/projects returned nothing — no project can be scanned');
  assert.ok(s.idx >= 0, `#scanProjSel has selectedIndex ${s.idx} — it renders blank (app.js:1462 assigns $('projSel').value, and the hardcoded "/root" option at index.html:64 is never in this list)`);
  assert.ok(s.opts.includes(s.value), `#scanProjSel value "${s.value}" is not one of its own options`);
});

await test('Scan: Run scan works from a cold load with no manual selection', async () => {
  // The single highest-value path on this surface: open Scan, tap the primary
  // CTA. Asserting the REQUEST is what makes this non-vacuous — the button is
  // present and enabled today and still does absolutely nothing.
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-scan');
  await page.waitForFunction(() => document.querySelectorAll('#scanProjSel option').length > 0, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const mark = netlog.length;
  const fired = () => netlog.slice(mark).filter((u) => u.includes('/api/scan')).length;
  await page.click('#scanBtn');
  const t0 = Date.now();
  while (!fired() && Date.now() - t0 < 6000) await page.waitForTimeout(200);
  assert.ok(fired() > 0, 'clicking Run scan issued ZERO /api/scan requests — silent no-op, no error, no feedback');
  await page.waitForSelector('#scanList .scanrow, #scanList .hint', { timeout: 120000 });
  const n = await page.evaluate(() => ({
    rows: document.querySelectorAll('#scanList .scanrow').length,
    clean: /clean — no findings/.test(document.getElementById('scanList').textContent),
  }));
  assert.ok(n.rows > 0 || n.clean, 'scan finished but rendered neither findings nor an explicit clean state');
});

await test('Scan: an explicit run produces an honest, populated surface', async () => {
  const { openable } = await projects();
  assert.ok(openable.length > 0, 'no scannable project on this host — cannot verify the scan surface');
  await runScan(openable[0]);
  const s = await page.evaluate(() => ({
    rows: document.querySelectorAll('#scanList .scanrow').length,
    clean: /clean — no findings/.test(document.getElementById('scanList').textContent),
    axes: [...document.querySelectorAll('#scanMeta .axis')].map((c) => c.textContent),
    sub: document.querySelector('#scanMeta .axissub')?.textContent ?? '',
    badges: [...document.querySelectorAll('#scanList .scanrow .sbadge')].map((b) => b.textContent),
    locs: [...document.querySelectorAll('#scanList .scanrow .sloc')].map((b) => b.textContent),
  }));
  assert.ok(s.rows > 0 || s.clean, 'neither findings nor the explicit clean empty-state rendered');
  assert.equal(s.axes.length, 4, `expected the four axes (Security/Health/A11y/Reach), got ${s.axes.length}: ${s.axes.join(', ')}`);
  for (const want of ['Security', 'Health', 'A11y', 'Reach']) {
    assert.ok(s.axes.some((a) => a.includes(want)), `missing the ${want} axis`);
  }
  assert.match(s.sub, /\d+ files/, `scan meta never says how many files it looked at: "${s.sub}"`);
  if (s.rows) {
    assert.ok(s.badges.every((b) => /^(critical|high|medium|low|info)$/.test(b.trim())), 'a finding row has no severity badge');
    assert.ok(s.locs.every((l) => /\S+:(\d+|\?)$/.test(l.trim())), 'a finding row has no file:line');
  }
});

await test('Scan: tapping a finding opens the right file at the right line', async () => {
  const { openable } = await projects();
  assert.ok(openable.length > 0, 'no scannable project on this host');
  const root = openable[0];
  await runScan(root);
  const locs = await rowLocs();
  const i = locs.findIndex((l) => /:\d+$/.test(l.trim()));
  assert.ok(i >= 0, 'no finding carries a real line number to navigate to');
  const [relFile, line] = locs[i].trim().split(/:(?=\d+$)/);
  await page.locator('#scanList .scanrow').nth(i).click();
  await page.waitForFunction(() => document.getElementById('s-editor').classList.contains('active'), null, { timeout: 8000 });
  await page.waitForFunction((p) => document.getElementById('edPath').value === p, `${root}/${relFile}`, { timeout: 10000 });
  const s = await page.evaluate(() => ({
    name: document.getElementById('edName').textContent,
    path: document.getElementById('edPath').value,
    cursor: document.querySelector('.CodeMirror')?.CodeMirror?.getCursor?.().line,
    chars: document.querySelector('.CodeMirror')?.CodeMirror?.getValue?.().length ?? 0,
  }));
  assert.equal(s.path, `${root}/${relFile}`, 'opened the wrong path');
  assert.equal(s.name, relFile.split('/').pop(), 'editor header names a different file');
  assert.ok(s.chars > 0, 'the editor opened an EMPTY buffer — the file never loaded');
  assert.equal(s.cursor, Number(line) - 1, `cursor landed on line ${s.cursor + 1}, finding is at ${line}`);
});

await test('Scan: tapping a finding never destroys unsaved editor work', async () => {
  // Data loss. openScanFinding (app.js:1520) does setValue() with no check of the
  // dirty flag app.js:768 maintains, and resets #edDirty at 1521 — erasing the
  // only evidence that anything was lost. A finding row is a NAVIGATION gesture,
  // so unlike Open there is no moment where the user chose to discard.
  const { openable } = await projects();
  assert.ok(openable.length > 0, 'no scannable project on this host');
  const root = openable[0];
  await runScan(root);
  const locs = await rowLocs();
  const i = locs.findIndex((l) => /:\d+$/.test(l.trim()));
  assert.ok(i >= 0, 'no navigable finding');
  const fileA = locs[i].trim().split(':')[0];
  await page.locator('#scanList .scanrow').nth(i).click();
  await page.waitForFunction((p) => document.getElementById('edPath').value === p, `${root}/${fileA}`, { timeout: 10000 });

  // dirty the buffer (never saved — no file is written)
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue(cm.getValue() + '\n// ATLAN-SPEC-UNSAVED-MARKER\n');
  });
  await page.waitForFunction(() => document.getElementById('edDirty').textContent.includes('unsaved'), null, { timeout: 5000 });

  const j = locs.findIndex((l) => l.trim().split(':')[0] !== fileA);
  assert.ok(j >= 0, 'scan produced findings in only one file — cannot test the clobber path');
  lastDialog = null;
  await tab('s-scan');
  await page.locator('#scanList .scanrow').nth(j).click();
  await page.waitForTimeout(2000);
  const survived = await page.evaluate(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('ATLAN-SPEC-UNSAVED-MARKER'));
  assert.ok(lastDialog !== null || survived,
    'unsaved edits were silently discarded by tapping a scan finding — no confirmation, and #edDirty was reset so nothing on screen shows work was lost');
});

await test('Scan: a finding that cannot be opened must say so ON SCREEN', async () => {
  // Real trigger, proven on this host: findings inside Atlan's OWN repo are
  // refused by files.js:13 (blockAppRoot) with "Atlan's own files aren't editable
  // here". openScanFinding switches to the Editor tab first (app.js:1516) and
  // then reports the failure with addMsg('err', …) — which writes to #chatlog,
  // on a screen the user is no longer looking at. Result: a blank Editor and no
  // explanation. Stubbed here so the assertion holds on any host.
  const { openable } = await projects();
  assert.ok(openable.length > 0, 'no scannable project on this host');
  await runScan(openable[0]);
  assert.ok(await page.locator('#scanList .scanrow').count() > 0, 'no findings to tap');
  await page.route('**/api/file*', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ error: 'PROBE-REFUSED: that path is not editable here' }),
  }));
  try {
    await page.locator('#scanList .scanrow').first().click();
    await page.waitForTimeout(2000);
    const s = await page.evaluate(() => {
      const active = document.querySelector('.screen.active');
      return { screen: active?.id, visibleText: active?.innerText ?? '', edName: document.getElementById('edName').textContent };
    });
    assert.ok(/PROBE-REFUSED/.test(s.visibleText),
      `the file could not be opened and the reason never reached the screen the user is on (#${s.screen}); it shows "${s.edName}"`);
  } finally { await page.unroute('**/api/file*'); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PREVIEW
// ══════════════════════════════════════════════════════════════════════════════

await test('Preview: a refused URL is reported in the console, and clear empties it', async () => {
  // The console strip is the only feedback channel the Preview tab has.
  // NOTE: #consoleClear is client-only — no `preview.clear` frame exists in
  // index.js, so up to 50 errors stay queued server-side (index.js:503) after
  // the UI says the strip is empty. Proving that desync needs a chat turn
  // against a real engine, which this suite must not spend, so it is documented
  // rather than asserted.
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-preview');
  await page.fill('#previewUrl', 'http://evil.example.com');
  await page.click('#previewGo');
  await page.waitForSelector('#previewConsole .cl.error', { timeout: 8000 });
  const msg = await page.locator('#previewConsole .cl.error').first().innerText();
  assert.ok(msg.replace(/[\d:]/g, '').trim().length > 0, 'error row rendered with no message');
  await page.click('#consoleClear');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    lines: document.querySelectorAll('#previewConsole .cl').length,
    seen: document.getElementById('seenLine').textContent.trim(),
  }));
  assert.equal(after.lines, 0, 'clear left console rows behind');
  assert.equal(after.seen, '', 'clear left a stale "queued for Claude" line');
});

await test('Preview: the URL bar must not misreport what the server stored', async () => {
  // index.js:354 stores only u.origin; the client ignores the returned j.url
  // (app.js:858-860). So the bar keeps showing a path the proxy is not serving.
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-preview');
  await page.fill('#previewUrl', 'http://127.0.0.1:5173/dashboard?tab=1');
  await page.click('#previewGo');
  await page.waitForTimeout(1500);
  const s = await page.evaluate(async () => ({
    bar: document.getElementById('previewUrl').value,
    stored: (await fetch('/api/preview/target').then((r) => r.json())).url,
  }));
  assert.equal(s.bar, s.stored, `the bar says "${s.bar}" but the proxy is serving "${s.stored}"`);
});

await test('Preview: the target survives a reload', async () => {
  // GET /api/preview/target exists (index.js:331) and is never called by the
  // client, so a reload gives a blank pane plus the hardcoded default URL from
  // index.html:99 regardless of what is actually configured.
  await tab('s-preview');
  await page.fill('#previewUrl', 'http://127.0.0.1:5199');
  await page.click('#previewGo');
  await page.waitForFunction(() => !!document.getElementById('previewFrame').getAttribute('src'), null, { timeout: 8000 });
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-preview');
  await page.waitForTimeout(1000);
  const s = await page.evaluate(async () => ({
    bar: document.getElementById('previewUrl').value,
    src: document.getElementById('previewFrame').getAttribute('src'),
    stored: (await fetch('/api/preview/target').then((r) => r.json())).url,
  }));
  assert.equal(s.bar, s.stored, `after a reload the bar shows "${s.bar}" while the stored target is "${s.stored}"`);
  assert.ok(s.src, 'after a reload the preview pane is blank — the stored target was never re-loaded');
});

await test('Preview: Snapshot never leaves the button stuck', async () => {
  // With nothing loaded the guard at app.js:902 never fires (an src-less iframe
  // still has a live about:blank contentWindow), the postMessage is dropped on
  // the origin check, no preview.snap goes out, and case 'preview.snapped'
  // (app.js:297) — the ONLY thing that restores the label — never arrives.
  await page.reload({ waitUntil: 'networkidle' });
  await tab('s-preview');
  const src = await page.locator('#previewFrame').getAttribute('src');
  assert.ok(!src, 'expected a fresh page to have no preview loaded');
  assert.equal((await page.locator('#snapBtn').innerText()).trim(), SNAP_IDLE, 'snapshot button did not start idle');
  await page.click('#snapBtn');
  await page.waitForTimeout(3500);
  const s = await page.evaluate(() => ({
    label: document.getElementById('snapBtn').textContent.trim(),
    lines: document.querySelectorAll('#previewConsole .cl').length,
  }));
  assert.equal(s.label, SNAP_IDLE, `snapshot button is stuck at "${s.label}" with nothing loaded — it never resets`);
  assert.ok(s.lines >= 1, 'snapshot failed with no explanation in the console strip');
});

// ══════════════════════════════════════════════════════════════════════════════
// TERM
// ══════════════════════════════════════════════════════════════════════════════

await test('Term: xterm mounts, wires up the pty, and renders what the pty sends', async () => {
  // Read-only on purpose: pty.open attaches to tmux session `atlan-main`, which
  // on a live box is the user's own shell — this suite NEVER sends pty.input.
  //
  // The round trip is forced with a viewport change (rotating the phone), which
  // is what the app already does on every `resize` (app.js:748 → fit() →
  // pty.resize) and makes tmux redraw the pane. That is deliberate: measured on
  // this host, opening Term against an ALREADY-RUNNING pty session renders a
  // BLANK terminal — pty.js:33 reuses the session and nothing is replayed for
  // the new subscriber, so 0 `pty.data` frames arrive until something changes.
  // Waiting for spontaneous bytes would therefore be green on a fresh server and
  // red on a warm one; a test must never depend on how it measures.
  const frames = { data: 0, sent: [] };
  const onWs = (ws) => {
    ws.on('framesent', (f) => { try { frames.sent.push(JSON.parse(f.payload).t); } catch { /* binary */ } });
    ws.on('framereceived', (f) => { try { if (JSON.parse(f.payload).t === 'pty.data') frames.data++; } catch { /* binary */ } });
  };
  page.on('websocket', onWs);
  try {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('connDot')?.classList.contains('on'), null, { timeout: 8000 });
    await tab('s-term');
    await page.waitForSelector('.xterm-rows', { timeout: 10000 });
    const mount = await page.evaluate(() => {
      const box = document.getElementById('term').getBoundingClientRect();
      return {
        screen: !!document.querySelector('.xterm-screen'),
        rows: document.querySelector('.xterm-rows').children.length,
        w: Math.round(box.width), h: Math.round(box.height),
      };
    });
    assert.ok(mount.screen, 'no .xterm-screen — the terminal never mounted');
    assert.ok(mount.rows > 10, `xterm mounted with only ${mount.rows} rows — fit() did not size it to the phone`);
    assert.ok(mount.w > 300 && mount.h > 200, `terminal box collapsed at 412px: ${mount.w}x${mount.h}`);
    assert.ok(frames.sent.includes('pty.open'), 'opening the Term tab never sent pty.open — the terminal is not wired to a shell');
    assert.ok(frames.sent.includes('pty.resize'), 'the terminal never told the pty what size the phone is');

    // rotate → tmux redraws → bytes must arrive AND be painted
    await page.setViewportSize({ width: 380, height: 800 });
    await page.waitForFunction(() => {
      const r = document.querySelector('.xterm-rows');
      return r && [...r.children].map((x) => x.textContent).join('').trim().length > 0;
    }, null, { timeout: 20000 });
    const painted = await page.evaluate(() => [...document.querySelector('.xterm-rows').children].map((x) => x.textContent).join('').trim().length);
    assert.ok(frames.data > 0, 'the pty sent no data over the WS — the terminal channel is dead');
    assert.ok(painted > 0, `pty.data arrived (${frames.data} frames) but xterm painted nothing`);
  } finally {
    page.off('websocket', onWs);
    await page.setViewportSize({ width: 412, height: 900 });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 412px — this product is phone-FIRST
// ══════════════════════════════════════════════════════════════════════════════

await test('412px: all eight nav tabs are reachable, unclipped and tappable', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  const s = await page.evaluate(() => {
    const nav = document.querySelector('nav');
    const vw = document.documentElement.clientWidth;
    return {
      vw, sw: nav.scrollWidth, cw: nav.clientWidth,
      btns: [...nav.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect(); const lb = b.querySelector('.lb');
        return {
          s: b.dataset.s, label: lb?.textContent ?? '',
          left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height),
          clipped: !!lb && lb.scrollWidth > lb.clientWidth + 1,
        };
      }),
    };
  });
  assert.equal(s.vw, 412, `viewport is ${s.vw}px, this suite must run at 412`);
  assert.equal(s.btns.length, 8, `expected 8 nav tabs, got ${s.btns.length}`);
  assert.ok(s.sw <= s.cw + 1, `the tab bar scrolls horizontally at 412px (${s.sw} > ${s.cw}) — tabs are unreachable`);
  for (const b of s.btns) {
    assert.ok(b.left >= -1 && b.right <= s.vw + 1, `tab "${b.label}" sits outside the viewport (${b.left}..${b.right})`);
    assert.ok(!b.clipped, `tab label "${b.label}" is clipped`);
    assert.ok(b.h >= 44 && b.w >= 40, `tab "${b.label}" is a ${b.w}x${b.h} tap target — below the 44px minimum`);
  }
  // every audited surface must be one tap away
  for (const id of SCREENS) assert.ok(s.btns.some((b) => b.s === id), `no nav button reaches #${id}`);
});

await test('412px: no audited surface scrolls horizontally or pushes a control off-screen', async () => {
  const bad = [];
  for (const id of SCREENS) {
    await tab(id);
    await page.waitForTimeout(1800); // let loaders + xterm fit settle
    const r = await page.evaluate((sid) => {
      const el = document.getElementById(sid);
      const vw = document.documentElement.clientWidth;
      const off = [];
      for (const e of el.querySelectorAll('button, select, input, a, .check, .keyrow, .scanrow, iframe')) {
        if (!e.getClientRects().length) continue;
        const b = e.getBoundingClientRect();
        if (b.right > vw + 1) off.push(`${e.tagName}#${e.id || e.className}`.slice(0, 40) + `@${Math.round(b.right)}`);
      }
      return { sw: el.scrollWidth, cw: el.clientWidth, docSw: document.documentElement.scrollWidth, vw, off };
    }, id);
    if (r.sw > r.cw + 1) bad.push(`#${id} scrolls horizontally (${r.sw} > ${r.cw})`);
    if (r.docSw > r.vw + 1) bad.push(`#${id} makes the PAGE scroll horizontally (${r.docSw} > ${r.vw})`);
    if (r.off.length) bad.push(`#${id} pushes controls off-screen: ${r.off.join(', ')}`);
  }
  assert.equal(bad.length, 0, bad.join(' | '));
});

await test('no uncaught page errors across the whole run', async () => {
  assert.equal(consoleErrors.length, 0, 'page errors: ' + consoleErrors.join('; '));
});

// ── restore the one piece of server state this suite writes ───────────────────
await page.evaluate((u) => fetch('/api/preview/target', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: u }),
}), originalTarget);

await browser.close();
console.log('\nPLAYWRIGHT DOCTOR · SCAN · PREVIEW · TERM SUITE');
for (const [s, n] of results) console.log(' ', s, n);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
