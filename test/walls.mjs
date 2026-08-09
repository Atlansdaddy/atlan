// THE WALLS, EXERCISED — every guarantee in this file is asserted by BEHAVIOUR.
//
// Why this suite exists. A mutation pass over the existing suites found that the
// controls SECURITY.md lists as "verified present in code" were, in several
// cases, verified only by GREPPING THE SOURCE for a phrase. Neutering the daily
// token cap (`>= DAILY_TOKEN_CAP` → `>= Infinity`), the concurrency cap, the
// budget clamp, the in-flight reservation, scout's canUseTool check, the
// preview proxy's WebSocket-upgrade gate, atomicWrite's 0600 and its
// temp+rename, the failed-login throttle, session revocation on password
// change, the session store's freedom from replayable tokens, and
// scrubbedEnv's explicit DROP list — every one of those left the whole gate
// green. A test that checks the code LOOKS a certain way cannot tell a live
// wall from a dead branch, and it is exactly the refactor-and-bad-merge case it
// was written for that it fails to catch.
//
// So: no readFileSync of a server module anywhere in this file. Every test here
// makes the thing happen and looks at what came back.
//
// SELF-CONTAINED. It boots its OWN server with its OWN state dir, because it
// changes the password and restarts the process — neither of which a suite may
// do to the shared harness.
import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const REPO = new URL('..', import.meta.url).pathname;
let pass = 0, fail = 0;
const test = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
};

console.log('WALLS — behavioural, never source-text\n');

// ── a throwaway cockpit of our own ────────────────────────────────────────
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const STATE = mkdtempSync(join(tmpdir(), 'atlan-walls-'));
const PROJECTS = join(STATE, 'projects');
const PROJ = join(PROJECTS, 'proj');
const OUTSIDE = join(STATE, 'outside');
mkdirSync(PROJ, { recursive: true });
mkdirSync(OUTSIDE, { recursive: true });
writeFileSync(join(PROJ, 'app.js'), 'console.log(1)\n');
writeFileSync(join(PROJ, '.env'), 'DATABASE_URL=postgres://u:p@db.internal:5432/app\n');
writeFileSync(join(OUTSIDE, '.env'), 'OPENAI_API_KEY=sk-NOTREAL0000000000000000\n');
symlinkSync(OUTSIDE, join(PROJ, 'escape'), 'dir');

const PORT = await freePort();
const PREVIEW_PORT = await freePort();
const TOKEN = 'walls-' + randomBytes(16).toString('hex');
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const childEnv = {
  ...process.env,
  ATLAN_PORT: String(PORT), ATLAN_PREVIEW_PORT: String(PREVIEW_PORT),
  ATLAN_FLEET_DIR: join(STATE, 'fleet'), ATLAN_TOKEN: TOKEN, ATLAN_PROJECTS: PROJECTS,
};
let server = spawn('node', ['server/src/index.js'], { cwd: REPO, stdio: 'ignore', env: childEnv });
const waitUp = async () => {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + '/'); if (r.status === 200 || r.status === 401) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
if (!(await waitUp())) { console.error('FATAL: walls server never came up'); process.exit(2); }

