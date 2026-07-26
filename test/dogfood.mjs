// Dogfood receipts — exercises the cockpit the way a person actually uses it:
// multi-model brains on one prompt, real multimodal with KNOWN ground truth,
// and the agent engines on a real task. Every claim here is checked against
// something verifiable, not eyeballed.
//
// Opt-in (spends real quota/tokens):  RUN_DOGFOOD=1 node test/dogfood.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';

if (!process.env.RUN_DOGFOOD) {
  console.log('dogfood: opt-in only — RUN_DOGFOOD=1 node test/dogfood.mjs');
  process.exit(0);
}

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const WSURL = BASE.replace(/^http/, 'ws') + '/ws';
const CWD = process.env.DOGFOOD_CWD ?? '/root/atlan';
const H = { 'x-atlan-token': TOKEN, 'content-type': 'application/json' };
const FIX = new URL('./fixtures/', import.meta.url);

// Ground truth baked into test/fixtures/ by the generator — see receipts header.
const TRUTH = { colors: ['red', 'green', 'blue', 'yellow'], circles: 7, hz: 440 };

const rows = [];
const rec = (group, name, verdict, ms, detail) => {
  rows.push({ group, name, verdict, ms, detail });
  const mark = verdict === 'PASS' ? '✓' : verdict === 'PARTIAL' ? '~' : '✗';
  console.log(`  ${mark} ${name.padEnd(34)} ${String(verdict).padEnd(8)} ${String(ms) + 'ms'} ${detail ? '— ' + detail.slice(0, 90) : ''}`);
};

async function attach(file, mime) {
  const data = readFileSync(new URL(file, FIX)).toString('base64');
  const r = await fetch(`${BASE}/api/attach`, { method: 'POST', headers: H, body: JSON.stringify({ name: file, mime, data }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}

function chat(engine, text, { attachments = [], model, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WSURL, { headers: { 'x-atlan-token': TOKEN } });
    let reply = '';
    const t0 = Date.now();
    const done = (verdict) => { try { ws.close(); } catch { /* */ } resolve({ verdict, ms: Date.now() - t0, reply: reply.trim() }); };
    const timer = setTimeout(() => done('TIMEOUT'), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'chat.send', text, cwd: CWD, engine, model, attachments })));
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if ((m.t === 'chat.msg' || m.t === 'chat.delta') && m.text) reply += m.text;
      if (m.t === 'chat.err') { reply = m.msg; clearTimeout(timer); done('ERROR'); }
      if (m.t === 'chat.result') { clearTimeout(timer); done('OK'); }
    });
    ws.on('error', (e) => { reply = e.message; clearTimeout(timer); done('WS_ERROR'); });
  });
}

const roster = await (await fetch(`${BASE}/api/engines`, { headers: H })).json();
const ready = roster.filter((e) => e.ready);
const readyIds = new Set(ready.map((e) => e.id));
console.log(`\nDOGFOOD RECEIPTS — ${ready.length} engines ready: ${[...readyIds].join(', ')}, claude\n`);

// ── 1. Multi-model: one deterministic question, every ready brain ────────────
// Deterministic so a wrong answer is unambiguous, and small so it's cheap.
console.log('1. MULTI-MODEL BRAINS — same prompt, every ready brain');
const Q = 'A shelf holds 3 boxes. Each box holds 4 bags. Each bag holds 5 marbles. How many marbles total? Reply with only the number.';
for (const e of ready.filter((x) => x.group !== 'agent')) {
  const r = await chat(e.id, Q, { timeoutMs: 90000 });
  const hit = /\b60\b/.test(r.reply);
  rec('multi-model', e.label, r.verdict === 'OK' ? (hit ? 'PASS' : 'WRONG') : r.verdict, r.ms,
    hit ? r.reply.replace(/\s+/g, ' ').slice(0, 40) : r.reply.replace(/\s+/g, ' ').slice(0, 80));
}

// ── 2. Multimodal image — known quadrants + countable circles ────────────────
console.log('\n2. MULTIMODAL IMAGE — 512x512, TL=red TR=green BL=blue BR=yellow, 7 circles');
let img;
try {
  img = await attach('mm-quadrants.png', 'image/png');
  rec('multimodal', 'upload classified as image', img.kind === 'image' ? 'PASS' : 'FAIL', 0, `kind=${img.kind}`);
} catch (err) { rec('multimodal', 'image upload', 'FAIL', 0, err.message); }

