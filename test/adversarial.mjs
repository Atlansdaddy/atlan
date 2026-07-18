// Adversarial suite — hostile inputs against the live cockpit server.
// Run against a server started on a throwaway state dir. Asserts the server
// REFUSES the bad thing (not just "doesn't crash").
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import WebSocket from '../node_modules/ws/index.js';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const ROOT = '/root/atlan';
let pass = 0, fail = 0;
const results = [];

async function test(name, fn) {
  try { await fn(); results.push(['✓', name]); pass++; }
  catch (e) { results.push(['✗', name + ' — ' + e.message]); fail++; }
}
const j = (r) => r.json();
const post = (path, body) => fetch(BASE + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

// ── keys endpoint ──
await test('rejects non-whitelisted key name', async () => {
  const r = await post('/api/keys', { env: 'EVIL_KEY; rm -rf /', value: 'x' });
  assert.equal(r.status, 400, 'should 400 on unknown key');
});
await test('key never returned in plaintext by GET /api/keys', async () => {
  await post('/api/keys', { env: 'OPENAI_API_KEY', value: 'sk-SECRET-should-never-echo-123' });
  const list = await j(await fetch(BASE + '/api/keys'));
  const blob = JSON.stringify(list);
  assert.ok(!blob.includes('sk-SECRET-should-never-echo-123'), 'plaintext key leaked in status');
  assert.ok(blob.includes('123'), 'expected last-4 hint');
});
await test('stored key is encrypted on disk (no plaintext in .keys.enc)', async () => {
  const enc = existsSync(ROOT + '/.keys.enc') ? readFileSync(ROOT + '/.keys.enc', 'utf8') : '';
  assert.ok(!enc.includes('sk-SECRET-should-never-echo-123'), 'plaintext key on disk!');
});
await test('empty value deletes key (no crash, reports unset)', async () => {
  await post('/api/keys', { env: 'OPENAI_API_KEY', value: '' });
  const list = await j(await fetch(BASE + '/api/keys'));
  const k = list.find((x) => x.env === 'OPENAI_API_KEY');
  assert.ok(k && !k.set, 'key should be unset after empty write');
});

// ── preview target: SSRF / non-local guard ──
for (const bad of [
  'http://169.254.169.254/latest/meta-data/',   // cloud metadata
  'http://evil.com/',                            // external
  'file:///etc/passwd',                          // scheme abuse
  'http://127.0.0.1.evil.com/',                  // suffix trick
  'http://localhost.evil.com/',                  // suffix trick 2
  'http://0.0.0.0:8080/',                         // wildcard bind, not loopback
]) {
  await test(`preview target refuses ${bad}`, async () => {
    const r = await post('/api/preview/target', { url: bad });
    assert.equal(r.status, 400, `accepted hostile target ${bad}`);
  });
}
// Loopback (any port) is the INTENDED local-dev policy — pointing at your own
// device is not SSRF. Cross-host is the threat, and it's blocked above.
for (const ok of ['http://127.0.0.1:5173', 'http://localhost:3000', 'http://[::1]:5177']) {
  await test(`preview target accepts local ${ok}`, async () => {
    const r = await post('/api/preview/target', { url: ok });
    assert.equal(r.status, 200, `rejected legit local ${ok}`);
  });
}

// ── projects endpoint: no traversal, only dirs under /root ──
await test('projects only lists dirs under /root', async () => {
  const list = await j(await fetch(BASE + '/api/projects'));
  for (const p of list) assert.ok(p.path.startsWith('/root/'), 'path escaped /root: ' + p.path);
});

// ── static /apk cannot be traversed out ──
await test('/apk blocks path traversal', async () => {
  const r = await fetch(BASE + '/apk/..%2f..%2f..%2fetc%2fpasswd');
  const body = await r.text();
  assert.ok(!body.includes('root:x:0:0'), 'served /etc/passwd via /apk traversal');
});

// ── fleet API rejects bad spawns without burning tokens ──
await test('fleet: unknown profile is a 400', async () => {
  const r = await fetch(BASE + '/api/fleet/run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'x', profile: 'god-mode' }),
  });
  assert.equal(r.status, 400);
});
await test('fleet: empty prompt is a 400', async () => {
  const r = await fetch(BASE + '/api/fleet/run', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '   ', profile: 'scout' }),
  });
  assert.equal(r.status, 400);
});
await test('fleet: kill of unknown id kills nothing', async () => {
  const r = await (await fetch(BASE + '/api/fleet/kill', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'nope1234' }),
  })).json();
  assert.equal(r.killed, 0);
});
await test('fleet: scout profile hard-blocks Bash via disallowedTools', async () => {
  // static contract check, no tokens: the profile table itself must carry it
  const { PROFILES_FOR_TEST } = await import('../server/src/fleet.js');
  assert.ok(PROFILES_FOR_TEST.scout.disallowed.includes('Bash'));
  assert.ok(PROFILES_FOR_TEST.scout.disallowed.includes('WebFetch'));
  assert.ok(PROFILES_FOR_TEST.verifier.disallowed.includes('Edit'));
});

