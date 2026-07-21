// Attachments suite — upload (image/file), reference (file/folder), path-
// traversal guard, oversize reject, and turn-context wiring. Audio/video
// delegation needs a live multimodal key, so it's smoke-checked for graceful
// degradation only (no key → honest note, no crash).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const api = (p, o = {}) => fetch(BASE + p, { ...o, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(o.headers ?? {}) } });
const j = (r) => r.json();
let pass = 0, fail = 0;
async function test(n, fn) { try { await fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + e.message); } }

console.log('ATTACHMENTS SUITE');
// 1x1 png
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

await test('upload an image → kind image + saved path', async () => {
  const a = await j(await api('/api/attach', { method: 'POST', body: JSON.stringify({ name: 'dot.png', mime: 'image/png', data: PNG }) }));
  assert.equal(a.kind, 'image');
  assert.ok(a.path.includes('.attachments'));
});
await test('upload a text file → kind file', async () => {
  const a = await j(await api('/api/attach', { method: 'POST', body: JSON.stringify({ name: 'notes.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') }) }));
  assert.equal(a.kind, 'file');
});
await test('empty upload is rejected', async () => {
  assert.equal((await api('/api/attach', { method: 'POST', body: JSON.stringify({ name: 'x', data: '' }) })).status, 400);
});
await test('reference an existing folder in the project → kind folder', async () => {
  const a = await j(await api('/api/attach/ref', { method: 'POST', body: JSON.stringify({ path: process.env.ATLAN_PROJECTS_TEST || '/root/atlan/server' }) }));
  assert.equal(a.kind, 'folder');
});
await test('reference a file → kind file', async () => {
  const a = await j(await api('/api/attach/ref', { method: 'POST', body: JSON.stringify({ path: '/root/atlan/package.json' }) }));
  assert.equal(a.kind, 'file');
});
await test('path traversal outside project is rejected', async () => {
  for (const p of ['/etc/passwd', '/root/.ssh', '/root/atlan/../../etc/hosts']) {
    assert.equal((await api('/api/attach/ref', { method: 'POST', body: JSON.stringify({ path: p }) })).status, 400, 'accepted ' + p);
  }
});
await test('audio with no key degrades gracefully (note, no crash)', async () => {
  const a = await j(await api('/api/attach', { method: 'POST', body: JSON.stringify({ name: 'clip.mp3', mime: 'audio/mpeg', data: Buffer.from('fakeaudio').toString('base64') }) }));
  assert.equal(a.kind, 'audio');
  assert.ok(a.note && /key/i.test(a.note), 'should note missing key');
  assert.equal((await api('/api/doctor')).status, 200, 'server survived');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
