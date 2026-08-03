// ladder.mjs — the chat escalation ladder.
//
// The thing under test is the ESCALATION TRIGGER, and the property that matters
// most is what it refuses to claim. It must escalate on observable facts (error,
// empty, truncated, stated incapacity) and must NOT pretend to detect a
// confidently wrong answer — that is the honest limit of the design, and a test
// that asserted otherwise would be encoding a promise the code cannot keep.

import assert from 'node:assert';
import {
  shouldEscalate, normaliseLadder, describeRung, ladderRungs,
  CHAT_LADDER, MIN_USEFUL_CHARS, INCAPACITY_PATTERNS,
} from '../server/src/ladder.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