const api = (path, opts = {}) => fetch(BASE + path, {
  ...opts,
  headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, origin: ORIGIN, ...(opts.headers ?? {}) },
});
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// Run a snippet against the real modules in an isolated process + state dir.
// Isolation is the point: several of these deliberately corrupt a state file or
// kill a server, which no shared harness may witness.
const node = (src, env = {}, { expectFail = false } = {}) => {
  try {
    return execFileSync('node', ['--input-type=module', '-e', src], {
      cwd: REPO, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (expectFail) return (err.stdout || '') + (err.stderr || '');
    throw new Error(`subprocess failed: ${(err.stderr || err.stdout || err.message).slice(-500)}`);
  }
};
const scratch = (name) => { const d = join(STATE, name); mkdirSync(d, { recursive: true }); return d; };

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── credential-path guard: FAMILIES, not a fixed list ──');
// The regex used to match a literal `.env`, so `.env.local` — where the real
// deploy secrets live — was fully readable AND writable through /api/file.
const { isSensitive } = await import(new URL('../server/src/guards.js', import.meta.url));

await test('every .env variant is refused, not just the bare literal', () => {
  for (const p of [
    '.env', '.env.local', '.env.production', '.env.development.local', '.env.staging',
    'proj/.env.local', '/home/x/app/.env.production.local',
  ]) assert.ok(isSensitive(p), `NOT refused: ${p}`);
});

await test('the .env suffixes that exist to be shared stay editable', () => {
  for (const p of ['.env.example', '.env.sample', '.env.template', 'proj/.env.dist']) {
    assert.equal(isSensitive(p), false, `over-blocked: ${p}`);
  }
  // and a word that merely starts with .env is not an env file
  assert.equal(isSensitive('proj/.environment/readme.md'), false);
});

await test('ssh private keys are matched by KEY TYPE, so none can be forgotten', () => {
  for (const p of ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_ed25519_sk', 'proj/keys/id_ecdsa']) {
    assert.ok(isSensitive(p), `NOT refused: ${p}`);
  }
  assert.equal(isSensitive('id_rsa.pub'), false, 'the PUBLIC half must stay readable');
  assert.equal(isSensitive('src/id_generator.js'), false, 'a project file must not be swept up');
});

await test('credential-shaped filenames and private-key extensions are refused', () => {
  for (const p of [
    'proj/.npmrc', 'proj/.netrc', 'proj/.pgpass', 'proj/.git-credentials', 'proj/.htpasswd',
    'proj/credentials.json', 'proj/secrets.yml', 'proj/secrets.yaml', 'proj/secrets.json',
    'proj/deploy-prod.pem', 'proj/service.key', 'proj/store.p12', 'proj/app.keystore',
  ]) assert.ok(isSensitive(p), `NOT refused: ${p}`);
});

await test('ordinary project files are not swept up by the widened families', () => {
  for (const p of [
    'proj/src/main.js', 'proj/README.md', 'proj/package.json', 'proj/keyboard.js',
    'proj/monkey.ts', 'proj/src/environment.ts', 'proj/claude-clone/index.js',
  ]) assert.equal(isSensitive(p), false, `false positive: ${p}`);
});

await test('the editor refuses to READ or WRITE a .env variant over HTTP', async () => {
  writeFileSync(join(PROJ, '.env.local'), 'STRIPE_SECRET_KEY=sk_live_NOTREAL\n');
  const read = await j(await api('/api/file?path=' + encodeURIComponent(join(PROJ, '.env.local'))));
  assert.equal(read.status, 400, 'served the secret');
  assert.ok(!JSON.stringify(read.body).includes('sk_live_NOTREAL'), 'secret content leaked in the error');
  const write = await j(await api('/api/file', { method: 'POST', body: JSON.stringify({ path: join(PROJ, '.env.local'), content: 'x' }) }));
  assert.equal(write.status, 400, 'overwrote a credential file');
  assert.match(readFileSync(join(PROJ, '.env.local'), 'utf8'), /sk_live_NOTREAL/, 'the file was modified anyway');
  const ref = await j(await api('/api/attach/ref', { method: 'POST', body: JSON.stringify({ path: join(PROJ, '.env.local') }) }));
  assert.equal(ref.status, 400, 'attachable into a chat turn');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── /api/scan containment ──');

await test('scan will NOT follow a symlink out of the projects root', async () => {
  const r = await j(await api('/api/scan?path=' + encodeURIComponent(join(PROJ, 'escape'))));
  assert.equal(r.status, 400, 'walked through the symlink');
  assert.ok(!JSON.stringify(r.body).includes('sk-NOTREAL'), 'disclosed a secret from outside the root');
});

await test('scan still refuses a plain path outside the root', async () => {
  const r = await j(await api('/api/scan?path=' + encodeURIComponent(OUTSIDE)));
  assert.equal(r.status, 400);
});

await test('scan STILL reads .env inside the project — it is the secret scanner', async () => {
  // The credential denylist deliberately does NOT apply here. A scanner that
  // refuses to open .env cannot do the one job it exists for, and silently
  // dropping the Env Hygiene probe would be a worse defect than the one above.
  const r = await j(await api('/api/scan?path=' + encodeURIComponent(PROJ)));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const hits = (r.body.findings ?? []).filter((f) => /\.env/.test(f.file ?? ''));
  assert.ok(hits.length > 0, 'the scanner stopped finding secrets in .env');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── fleet write scope ──');
const fleetEnv = { ATLAN_FLEET_DIR: scratch('fleet-prof'), ATLAN_PROJECTS: PROJECTS };
const { PROFILES_FOR_TEST } = await import(new URL('../server/src/fleet.js', import.meta.url));

await test('builder REFUSES a write to Atlan\'s own source even when cwd is the app root', () => {
  const out = node(`
    const { PROFILES_FOR_TEST } = await import('${REPO}server/src/fleet.js');
    const b = PROFILES_FOR_TEST.builder;
    const r = (f, cwd) => JSON.stringify(b.check('Write', { file_path: f }, cwd));
    console.log(r('${REPO}server/src/auth.js', '${REPO}'.replace(/\\/$/, '')));
    console.log(r('${REPO}.fleet/auth.json', '${REPO}'.replace(/\\/$/, '')));
    console.log(r('/etc/hosts', '/'));
    console.log(r('${homedir()}/.ssh/authorized_keys', '/'));
    console.log(r('${REPO}.keys.enc', '/'));
  `, { ATLAN_FLEET_DIR: scratch('fleet-b') });
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 5);
  for (const [i, r] of lines.entries()) assert.equal(r.ok, false, `line ${i} was ALLOWED: ${JSON.stringify(r)}`);
});

await test('builder still allows an ordinary write inside its project', () => {
  // In a SUBPROCESS: PROJECTS_DIR is read once at module load, so the fixture
  // root has to be in the environment before fleet.js is imported.
  const out = node(`
    const { PROFILES_FOR_TEST } = await import('${REPO}server/src/fleet.js');
    console.log(JSON.stringify(PROFILES_FOR_TEST.builder.check('Write', { file_path: '${join(PROJ, 'src/new.js')}' }, '${PROJ}')));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('fleet-ok'), ATLAN_PROJECTS: PROJECTS });
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.equal(r.ok, true, `an ordinary project write was blocked: ${JSON.stringify(r)}`);
});

await test('scout canUseTool refuses every non-read tool (not just disallowedTools)', () => {
  // disallowedTools is the OTHER belt and is already covered. This is the
  // callback itself: opening it to `return {ok:true}` left the whole gate green.
  const s = PROFILES_FOR_TEST.scout;
  for (const tool of ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Task']) {
    assert.equal(s.check(tool).ok, false, `scout allowed ${tool}`);
  }
  for (const tool of ['Read', 'Grep', 'Glob', 'LS']) assert.equal(s.check(tool).ok, true, `scout blocked ${tool}`);
});

await test('verifier canUseTool refuses writes but allows checks', () => {
  const v = PROFILES_FOR_TEST.verifier;
  for (const tool of ['Write', 'Edit', 'NotebookEdit']) assert.equal(v.check(tool).ok, false, `verifier allowed ${tool}`);
  for (const tool of ['Read', 'Bash']) assert.equal(v.check(tool).ok, true, `verifier blocked ${tool}`);
});

await test('spawnRun REFUSES a cwd outside the projects root', async () => {
  const r = await j(await api('/api/fleet/run', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'hi', profile: 'builder', cwd: '/', engine: 'claude' }),
  }));
  assert.equal(r.status, 400, 'accepted cwd:/');
  assert.match(r.body.error ?? '', /must be under/i);
});

await test('spawnRun REFUSES a cwd that reaches outside via a symlink', async () => {
  const r = await j(await api('/api/fleet/run', {
    method: 'POST',
    body: JSON.stringify({ prompt: 'hi', profile: 'builder', cwd: join(PROJ, 'escape'), engine: 'claude' }),
  }));
  assert.equal(r.status, 400, 'accepted a symlinked escape as cwd');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── spend walls, by behaviour ──');

await test('the DAILY TOKEN CAP actually refuses a run past it', () => {
  const dir = scratch('cap-daily');
  writeFileSync(join(dir, 'burn.json'), JSON.stringify({ [new Date().toISOString().slice(0, 10)]: { tokens: 9_999_999, cost: 0, cacheRead: 0 } }));
  const out = node(`
    const { spawnRun } = await import('${REPO}server/src/fleet.js');
    try { spawnRun({ prompt: 'x', profile: 'scout', cwd: '${PROJ}' }); console.log('ADMITTED'); }
    catch (e) { console.log('REFUSED: ' + e.message); }
    process.exit(0);
  `, { ATLAN_FLEET_DIR: dir, ATLAN_PROJECTS: PROJECTS, ATLAN_DAILY_TOKEN_CAP: '1000' });
  assert.match(out, /REFUSED: daily token cap/, out);
});

await test('the CONCURRENCY CAP actually refuses the run that exceeds it', () => {
  const out = node(`
    const { spawnRun } = await import('${REPO}server/src/fleet.js');
    process.env.X = '';
    spawnRun({ prompt: 'one', profile: 'scout', cwd: '${PROJ}', engine: 'codex', allowUnsandboxed: true });
    try { spawnRun({ prompt: 'two', profile: 'scout', cwd: '${PROJ}', engine: 'codex', allowUnsandboxed: true }); console.log('ADMITTED'); }
    catch (e) { console.log('REFUSED: ' + e.message); }
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('cap-conc'), ATLAN_PROJECTS: PROJECTS, ATLAN_MAX_CONCURRENT_RUNS: '1', ATLAN_ASSUME_NO_SANDBOX: '1' });
  assert.match(out, /REFUSED: too many runs in flight/, out);
});

await test('the BUDGET CLAMP actually clamps what the run record reports', () => {
  const out = node(`
    const { spawnRun } = await import('${REPO}server/src/fleet.js');
    const mk = (budget) => spawnRun({ prompt: 'x', profile: 'scout', cwd: '${PROJ}', budget, engine: 'codex', allowUnsandboxed: true }).budget;
    console.log(JSON.stringify({ hi: mk(99_000_000), lo: mk(-5), zero: mk(0), missing: mk(undefined) }));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('cap-clamp'), ATLAN_PROJECTS: PROJECTS, ATLAN_ASSUME_NO_SANDBOX: '1', ATLAN_DAILY_TOKEN_CAP: '0', ATLAN_MAX_CONCURRENT_RUNS: '0' });
  const b = JSON.parse(out.trim().split('\n').pop());
  assert.equal(b.hi, 2_000_000, 'an absurd budget was not clamped to the 2M ceiling');
  assert.equal(b.lo, 1000, 'a negative budget was not raised to the 1000 floor');
  assert.equal(b.zero, 150000, 'budget 0 must fall back to the default, not to the floor');
  assert.equal(b.missing, 150000, 'a missing budget must fall back to the default');
});

await test('the daily cap RESERVES the remaining budget of runs still in flight', () => {
  // CLI runs hold tokens=0 until they finish, so without the reservation N
  // concurrent spawns all see the same burn total (0) and are ALL admitted, no
  // matter how many. Cap 1M, budget 900k each: #1 and #2 fit under the
  // reservation arithmetic, #3 must not. With the reservation neutered, #3 is
  // admitted like the others.
  const out = node(`
    const { spawnRun } = await import('${REPO}server/src/fleet.js');
    const mk = (p) => spawnRun({ prompt: p, profile: 'scout', cwd: '${PROJ}', budget: 900000, engine: 'codex', allowUnsandboxed: true });
    const results = [];
    for (const p of ['one', 'two', 'three']) {
      try { mk(p); results.push('ADMITTED'); } catch (e) { results.push('REFUSED: ' + e.message); }
    }
    console.log(JSON.stringify(results));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('cap-reserve'), ATLAN_PROJECTS: PROJECTS, ATLAN_ASSUME_NO_SANDBOX: '1', ATLAN_DAILY_TOKEN_CAP: '1000000', ATLAN_MAX_CONCURRENT_RUNS: '0' });
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.equal(r[0], 'ADMITTED', 'the first run should always fit');
  assert.match(r[2], /REFUSED: daily token cap[\s\S]*reserved by runs still in flight/,
    `the third concurrent run was admitted against a stale total: ${JSON.stringify(r)}`);
});

await test('a CORRUPT burn ledger fails CLOSED and is never overwritten', () => {
  const dir = scratch('cap-corrupt');
  const burn = join(dir, 'burn.json');
  writeFileSync(burn, '{"2026-08-06":{"tokens":51');   // truncated mid-write
  const out = node(`
    const { spawnRun, todayBurn } = await import('${REPO}server/src/fleet.js');
    console.log('BURN ' + JSON.stringify(todayBurn()));
    try { spawnRun({ prompt: 'x', profile: 'scout', cwd: '${PROJ}' }); console.log('ADMITTED'); }
    catch (e) { console.log('REFUSED: ' + e.message); }
    process.exit(0);
  `, { ATLAN_FLEET_DIR: dir, ATLAN_PROJECTS: PROJECTS, ATLAN_DAILY_TOKEN_CAP: '5000000' });
  assert.match(out, /REFUSED: the spend ledger was unreadable/, out);
  const quarantined = readdirSync(dir).filter((f) => f.startsWith('burn.json.corrupt-'));
  assert.equal(quarantined.length, 1, 'the corrupt ledger was not preserved');
  assert.match(readFileSync(join(dir, quarantined[0]), 'utf8'), /"tokens":51/, 'the evidence was destroyed');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── state stores: corrupt ≠ empty ──');

await test('a corrupt routines.json is quarantined, not silently wiped', () => {
  const dir = scratch('rout-corrupt');
  writeFileSync(join(dir, 'routines.json'), '{"routines":[{"id":"aaa","name":"nightly self-audit"');
  const out = node(`
    const { listRoutines, setPaused } = await import('${REPO}server/src/routines.js');
    console.log('LOADERR ' + JSON.stringify(listRoutines().loadError));
    setPaused(true);   // any state change used to make the loss permanent
    process.exit(0);
  `, { ATLAN_FLEET_DIR: dir, ATLAN_PROJECTS: PROJECTS });
  assert.match(out, /LOADERR "[^"]*routines\.json\.corrupt-/, `loadError not surfaced: ${out}`);
  const kept = readdirSync(dir).filter((f) => f.startsWith('routines.json.corrupt-'));
  assert.equal(kept.length, 1, 'the corrupt routines file was not preserved');
  assert.match(readFileSync(join(dir, kept[0]), 'utf8'), /nightly self-audit/, 'the schedules were destroyed');
});

await test('a healthy routines.json still loads (the quarantine is not trigger-happy)', () => {
  const dir = scratch('rout-ok');
  writeFileSync(join(dir, 'routines.json'), JSON.stringify({
    routines: [{ id: 'aaa', name: 'nightly', cadence: { kind: 'daily', at: '03:00' }, prompt: 'p', profile: 'scout', cwd: PROJ, model: 'm', budget: 50000, enabled: true, lastFireAt: null, lastRunId: null, missed: false, createdAt: 1 }],
    paused: false,
  }));
  const out = node(`
    const { listRoutines } = await import('${REPO}server/src/routines.js');
    const l = listRoutines();
    console.log(JSON.stringify({ names: l.routines.map(r => r.name), loadError: l.loadError }));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: dir, ATLAN_PROJECTS: PROJECTS });
  const got = JSON.parse(out.trim().split('\n').pop());
  assert.deepEqual(got.names, ['nightly']);
  assert.equal(got.loadError, null);
  assert.equal(readdirSync(dir).filter((f) => f.includes('.corrupt-')).length, 0, 'a healthy file was quarantined');
});

await test('a corrupt hierarchy jobs file is quarantined too', () => {
  const dir = scratch('jobs-corrupt');
  writeFileSync(join(dir, 'hierarchy-jobs.json'), '[{"id":"j1","name":"nightly build"');
  node(`
    const { listJobs } = await import('${REPO}server/src/hierarchy.js');
    console.log(JSON.stringify(listJobs()));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: dir, ATLAN_PROJECTS: PROJECTS });
  const kept = readdirSync(dir).filter((f) => f.startsWith('hierarchy-jobs.json.corrupt-'));
  assert.equal(kept.length, 1, 'the corrupt jobs file was not preserved');
  assert.match(readFileSync(join(dir, kept[0]), 'utf8'), /nightly build/);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── atomicWrite ──');
const { atomicWrite } = await import(new URL('../server/src/fsutil.js', import.meta.url));

await test('atomicWrite PRESERVES the 0600 mode it is given', () => {
  const f = join(scratch('atomic'), 'sessions.json');
  atomicWrite(f, '[]', { mode: 0o600 });
  assert.equal(statSync(f).mode & 0o777, 0o600, 'the session store is world-readable');
  atomicWrite(f, '[1]', { mode: 0o600 });      // and on OVERWRITE, not just create
  assert.equal(statSync(f).mode & 0o777, 0o600);
});

await test('atomicWrite REPLACES the file rather than truncating it in place', () => {
  // The observable signature of temp+rename, and the one a direct
  // writeFileSync(path, …) cannot fake: rename(2) swaps the directory entry, so
  // the target gets a NEW inode and a reader holding the old one still sees a
  // whole file. An in-place write truncates the SAME inode — which is exactly
  // the torn-state failure the function's docstring says it exists to prevent,
  // and which "the content is correct afterwards" cannot detect.
  const dir = scratch('atomic2');
  const f = join(dir, 'store.json');
  atomicWrite(f, '{"a":1}');
  const first = statSync(f).ino;
  atomicWrite(f, '{"a":2,"padding":"' + 'x'.repeat(200000) + '"}');
  const second = statSync(f).ino;
  assert.notEqual(second, first, 'the file was truncated in place — a crash mid-write leaves half a record');
  assert.equal(readdirSync(dir).length, 1, `a temp file was left behind: ${readdirSync(dir)}`);
  assert.match(readFileSync(f, 'utf8'), /^\{"a":2/);
});

await test('a failed atomicWrite leaves the ORIGINAL intact and cleans its temp', () => {
  const dir = scratch('atomic3');
  const f = join(dir, 'store.json');
  atomicWrite(f, 'GOOD');
  // A circular structure makes JSON.stringify throw before any write; a
  // directory as the target makes the rename fail after one. Use the second:
  // it is the case the temp+rename exists for.
  let threw = false;
  try { atomicWrite(dir, 'x'); } catch { threw = true; }
  assert.ok(threw, 'writing over a directory should have thrown');
  assert.equal(readFileSync(f, 'utf8'), 'GOOD', 'the good file was damaged');
  assert.equal(readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0, 'a temp file was orphaned');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── credential scrubbing: the DROP list, not just the heuristic ──');
const { scrubbedEnv } = await import(new URL('../server/src/containment.js', import.meta.url));

await test('scrubbedEnv drops the keys ONLY the explicit list can catch', () => {
  // AWS_ACCESS_KEY_ID ends `_ID`, AWS_SECRET_ACCESS_KEY ends `_KEY` (the
  // heuristic needs `API_KEY`), ATLAN_ORIGIN matches nothing — so each of these
  // is held up by the DROP list alone. The old fixture used only keys the
  // heuristic also caught, which is why disabling the list changed nothing.
  const env = scrubbedEnv({
    PATH: '/usr/bin', HOME: '/root', HARMLESS: 'keep',
    AWS_ACCESS_KEY_ID: 'AKIA0', AWS_SECRET_ACCESS_KEY: 'zz', ATLAN_ORIGIN: 'http://x',
    GH_TOKEN: 'gh', GITHUB_TOKEN: 'gh2',
  });
  for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'ATLAN_ORIGIN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    assert.ok(!(k in env), `${k} SURVIVED scrubbing`);
  }
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HARMLESS, 'keep');
});

await test('scrubbedEnv still catches a provider it has never heard of', () => {
  const env = scrubbedEnv({ SOME_FUTURE_PROVIDER_API_KEY: 'x', A_PASSWORD: 'y', KEEP: 'z' });
  assert.ok(!('SOME_FUTURE_PROVIDER_API_KEY' in env));
  assert.ok(!('A_PASSWORD' in env));
  assert.equal(env.KEEP, 'z');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── containment: the proposal must survive, and show deletions ──');
const { openContained } = await import(new URL('../server/src/containment.js', import.meta.url));

await test('a copy-mode proposal reports DELETIONS and outlives teardown', async () => {
  const src = scratch('contain-src');
  writeFileSync(join(src, 'keep.txt'), 'original');
  writeFileSync(join(src, 'delete-me.txt'), 'doomed');
  const w = await openContained(src, 'walls');
  assert.equal(w.kind, 'copy');
  rmSync(join(w.dir, 'delete-me.txt'));
  writeFileSync(join(w.dir, 'keep.txt'), 'edited');
  writeFileSync(join(w.dir, 'new-work.txt'), 'agent output');
  const d = w.diff();
  assert.equal(d.changed, 3, `changed=${d.changed} — deletions are invisible again: ${d.status}`);
  assert.match(d.status, /D {2}delete-me\.txt/, 'the deletion is missing from the proposal');
  assert.match(d.status, /A {2}new-work\.txt/);
  assert.match(d.status, /M {2}keep\.txt/);
  assert.ok(d.patch, 'a copy-mode proposal has no patch — nothing to review');
  await w.cleanup();
  assert.equal(existsSync(w.dir), false, 'the workspace was not cleaned up');
  // The work product must still be readable AFTER the workspace is gone.
  assert.ok(d.patch.includes('agent output'), 'the agent\'s work died with the workspace');
  assert.ok(d.patch.includes('DELETED delete-me.txt'));
});

await test('containment never touches the real project', async () => {
  const src = scratch('contain-src2');
  writeFileSync(join(src, 'keep.txt'), 'original');
  const w = await openContained(src, 'walls');
  writeFileSync(join(w.dir, 'keep.txt'), 'edited');
  assert.equal(readFileSync(join(src, 'keep.txt'), 'utf8'), 'original');
  await w.cleanup();
});

await test('openContained does not block the event loop', async () => {
  const src = scratch('contain-big');
  for (let i = 0; i < 1200; i++) writeFileSync(join(src, `f${i}.txt`), 'x'.repeat(2000));
  let worst = 0, last = Date.now();
  const iv = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; }, 10);
  await new Promise((r) => setTimeout(r, 60));
  last = Date.now(); worst = 0;
  const w = await openContained(src, 'walls');
  clearInterval(iv);
  await w.cleanup();
  // Generous: the assertion is "the loop kept turning", not a latency SLA. A
  // synchronous cpSync of this tree pins it for the whole copy in one block.
  assert.ok(worst < 400, `the event loop stalled ${worst}ms during the containment copy`);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── engine policy tells the truth about the run it allowed ──');
const { policyArgs } = await import(new URL('../server/src/enginePolicy.js', import.meta.url));

await test('a run allowed on a host with NO kernel sandbox is labelled unenforced', () => {
  const out = node(`
    const { policyArgs, sandboxCapableHost } = await import('${REPO}server/src/enginePolicy.js');
    console.log(JSON.stringify({ host: sandboxCapableHost().ok, g: policyArgs('codex', 'scout', { allowUnsandboxed: true }) }));
    process.exit(0);
  `, { ATLAN_ASSUME_NO_SANDBOX: '1' });
  const got = JSON.parse(out.trim().split('\n').pop());
  assert.equal(got.host, false, 'the simulated proot host was not in effect');
  assert.equal(got.g.enforced, false, 'an UNGATED run was recorded as enforced — the receipt is lying');
});

await test('an engine that cannot express a profile is REFUSED, not silently bypassed', () => {
  // grok's fidelity is 'unverified' — no profile mapping — so asking for one is
  // an error, never a quiet run with the gate off.
  assert.throws(() => policyArgs('grok', 'builder'), /refusing rather than running it ungated/);
  assert.equal(policyArgs('grok', 'builder', { allowUnsandboxed: true }).enforced, false,
    'an acknowledged bypass must still be labelled unenforced');
  // and the mapping that DOES exist reports itself as enforced
  assert.equal(policyArgs('codex', 'scout').enforced, true, 'a kernel-gated run is not labelled enforced');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── silent failure ──');

await test('a CLI that exits non-zero AFTER printing is recorded as an error, not done', () => {
  const bin = scratch('fakebin');
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env bash
echo '{"type":"item.completed","item":{"type":"agent_message","text":"a partial answer"}}'
echo "codex: FATAL: stream disconnected mid-turn" >&2
exit 7
`, { mode: 0o755 });
  const out = node(`
    const { spawnRun, listRuns } = await import('${REPO}server/src/fleet.js');
    const r = spawnRun({ engine: 'codex', profile: 'scout', prompt: 'hi', cwd: '${PROJ}', allowUnsandboxed: true });
    await new Promise(res => setTimeout(res, 3000));
    console.log(JSON.stringify(listRuns().find(x => x.id === r.id)));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('cli-exit'), ATLAN_PROJECTS: PROJECTS, ATLAN_ASSUME_NO_SANDBOX: '1', PATH: `${bin}:${process.env.PATH}` });
  const run = JSON.parse(out.trim().split('\n').pop());
  assert.equal(run.status, 'error', `a crashed run was reported as "${run.status}" with lastLine "${run.lastLine}"`);
  assert.equal(run.exitCode, 7, 'the exit code never reached the record');
  assert.match(run.lastLine, /exited 7/);
});

await test('a Claude result carrying an error subtype is NOT recorded as done', () => {
  // The SDK is stubbed: an error result RESOLVES the iterator rather than
  // throwing, which is exactly why it used to fall through to status 'done'.
  const stub = join(scratch('sdkstub'), 'stub.mjs');
  writeFileSync(stub, `
import { registerHooks } from 'node:module';
registerHooks({
  resolve(spec, ctx, next) { return spec === '@anthropic-ai/claude-agent-sdk' ? { url: 'stub:sdk', shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) {
    if (url !== 'stub:sdk') return next(url, ctx);
    return { format: 'module', shortCircuit: true, source: \`
      export function query() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'system', subtype: 'init', session_id: 's1' };
            yield { type: 'assistant', message: { usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'partial work' }] } };
            yield { type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0 };
          },
          async interrupt() {},
        };
      }\` };
  },
});
`);
  const out = execFileSync('node', ['--import', stub, '--input-type=module', '-e', `
    const { spawnRun, listRuns } = await import('${REPO}server/src/fleet.js');
    const r = spawnRun({ engine: 'claude', profile: 'scout', prompt: 'hi', cwd: '${PROJ}' });
    await new Promise(res => setTimeout(res, 800));
    console.log(JSON.stringify(listRuns().find(x => x.id === r.id)));
    process.exit(0);
  `], { cwd: REPO, encoding: 'utf8', env: { ...process.env, ATLAN_FLEET_DIR: scratch('claude-err'), ATLAN_PROJECTS: PROJECTS } });
  const run = JSON.parse(out.trim().split('\n').pop());
  assert.equal(run.status, 'error', `error_max_turns was reported as "${run.status}" / "${run.lastLine}"`);
  assert.match(run.lastLine, /turn wall|NOT finished/i);
  assert.equal(run.resultText, 'partial work', 'the partial output was thrown away');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── the scheduler never spends by surprise ──');

await test('a daily routine created AFTER its time waits until tomorrow', () => {
  const out = node(`
    const { _testInternals } = await import('${REPO}server/src/routines.js');
    const now = new Date(); now.setHours(14, 0, 0, 0);
    const r = { cadence: { kind: 'daily', at: '09:00' }, lastFireAt: null, createdAt: now.getTime() };
    const real = Date.now; Date.now = () => now.getTime();
    const due = _testInternals.dueAt(r);
    Date.now = real;
    console.log(JSON.stringify({ fireNow: now.getTime() >= due, hoursAway: Math.round((due - now.getTime()) / 3600000) }));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('rout-due'), ATLAN_PROJECTS: PROJECTS });
  const got = JSON.parse(out.trim().split('\n').pop());
  assert.equal(got.fireNow, false, 'a brand-new 09:00 daily routine, created at 2pm, fires within 30 seconds');
  assert.equal(got.hoursAway, 19, `expected tomorrow 09:00 (19h away), got ${got.hoursAway}h`);
});

await test('an already-fired daily routine still gets tomorrow\'s slot', () => {
  const out = node(`
    const { _testInternals } = await import('${REPO}server/src/routines.js');
    const now = new Date(); now.setHours(14, 0, 0, 0);
    const r = { cadence: { kind: 'daily', at: '09:00' }, lastFireAt: now.getTime() - 5 * 3600000, createdAt: 0 };
    const real = Date.now; Date.now = () => now.getTime();
    const due = _testInternals.dueAt(r); Date.now = real;
    console.log(String(Math.round((due - now.getTime()) / 3600000)));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('rout-due2'), ATLAN_PROJECTS: PROJECTS });
  assert.equal(out.trim().split('\n').pop(), '19');
});

await test('a routine created BEFORE its time today still fires today', () => {
  const out = node(`
    const { _testInternals } = await import('${REPO}server/src/routines.js');
    const now = new Date(); now.setHours(8, 0, 0, 0);
    const r = { cadence: { kind: 'daily', at: '09:00' }, lastFireAt: null, createdAt: now.getTime() };
    const real = Date.now; Date.now = () => now.getTime();
    const due = _testInternals.dueAt(r); Date.now = real;
    console.log(String(Math.round((due - now.getTime()) / 3600000)));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('rout-due3'), ATLAN_PROJECTS: PROJECTS });
  assert.equal(out.trim().split('\n').pop(), '1', 'the fix must not push a legitimately-due routine to tomorrow');
});

await test('tick() FLAGS a slot missed past its grace instead of firing it late', () => {
  const out = node(`
    const { _testInternals, upsertRoutine, listRoutines, startScheduler, stopScheduler } = await import('${REPO}server/src/routines.js');
    startScheduler(() => {}, async () => {});
    stopScheduler();
    const r = upsertRoutine({ name: 'nightly', cadence: { kind: 'every', minutes: 10 }, prompt: 'p', cwd: '${PROJ}' });
    // Pretend it last fired a day ago: far past due + grace (5 min).
    _testInternals.state.routines.find(x => x.id === r.id).lastFireAt = Date.now() - 24 * 3600000;
    _testInternals.tick();
    const after = listRoutines().routines.find(x => x.id === r.id);
    console.log(JSON.stringify({ missed: after.missed, lastRunId: after.lastRunId }));
    process.exit(0);
  `, { ATLAN_FLEET_DIR: scratch('rout-tick'), ATLAN_PROJECTS: PROJECTS });
  const got = JSON.parse(out.trim().split('\n').pop());
  assert.equal(got.missed, true, 'a long-missed slot was not flagged');
  assert.equal(got.lastRunId, null, 'a long-missed slot AUTO-FIRED — real tokens, unconfirmed');
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── nothing outlives the socket that started it ──');

await test('a dropped WebSocket tears down the warm Claude session', () => {
  const dir = scratch('ws-teardown');
  const stub = join(dir, 'stub.mjs');
  const log = join(dir, 'sessions.log');
  writeFileSync(stub, `
import { registerHooks } from 'node:module';
import { appendFileSync } from 'node:fs';
globalThis.__log = (l) => { try { appendFileSync('${log}', l + '\\n'); } catch {} };
registerHooks({
  resolve(spec, ctx, next) { return spec === '@anthropic-ai/claude-agent-sdk' ? { url: 'stub:sdk', shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) {
    if (url !== 'stub:sdk') return next(url, ctx);
    return { format: 'module', shortCircuit: true, source: \`
      let n = 0;
      export function query({ prompt }) {
        const id = ++n;
        globalThis.__log('OPEN ' + id);
        (async () => { try { for await (const _ of prompt) {} } catch {} globalThis.__log('INPUT-ENDED ' + id); })();
        return {
          async *[Symbol.asyncIterator]() { await new Promise(() => {}); },
          async interrupt() { globalThis.__log('INTERRUPT ' + id); },
          async close() { globalThis.__log('CLOSE ' + id); },
          async setModel() {},
        };
      }\` };
  },
});
`);
  writeFileSync(log, '');
  const p2 = execFileSync('node', ['--input-type=module', '-e', `
    const { spawn } = await import('node:child_process');
    const { createServer } = await import('node:net');
    const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const port = await freePort(), pport = await freePort();
    const env = { ...process.env, ATLAN_PORT: String(port), ATLAN_PREVIEW_PORT: String(pport), ATLAN_FLEET_DIR: '${join(dir, 'fleet')}', ATLAN_TOKEN: 'tk', ATLAN_PROJECTS: '${PROJECTS}' };
    const srv = spawn('node', ['--import', '${stub}', 'server/src/index.js'], { cwd: '${REPO}', stdio: 'ignore', env });
    for (let i = 0; i < 120; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/'); if (r.status) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    const { WebSocket } = await import('ws');
    for (let k = 0; k < 3; k++) {
      const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws', { headers: { 'x-atlan-token': 'tk' } });
      await new Promise(r => ws.on('open', r));
      ws.send(JSON.stringify({ t: 'chat.send', text: 'hi', cwd: '${PROJ}' }));
      await new Promise(r => setTimeout(r, 500));
      ws.terminate();                       // TCP reset — a phone losing signal
      await new Promise(r => setTimeout(r, 500));
    }
    srv.kill(); process.exit(0);
  `], { cwd: REPO, encoding: 'utf8', env: process.env });
  const lines = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  const opened = lines.filter((l) => l.startsWith('OPEN')).length;
  const torn = lines.filter((l) => /^(INTERRUPT|CLOSE|INPUT-ENDED)/.test(l)).length;
  assert.equal(opened, 3, `expected 3 warm sessions, saw ${opened}: ${lines.join(' ')}`);
  assert.ok(torn >= opened, `${opened} warm sessions opened, only ${torn} teardown events — each orphan holds a live agent CLI forever: ${lines.join(' ')}`);
});

await test('a chat-path agent CLI dies with its socket, and KILL ALL reaches it', () => {
  // The fake CLI records its OWN pid, so liveness is `kill -0 <pid>` rather than
  // a pgrep pattern — the pattern would also match this test's own command line
  // and count itself as a running agent.
  const bin = scratch('fakebin2');
  const pidfile = join(scratch('chat-orphan'), 'pids');
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env bash\necho $$ >> ${pidfile}\nfor i in $(seq 1 120); do sleep 1; done\n`, { mode: 0o755 });
  writeFileSync(pidfile, '');
  const out = node(`
    const { spawn } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const { createServer } = await import('node:net');
    const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const port = await freePort(), pport = await freePort();
    const env = { ...process.env, ATLAN_PORT: String(port), ATLAN_PREVIEW_PORT: String(pport), ATLAN_FLEET_DIR: '${scratch('chat-orphan')}', ATLAN_TOKEN: 'tk', ATLAN_PROJECTS: '${PROJECTS}', PATH: '${bin}:' + process.env.PATH };
    const srv = spawn('node', ['server/src/index.js'], { cwd: '${REPO}', stdio: 'ignore', env });
    for (let i = 0; i < 120; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/'); if (r.status) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    const { WebSocket } = await import('ws');
    const pids = () => readFileSync('${pidfile}', 'utf8').trim().split('\\n').filter(Boolean).map(Number);
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const turn = async () => {
      const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws', { headers: { 'x-atlan-token': 'tk' } });
      await new Promise(r => ws.on('open', r));
      ws.send(JSON.stringify({ t: 'chat.send', engine: 'codex', text: 'work', cwd: '${PROJ}' }));
      await new Promise(r => setTimeout(r, 1500));
      return ws;
    };

    // (a) a dropped socket must reap the child it started
    let ws = await turn();
    const pidA = pids().at(-1);
    const startedA = Number.isInteger(pidA) && alive(pidA);
    ws.terminate();
    await new Promise(r => setTimeout(r, 2000));
    const survivedDrop = alive(pidA);

    // (b) KILL ALL must reach a chat-path child on a LIVE socket
    ws = await turn();
    const pidB = pids().at(-1);
    const startedB = pidB !== pidA && alive(pidB);
    const killed = await (await fetch('http://127.0.0.1:' + port + '/api/fleet/kill', { method: 'POST', headers: { 'content-type': 'application/json', 'x-atlan-token': 'tk' }, body: JSON.stringify({ id: 'all' }) })).json();
    await new Promise(r => setTimeout(r, 2000));
    const survivedKill = alive(pidB);
    ws.terminate(); srv.kill();
    for (const p of pids()) { try { process.kill(-p, 'SIGKILL'); } catch {} }
    console.log(JSON.stringify({ startedA, survivedDrop, startedB, killed: killed.killed, survivedKill }));
    process.exit(0);
  `, {});
  const got = JSON.parse(out.trim().split('\n').pop());
  assert.equal(got.startedA, true, `the fake CLI never started (${JSON.stringify(got)})`);
  assert.equal(got.survivedDrop, false, 'a full-auto agent CLI outlived the socket that started it');
  assert.equal(got.startedB, true, 'the second turn never started');
  assert.ok(got.killed >= 1, `KILL ALL reported ${got.killed} — it cannot see chat-path children`);
  assert.equal(got.survivedKill, false, 'KILL ALL did not reach the chat-path child');
});

await test('a run in flight when the cockpit is SIGKILLed still gets a report card and its burn', () => {
  const bin = scratch('fakebin3');
  const dir = scratch('inflight');
  const pidfile = join(dir, 'pids');
  // Records its own pid: a `pkill -f <path>` here would match this harness's
  // OWN command line (the path appears in the -e source) and kill the harness
  // before it printed anything.
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env bash\necho $$ >> ${pidfile}\nfor i in $(seq 1 120); do sleep 1; done\n`, { mode: 0o755 });
  writeFileSync(pidfile, '');
  const out = node(`
    const { spawn } = await import('node:child_process');
    const { createServer } = await import('node:net');
    const freePort = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const port = await freePort(), pport = await freePort();
    const env = { ...process.env, ATLAN_PORT: String(port), ATLAN_PREVIEW_PORT: String(pport), ATLAN_FLEET_DIR: '${dir}', ATLAN_TOKEN: 'tk', ATLAN_PROJECTS: '${PROJECTS}', ATLAN_ASSUME_NO_SANDBOX: '1', PATH: '${bin}:' + process.env.PATH };
    const boot = async () => {
      const s = spawn('node', ['server/src/index.js'], { cwd: '${REPO}', stdio: 'ignore', env });
      for (let i = 0; i < 120; i++) { try { const r = await fetch('http://127.0.0.1:' + port + '/'); if (r.status) return s; } catch {} await new Promise(r => setTimeout(r, 200)); }
      return s;
    };
    const hit = (p, o) => fetch('http://127.0.0.1:' + port + p, { headers: { 'content-type': 'application/json', 'x-atlan-token': 'tk' }, ...o }).then(r => r.json());
    let srv = await boot();
    const run = await hit('/api/fleet/run', { method: 'POST', body: JSON.stringify({ engine: 'codex', profile: 'scout', prompt: 'long job', cwd: '${PROJ}', allowUnsandboxed: true }) });
    await new Promise(r => setTimeout(r, 1500));
    srv.kill('SIGKILL');                                  // the OOM / supervisor case
    await new Promise(r => setTimeout(r, 800));
    srv = await boot();                                   // exactly what atlan-serve.sh does
    const fleet = await hit('/api/fleet');
    const today = fleet.today;
    srv.kill();
    const { readFileSync } = await import('node:fs');
    for (const p of readFileSync('${pidfile}', 'utf8').trim().split('\\n').filter(Boolean)) {
      try { process.kill(-Number(p), 'SIGKILL'); } catch {}
      try { process.kill(Number(p), 'SIGKILL'); } catch {}
    }
    console.log(JSON.stringify({ id: run.id, today, history: fleet.history.map(h => ({ id: h.id, status: h.status, lastLine: h.lastLine })) }));
    process.exit(0);
  `, {}, { expectFail: true });
  const last = out.trim().split('\n').pop();
  let got;
  try { got = JSON.parse(last); } catch { throw new Error('the restart harness produced no result: ' + out.slice(-700)); }
  const card = got.history.find((h) => h.id === got.id);
  assert.ok(card, `the run vanished on restart — no report card at all (history: ${JSON.stringify(got.history)})`);
  assert.equal(card.status, 'interrupted', `expected 'interrupted', got '${card.status}'`);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── auth walls ──');

// ORDER MATTERS HERE: the throttle test deliberately locks the login endpoint
// for a minute, and nothing clears it but time or a successful login (which a
// 429 short-circuits before the password is even checked). So the tests that
// need to log in run FIRST, and the throttle runs last.
await test('changing the password revokes an existing session cookie', async () => {
  await j(await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: 'correcthorse1' }) }));
  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'correcthorse1' }) });
  assert.equal(login.status, 200, 'could not log in');
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  assert.match(cookie, /^atlan_session=/);
  const withCookie = (path) => fetch(BASE + path, { headers: { cookie, origin: ORIGIN } });
  assert.equal((await withCookie('/api/routines')).status, 200, 'the fresh cookie did not work');
  const chg = await j(await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current: 'correcthorse1', next: 'batterystaple2' }) }));
  assert.equal(chg.status, 200, JSON.stringify(chg.body));
  assert.equal((await withCookie('/api/routines')).status, 401, 'the STOLEN cookie survived the password change');
});

await test('the session store holds nothing replayable', async () => {
  // ABSENCE is the property that matters, and a presence-shaped assertion
  // ("the hash is there") cannot check it: re-adding the plaintext alongside
  // the hash left every existing assertion green.
  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'batterystaple2' }) });
  const token = ((login.headers.get('set-cookie') ?? '').match(/atlan_session=([^;]+)/) ?? [])[1];
  assert.ok(token, 'no session token issued');
  const raw = readFileSync(join(STATE, 'fleet', 'sessions.json'), 'utf8');
  assert.ok(!raw.includes(token), 'sessions.json contains the REPLAYABLE token, not just its hash');
  for (const s of JSON.parse(raw)) {
    for (const [k, v] of Object.entries(s)) {
      if (typeof v !== 'string') continue;
      assert.ok(k === 'h' || !/^[0-9a-f]{64}$/.test(v), `field "${k}" looks like a raw session token`);
    }
  }
  assert.equal(statSync(join(STATE, 'fleet', 'sessions.json')).mode & 0o777, 0o600, 'the session store is not 0600');
});

