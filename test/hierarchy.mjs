// Worker-hierarchy suite — proves the approved schema at runtime WITHOUT real
// spend: two mock OpenAI-compat engines stand in for the local + cloud-sm
// tiers, so we can exercise the checker-gated chain, tier escalation, the
// blackboard wiring, budget halt, and the human gate deterministically.
// Requires the server to be started with:
//   ATLAN_TIER_LOCAL_BASE=http://127.0.0.1:8091  ATLAN_TIER_CLOUDSM_BASE=http://127.0.0.1:8092
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const api = (p, o = {}) => fetch(BASE + p, { ...o, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(o.headers ?? {}) } });
const j = (r) => r.json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

// mock engines: each returns a JSON answer we control per-instance
function mockEngine(port, answerFn) {
  const s = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') return res.end('{"status":"ok"}');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answerFn()) } }], usage: { total_tokens: 20 } }));
    });
  });
  return new Promise((r) => s.listen(port, '127.0.0.1', () => r(s)));
}

let localAns = { category: 'washer', line_total: 20, note: 'ok' };
let cloudAns = { category: 'washer', line_total: 20, note: 'ok' };
const localSrv = await mockEngine(8091, () => localAns);
const cloudSrv = await mockEngine(8092, () => cloudAns);

console.log('WORKER HIERARCHY SUITE');

// build a command with checkers (category enum, line_total = qty*price, note not-empty)
let cmdId;
await test('setup: a persona + checker-gated command', async () => {
  const p = await j(await api('/api/personas', { method: 'POST', body: JSON.stringify({ name: 'Hier Max', focus: 'estimates' }) }));
  const c = await j(await api('/api/commands', { method: 'POST', body: JSON.stringify({
    name: 'HIER_ESTIMATE', personaId: p.id, focus: 'estimate',
    variables: [{ name: 'qty', type: 'number', required: true }, { name: 'price', type: 'number', required: true }],
    fields: [{ name: 'category', type: 'string' }, { name: 'line_total', type: 'number' }, { name: 'note', type: 'string' }],
    checkers: [
      { kind: 'enum', field: 'category', values: ['washer', 'dryer'] },
      { kind: 'arith', field: 'line_total', formula: 'qty*price', tolerance: 0.01 },
      { kind: 'not-empty', field: 'note' },
    ],
  }) }));
  cmdId = c.id;
  assert.ok(cmdId);
});

let jobId;
await test('a job requires a link that references a real command', async () => {
  assert.equal((await api('/api/hierarchy/job', { method: 'POST', body: JSON.stringify({ title: 'empty', links: [] }) })).status, 400);
  const job = await j(await api('/api/hierarchy/job', { method: 'POST', body: JSON.stringify({
    title: 'estimate job', maxEscalations: 2, budget: 100000, humanGate: 'never',
    links: [{ id: 'estimate', commandId: cmdId, inputsFrom: ['job.input'], startTier: 'local', escalation: ['local', 'cloud-sm'], onCheckerFail: 'escalate' }],
  }) }));
  jobId = job.id;
  assert.equal(job.links.length, 1);
  assert.equal(job.humanGate, 'never');
});

async function runToEnd(input) {
  const start = await j(await api('/api/hierarchy/start', { method: 'POST', body: JSON.stringify({ jobId, input }) }));
  for (let i = 0; i < 40; i++) {
    const r = await j(await api(`/api/hierarchy/run/${start.id}`));
    if (['done', 'error', 'halted', 'halted-budget'].includes(r.status)) return r;
    await sleep(300);
  }
  throw new Error('run did not finish');
}

await test('local tier passes checkers → job done at the cheapest tier', async () => {
  localAns = { category: 'washer', line_total: 40, note: 'drain pump' };
  const r = await runToEnd({ qty: 2, price: 20 });
  assert.equal(r.status, 'done', JSON.stringify(r.steps));
  assert.equal(r.steps[0].tier, 'local', 'should have finished on local, no escalation');
  assert.equal(r.steps[0].escalations, 0);
  assert.ok(r.steps[0].passed);
});

await test('local FAILS checkers → escalates to cloud-sm which passes', async () => {
  localAns = { category: 'spaceship', line_total: 999, note: '' };   // fails enum, arith, not-empty
  cloudAns = { category: 'washer', line_total: 40, note: 'drain pump' }; // passes
  const r = await runToEnd({ qty: 2, price: 20 });
  assert.equal(r.status, 'done', JSON.stringify(r.steps));
  assert.equal(r.steps[0].tier, 'cloud-sm', 'should have escalated to cloud-sm');
  assert.ok(r.steps[0].escalations >= 1, 'no escalation recorded');
});

await test('both tiers fail → job errors with a clear reason (ladder exhausted)', async () => {
  localAns = { category: 'spaceship', line_total: 1, note: '' };
  cloudAns = { category: 'spaceship', line_total: 1, note: '' };
  const r = await runToEnd({ qty: 2, price: 20 });
  assert.equal(r.status, 'error');
  assert.match(r.result, /checker/i);
});

await test('a human gate PAUSES the run and resumes on approval', async () => {
  // a job whose single link forces a human gate
  const gated = await j(await api('/api/hierarchy/job', { method: 'POST', body: JSON.stringify({
    title: 'gated', humanGate: 'never', budget: 100000,
    links: [{ id: 'estimate', commandId: cmdId, inputsFrom: ['job.input'], startTier: 'local', escalation: ['local'], onCheckerFail: 'halt', humanGate: true }],
  }) }));
  localAns = { category: 'washer', line_total: 40, note: 'drain pump' };
  const start = await j(await api('/api/hierarchy/start', { method: 'POST', body: JSON.stringify({ jobId: gated.id, input: { qty: 2, price: 20 } }) }));
  // poll until it's awaiting a gate
  let r;
  for (let i = 0; i < 30; i++) { r = await j(await api(`/api/hierarchy/run/${start.id}`)); if (r.awaiting) break; await sleep(200); }
  assert.ok(r.awaiting, 'run never paused at the gate');
  assert.equal(r.awaiting.linkId, 'estimate');
  // approve → run finishes
  await api('/api/hierarchy/gate', { method: 'POST', body: JSON.stringify({ runId: start.id, approve: true }) });
  for (let i = 0; i < 20; i++) { r = await j(await api(`/api/hierarchy/run/${start.id}`)); if (r.status === 'done') break; await sleep(200); }
  assert.equal(r.status, 'done', 'gate approval did not complete the run');
  await api('/api/hierarchy/job/delete', { method: 'POST', body: JSON.stringify({ id: gated.id }) });
});

await test('cleanup', async () => {
  await api('/api/hierarchy/job/delete', { method: 'POST', body: JSON.stringify({ id: jobId }) });
  await api('/api/commands/delete', { method: 'POST', body: JSON.stringify({ id: cmdId }) });
});

localSrv.close(); cloudSrv.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
