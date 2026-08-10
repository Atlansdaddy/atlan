// Connection suite — the live WebSocket + PTY plumbing under real conditions:
// authed connect, broadcast to multiple clients, malformed-message survival,
// a tmux PTY round-trip, and reconnection after a drop.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws'; // the ws client sets real headers; no token in the URL
import { REPO } from './lib/paths.mjs';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const WS = BASE.replace('http', 'ws') + '/ws';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const authed = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}
// Auth rides the x-atlan-token HEADER (bearer for automation) — never a URL.
const openWs = (token = TOKEN) => new Promise((res, rej) => {
  const ws = new WebSocket(WS, { headers: { 'x-atlan-token': token } });
  ws.on('open', () => res(ws));
  ws.on('close', (code) => rej(new Error('closed ' + code)));
  setTimeout(() => rej(new Error('ws open timeout')), 4000);
});
const nextMsg = (ws, pred, ms = 8000) => new Promise((res, rej) => {
  const on = (data) => { const m = JSON.parse(data.toString()); if (!pred || pred(m)) { ws.off('message', on); res(m); } };
  ws.on('message', on);
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
    const ws = new WebSocket(WS, { headers: { 'x-atlan-token': 'garbage' } });
    ws.on('close', (c) => res(c));
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
  const run = await (await authed('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: 'connection test — reply ok', profile: 'scout', budget: 2000, cwd: REPO }) })).json();
  const [ma, mb] = await Promise.all([gotA, gotB]);
  assert.equal(ma.run.id, run.id);
  assert.equal(mb.run.id, run.id);
  await authed('/api/fleet/kill', { method: 'POST', body: JSON.stringify({ id: run.id }) });
  a.close(); b.close();
});
await test('PTY round-trip: open a tmux pty, echo, receive output', async () => {
  const ws = await openWs();
  ws.send(JSON.stringify({ t: 'pty.open', name: 'conntest', cols: 80, rows: 24, cwd: REPO }));
  const marker = 'ATLAN_PTY_OK';
  // wait for the shell to be ready-ish, then echo a unique marker
  await new Promise((r) => setTimeout(r, 800));
  const got = nextMsg(ws, (m) => m.t === 'pty.data' && String(m.data).includes(marker), 8000);
  ws.send(JSON.stringify({ t: 'pty.input', name: 'conntest', data: `echo ${marker}\n` }));
  const m = await got;
  assert.ok(String(m.data).includes(marker));
  ws.close();
});
await test('a host with no tmux still gets a terminal, not an execvp error', async () => {
  // THE TERM TAB WAS DEAD ON THE PHONE AND NOTHING SAID WHY. openPty spawned
  // `tmux new-session` unconditionally; node-pty forks a live PTY and the exec
  // fails in the CHILD, so a missing tmux surfaced as "execvp(3) failed.: No
  // such file or directory" plus an exit — naming neither tmux nor a fix.
  // Everything downstream went with it, including the engine-login buttons.
  //
  // Driven through the module rather than the socket, because the question is
  // which BINARY gets chosen and the server under test has tmux installed.
  const ptymod = await import('../server/src/pty.js');
  const realPath = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-atlan-test'; // a PATH with no tmux on it
    ptymod._resetTmuxProbe();
    assert.equal(ptymod.ptyPersistent(), false, 'no tmux on PATH must report non-persistent');
  } finally {
    process.env.PATH = realPath;
    ptymod._resetTmuxProbe();
  }
  // …and where tmux DOES exist, persistence is claimed rather than quietly lost.
  const cp = await import('node:child_process');
  const haveTmux = await new Promise((res) => cp.exec('command -v tmux || true', (_e, o) => res(String(o).trim())));
  if (haveTmux) assert.equal(ptymod.ptyPersistent(), true, 'tmux is installed here, so sessions must be persistent');
});
await test('reconnection after a drop re-subscribes to broadcasts', async () => {
  let ws = await openWs();
  ws.close();
  await new Promise((r) => setTimeout(r, 300));
  ws = await openWs(); // fresh connection = the app's reconnect path
  const got = nextMsg(ws, (m) => m.t === 'fleet.run');
  const run = await (await authed('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: 'reconnect test', profile: 'scout', budget: 2000, cwd: REPO }) })).json();
  const m = await got;
  assert.equal(m.run.id, run.id);
  await authed('/api/fleet/kill', { method: 'POST', body: JSON.stringify({ id: run.id }) });
  ws.close();
});

// ── live chat-to-chat delivery ──────────────────────────────────────────────
// The liveChats registry had no coverage: written, reasoned about in a comment,
// never exercised. Everything below drives it over a real socket.
//
// A conversation becomes addressable by SENDING a chat turn, because that is
// what registers the socket — so each test opens a WS, sends one, then messages
// it from outside over HTTP.
const CONV_LIVE = 'conntest-livechat01';
const say = (ws, conv, text) => ws.send(JSON.stringify({ t: 'chat.send', conv, text, engine: 'no-such-engine' }));
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

await test('a message to a LIVE conversation arrives on its socket', async () => {
  const ws = await openWs();
  say(ws, CONV_LIVE, 'register me');
  await settle();

  const arrival = nextMsg(ws, (m) => m.t === 'chat.msg' && m.role === 'peer');
  const r = await (await authed('/api/chats/message', {
    method: 'POST', body: JSON.stringify({ to: CONV_LIVE, text: 'hello from outside', from: 'conntest' }),
  })).json();
  assert.equal(r.delivered, true, `expected live delivery, got ${JSON.stringify(r)}`);

  const m = await arrival;
  assert.equal(m.text, 'hello from outside');
  assert.equal(m.role, 'peer', 'it must arrive as peer — never as the user or the agent');
  assert.equal(m.engine, 'conntest', 'the sender must travel with it');
  ws.close();
});

await test('once the socket closes, the same message QUEUES instead of vanishing', async () => {
  const ws = await openWs();
  say(ws, CONV_LIVE, 'register again');
  await settle();
  ws.close();
  await settle();

  const r = await (await authed('/api/chats/message', {
    method: 'POST', body: JSON.stringify({ to: CONV_LIVE, text: 'sent while away', from: 'conntest' }),
  })).json();
  assert.equal(r.delivered, false, 'nothing is listening, so it must not claim delivery');
  assert.equal(r.queued, true);

  const read = await (await authed(`/api/chats/${CONV_LIVE}`)).json();
  assert.ok(read.messages.some((m) => m.text === 'sent while away'), 'a queued message must be in the transcript');
});

await test('a refresh does not unhook the conversation (the close-race)', async () => {
  // THE BUG THIS GUARDS: app.js reconnects ~1.5s after every close, so a new
  // socket attaches to the same conversation before the old one finishes
  // closing. An unconditional delete on close would unhook the LIVE session
  // that had just replaced it, and messages would silently stop arriving until
  // the next reload. The registry only clears an entry that is still its own.
  const first = await openWs();
  say(first, CONV_LIVE, 'first socket');
  await settle(300);

  const second = await openWs();          // the "refresh"
  say(second, CONV_LIVE, 'second socket');
  await settle(300);
  first.close();                          // the OLD socket closes after the new one registered
  await settle();

  const arrival = nextMsg(second, (m) => m.t === 'chat.msg' && m.role === 'peer');
  const r = await (await authed('/api/chats/message', {
    method: 'POST', body: JSON.stringify({ to: CONV_LIVE, text: 'after the refresh', from: 'conntest' }),
  })).json();
  assert.equal(r.delivered, true, 'the surviving socket must still be registered');
  assert.equal((await arrival).text, 'after the refresh');
  second.close();
});

await test('cleanup: the connection suite leaves no conversation behind', async () => {
  await authed('/api/chats/delete', { method: 'POST', body: JSON.stringify({ id: CONV_LIVE }) });
  const { chats } = await (await authed('/api/chats')).json();
  assert.ok(!chats.some((c) => c.id === CONV_LIVE));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
