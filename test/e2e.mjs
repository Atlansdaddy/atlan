// End-to-end suite — real flows through the whole stack, no mocking of the
// parts under test. Uses the Claude Agent SDK live (needs auth) for fleet runs
// and a local mock OpenAI-compat engine for the harness (deterministic, no RAM).
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const api = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });
const j = async (r) => r.json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}
async function poll(id, until, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const f = await j(await api('/api/fleet'));
    const run = f.runs.find((r) => r.id === id) || f.history.find((r) => r.id === id);
    if (run && until(run)) return run;
    await sleep(3000);
  }
  throw new Error('poll timeout for ' + id);
}

// mock engine that serves a good or bad REQUEST_ESTIMATE answer by state
let mockMode = 'good', mockPort = 8099;
const mock = createServer((req, res) => {
  const answers = {
    good: { category: 'washer', parts: ['drain pump'], line_total: 179.98, note: 'Drain pump replacement.' },
    bad: { category: 'spaceship', parts: ['flux capacitor'], line_total: 999, note: '' },
  };
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') return res.end('{"status":"ok"}');
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answers[mockMode]) } }], usage: { total_tokens: 42 } }));
});
await new Promise((r) => mock.listen(mockPort, '127.0.0.1', r));

console.log('E2E SUITE');

// ── real fleet run to completion ──
await test('scout run executes and surfaces a report', async () => {
  const run = await j(await api('/api/fleet/run', { method: 'POST', body: JSON.stringify({
    prompt: 'Read package.json in this project and reply with the two workspace names, nothing else.',
    profile: 'scout', cwd: '/root/atlan', budget: 60000, model: 'claude-haiku-4-5-20251001',
  }) }));
  const done = await poll(run.id, (r) => ['done', 'halted-budget', 'error'].includes(r.status));
  assert.notEqual(done.status, 'error', done.lastLine);
  assert.match((done.resultText || '').toLowerCase(), /server|web/);
});

// ── budget halt → top-up resume (the headline M5b guarantee) ──
await test('a tiny budget HALTS, top-up resumes the same session', async () => {
  const run = await j(await api('/api/fleet/run', { method: 'POST', body: JSON.stringify({
    prompt: 'Read package.json and tell me the license field.', profile: 'scout', cwd: '/root/atlan', budget: 1000,
  }) }));
  const halted = await poll(run.id, (r) => r.status === 'halted-budget');
  assert.ok(halted.resumable, 'halted run not marked resumable');
  const resumed = await j(await api('/api/fleet/topup', { method: 'POST', body: JSON.stringify({ id: run.id, extra: 60000 }) }));
  assert.equal(resumed.resumedFrom, run.id);
  const finished = await poll(resumed.id, (r) => ['done', 'error', 'halted-budget'].includes(r.status));
  assert.notEqual(finished.status, 'error', finished.lastLine);
});

// ── harness: good answer passes every checker ──
let cmdId;
await test('setup: a persona+command for the harness', async () => {
  const p = await j(await api('/api/personas', { method: 'POST', body: JSON.stringify({ name: 'E2E Max', focus: 'appliance estimates' }) }));
  const c = await j(await api('/api/commands', { method: 'POST', body: JSON.stringify({
    name: 'REQUEST_ESTIMATE_E2E', personaId: p.id, focus: 'estimate',
    variables: [
      { name: 'complaint', type: 'string', required: true }, { name: 'parts_available', type: 'string', required: true },
      { name: 'qty', type: 'number', required: true }, { name: 'unit_price', type: 'number', required: true },
    ],
    fields: [
      { name: 'category', type: 'string' }, { name: 'parts', type: 'array' },
      { name: 'line_total', type: 'number' }, { name: 'note', type: 'string' },
    ],
    checkers: [
      { kind: 'enum', field: 'category', values: ['washer', 'dryer', 'other'] },
      { kind: 'subset-of-var', field: 'parts', ofVar: 'parts_available' },
      { kind: 'arith', field: 'line_total', formula: 'qty*unit_price', tolerance: 0.01 },
      { kind: 'not-empty', field: 'note' },
    ],
  }) }));
  cmdId = c.id;
  assert.ok(cmdId);
});
const runHarness = () => api('/api/harness/run', { method: 'POST', body: JSON.stringify({
  commandId: cmdId, engine: 'local', base: `http://127.0.0.1:${mockPort}`,
  vars: { complaint: 'no drain', parts_available: 'drain pump, belt', qty: 2, unit_price: 89.99 },
}) }).then(j);

await test('harness: a correct answer passes ALL checkers', async () => {
  mockMode = 'good';
  const r = await runHarness();
  assert.ok(r.passed, JSON.stringify(r.results?.filter((x) => !x.ok)));
  assert.match(r.tier3, /semantic/);
  assert.equal(r.escalatePrompt, null);
});
await test('harness: a bad answer fails checkers and offers escalation', async () => {
  mockMode = 'bad';
  const r = await runHarness();
  assert.ok(!r.passed);
  const failed = r.results.filter((x) => !x.ok).map((x) => x.check);
  assert.ok(failed.some((c) => c.includes('category')), 'enum not caught');
  assert.ok(failed.some((c) => c.includes('parts')), 'stray part not caught');
  assert.ok(failed.some((c) => c.includes('line_total')), 'bad math not caught');
  assert.ok(r.escalatePrompt, 'no escalation offered');
});
await test('harness escalation spawns a real fleet run', async () => {
  const r = await runHarness(); // still bad mode
  const esc = await j(await api('/api/harness/escalate', { method: 'POST', body: JSON.stringify({ prompt: r.escalatePrompt, budget: 40000 }) }));
  assert.equal(esc.source, 'harness-escalation');
  await api('/api/fleet/kill', { method: 'POST', body: JSON.stringify({ id: esc.id }) });
});

// ── routine fire → inbox linkage ──
await test('a fired routine produces a source-labeled inbox entry', async () => {
  const rt = await j(await api('/api/routines', { method: 'POST', body: JSON.stringify({
    name: 'e2e-fire', prompt: 'reply with exactly: ok', cadence: { kind: 'daily', at: '04:00' }, profile: 'scout', budget: 2000, cwd: '/root/atlan',
  }) }));
  const run = await j(await api('/api/routines/fire', { method: 'POST', body: JSON.stringify({ id: rt.id }) }));
  assert.equal(run.source, 'routine:e2e-fire');
  await poll(run.id, (r) => ['done', 'halted-budget', 'error'].includes(r.status));
  const f = await j(await api('/api/fleet'));
  assert.ok([...f.runs, ...f.history].some((r) => r.source === 'routine:e2e-fire'));
  await api('/api/routines/delete', { method: 'POST', body: JSON.stringify({ id: rt.id }) });
});

// cleanup
await api('/api/commands/delete', { method: 'POST', body: JSON.stringify({ id: cmdId }) });
mock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
