// Live engine checkup — proves every CONFIGURED engine actually answers, end
// to end through the real WS, and says exactly what each unconfigured one
// needs. Opt-in (it spends real quota on subscription engines and real tokens
// on keyed ones): RUN_LIVE_ENGINES=1 node test/engines-live.mjs
// Works against the live cockpit by default, or a test instance via
// ATLAN_BASE/ATLAN_TOKEN like every other suite.
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws'; // the ws client sets real headers; no token in the URL

if (!process.env.RUN_LIVE_ENGINES) {
  console.log('engines-live: opt-in only — RUN_LIVE_ENGINES=1 node test/engines-live.mjs');
  process.exit(0);
}

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const WSURL = BASE.replace(/^http/, 'ws') + '/ws';
const PROBE = 'Reply with the single word OK and nothing else.';
const CWD = process.env.ENGINES_LIVE_CWD ?? process.cwd(); // agents need a trusted repo dir

const roster = await (await fetch(`${BASE}/api/engines`, { headers: { 'x-atlan-token': TOKEN } })).json();

function probe(engine, timeoutMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WSURL, { headers: { 'x-atlan-token': TOKEN } });
    let reply = '';
    const t0 = Date.now();
    const done = (verdict) => { try { ws.close(); } catch { /* */ } resolve({ verdict, ms: Date.now() - t0, reply: reply.trim().slice(0, 60) }); };
    const timer = setTimeout(() => done('TIMEOUT'), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'chat.send', text: PROBE, engine, cwd: CWD })));
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if ((m.t === 'chat.msg' || m.t === 'chat.delta') && m.text) reply += m.text;
      if (m.t === 'chat.err') { reply = m.msg; clearTimeout(timer); done('ERROR'); }
      if (m.t === 'chat.result') { clearTimeout(timer); done(/\bok\b/i.test(reply) ? 'PASS' : 'ODD_REPLY'); }
    });
    ws.on('error', (e) => { reply = e.message; clearTimeout(timer); done('WS_ERROR'); });
  });
}

console.log('ENGINE CHECKUP — live, end to end\n');
let pass = 0, tested = 0;
for (const e of roster) {
  if (e.id === 'claude') continue; // covered below with the agent group
  if (!e.ready) { console.log(`  ⏭  ${e.label.padEnd(42)} needs: ${e.needs}`); continue; }
  tested++;
  const r = await probe(e.id, e.group === 'agent' ? 180000 : 90000);
  if (r.verdict === 'PASS') pass++;
  console.log(`  ${r.verdict === 'PASS' ? '✓' : '✗'}  ${e.label.padEnd(42)} ${r.verdict} ${r.ms}ms ${r.verdict === 'PASS' ? '' : '— ' + r.reply}`);
}
// Claude (Agent SDK) — always present, subscription-authed
tested++;
const c = await probe('claude', 180000);
if (c.verdict === 'PASS') pass++;
console.log(`  ${c.verdict === 'PASS' ? '✓' : '✗'}  ${'Claude Code (Agent SDK, subscription)'.padEnd(42)} ${c.verdict} ${c.ms}ms ${c.verdict === 'PASS' ? '' : '— ' + c.reply}`);

console.log(`\n${pass} passed, ${tested - pass} failed of ${tested} configured engines (${roster.filter((e) => !e.ready).length} not configured)`);
process.exit(pass === tested ? 0 : 1);
