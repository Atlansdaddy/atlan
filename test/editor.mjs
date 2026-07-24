// Code editor file-API suite — read / write / tree, scoped to the USER'S project
// via the SHARED guard (guards.js), with a hard exclusion of Atlan's OWN repo (the
// editor is for your projects, not the cockpit's source/state).
//
// Fixtures live in a throwaway dir UNDER PROJECTS_DIR but OUTSIDE the app repo. The
// old suite used the app's own tree as its fixture — which is exactly why the
// `.fleet`/`.env` guard drift slipped through green: it tested `.auth-token` but
// never `.fleet/auth.json` (the scrypt password hash) or the source files. (PC
// code-review, 2026-07-23.)
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const PROJ = (process.env.ATLAN_PROJECTS ?? '/root').replace(/\/$/, '');
const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, ''); // Atlan's own repo (== server APP_ROOT)
const api = (p, o = {}) => fetch(BASE + p, { ...o, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(o.headers ?? {}) } });
const j = (r) => r.json();
let pass = 0, fail = 0;
async function test(n, fn) { try { await fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + e.message); } }

console.log('CODE EDITOR SUITE');

// Hermetic fixture under the project root, NOT under the app repo.
const FIX = `${PROJ}/editor-suite-fixture`;
rmSync(FIX, { recursive: true, force: true });
mkdirSync(`${FIX}/sub`, { recursive: true });
writeFileSync(`${FIX}/package.json`, '{"name":"fixture"}');
writeFileSync(`${FIX}/b.txt`, 'b');
writeFileSync(`${FIX}/sub/a.txt`, 'a');

await test('read an existing file returns its content', async () => {
  const f = await j(await api('/api/file?path=' + encodeURIComponent(`${FIX}/package.json`)));
  assert.equal(f.name, 'package.json');
  assert.ok(f.content.includes('"name"'));
});
await test('tree lists a directory, folders first', async () => {
  const t = await j(await api('/api/tree?path=' + encodeURIComponent(FIX)));
  assert.ok(Array.isArray(t.entries) && t.entries.length >= 2);
  const di = t.entries.findIndex((e) => e.dir), fi = t.entries.findIndex((e) => !e.dir);
  if (di >= 0 && fi >= 0) assert.ok(di < fi, 'folders should sort first');
  assert.ok(!t.entries.some((e) => e.name === 'node_modules' || e.name === '.git'), 'noise dirs hidden');
});
let tmpPath;
await test('write creates a new file and reads back', async () => {
  tmpPath = `${FIX}/new-file.txt`;
  const w = await j(await api('/api/file', { method: 'POST', body: JSON.stringify({ path: tmpPath, content: 'hello from the editor' }) }));
  assert.equal(w.bytes, 21);
  const r = await j(await api('/api/file?path=' + encodeURIComponent(tmpPath)));
  assert.equal(r.content, 'hello from the editor');
});
await test('reading a secrets path is refused', async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent(`${FIX}/.auth-token`))).status, 400);
});

// ── REGRESSION (PC review 2026-07-23): the editor's guard had drifted from
// attachments and lost `.fleet` and `.env`, exposing the password hash + session
// store to read/overwrite, and nothing stopped it rewriting the cockpit's own
// source (which the auto-respawn supervisor would then execute). All refused now. ──
await test('reading .env is refused (regex-drift regression)', async () => {
  writeFileSync(`${FIX}/.env`, 'SECRET=1');
  assert.equal((await api('/api/file?path=' + encodeURIComponent(`${FIX}/.env`))).status, 400);
});
await test('reading a .fleet path is refused (regex-drift regression)', async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent(`${PROJ}/.fleet/auth.json`))).status, 400);
});
await test("reading Atlan's own state (.fleet/auth.json) is refused", async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent(`${APP}/.fleet/auth.json`))).status, 400);
});
await test("reading Atlan's own source (server/src/auth.js) is refused", async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent(`${APP}/server/src/auth.js`))).status, 400);
});
await test("overwriting Atlan's own source is refused (auth-rewrite → respawn vector)", async () => {
  assert.equal((await api('/api/file', { method: 'POST', body: JSON.stringify({ path: `${APP}/server/src/auth.js`, content: '// pwned' }) })).status, 400);
});
await test('the app repo is hidden from the file tree', async () => {
  const t = await j(await api('/api/tree?path=' + encodeURIComponent(PROJ)));
  const appName = APP.split('/').pop();
  assert.ok(!t.entries.some((e) => e.path === APP || e.name === appName), 'app repo leaked into the tree');
});

await test('reading outside the project is refused', async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent('/etc/passwd'))).status, 400);
});
await test('writing outside the project is refused', async () => {
  assert.equal((await api('/api/file', { method: 'POST', body: JSON.stringify({ path: '/etc/atlan-pwn', content: 'x' }) })).status, 400);
});
await test('reading a folder as a file errors cleanly', async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent(FIX))).status, 400);
});

// REGRESSION (fleet scout audit 2026-07-22): a symlink under the project pointing
// outside it must not be readable/attachable — resolve() doesn't follow links.
await test('a symlink escaping the project is refused (read + attach)', async () => {
  const link = `${FIX}/evil-link`;
  try { if (existsSync(link)) rmSync(link); symlinkSync('/etc/passwd', link); } catch { return; }
  const read = await api('/api/file?path=' + encodeURIComponent(link));
  const att = await api('/api/attach/ref', { method: 'POST', body: JSON.stringify({ path: link }) });
  try { rmSync(link); } catch {}
  assert.equal(read.status, 400, 'symlink read not blocked');
  assert.equal(att.status, 400, 'symlink attach not blocked');
});

// REGRESSION (peer review 2026-07-22): a NEW file under a symlinked PARENT dir.
await test('write to a new file under a symlinked parent is refused', async () => {
  const outside = mkdtempSync(tmpdir() + '/atlan-esc-');
  const linkDir = `${FIX}/escdir`;
  try { if (existsSync(linkDir)) rmSync(linkDir); symlinkSync(outside, linkDir); } catch { return; }
  const r = await api('/api/file', { method: 'POST', body: JSON.stringify({ path: linkDir + '/pwned.txt', content: 'x' }) });
  try { rmSync(linkDir); } catch {}
  assert.equal(r.status, 400, 'new-file write via symlinked parent not blocked');
});

await test('cleanup', () => { rmSync(FIX, { recursive: true, force: true }); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
