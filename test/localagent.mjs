// The local model, with hands — attacked rather than described.
//
// This is the third agent runner in the codebase and the first one whose model
// runs on the user's own device. The interesting question is not "does it work"
// but "what happens when the model is WRONG", because a 1B will be: GBNF
// constrains the shape of a tool call, never its truth. So most of this file is
// about a model asking for things it must not get.
//
// fetchImpl is injected, so every path here — multi-step tool use, both runaway
// caps, a malformed argument payload, a path escape — runs with no model, no
// network and no llama-server.
import './_isolate.mjs';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { projectScratch } from './lib/paths.mjs';
import { localAgentRun, runTool, TOOLS, MAX_TOOL_CALLS, toolCallFromContent } from '../server/src/localAgent.js';

let pass = 0, fail = 0;
const test = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
};

// A project that is NOT Atlan's own repo — guardPath refuses this repo's source
// by design, and testing inside it would prove the wrong thing.
// UNDER the projects root, not /tmp. guardPath bounds every write to
// PROJECTS_DIR, so a scratch dir in /tmp is refused — correctly. Testing there
// would have proven the wall works and nothing else.
const proj = projectScratch('atlan-localagent-');
writeFileSync(join(proj, 'existing.txt'), 'hello from disk');
mkdirSync(join(proj, 'sub'), { recursive: true });

