// Code editor file-API suite — read / write / tree, scoped to the project,
// with the same secrets + traversal guards as attachments.
import assert from 'node:assert';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const PROJ = process.env.ATLAN_PROJECTS ?? '/root';
const api = (p, o = {}) => fetch(BASE + p, { ...o, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(o.headers ?? {}) } });
const j = (r) => r.json();
let pass = 0, fail = 0;
async function test(n, fn) { try { await fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + e.message); } }

console.log('CODE EDITOR SUITE');
const under = (rel) => `${PROJ.replace(/\/$/, '')}/${rel}`;

await test('read an existing file returns its content', async () => {
  const f = await j(await api('/api/file?path=' + encodeURIComponent(under('atlan/package.json'))));
  assert.equal(f.name, 'package.json');
  assert.ok(f.content.includes('"name"'));
});
await test('tree lists a directory, folders first', async () => {
  const t = await j(await api('/api/tree?path=' + encodeURIComponent(under('atlan'))));
  assert.ok(Array.isArray(t.entries) && t.entries.length > 3);
  const firstDirIdx = t.entries.findIndex((e) => e.dir);
  const firstFileIdx = t.entries.findIndex((e) => !e.dir);
  if (firstDirIdx >= 0 && firstFileIdx >= 0) assert.ok(firstDirIdx < firstFileIdx, 'folders should sort first');
  assert.ok(!t.entries.some((e) => e.name === 'node_modules' || e.name === '.git'), 'noise dirs hidden');
});
let tmpPath;
await test('write creates a new file and reads back', async () => {
  tmpPath = under('atlan/.attachments/editor-suite-test.txt');
  const w = await j(await api('/api/file', { method: 'POST', body: JSON.stringify({ path: tmpPath, content: 'hello from the editor' }) }));
  assert.equal(w.bytes, 21);
  const r = await j(await api('/api/file?path=' + encodeURIComponent(tmpPath)));
  assert.equal(r.content, 'hello from the editor');
});
await test('reading a secrets path is refused', async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent(under('atlan/.auth-token')))).status, 400);
});
await test('reading outside the project is refused', async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent('/etc/passwd'))).status, 400);
});
await test('writing outside the project is refused', async () => {
  assert.equal((await api('/api/file', { method: 'POST', body: JSON.stringify({ path: '/etc/atlan-pwn', content: 'x' }) })).status, 400);
});
await test('reading a folder as a file errors cleanly', async () => {
  assert.equal((await api('/api/file?path=' + encodeURIComponent(under('atlan')))).status, 400);
});
// REGRESSION (fleet scout audit 2026-07-22): a symlink under the project that
// points outside it must not be readable/attachable — resolve() doesn't follow
// links, so we realpath-check.
await test('a symlink escaping the project is refused (read + attach)', async () => {
  const { symlinkSync, unlinkSync: rm } = await import('node:fs');
  const link = under('atlan/.attachments/evil-link-test');
  try { if (existsSync(link)) rm(link); symlinkSync('/etc/passwd', link); } catch { return; }
  const read = await api('/api/file?path=' + encodeURIComponent(link));
  const att = await api('/api/attach/ref', { method: 'POST', body: JSON.stringify({ path: link }) });
  try { rm(link); } catch {}
  assert.equal(read.status, 400, 'symlink read not blocked');
  assert.equal(att.status, 400, 'symlink attach not blocked');
});

// REGRESSION (peer review 2026-07-22): a NEW file written under a symlinked
// PARENT dir must be refused — the original symlink fix only checked existing files.
await test('write to a new file under a symlinked parent is refused', async () => {
  const { symlinkSync, unlinkSync: rm, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const outside = mkdtempSync(tmpdir() + '/atlan-esc-');
  const linkDir = under('atlan/.attachments/escdir');
  try { if (existsSync(linkDir)) rm(linkDir); symlinkSync(outside, linkDir); } catch { return; }
  const r = await api('/api/file', { method: 'POST', body: JSON.stringify({ path: linkDir + '/pwned.txt', content: 'x' }) });
  try { rm(linkDir); } catch {}
  assert.equal(r.status, 400, 'new-file write via symlinked parent not blocked');
});

await test('cleanup', () => { if (tmpPath && existsSync(tmpPath)) unlinkSync(tmpPath); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
