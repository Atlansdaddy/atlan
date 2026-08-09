// ladder.mjs — the chat escalation ladder.
//
// The thing under test is the ESCALATION TRIGGER, and the property that matters
// most is what it refuses to claim. It must escalate on observable facts (error,
// empty, truncated, stated incapacity) and must NOT pretend to detect a
// confidently wrong answer — that is the honest limit of the design, and a test
// that asserted otherwise would be encoding a promise the code cannot keep.

import assert from 'node:assert';
import {
  shouldEscalate, normaliseLadder, describeRung, ladderRungs, runLadder,
  CHAT_LADDER, MIN_USEFUL_CHARS, INCAPACITY_PATTERNS,
} from '../server/src/ladder.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('LADDER SUITE');

const GOOD = 'The capital of France is Paris, which has been the seat of government since the 10th century.';

// ── the trigger ────────────────────────────────────────────────────────────
test('a substantive answer does NOT escalate', () => {
  const r = shouldEscalate({ text: GOOD });
  assert.equal(r.escalate, false);
  assert.equal(r.reason, null);
});

test('an error escalates, and the reason names the error', () => {
  const r = shouldEscalate({ text: '', error: 'ECONNREFUSED :8080' });
  assert.equal(r.escalate, true);
  assert.match(r.reason, /errored/i);
  assert.match(r.reason, /ECONNREFUSED/, 'the cause must survive into the reason');
});

test('an error escalates even when text is present', () => {
  // A partial answer plus an error is still a failed rung.
  assert.equal(shouldEscalate({ text: GOOD, error: 'timeout' }).escalate, true);
});

test('empty and whitespace-only responses escalate', () => {
  for (const t of ['', '   ', '\n\n\t']) {
    assert.equal(shouldEscalate({ text: t }).escalate, true, JSON.stringify(t));
  }
  assert.equal(shouldEscalate({ text: null }).escalate, true);
  assert.equal(shouldEscalate({ text: undefined }).escalate, true);
});

test('a too-short response escalates and reports its length', () => {
  const r = shouldEscalate({ text: 'Yes.' });
  assert.equal(r.escalate, true);
  assert.match(r.reason, /4 chars/);
});

test('the length boundary is exact and not off-by-one', () => {
  const atLimit = 'x'.repeat(MIN_USEFUL_CHARS);
  const under = 'x'.repeat(MIN_USEFUL_CHARS - 1);
  assert.equal(shouldEscalate({ text: atLimit }).escalate, false, 'exactly at the limit is acceptable');
  assert.equal(shouldEscalate({ text: under }).escalate, true, 'one under is not');
});

test('a truncated response escalates even when long and substantive', () => {
  const r = shouldEscalate({ text: GOOD, truncated: true });
  assert.equal(r.escalate, true);
  assert.match(r.reason, /cut off/i);
});

test('stated incapacity escalates', () => {
  const phrases = [
    "I don't have information about that.",
    'I cannot answer this question without more detail.',
    "I'm not able to help with that particular request.",
    'That is beyond my training data and knowledge.',
    'There is insufficient context to answer properly.',
    'I would need additional details to respond to this.',
  ];
  for (const p of phrases) {
    assert.equal(shouldEscalate({ text: p }).escalate, true, p);
  }
});

test('incapacity detection is case-insensitive', () => {
  assert.equal(shouldEscalate({ text: 'i cannot answer that question at all here.' }).escalate, true);
});

test('every INCAPACITY_PATTERN actually fires on something', () => {
  // NOT vacuous: a pattern that can never match would silently weaken the
  // trigger while looking like coverage.
  const corpus = [
    "I don't have that", 'I do not know that', 'I cannot do it', "I can't do it",
    'I am unable to comply', "I'm not able to assist", 'beyond my capabilities here',
    'insufficient context provided', 'I would need more time',
  ];
  for (const re of INCAPACITY_PATTERNS) {
    assert.ok(corpus.some((s) => re.test(s)), `pattern ${re} matches nothing in the corpus`);
  }
});

test('THE HONEST LIMIT: a confident wrong answer does NOT escalate', () => {
  // This is the design's stated boundary, asserted so nobody later "fixes" it
  // by adding a model-grades-the-model check and calls it a wall.
  const confidentlyWrong = 'The capital of France is Berlin, which has held that role since 1789.';
  assert.equal(shouldEscalate({ text: confidentlyWrong }).escalate, false,
    'no deterministic check can catch this — the ladder must not pretend otherwise');
});

test('discussing inability in the abstract does not trip the trigger', () => {
  // Guards against over-eager escalation on legitimate content.
  const meta = 'Rate limiting is how an API signals that a client should slow down and retry later.';
  assert.equal(shouldEscalate({ text: meta }).escalate, false);
});

// ── ladder shape ───────────────────────────────────────────────────────────
test('the default chat ladder climbs cheapest-first', () => {
  assert.deepEqual(CHAT_LADDER, ['local', 'cloud-sm', 'frontier']);
});

test('the agentic rung is NOT on the default chat ladder', () => {
  // It has hands and a second vendor — opt-in only, same rule as the hierarchy.
  assert.ok(!CHAT_LADDER.includes('agentic'),
    'a rung with filesystem access must never be reached silently from chat');
});

test('normaliseLadder falls back to the default for empty input', () => {
  assert.deepEqual(normaliseLadder(), CHAT_LADDER);
  assert.deepEqual(normaliseLadder([]), CHAT_LADDER);
  assert.deepEqual(normaliseLadder(null), CHAT_LADDER);
});

