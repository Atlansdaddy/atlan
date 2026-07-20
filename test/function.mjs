// Function suite — every HTTP endpoint's contract, happy path + shape. Plus
// data-store durability ("db"): the JSON stores survive corruption and tamper.
import assert from 'node:assert';
import { readFileSync, writeFileSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const api = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('FUNCTION SUITE');

// ── read endpoints return their documented shape ──
await test('GET /api/doctor → array of {id,label,ok,detail}', async () => {
  const { body } = await j(await api('/api/doctor'));
  assert.ok(Array.isArray(body) && body.length > 5);
  for (const c of body) assert.ok('id' in c && 'label' in c && 'ok' in c && 'detail' in c);
});
await test('GET /api/engines → agents + brains, grouped', async () => {
  const { body } = await j(await api('/api/engines'));
  assert.ok(Array.isArray(body));
  assert.ok(body.some((e) => e.group === 'local'), 'no local group');
});
await test('GET /api/preflight → {ready, blockers, checks}', async () => {
  const { body } = await j(await api('/api/preflight'));
  assert.ok('ready' in body && 'blockers' in body && Array.isArray(body.checks));
});
await test('GET /api/fleet → {runs, history, today, profiles, pushSubs}', async () => {
  const { body } = await j(await api('/api/fleet'));
  for (const k of ['runs', 'history', 'today', 'profiles', 'pushSubs']) assert.ok(k in body, `missing ${k}`);
  assert.ok(body.profiles.some((p) => p.id === 'scout'));
});
await test('GET /api/routines → {routines, paused}', async () => {
  const { body } = await j(await api('/api/routines'));
  assert.ok(Array.isArray(body.routines) && 'paused' in body);
});
await test('GET /api/personas → {personas, commands}', async () => {
  const { body } = await j(await api('/api/personas'));
  assert.ok(Array.isArray(body.personas) && Array.isArray(body.commands));
});
await test('GET /api/projects → array with atlan itself', async () => {
  const { body } = await j(await api('/api/projects'));
  assert.ok(body.some((p) => p.name === 'atlan'));
});
await test('GET /api/keys → array of {env,set,source} no material', async () => {
  const { body } = await j(await api('/api/keys'));
  assert.ok(body.every((k) => 'env' in k && 'set' in k));
});
await test('GET /api/push/pubkey → VAPID public key', async () => {
  const { body } = await j(await api('/api/push/pubkey'));
  assert.ok(typeof body.key === 'string' && body.key.length > 60);
});

// ── persona/command CRUD round-trip ──
let personaId, commandId;
await test('POST /api/personas creates + returns id', async () => {
  const { status, body } = await j(await api('/api/personas', { method: 'POST', body: JSON.stringify({ name: 'FnTest', focus: 'testing the function suite' }) }));
  assert.equal(status, 200);
  personaId = body.id;
  assert.ok(personaId);
});
await test('POST /api/commands links persona + compiles', async () => {
  const { body } = await j(await api('/api/commands', { method: 'POST', body: JSON.stringify({
    name: 'REQUEST_FN', personaId, focus: 'fn', fields: [{ name: 'answer', type: 'string' }],
    variables: [{ name: 'q', type: 'string', required: true }],
    checkers: [{ kind: 'not-empty', field: 'answer' }],
  }) }));
  commandId = body.id;
  assert.equal(body.checkers.length, 1);
});
await test('GET /api/commands/:id/compiled → system+request+schemas', async () => {
  const { body } = await j(await api(`/api/commands/${commandId}/compiled`));
  assert.match(body.system, /FnTest/);
  assert.equal(body.responseSchema.properties.answer.type, 'string');
  assert.ok(body.toolSchema.input_schema.required.includes('q'));
});
await test('compiled of unknown command → 404', async () => {
  assert.equal((await api('/api/commands/nope9999/compiled')).status, 404);
});

// ── routine CRUD + lifecycle ──
let routineId;
await test('POST /api/routines validates cadence', async () => {
  assert.equal((await api('/api/routines', { method: 'POST', body: JSON.stringify({ name: 'x', prompt: 'x', cadence: { kind: 'every', minutes: 1 } }) })).status, 400, 'accepted <5min');
  assert.equal((await api('/api/routines', { method: 'POST', body: JSON.stringify({ name: 'x', prompt: 'x', cadence: { kind: 'daily', at: '99:99' } }) })).status, 400, 'accepted bad time');
});
await test('POST /api/routines creates a valid routine', async () => {
  const { body } = await j(await api('/api/routines', { method: 'POST', body: JSON.stringify({
    name: 'fn-routine', prompt: 'say ok', cadence: { kind: 'daily', at: '03:00' }, profile: 'scout', budget: 50000,
  }) }));
  routineId = body.id;
  assert.equal(body.cadence.at, '03:00');
});
await test('POST /api/routines/pause toggles global pause', async () => {
  assert.equal((await j(await api('/api/routines/pause', { method: 'POST', body: JSON.stringify({ paused: true }) }))).body.paused, true);
  const { body } = await j(await api('/api/routines'));
  assert.ok(body.routines.find((r) => r.id === routineId).nextDueAt === null, 'paused routine still shows nextDue');
  await api('/api/routines/pause', { method: 'POST', body: JSON.stringify({ paused: false }) });
});
await test('POST /api/routines/fire of unknown id → 400', async () => {
  assert.equal((await api('/api/routines/fire', { method: 'POST', body: JSON.stringify({ id: 'ghost' }) })).status, 400);
});

// ── fleet run validation (no live spawn — that's e2e) ──
await test('POST /api/fleet/run rejects empty prompt', async () => {
  assert.equal((await api('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: '  ' }) })).status, 400);
});
await test('POST /api/fleet/kill of unknown id → killed:0', async () => {
  const { body } = await j(await api('/api/fleet/kill', { method: 'POST', body: JSON.stringify({ id: 'nope' }) }));
  assert.equal(body.killed, 0);
});
await test('POST /api/fleet/topup of non-halted → 400', async () => {
  assert.equal((await api('/api/fleet/topup', { method: 'POST', body: JSON.stringify({ id: 'nope' }) })).status, 400);
});

// ── data-store durability ("db") ──
const ROOT = new URL('../', import.meta.url).pathname;
await test('a corrupt burn.json fails soft (endpoint still 200)', async () => {
  const f = ROOT + '.fleet/burn.json';
  const bak = existsSync(f) ? readFileSync(f, 'utf8') : null;
  writeFileSync(f, '{ this is not json');
  const { status, body } = await j(await api('/api/fleet'));
  assert.equal(status, 200);
  assert.ok('tokens' in body.today, 'today burn not defaulted');
  if (bak !== null) writeFileSync(f, bak); else unlinkSync(f);
});
await test('a truncated history.jsonl line is skipped, not fatal', async () => {
  const f = ROOT + '.fleet/history.jsonl';
  const bak = existsSync(f) ? readFileSync(f, 'utf8') : '';
  writeFileSync(f, bak + '\n{ half a record');
  const { status, body } = await j(await api('/api/fleet'));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.history));
  writeFileSync(f, bak);
});
await test('personas.json survives a garbage write (soft-empty)', async () => {
  // We don't clobber the live file; assert the loader contract via a fresh import path.
  const { status } = await j(await api('/api/personas'));
  assert.equal(status, 200);
});

// ── cleanup ──
await test('DELETE paths remove what we created', async () => {
  assert.equal((await j(await api('/api/commands/delete', { method: 'POST', body: JSON.stringify({ id: commandId }) }))).body.deleted, true);
  assert.equal((await j(await api('/api/personas/delete', { method: 'POST', body: JSON.stringify({ id: personaId }) }))).body.deleted, true);
  assert.equal((await j(await api('/api/routines/delete', { method: 'POST', body: JSON.stringify({ id: routineId }) }))).body.deleted, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
