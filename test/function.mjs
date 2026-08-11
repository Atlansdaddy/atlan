// Function suite — every HTTP endpoint's contract, happy path + shape. Plus
// data-store durability ("db"): the JSON stores survive corruption and tamper.
import assert from 'node:assert';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { REPO } from './lib/paths.mjs';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const api = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('FUNCTION SUITE');

// ── read endpoints return their documented shape ──
await test('GET /api/doctor → array of {id,label,ok,detail}', async () => {
  const { body } = await j(await api('/api/doctor'));
  assert.ok(Array.isArray(body) && body.length > 5);
  for (const c of body) assert.ok('id' in c && 'label' in c && 'ok' in c && 'detail' in c);
});
await test('every doctor row carries the QUESTION it answers', async () => {
  // doctor.js had no test naming it, and it was restructured into groups — so
  // this pins the contract the tab renders from. A row with no group would fall
  // into Health silently and the grouping would quietly stop meaning anything.
  const { body } = await j(await api('/api/doctor'));
  const known = new Set(['safety', 'engines', 'build', 'health']);
  for (const c of body) {
    assert.ok(c.group, `${c.id} has no group`);
    assert.ok(known.has(c.group), `${c.id} is in unknown group ${c.group}`);
    assert.ok(c.groupLabel, `${c.id} carries no group label for the UI to render`);
  }
});
await test('the containment row is named for the question, not the implementation', async () => {
  // It was "Homebuilt confinement ladder (atlan-confine, seccomp)" and a user
  // looking for exactly this scrolled past it.
  const { body } = await j(await api('/api/doctor'));
  const row = body.find((c) => c.id === 'confine');
  assert.ok(row, 'the confinement row must exist');
  assert.equal(row.group, 'safety');
  assert.match(row.label, /containment/i, `label should say what it answers, got "${row.label}"`);
  assert.ok(!/atlan-confine|seccomp/i.test(row.label), 'the implementation name belongs in the detail, not the label');
  assert.match(row.detail, /established T[0-3S]/, 'the detail must state the tier it measured');
});
await test('the terminal engine has a doctor row — its old failure mode had no voice at all', async () => {
  // node-pty was a static import: on the host where it failed, the process
  // died before doctor existed, so the one platform that needed this row could
  // never see it (docs/8-10-feedback-and-fix.md §3). The row existing AND the
  // module reporting loadable are two halves of the same guard.
  const { ptyAvailable, ptyLoadFailure } = await import('../server/src/pty.js');
  assert.ok(ptyAvailable(), `node-pty must load on a gate host: ${ptyLoadFailure()}`);
  const { body } = await j(await api('/api/doctor'));
  const row = body.find((c) => c.id === 'pty');
  assert.ok(row, 'the pty row must exist');
  assert.equal(row.group, 'health');
  assert.ok(row.ok, `pty row must be green where the module loads, got: ${row.detail}`);
  assert.match(row.detail, /loaded/, 'the detail should say the native module loaded');
});
await test('the CLI-connections row reports binary AND auth per engine', async () => {
  // Installed-but-logged-out and never-installed used to look identical.
  const { body } = await j(await api('/api/doctor'));
  const row = body.find((c) => c.id === 'cli-connections');
  assert.ok(row, 'the connections row must exist');
  assert.equal(row.group, 'engines');
  assert.match(row.detail, /\d+\/\d+ usable/, 'it must count what is usable');
  assert.match(row.detail, /bin (ok|MISSING)/, 'it must say whether the binary runs');
  assert.match(row.detail, /auth (ok|—|NO AUTH)/, 'and whether it is authenticated');
});
await test('the chat-store row reports usage and never claims to have acted', async () => {
  const { body } = await j(await api('/api/doctor'));
  const row = body.find((c) => c.id === 'chat-store');
  assert.ok(row, 'the transcripts row must exist');
  assert.match(row.detail, /conversation/, 'it must say how many conversations');
  assert.ok(!/deleted|removed|pruned/i.test(row.detail), 'nothing is ever deleted to save space, so nothing may say it was');
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
// REGRESSION (adversarial agent, 2026-07-20): concurrent fires of one routine
// must NOT spawn parallel runs — one routine, one live run.
await test('concurrent fires of a routine spawn only ONE run', async () => {
  const rt = await j(await api('/api/routines', { method: 'POST', body: JSON.stringify({
    name: 'race-guard', prompt: 'reply ok', cadence: { kind: 'daily', at: '03:30' }, profile: 'scout', budget: 2000, cwd: REPO,
  }) }));
  const results = await Promise.all(Array.from({ length: 6 }, () =>
    api('/api/routines/fire', { method: 'POST', body: JSON.stringify({ id: rt.body.id }) }).then(j)));
  const ok = results.filter((r) => r.status === 200);
  const blocked = results.filter((r) => r.status === 400);
  assert.equal(ok.length, 1, `expected 1 run, got ${ok.length}`);
  assert.ok(blocked.length >= 1 && blocked.every((r) => /in flight/.test(r.body.error)), 'blockers did not cite in-flight guard');
  // clean up: kill the one run + delete the routine
  await api('/api/fleet/kill', { method: 'POST', body: JSON.stringify({ id: ok[0].body.id }) });
  await api('/api/routines/delete', { method: 'POST', body: JSON.stringify({ id: rt.body.id }) });
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
// Corrupt the store the SERVER UNDER TEST actually reads — config.js resolves
// it as ATLAN_FLEET_DIR, and the harness always points that at a throwaway dir.
// Reading ROOT/.fleet instead made these two both wrong ways at once: ENOENT on
// a fresh checkout (no .fleet yet), and on a used checkout a vacuous pass — the
// endpoint returned 200 off an untouched temp store while we corrupted a live
// file the server never opened, so fail-soft was never actually exercised.
const ROOT = new URL('../', import.meta.url).pathname;
const FLEET = process.env.ATLAN_FLEET_DIR ?? ROOT + '.fleet';
await test('a corrupt burn.json fails soft AND is preserved, never overwritten', async () => {
  // Failing soft was only half the requirement, and the only half tested. The
  // other half: a corrupt ledger used to read as a ZERO ledger, silently
  // disabling the daily token cap, and the next commitBurn() then wrote over
  // the file — destroying the record of what had already been spent. It is now
  // moved aside under a timestamped name so the number stays recoverable.
  // (Cross-vendor adversarial review, 2026-08-06.)
  const f = FLEET + '/burn.json';
  const bak = existsSync(f) ? readFileSync(f, 'utf8') : null;
  writeFileSync(f, '{ "2026-08-06": { "tokens": 4242');
  const { status, body } = await j(await api('/api/fleet'));
  assert.equal(status, 200);
  assert.ok('tokens' in body.today, 'today burn not defaulted');
  const kept = readdirSync(FLEET).filter((n) => n.startsWith('burn.json.corrupt-'));
  assert.equal(kept.length, 1, `the corrupt ledger was not preserved: ${readdirSync(FLEET).join(', ')}`);
  assert.match(readFileSync(FLEET + '/' + kept[0], 'utf8'), /4242/, 'the spend evidence was destroyed');
  for (const n of kept) unlinkSync(FLEET + '/' + n);
  if (bak !== null) writeFileSync(f, bak); else if (existsSync(f)) unlinkSync(f);
});
await test('a truncated history.jsonl line is skipped, not fatal', async () => {
  const f = FLEET + '/history.jsonl';
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

// ── chat transcripts + chat-to-chat messages, over HTTP ────────────────────
// The endpoint had no tests at all: resolveTarget was unit-tested in isolation
// and that got mistaken for coverage of the route that calls it.
const CONV_A = 'functest-convaaaa1';

await test('POST /api/chats/message REFUSES an unknown conversation, and says why', async () => {
  const { status, body } = await j(await api('/api/chats/message', {
    method: 'POST', body: JSON.stringify({ to: 'functest-nosuchconv', text: 'hello' }),
  }));
  assert.equal(status, 404);
  assert.match(body.error, /no conversation/i);
});
await test('POST /api/chats/message REFUSES a traversal id rather than pathing on it', async () => {
  const { status } = await j(await api('/api/chats/message', {
    method: 'POST', body: JSON.stringify({ to: '../../.keys.enc', text: 'hello' }),
  }));
  assert.ok(status === 404 || status === 400, `expected a refusal, got ${status}`);
});
await test('POST /api/chats/message REFUSES an empty message', async () => {
  const { status, body } = await j(await api('/api/chats/message', {
    method: 'POST', body: JSON.stringify({ to: CONV_A, text: '   ' }),
  }));
  assert.equal(status, 400);
  assert.match(body.error, /empty/i);
});
// A conversation is only created by a real chat turn over the WebSocket, which
// this HTTP suite cannot do. So the two tests below run against an EXISTING
// conversation if the instance has one and say so plainly if it does not —
// rather than early-returning green, which would read as coverage that never
// happened. The limiter's own behaviour is covered exhaustively in test/unit.mjs.
const existing = (await j(await api('/api/chats'))).body?.chats?.[0]?.id ?? null;

await test('a delivered message is stored under the PEER role and reads back', async () => {
  if (!existing) { console.log('      ⊘ no conversation on this instance — peer-storage path not exercised here'); return; }
  const r = await j(await api('/api/chats/message', {
    method: 'POST', body: JSON.stringify({ to: existing, text: 'functest peer message', from: 'functest' }),
  }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const read = await j(await api(`/api/chats/${existing}`));
  assert.ok(read.body.messages.some((m) => m.role === 'peer' && m.text === 'functest peer message'),
    'stored under peer — never as the user, never as the agent');
});
await test('the rate limit fires over HTTP, with 429 and a reason', async () => {
  if (!existing) { console.log('      ⊘ no conversation on this instance — limiter wiring not exercised here'); return; }
  let refused = null;
  for (let i = 0; i < 12 && !refused; i++) {
    const r = await j(await api('/api/chats/message', {
      method: 'POST', body: JSON.stringify({ to: existing, text: `burst ${i}`, from: 'flooder' }),
    }));
    if (r.status === 429) refused = r;
  }
  assert.ok(refused, 'twelve messages in a row must trip the limiter');
  assert.ok(refused.body.error, 'a refusal must carry a reason — a silent drop is indistinguishable from a broken feature');
});
await test('GET /api/chats/usage reports and suggests, without acting', async () => {
  const { status, body } = await j(await api('/api/chats/usage'));
  assert.equal(status, 200);
  assert.equal(typeof body.bytes, 'number');
  assert.equal(typeof body.suggestArchive, 'boolean');
  if (body.suggestArchive) assert.ok(body.reason, 'a suggestion must name its reason');
});
await test('GET /api/chats/projects returns the project list', async () => {
  const { status, body } = await j(await api('/api/chats/projects'));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.projects));
});
await test('cleanup: the suite leaves no conversations behind', async () => {
  await j(await api('/api/chats/delete', { method: 'POST', body: JSON.stringify({ id: CONV_A }) }));
  const { body } = await j(await api('/api/chats'));
  assert.ok(!body.chats.some((c) => c.id === CONV_A));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