/** A fake model: hands back a scripted sequence of assistant turns. */
const scripted = (turns) => {
  let i = 0;
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: turns[Math.min(i++, turns.length - 1)] }] }),
    text: async () => '',
  });
};
const call = (name, args, id = 'c1') => ({
  role: 'assistant', content: '',
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content) => ({ role: 'assistant', content });
// A turn where the model wrote the tool call as CONTENT, not a structured
// tool_calls entry — the on-device reality for small models (see below).
const sayContent = (content) => ({ role: 'assistant', content, tool_calls: [] });

console.log('LOCAL AGENT');

// ── the on-device reality: models describe tool calls in prose ───────────────
// Verbatim shape Qwen-Coder-1.5B emitted on the S9 for "build an app": a fenced
// JSON block in content, no structured tool_calls. Llama-3.2 instead 500s the
// server. The fallback parser has to turn THIS into a real write.
const QWEN_MARKDOWN = '```json\n{\n  "name": "write_file",\n  "arguments": {\n    "path": "www/index.html",\n    "content": "<html><head><title>Test App</title></head><body><h1>Welcome</h1></body></html>"\n  }\n}\n```';

await test('toolCallFromContent: extracts a known-tool call from a markdown JSON block', () => {
  const fc = toolCallFromContent(QWEN_MARKDOWN);
  assert.ok(fc, 'a fenced {name,arguments} for a known tool must be recovered');
  assert.equal(fc.name, 'write_file');
  assert.equal(fc.args.path, 'www/index.html');
  assert.match(fc.args.content, /<h1>Welcome<\/h1>/);
});

await test('toolCallFromContent: ignores JSON that is not a known tool call', () => {
  assert.equal(toolCallFromContent('here is some data: {"name":"nonsense","arguments":{}}'), null);
  assert.equal(toolCallFromContent('no json at all, just prose'), null);
  assert.equal(toolCallFromContent('{"foo":1}'), null);
});

await test('content-only tool call still writes the file (Qwen-Coder path, end to end)', async () => {
  const r = await localAgentRun({
    prompt: 'build a simple app, write www/index.html',
    cwd: proj,
    fetchImpl: scripted([sayContent(QWEN_MARKDOWN), say('Done — wrote www/index.html.')]),
  });
  assert.match(readFileSync(join(proj, 'www/index.html'), 'utf8'), /<h1>Welcome<\/h1>/,
    'the file the model described in content must actually land on disk');
  assert.equal(r.tools[0].name, 'write_file');
  assert.ok(r.tools[0].ok, 'the recovered call must execute, not just parse');
});

// ── the toolset itself ───────────────────────────────────────────────────────
await test('exactly four tools are offered, and each says WHEN to use it', () => {
  // A small model choosing between four sharp tools beats one choosing between
  // twenty. The count is a design decision, so it is asserted.
  assert.equal(TOOLS.length, 4, 'the toolset is deliberately small');
  assert.deepEqual(TOOLS.map((t) => t.function.name).sort(),
    ['list_files', 'open_preview', 'read_file', 'write_file']);
  for (const t of TOOLS) {
    assert.match(t.function.description, /use this/i, `${t.function.name} must tell a small model WHEN to use it`);
    assert.ok(t.function.parameters.required.length, `${t.function.name} must require its arguments`);
  }
});

// ── the happy path, end to end ───────────────────────────────────────────────
await test('write then preview: the file lands and the preview is told', async () => {
  let previewed = null;
  const r = await localAgentRun({
    prompt: 'make a hello world page',
    cwd: proj,
    onPreview: (p) => { previewed = p; },
    fetchImpl: scripted([
      call('write_file', { path: 'index.html', content: '<h1>Hello</h1>' }),
      call('open_preview', { path: 'index.html' }, 'c2'),
      say('Wrote index.html and opened the preview.'),
    ]),
  });
  assert.equal(readFileSync(join(proj, 'index.html'), 'utf8'), '<h1>Hello</h1>');
  assert.ok(previewed?.endsWith('index.html'), 'the preview was never told');
  assert.equal(r.tools.length, 2);
  assert.match(r.text, /Wrote index.html/);
});

await test('read_file returns real bytes the model can act on', async () => {
  const r = await localAgentRun({
    prompt: 'read it', cwd: proj,
    fetchImpl: scripted([call('read_file', { path: 'existing.txt' }), say('done')]),
  });
  assert.equal(r.tools[0].result, 'hello from disk');
  assert.ok(r.tools[0].ok);
});

await test('list_files marks directories so the model can tell them apart', async () => {
  const r = await localAgentRun({
    prompt: 'what is here', cwd: proj,
    fetchImpl: scripted([call('list_files', { path: '.' }), say('done')]),
  });
  assert.match(r.tools[0].result, /sub\//, 'a directory must be distinguishable from a file');
});

// ── the walls ────────────────────────────────────────────────────────────────
await test('a path ESCAPE is refused, and the model is told why', async () => {
  // The model's path is generated text. A prompt-injected page asking for
  // ../../.auth-token is the threat this exists for.
  const r = await localAgentRun({
    prompt: 'read the token', cwd: proj,
    fetchImpl: scripted([call('read_file', { path: '../../.auth-token' }), say('done')]),
  });
  assert.equal(r.tools[0].ok, false);
  assert.match(r.tools[0].result, /ERROR/);
  // Refusal is a TOOL RESULT, not a thrown request: the model gets to recover,
  // and the transcript records the attempt instead of losing it in a stack trace.
  assert.match(r.text, /done/);
});

await test('an absolute path outside the project is refused', async () => {
  const r = await localAgentRun({
    prompt: 'read /etc/passwd', cwd: proj,
    fetchImpl: scripted([call('read_file', { path: '/etc/passwd' }), say('done')]),
  });
  assert.equal(r.tools[0].ok, false);
  assert.match(r.tools[0].result, /escapes the project|ERROR/);
  assert.ok(!r.tools[0].result.includes('root:'), '/etc/passwd content must never reach the model');
});

await test('the SCOUT profile cannot write — the same predicate the fleet uses', async () => {
  const r = await localAgentRun({
    prompt: 'write a file', cwd: proj, profile: 'scout',
    fetchImpl: scripted([call('write_file', { path: 'nope.txt', content: 'x' }), say('done')]),
  });
  assert.equal(r.tools[0].ok, false);
  assert.match(r.tools[0].result, /scout/, 'the refusal must name the profile that refused');
  assert.ok(!existsSync(join(proj, 'nope.txt')), 'scout wrote a file');
});

await test('an unknown tool is refused rather than guessed at', () => {
  assert.throws(() => runTool('rm_rf', { path: '.' }, { cwd: proj, profile: 'builder' }), /unknown tool/);
});

await test('an unknown PROFILE refuses instead of defaulting to a permissive one', () => {
  // Failing open here would hand a typo full write access.
  assert.throws(() => runTool('write_file', { path: 'a', content: 'b' }, { cwd: proj, profile: 'admin' }), /unknown profile/);
});

// ── runaway ──────────────────────────────────────────────────────────────────
await test('a model that only ever calls tools is stopped by the STEP cap', async () => {
  const r = await localAgentRun({
    prompt: 'loop', cwd: proj, maxSteps: 3,
    fetchImpl: scripted([call('list_files', { path: '.' })]), // never stops calling
  });
  assert.equal(r.halted, 'step-cap');
  assert.equal(r.steps, 3);
  assert.match(r.text, /without finishing/, 'a halt must not read as an answer');
});

await test('the TOOL-CALL cap catches a model batching calls inside one turn', async () => {
  // The step cap counts round trips; a model can emit many calls per turn, so the
  // two caps catch different runaways.
  const many = {
    role: 'assistant', content: '',
    tool_calls: Array.from({ length: MAX_TOOL_CALLS + 5 }, (_, i) => ({
      id: `c${i}`, type: 'function',
      function: { name: 'list_files', arguments: '{"path":"."}' },
    })),
  };
  const r = await localAgentRun({ prompt: 'spam', cwd: proj, fetchImpl: scripted([many]) });
  assert.equal(r.halted, 'tool-cap');
  assert.ok(r.tools.length <= MAX_TOOL_CALLS, `ran ${r.tools.length} tools past a cap of ${MAX_TOOL_CALLS}`);
});

// ── the model being wrong ────────────────────────────────────────────────────
await test('unparseable tool arguments become a recoverable error, not a crash', async () => {
  // GBNF constrains the SHAPE of a call, never that the argument JSON parses.
  const broken = {
    role: 'assistant', content: '',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path": "oops.txt", "content"' } }],
  };
  const r = await localAgentRun({ prompt: 'x', cwd: proj, fetchImpl: scripted([broken, say('recovered')]) });
  assert.equal(r.tools[0].ok, false);
  assert.match(r.text, /recovered/, 'the loop must survive a malformed payload');
});

await test('a server started without --jinja is named exactly, not reported as a 500', async () => {
  // The one failure everyone hits first, and its message hides inside an HTTP 500.
  const r = localAgentRun({
    prompt: 'x', cwd: proj,
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => 'tools param requires --jinja flag' }),
  });
  await assert.rejects(r, /--jinja/);
});