// ── M5b: push + inbox surface ──
await test('push pubkey is a VAPID key', async () => {
  const { key } = await j(await fetch(BASE + '/api/push/pubkey'));
  assert.ok(typeof key === 'string' && key.length > 60);
});
await test('push subscribe rejects garbage', async () => {
  const r = await fetch(BASE + '/api/push/subscribe', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ not: 'a subscription' }),
  });
  assert.equal(r.status, 400);
});
await test('topup of unknown run is a 400', async () => {
  const r = await fetch(BASE + '/api/fleet/topup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'nope1234' }),
  });
  assert.equal(r.status, 400);
});
await test('served sw.js has NO fetch handler (stale-SW landmine stays dead)', async () => {
  const src = await (await fetch(BASE + '/sw.js')).text();
  assert.ok(!/addEventListener\(\s*['"]fetch['"]/.test(src), 'sw.js grew a fetch handler');
  assert.ok(/addEventListener\(\s*['"]push['"]/.test(src), 'sw.js lost its push handler');
});
await test('fleet payload carries durable history for the inbox', async () => {
  const f = await j(await fetch(BASE + '/api/fleet'));
  assert.ok(Array.isArray(f.history));
});

// ── malformed / oversized input doesn't take the server down ──
await test('garbage JSON body is handled', async () => {
  const r = await fetch(BASE + '/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.ok(r.status >= 400 && r.status < 500, 'expected 4xx on bad json, got ' + r.status);
});
await test('server still alive after garbage', async () => {
  const r = await fetch(BASE + '/api/doctor');
  assert.equal(r.status, 200, 'server died after malformed input');
});

// ── WS: malformed frames, unknown types, flooding ──
await test('WS survives malformed + unknown messages', async () => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws');
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send('not json at all');
  ws.send(JSON.stringify({ t: 'nonexistent.type', x: 1 }));
  ws.send(JSON.stringify({ t: 'perm.reply', id: 'never-issued', approved: true }));
  for (let i = 0; i < 200; i++) ws.send(JSON.stringify({ t: 'garbage', i }));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ws.readyState, WebSocket.OPEN, 'WS closed under abuse');
  ws.close();
  // and the HTTP side is still healthy
  assert.equal((await fetch(BASE + '/api/doctor')).status, 200);
});

// ── preflight must honestly report auth-missing as a blocker ──
await test('preflight reports auth-layer blocker (not falsely green)', async () => {
  const p = await j(await fetch(BASE + '/api/preflight'));
  const auth = p.checks.find((c) => c.id === 'auth');
  assert.ok(auth, 'no auth check');
  if (!process.env.ATLAN_TOKEN) {
    assert.equal(auth.ok, false, 'auth check should fail with no token');
    assert.ok(!p.ready, 'preflight should not be ready without auth');
  }
});
await test('preflight flags a plaintext keys.json if present', async () => {
  const p = await j(await fetch(BASE + '/api/preflight'));
  const c = p.checks.find((x) => x.id === 'plainkeys');
  assert.ok(c, 'no plainkeys check');
  assert.equal(c.ok, !existsSync(ROOT + '/keys.json'), 'plainkeys check disagrees with disk');
});

// cleanup test key
await post('/api/keys', { env: 'OPENAI_API_KEY', value: '' });

console.log('\nADVERSARIAL SUITE');
for (const [s, n] of results) console.log(' ', s, n);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
