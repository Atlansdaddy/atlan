// Connection suite — the live WebSocket + PTY plumbing under real conditions:
// authed connect, broadcast to multiple clients, malformed-message survival,
// a tmux PTY round-trip, and reconnection after a drop.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const WS = BASE.replace('http', 'ws') + '/ws';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const authed = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}
const openWs = (token = TOKEN) => new Promise((res, rej) => {
  const ws = new WebSocket(`${WS}?token=${encodeURIComponent(token)}`);
  ws.onopen = () => res(ws);
  ws.onclose = (e) => rej(new Error('closed ' + e.code));
  setTimeout(() => rej(new Error('ws open timeout')), 4000);
});
const nextMsg = (ws, pred, ms = 8000) => new Promise((res, rej) => {
  const on = (ev) => { const m = JSON.parse(ev.data); if (!pred || pred(m)) { ws.removeEventListener('message', on); res(m); } };
  ws.addEventListener('message', on);
  setTimeout(() => rej(new Error('no matching msg')), ms);
});

console.log('CONNECTION SUITE');

await test('authed WS connects', async () => {
  const ws = await openWs();
  assert.equal(ws.readyState, 1);
  ws.close();
});
await test('WS with a bad token is closed 4001 (even if handshake completes)', async () => {
  const code = await new Promise((res) => {
    const ws = new WebSocket(`${WS}?token=garbage`);
    ws.onclose = (e) => res(e.code);
    setTimeout(() => res(0), 4000);
  });
  assert.equal(code, 4001, `expected 4001, got ${code}`);
});
await test('malformed frames + unknown types do not drop the socket', async () => {
  const ws = await openWs();
  ws.send('not json at all');
  ws.send(JSON.stringify({ t: 'nonexistent.type', junk: true }));
  ws.send(JSON.stringify({ t: 'chat.send' })); // missing fields
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(ws.readyState, 1, 'socket died under malformed input');
  ws.close();
});
await test('fleet events broadcast to ALL connected clients', async () => {
  const a = await openWs(), b = await openWs();
  const gotA = nextMsg(a, (m) => m.t === 'fleet.run');
  const gotB = nextMsg(b, (m) => m.t === 'fleet.run');
  const run = await (await authed('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: 'connection test — reply ok', profile: 'scout', budget: 2000, cwd: '/root/atlan' }) })).json();
  const [ma, mb] = await Promise.all([gotA, gotB]);
  assert.equal(ma.run.id, run.id);
  assert.equal(mb.run.id, run.id);
  await authed('/api/fleet/kill', { method: 'POST', body: JSON.stringify({ id: run.id }) });
  a.close(); b.close();
});
await test('PTY round-trip: open a tmux pty, echo, receive output', async () => {
  const ws = await openWs();
  ws.send(JSON.stringify({ t: 'pty.open', name: 'conntest', cols: 80, rows: 24, cwd: '/root/atlan' }));
  const marker = 'ATLAN_PTY_OK';
  // wait for the shell to be ready-ish, then echo a unique marker
  await new Promise((r) => setTimeout(r, 800));
  const got = nextMsg(ws, (m) => m.t === 'pty.data' && String(m.data).includes(marker), 8000);
  ws.send(JSON.stringify({ t: 'pty.input', name: 'conntest', data: `echo ${marker}\n` }));
  const m = await got;
  assert.ok(String(m.data).includes(marker));
  ws.close();
});
await test('reconnection after a drop re-subscribes to broadcasts', async () => {
  let ws = await openWs();
  ws.close();
  await new Promise((r) => setTimeout(r, 300));
  ws = await openWs(); // fresh connection = the app's reconnect path
  const got = nextMsg(ws, (m) => m.t === 'fleet.run');
  const run = await (await authed('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: 'reconnect test', profile: 'scout', budget: 2000, cwd: '/root/atlan' }) })).json();
  const m = await got;
  assert.equal(m.run.id, run.id);
  await authed('/api/fleet/kill', { method: 'POST', body: JSON.stringify({ id: run.id }) });
  ws.close();
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