test('normaliseLadder rejects an unknown tier, naming the valid set', () => {
  assert.throws(
    () => normaliseLadder(['local', 'wishful']),
    (e) => /unknown tier: wishful/.test(e.message) && /frontier/.test(e.message),
  );
});

test('normaliseLadder rejects a repeated tier', () => {
  assert.throws(() => normaliseLadder(['local', 'local']), /repeated tier/i);
});

test('normaliseLadder accepts a deliberate agentic opt-in', () => {
  assert.deepEqual(normaliseLadder(['local', 'agentic']), ['local', 'agentic']);
});

test('describeRung reads from TIERS so the UI cannot drift from what runs', () => {
  const r = describeRung('frontier');
  assert.equal(r.id, 'frontier');
  assert.ok(r.label && r.engine, 'label and engine are required for the picker');
  assert.equal(r.engine, 'claude');
});

test('describeRung marks the free rungs, which is the phone-relevant fact', () => {
  assert.equal(describeRung('local').free, true);
  assert.equal(describeRung('cloud-sm').free, true);
  assert.equal(describeRung('frontier').free, false);
});

test('describeRung returns null for an unknown tier rather than throwing', () => {
  assert.equal(describeRung('nope'), null);
});

test('ladderRungs describes every rung in order', () => {
  const rungs = ladderRungs();
  assert.equal(rungs.length, CHAT_LADDER.length);
  assert.deepEqual(rungs.map((r) => r.id), CHAT_LADDER);
  assert.ok(rungs.every((r) => r.label));
});

// ── the climb ──────────────────────────────────────────────────────────────
// runRung is injected, so the climb logic is testable without a model.
const asyncTest = [];
function atest(name, fn) { asyncTest.push([name, fn]); }

atest('stops at the first rung that answers, and never pays for the rest', async () => {
  const called = [];
  const r = await runLadder({
    text: 'q',
    runRung: async (tier) => { called.push(tier); return { text: GOOD, tokens: 10 }; },
  });
  assert.deepEqual(called, ['local'], 'must not touch cloud-sm or frontier');
  assert.equal(r.tier, 'local');
  assert.equal(r.attempts.length, 1);
});

atest('climbs past a rung that errors', async () => {
  const r = await runLadder({
    text: 'q',
    runRung: async (tier) => {
      if (tier === 'local') throw new Error('llama-server down');
      return { text: GOOD, tokens: 5 };
    },
  });
  assert.equal(r.tier, 'cloud-sm');
  assert.equal(r.attempts[0].escalated, true);
  assert.match(r.attempts[0].reason, /llama-server down/);
});

atest('climbs past stated incapacity, all the way to frontier', async () => {
  const r = await runLadder({
    text: 'q',
    runRung: async (tier) => (tier === 'frontier'
      ? { text: GOOD, tokens: 99 }
      : { text: 'I cannot answer that without more detail.', tokens: 1 }),
  });
  assert.equal(r.tier, 'frontier');
  assert.equal(r.attempts.length, 3);
});

atest('emits a rung frame per attempt so the climb is visible', async () => {
  const frames = [];
  await runLadder({
    text: 'q',
    send: (f) => frames.push(f),
    runRung: async (tier) => (tier === 'local' ? { text: '', tokens: 0 } : { text: GOOD, tokens: 1 }),
  });
  const phases = frames.filter((f) => f.t === 'chat.rung').map((f) => f.phase);
  assert.ok(phases.includes('start'), 'must announce each attempt');
  assert.ok(phases.includes('escalating'), 'must say it is climbing');
  assert.ok(phases.includes('answered'), 'must say which rung answered');
});

atest('an escalating frame names the NEXT rung, so the UI can say where it went', async () => {
  const frames = [];
  await runLadder({
    text: 'q',
    send: (f) => frames.push(f),
    runRung: async (tier) => (tier === 'local' ? { text: '', tokens: 0 } : { text: GOOD, tokens: 1 }),
  });
  const esc = frames.find((f) => f.phase === 'escalating');
  assert.ok(esc.next, 'the next rung must be named');
  assert.ok(esc.reason, 'and the reason given');
});

atest('an exhausted ladder returns the top answer, not nothing', async () => {
  // A weak visible answer beats a silent failure; `attempts` carries the record.
  const r = await runLadder({
    text: 'q',
    runRung: async () => ({ text: 'I cannot help with that request.', tokens: 1 }),
  });
  assert.equal(r.exhausted, true);
  assert.ok(r.text.length > 0, 'the user still gets something');
  assert.equal(r.attempts.length, 3);
  assert.ok(r.attempts.every((a) => a.escalated));
});

atest('a custom ladder is honoured, including a deliberate agentic opt-in', async () => {
  const called = [];
  await runLadder({
    text: 'q', rungs: ['cloud-sm', 'agentic'],
    runRung: async (t) => { called.push(t); return { text: '', tokens: 0 }; },
  });
  assert.deepEqual(called, ['cloud-sm', 'agentic']);
});

atest('tokens are recorded per attempt, so the climb has a real cost trail', async () => {
  const r = await runLadder({
    text: 'q',
    runRung: async (tier) => (tier === 'frontier' ? { text: GOOD, tokens: 900 } : { text: '', tokens: 7 }),
  });
  assert.deepEqual(r.attempts.map((a) => a.tokens), [7, 7, 900]);
});

const run = async () => {
  for (const [name, fn] of asyncTest) {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
await run();