await test('the failed-login throttle actually starts refusing', async () => {
  const codes = [];
  for (let i = 0; i < 15; i++) {
    codes.push((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'wrong-' + i }) })).status);
  }
  assert.equal(codes[0], 401, 'the first attempt should be a plain 401');
  assert.ok(codes.includes(429), `15 wrong passwords never tripped the throttle: ${codes.join(',')}`);
  assert.equal(codes.at(-1), 429, 'the throttle let go again');
  // and a CORRECT password is refused too while the cooldown holds — the point
  // is to stop guessing, not to grade the guess
  assert.equal((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'batterystaple2' }) })).status, 429);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── preview proxy: the WS upgrade is gated too ──');

// Raw socket: fetch/ws both forbid forging Host and Origin.
const rawUpgrade = (port, headers) => new Promise((resolve) => {
  const sock = net.connect(port, '127.0.0.1', () => {
    sock.write([
      'GET / HTTP/1.1', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13', '', '',
    ].join('\r\n'));
  });
  let got = '';
  sock.on('data', (d) => { got += d; });
  const done = () => resolve(got);
  sock.on('close', done);
  sock.on('error', () => resolve('CLOSED'));
  setTimeout(() => { sock.destroy(); done(); }, 1200);
});

// An upstream that WILL complete a WebSocket handshake. Without one, "no 101
// came back" is true whether the gate refused or the proxy simply had nothing
// to forward to — so the assertion could not tell a live gate from a dead one,
// and the gate-off mutant escaped. The same-origin case below is the control
// that makes the cross-origin case mean something.
const upstream = http.createServer((_q, s) => { s.writeHead(200); s.end('ok'); });
upstream.on('upgrade', (_q, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const UPSTREAM_PORT = upstream.address().port;
await j(await api('/api/preview/target', { method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${UPSTREAM_PORT}` }) }));

await test('a SAME-origin WebSocket upgrade through the preview proxy still works', async () => {
  const got = await rawUpgrade(PREVIEW_PORT, { Host: `127.0.0.1:${PREVIEW_PORT}`, Origin: `http://127.0.0.1:${PREVIEW_PORT}` });
  assert.match(got, /HTTP\/1\.1 101/, `the legitimate HMR socket was blocked too: ${got.slice(0, 160)}`);
});

await test('a cross-site WebSocket upgrade into the preview proxy is dropped', async () => {
  const got = await rawUpgrade(PREVIEW_PORT, { Host: `127.0.0.1:${PREVIEW_PORT}`, Origin: 'http://evil.example' });
  assert.ok(!/HTTP\/1\.1 101/.test(got), `the upgrade was ACCEPTED from a foreign origin: ${got.slice(0, 160)}`);
});

await test('a rebinding Host on the preview WS upgrade is dropped', async () => {
  const got = await rawUpgrade(PREVIEW_PORT, { Host: 'attacker.example', Origin: `http://127.0.0.1:${PREVIEW_PORT}` });
  assert.ok(!/HTTP\/1\.1 101/.test(got), `the upgrade was ACCEPTED for a foreign Host: ${got.slice(0, 160)}`);
});

await test('the HTTP path of the same gate is still closed', async () => {
  const status = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PREVIEW_PORT, path: '/', method: 'GET', headers: { Host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.end();
  });
  assert.equal(status, 403);
});

// ══════════════════════════════════════════════════════════════════════════
console.log('\n── preflight tells the truth about permission gates ──');

await test('the permission-gate row REFLECTS which engines actually run ungated', async () => {
  const { body } = await j(await api('/api/preflight'));
  const row = body.checks.find((c) => c.id === 'permmode');
  assert.ok(row, 'the permission-gate check disappeared');
  const { ungatedInteractiveEngines } = await import(new URL('../server/src/enginePolicy.js', import.meta.url));
  const { agentStatus } = await import(new URL('../server/src/agents.js', import.meta.url));
  const liveUngated = agentStatus().filter((a) => a.ready && ungatedInteractiveEngines().includes(a.id)).map((a) => a.id);
  assert.equal(row.ok, liveUngated.length === 0,
    `the row says ok:${row.ok} while ${liveUngated.length} ungated engine(s) are live here (${liveUngated.join(', ') || 'none'})`);
  for (const id of liveUngated) assert.ok(row.detail.includes(id), `the row does not name the ungated engine ${id}`);
  assert.ok(!/every dangerous tool asks you first/.test(row.detail),
    'the row is claiming a per-tool gate that four of the five engines do not have');
});

await test('every interactive-gate flag the check reports is the flag agents.js actually passes', () => {
  // One table, read by the launcher and by the honesty check. If they are ever
  // separated again, this is what notices.
  const src = readFileSync(new URL('../server/src/agents.js', import.meta.url), 'utf8');
  assert.ok(!/--dangerously-bypass-approvals-and-sandbox'\s*,|'--allow-all'|'--always-approve'|'--dangerously-skip-permissions'/.test(
    src.replace(/^\s*\/\/.*$/gm, '')),
  'agents.js spells a bypass flag out inline again — it must come from enginePolicy.interactiveGate');
});

// ── teardown ──────────────────────────────────────────────────────────────
upstream.close();
server.kill();
try { execFileSync('pkill', ['-f', join(STATE, 'fakebin')]); } catch { /* nothing left */ }
rmSync(STATE, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