if (img?.kind === 'image') {
  const P = 'Look at the attached image. Name the colour of each quadrant (top-left, top-right, bottom-left, bottom-right) and count the white circles. Be brief.';
  for (const id of ['gemini', 'claude'].filter((x) => x === 'claude' || readyIds.has(x))) {
    const r = await chat(id, P, { attachments: [img], timeoutMs: 180000 });
    const lc = r.reply.toLowerCase();
    const gotColors = TRUTH.colors.filter((c) => lc.includes(c)).length;
    const gotCount = new RegExp(`\\b${TRUTH.circles}\\b`).test(r.reply);
    const verdict = r.verdict !== 'OK' ? r.verdict : (gotColors === 4 && gotCount) ? 'PASS' : (gotColors >= 2 || gotCount) ? 'PARTIAL' : 'FAIL';
    rec('multimodal', `image read · ${id}`, verdict, r.ms, `${gotColors}/4 colours, circles ${gotCount ? '✓' : '✗'} — ${r.reply.replace(/\s+/g, ' ').slice(0, 70)}`);
  }
}

// ── 3. Multimodal audio — describeMedia runs at upload time ──────────────────
console.log('\n3. MULTIMODAL AUDIO — 3s 440Hz sine (A4)');
const tAudio = Date.now();
try {
  const aud = await attach('mm-tone-440.wav', 'audio/wav');
  const note = (aud.note ?? '').toLowerCase();
  const heard = /tone|sine|beep|hum|pitch|frequency|note|a4|440|steady|continuous|music/.test(note);
  rec('multimodal', 'audio auto-described', aud.kind !== 'audio' ? 'FAIL' : !aud.note ? 'NO_NOTE' : heard ? 'PASS' : 'ODD',
    Date.now() - tAudio, `kind=${aud.kind} note="${(aud.note ?? '(null)').replace(/\s+/g, ' ').slice(0, 80)}"`);
} catch (err) { rec('multimodal', 'audio upload', 'FAIL', Date.now() - tAudio, err.message); }

// ── 4. Agents on a real repo task (read-only, verifiable) ────────────────────
console.log('\n4. AGENTS — real repo task, answer checkable against the tree');
const AQ = 'In this repo, how many dependencies are listed in the root package.json "dependencies" block? Reply with only the number.';
for (const id of ['claude', 'codex'].filter((x) => x === 'claude' || readyIds.has(x))) {
  const r = await chat(id, AQ, { timeoutMs: 240000 });
  const hit = /\b3\b/.test(r.reply);
  rec('agent', `repo read · ${id}`, r.verdict === 'OK' ? (hit ? 'PASS' : 'WRONG') : r.verdict, r.ms, r.reply.replace(/\s+/g, ' ').slice(0, 70));
}

// ── receipts ────────────────────────────────────────────────────────────────
const pass = rows.filter((r) => r.verdict === 'PASS').length;
const stamp = new Date().toISOString();
const md = [
  `# Dogfood receipts — ${stamp}`, '',
  `Run: \`RUN_DOGFOOD=1 node test/dogfood.mjs\` against \`${BASE}\`, cwd \`${CWD}\`.`,
  `Engines ready at run time: ${[...readyIds].join(', ')}, claude.`, '',
  '**Fixtures carry known ground truth** (`test/fixtures/`, regenerable):',
  '- `mm-quadrants.png` — 512×512, TL=red TR=green BL=blue BR=yellow, exactly 7 white circles',
  '- `mm-tone-440.wav` — 3 s mono 16 kHz, 440 Hz sine (A4)', '',
  `**${pass} PASS of ${rows.length} checks.**`, '',
  '| Group | Check | Verdict | ms | Detail |', '|---|---|---|--:|---|',
  ...rows.map((r) => `| ${r.group} | ${r.name} | **${r.verdict}** | ${r.ms || ''} | ${(r.detail || '').replace(/\|/g, '\\|')} |`),
].join('\n') + '\n';
writeFileSync(new URL(`../docs/RECEIPTS-DOGFOOD.md`, import.meta.url), md);
console.log(`\n${pass}/${rows.length} PASS — receipts written to docs/RECEIPTS-DOGFOOD.md`);