await test('an oversized write is refused before it touches the disk', async () => {
  const r = await localAgentRun({
    prompt: 'x', cwd: proj,
    fetchImpl: scripted([call('write_file', { path: 'big.txt', content: 'a'.repeat(300_000) }), say('done')]),
  });
  assert.equal(r.tools[0].ok, false);
  assert.ok(!existsSync(join(proj, 'big.txt')));
});

await test('a truncated read SAYS it was truncated, in what the MODEL receives', () => {
  // A silently clipped file makes the model rewrite the visible half and delete
  // the rest, which looks like success.
  //
  // Asserted against runTool directly, not through the loop: `tools[].result` is
  // a 200-char PREVIEW kept for the transcript, so the marker at the end of a
  // 60KB read is clipped out of it. What the model is handed is the full string,
  // and that is where the promise has to hold.
  writeFileSync(join(proj, 'huge.txt'), 'x'.repeat(80_000));
  const out = runTool('read_file', { path: 'huge.txt' }, { cwd: proj, profile: 'builder' });
  assert.match(out, /\[truncated at \d+ bytes/, 'the model must be told the file was clipped');
  assert.ok(out.length < 80_000, 'the whole file came through despite the cap');
});

await test('an empty prompt and a missing cwd are refused', async () => {
  await assert.rejects(localAgentRun({ prompt: '  ', cwd: proj }), /empty prompt/);
  await assert.rejects(localAgentRun({ prompt: 'x' }), /cwd is required/);
});


// ── findings from an independent adversarial review (codex, 2026-08-09) ──────
// Every one of these was REPRODUCED before it was fixed. They are the tests the
// original file should have had: I tested the paths I thought of, and a reviewer
// with no attachment to the design tested the ones I did not.
await test('a SYMLINK inside the project cannot read outside it', async () => {
  // resolve() is lexical, so escape/secret.txt reads as "under cwd" on paper;
  // guardPath then re-checked the real path against PROJECTS_DIR, never against
  // cwd. Two guards, neither watching this boundary. Reproduced: it returned
  // another project's file verbatim.
  const other = projectScratch('other-');
  writeFileSync(join(other, 'secret.txt'), 'SECRET-FROM-ANOTHER-PROJECT');
  const victim = projectScratch('victim-');
  symlinkSync(other, join(victim, 'escape'));
  assert.throws(
    () => runTool('read_file', { path: 'escape/secret.txt' }, { cwd: victim, profile: 'builder' }),
    /through a link/,
  );
});

await test('a DEEP path under a symlink cannot outrun the resolver', () => {
  // A second reviewer broke the fix for the test above in one line. The ancestor
  // walk had a 64-step cap and a lexical fallback, so `escape/n/n/…/pwned.txt`
  // with 64+ missing components ran out of steps, realpathSync threw, and the
  // catch fell back to the lexical path — which is under cwd on paper. It failed
  // OPEN exactly when resolution failed. Reproduced at depth 72: the write landed
  // outside the project and built its directory tree there.
  const other = projectScratch('deep-other-');
  const victim = projectScratch('deep-victim-');
  symlinkSync(other, join(victim, 'escape'));
  const deep = `escape/${'n/'.repeat(70)}pwned.txt`;
  assert.throws(
    () => runTool('write_file', { path: deep, content: 'owned' }, { cwd: victim, profile: 'builder' }),
    /through a link|cannot resolve/,
  );
  assert.equal(readdirSync(other).length, 0, 'the deep write escaped the project');
});

await test('a SYMLINK inside the project cannot write outside it', () => {
  const other = projectScratch('other2-');
  const victim = projectScratch('victim2-');
  symlinkSync(other, join(victim, 'escape'));
  assert.throws(
    () => runTool('write_file', { path: 'escape/pwned.txt', content: 'owned' }, { cwd: victim, profile: 'builder' }),
    /through a link/,
  );
  assert.ok(!existsSync(join(other, 'pwned.txt')), 'the write landed outside the project');
});

await test('a huge file is refused on its SIZE, not read and then trimmed', () => {
  // Measured before the fix: reading a 5MB file to return 60KB grew the heap by
  // exactly 5.0MB. The cap was on the string, not on the read.
  writeFileSync(join(proj, 'big.bin'), Buffer.alloc(4 * 1024 * 1024, 0x41));
  assert.throws(
    () => runTool('read_file', { path: 'big.bin' }, { cwd: proj, profile: 'builder' }),
    /too large to read/,
  );
});

await test('a FIFO is refused instead of blocking the request forever', () => {
  // readFileSync on a FIFO never returns and takes no signal, so one `mkfifo`
  // inside a project would hang the agent permanently.
  const fifo = join(proj, 'hang');
  try { execFileSync('mkfifo', [fifo]); } catch { return; } // no mkfifo here: skip rather than fake a pass
  assert.throws(
    () => runTool('read_file', { path: 'hang' }, { cwd: proj, profile: 'builder' }),
    /not a regular file/,
  );
});

await test('list_files refuses a file, and marks dirs from ONE readdir', () => {
  // The old version stat'd each entry after listing — a syscall per entry and a
  // TOCTOU window between the listing and the stat.
  assert.throws(() => runTool('list_files', { path: 'existing.txt' }, { cwd: proj, profile: 'builder' }), /not a directory/);
});

await test('every model request carries a deadline, so a stall cannot hang forever', async () => {
  // `signal` was optional and there was no internal deadline, so a stalled model
  // server hung the request permanently. On a phone the server can be frozen by
  // Doze mid-generation, which makes that the likely failure, not an exotic one.
  //
  // Asserts the SIGNAL IS PASSED rather than racing a real abort: a test that
  // waits for a timer to win is a test that flakes on a loaded machine, and this
  // property is exactly "a deadline was attached".
  let seen = null;
  await localAgentRun({
    prompt: 'x', cwd: proj, stepTimeoutMs: 1234,
    fetchImpl: async (_url, opts) => { seen = opts.signal; return { ok: true, json: async () => ({ choices: [{ message: say('ok') }] }), text: async () => '' }; },
  });
  assert.ok(seen, 'no abort signal was attached to the model request');
  assert.equal(typeof seen.aborted, 'boolean', 'what was passed is not an AbortSignal');
});

await test('a caller-supplied signal is honoured over the default deadline', async () => {
  const ac = new AbortController();
  let seen = null;
  await localAgentRun({
    prompt: 'x', cwd: proj, signal: ac.signal,
    fetchImpl: async (_url, opts) => { seen = opts.signal; return { ok: true, json: async () => ({ choices: [{ message: say('ok') }] }), text: async () => '' }; },
  });
  assert.equal(seen, ac.signal, 'the caller must be able to cancel the run');
});


// ── the human gate (what makes CHAT bounded rather than autonomous) ──────────
// Chat supplies an `approve` hook that raises a permission card and waits. The
// fleet and hierarchy do not — they are already bounded by their profile — so the
// default is allow and the gate is something chat opts INTO.
await test('a declined tool does not run, and the model is told plainly', async () => {
  const before = existsSync(join(proj, 'declined.txt'));
  const r = await localAgentRun({
    prompt: 'write a file', cwd: proj,
    approve: async () => false,
    fetchImpl: scripted([call('write_file', { path: 'declined.txt', content: 'x' }), say('understood')]),
  });
  assert.equal(r.tools[0].ok, false);
  assert.match(r.tools[0].result, /declined/);
  assert.equal(existsSync(join(proj, 'declined.txt')), before, 'a declined write still happened');
  assert.match(r.text, /understood/, 'the model must get a chance to respond to a refusal');
});

await test('the gate is asked BEFORE the tool runs, not after', async () => {
  // A card shown for something that already happened is not a gate, it is a
  // receipt. Asserted by declining and checking the disk.
  let askedWith = null;
  await localAgentRun({
    prompt: 'write', cwd: proj,
    approve: async (req) => { askedWith = req; return false; },
    fetchImpl: scripted([call('write_file', { path: 'never.txt', content: 'x' }), say('ok')]),
  });
  assert.equal(askedWith?.name, 'write_file', 'the gate was not told which tool');
  assert.equal(askedWith?.args?.path, 'never.txt', 'the gate was not told the arguments');
  assert.ok(!existsSync(join(proj, 'never.txt')));
});

await test('an approve hook that THROWS is treated as a refusal', async () => {
  // A socket that dies mid-card, or a bug in the asker, must not become an allow.
  const r = await localAgentRun({
    prompt: 'write', cwd: proj,
    approve: async () => { throw new Error('socket closed'); },
    fetchImpl: scripted([call('write_file', { path: 'thrown.txt', content: 'x' }), say('ok')]),
  });
  assert.equal(r.tools[0].ok, false);
  assert.ok(!existsSync(join(proj, 'thrown.txt')), 'a broken gate let the write through');
});

await test('each tool call in a batch is gated separately', async () => {
  // One approval must not authorise the rest of the turn.
  const seen = [];
  const batch = {
    role: 'assistant', content: '',
    tool_calls: [
      { id: 'a', type: 'function', function: { name: 'list_files', arguments: '{"path":"."}' } },
      { id: 'b', type: 'function', function: { name: 'write_file', arguments: '{"path":"batch.txt","content":"x"}' } },
    ],
  };
  await localAgentRun({
    prompt: 'two things', cwd: proj,
    approve: async (req) => { seen.push(req.name); return req.name === 'list_files'; },
    fetchImpl: scripted([batch, say('done')]),
  });
  assert.deepEqual(seen, ['list_files', 'write_file'], 'every call must be asked about');
  assert.ok(!existsSync(join(proj, 'batch.txt')), 'approving one call authorised another');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
