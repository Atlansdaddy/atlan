// What a transcript keeps when a turn does NOT go well.
//
// The recorder used to end a turn only on chat.result. Every engine that streams
// — Claude, and the agent CLIs through chat.textstart/chat.delta — buffers its
// output in memory until that frame arrives. So a turn that streamed real text
// and then failed wrote NOTHING: the answer was on screen, which is exactly why
// it looked saved, and it was gone the moment the conversation was reopened.
//
// The local model's intermittent 500 makes that the everyday case, not an edge
// one. These tests drive the recorder frame by frame with an injected append, so
// they need no engine, no network and no llama-server.
import './_isolate.mjs';
import assert from 'node:assert';
import { makeTranscriptRecorder } from '../server/src/chatlog.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
};

// An injected sink: every call recorded, nothing touches disk.
const spy = () => {
  const rows = [];
  const rec = makeTranscriptRecorder({ append: (id, m) => { rows.push({ id, ...m }); return true; } });
  return { rows, rec };
};

console.log('\ntranscript recorder');

test('a streamed turn that SUCCEEDS is written once, complete', () => {
  const { rows, rec } = spy();
  rec('c1', { t: 'chat.textstart', engine: 'Claude' });
  rec('c1', { t: 'chat.delta', text: 'hello ' });
  rec('c1', { t: 'chat.delta', text: 'world' });
  rec('c1', { t: 'chat.result', subtype: 'success' });
  assert.equal(rows.length, 1, `expected 1 write, got ${rows.length}`);
  assert.equal(rows[0].text, 'hello world');
  assert.equal(rows[0].role, 'assistant');
});

// THE REGRESSION. Before the fix this wrote nothing at all.
test('a streamed turn that FAILS mid-answer still keeps what it streamed', () => {
  const { rows, rec } = spy();
  rec('c2', { t: 'chat.textstart', engine: 'local' });
  rec('c2', { t: 'chat.delta', text: 'building your page' });
  rec('c2', { t: 'chat.err', msg: 'llama-server 500: output that does not match the expected peg-native format' });
  assert.equal(rows.length, 1, 'a partial answer must survive the failure that ended it');
  assert.equal(rows[0].text, 'building your page');
  assert.equal(rows[0].engine, 'local', 'and stay filed under the engine that produced it');
});

test('err then result cannot write the same partial answer twice', () => {
  // spawn ENOENT emits BOTH 'error' and 'close', and agents.js sends a frame on
  // each — so two terminal frames for one turn is a real sequence, not a
  // hypothetical.
  const { rows, rec } = spy();
  rec('c3', { t: 'chat.textstart', engine: 'Codex' });
  rec('c3', { t: 'chat.delta', text: 'partial' });
  rec('c3', { t: 'chat.err', msg: 'failed to start' });
  rec('c3', { t: 'chat.result', subtype: 'error' });
  assert.equal(rows.length, 1, `double terminal frame wrote ${rows.length} copies`);
});

test('a failure with nothing streamed writes nothing', () => {
  // The unavailable-engine case: chat.err arrives with no output before it.
  // There is no answer to keep, and an empty assistant row would be noise.
  const { rows, rec } = spy();
  rec('c4', { t: 'chat.err', msg: 'Claude Code is not available here' });
  assert.equal(rows.length, 0);
});

test('whitespace-only stream is not a turn worth keeping', () => {
  const { rows, rec } = spy();
  rec('c5', { t: 'chat.textstart', engine: 'Claude' });
  rec('c5', { t: 'chat.delta', text: '   \n ' });
  rec('c5', { t: 'chat.err', msg: 'died' });
  assert.equal(rows.length, 0);
});

test('a failed turn does not leak its text into the next one', () => {
  const { rows, rec } = spy();
  rec('c6', { t: 'chat.textstart', engine: 'Claude' });
  rec('c6', { t: 'chat.delta', text: 'first attempt' });
  rec('c6', { t: 'chat.err', msg: 'died' });
  rec('c6', { t: 'chat.textstart', engine: 'Claude' });
  rec('c6', { t: 'chat.delta', text: 'second attempt' });
  rec('c6', { t: 'chat.result', subtype: 'success' });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].text, 'second attempt', 'the buffer must be cleared by the failure');
});

test('whole-message engines are recorded as they arrive', () => {
  const { rows, rec } = spy();
  rec('c7', { t: 'chat.msg', role: 'assistant', text: 'from a CLI', engine: 'Grok · full-auto' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].engine, 'Grok · full-auto');
});

test('no conversation id means nothing is written', () => {
  // Frames flow before a conversation exists; they must not throw or land
  // in some default transcript.
  const { rows, rec } = spy();
  rec(null, { t: 'chat.msg', role: 'assistant', text: 'orphan' });
  rec(undefined, { t: 'chat.result' });
  assert.equal(rows.length, 0);
});

test('a malformed frame is ignored, not fatal', () => {
  const { rows, rec } = spy();
  rec('c8', null);
  rec('c8', {});
  rec('c8', { t: 'chat.delta' }); // no text
  rec('c8', { t: 'chat.result' });
  assert.equal(rows.length, 0);
});

test('two connections keep separate buffers', () => {
  // One recorder per connection is the contract; prove they do not share state.
  const a = spy(), b = spy();
  a.rec('x', { t: 'chat.textstart', engine: 'Claude' });
  a.rec('x', { t: 'chat.delta', text: 'AAA' });
  b.rec('y', { t: 'chat.textstart', engine: 'Codex' });
  b.rec('y', { t: 'chat.delta', text: 'BBB' });
  a.rec('x', { t: 'chat.err', msg: 'boom' });
  b.rec('y', { t: 'chat.result' });
  assert.equal(a.rows[0].text, 'AAA');
  assert.equal(b.rows[0].text, 'BBB');
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
