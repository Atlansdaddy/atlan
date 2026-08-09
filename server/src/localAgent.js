// localAgent.js — the local model, with hands.
//
// Atlan had exactly two agent runners: the Claude SDK (canUseTool, per-tool
// cards) and exec'd CLIs (all-or-nothing approval). brains.js is the third path
// and is chat-only BY CONSTRUCTION — "no tools, no files" — so the on-device
// model could describe a hello-world page and never write one. On a phone whose
// only ready engine is llama-server, that makes the cockpit an expensive way to
// read text.
//
// WHY A 1B CAN DO THIS AT ALL. llama.cpp converts each tool's JSON Schema into a
// GBNF grammar and constrains decoding to it, so a malformed tool call is not one
// of the reachable outputs. The model does not need to be smart enough to emit
// valid JSON; it needs to pick a tool and fill fields. That moves the failure mode
// from SYNTACTIC (garbage nobody can parse) to SEMANTIC (wrong tool, wrong path)
// — which is the class this repo already grades with deterministic checkers
// rather than trusting a model to self-assess.
//
// FOUR TOOLS, DELIBERATELY. A small model choosing between four sharp tools beats
// one choosing between twenty; every extra tool is another way to pick wrong.
//
// THE WALLS ARE NOT NEW. Every call goes through the SAME fleet profile check
// that walls.mjs already attacks — builder's writes-under-cwd plus guardPath's
// refusal of Atlan's own source, state and credential files. A local agent
// inherits a boundary that has been shot at, instead of getting a fresh one
// nobody has tested.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { LOCAL_LLM_BASE } from './config.js';
import { guardPath, isUnder } from './guards.js';
import { PROFILES_FOR_TEST as PROFILES } from './fleet.js';

/** Runaway guards. A loop that calls tools forever is the failure mode here. */
export const MAX_STEPS = 8;        // model↔tool round trips per request
export const MAX_TOOL_CALLS = 24;  // total tool invocations per request
export const MAX_READ_BYTES = 60_000;
export const MAX_WRITE_BYTES = 256_000;

/**
 * The toolset the model is offered, as OpenAI-shaped schemas.
 *
 * Descriptions are written FOR A SMALL MODEL: they say when to use the tool, not
 * just what it does, because "when" is the decision a 1B gets wrong.
 */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a file in the project. Use this whenever the user asks you to make, create, write or fix a file. Always write the COMPLETE file contents, never a fragment.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'path relative to the project root, e.g. index.html' },
          content: { type: 'string', description: 'the entire file contents' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read an existing file. Use this before changing a file you have not seen, so you rewrite it correctly.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'path relative to the project root' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a project folder. Use this when you do not know what exists yet.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'folder relative to the project root; use "." for the root' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_preview',
      description: 'Show an HTML file in the cockpit Preview tab. Use this after writing a web page so the user can see it.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'the HTML file to show, relative to the project root' } },
        required: ['path'],
      },
    },
  },
];

/**
 * Resolve a model-supplied path INSIDE cwd, or refuse.
 *
 * The model's path is untrusted input in the strongest sense: it is generated
 * text, and a prompt-injected page could ask for `../../.auth-token`. Two belts —
 * isUnder pins it to the project, guardPath refuses Atlan's own source, state and
 * credential stores even when cwd legitimately contains this repo.
 */
function safePath(cwd, p, { mustExist = false } = {}) {
  const raw = String(p ?? '').trim();
  if (!raw) throw new Error('path is required');
  const abs = resolve(cwd, raw);
  // Lexical check first — cheap, and it catches the obvious ../../ spellings.
  if (!isUnder(abs, cwd)) throw new Error(`path escapes the project: ${raw}`);

  // THEN THE REAL PATH, AGAINST CWD. resolve() is lexical: it does not follow
  // symlinks, so a link INSIDE the project pointing anywhere else still reads as
  // "under cwd". guardPath re-checks the real path, but only against
  // PROJECTS_DIR — so a symlink to a SIBLING project passed both guards, and
  // neither one was checking the boundary that matters here.
  //
  // Reproduced before fixing: with cwd=victim/ and victim/escape -> other/,
  // read_file("escape/secret.txt") returned another project's file, and
  // write_file("escape/pwned.txt") wrote outside cwd. (Found by an independent
  // adversarial review, 2026-08-09.)
  //
  // realpath the deepest EXISTING ancestor, because the target of a write does
  // not exist yet and realpathSync would throw on it.
  //
  // NO ITERATION CAP, and no lexical fallback. The first version of this fix had
  // both, and a second reviewer broke it in one line: with 64+ non-existent
  // components under the symlink — `escape/n/n/n/…/pwned.txt` — the walk ran out
  // of steps before reaching an existing directory, realpathSync threw, the catch
  // fell back to the LEXICAL path, and that path is under cwd on paper. It failed
  // OPEN at precisely the moment resolution failed. Reproduced at depth 72: the
  // write landed outside the project and created its tree there.
  //
  // guards.js walks to the root with no cap; capping here reintroduced a limit
  // the guard next door does not have. Terminating at the filesystem root is
  // bounded by the path itself, so the loop cannot run away.
  let probe = abs;
  while (!existsSync(probe)) {
    const up = dirname(probe);
    if (up === probe) break; // reached the root
    probe = up;
  }
  let real, realCwd;
  try {
    real = realpathSync(probe);
    realCwd = realpathSync(cwd);
  } catch (err) {
    // Cannot resolve => cannot vouch for it. The only safe direction is refusal.
    // `cause` kept: the model is shown a short reason, but the underlying errno
    // is what tells an operator whether this was ELOOP, ENAMETOOLONG or EACCES.
    throw new Error(`cannot resolve path safely: ${raw} (${err.code ?? err.message})`, { cause: err });
  }
  if (!isUnder(real, realCwd)) throw new Error(`path escapes the project through a link: ${raw}`);

  guardPath(abs, { mustExist, blockAppRoot: true, verb: 'writable' });
  return abs;
}

/**
 * Refuse anything that is not a regular file BEFORE reading it.
 *
 * readFileSync on a FIFO blocks forever with no timeout and no signal — a single
 * `mkfifo hang` inside a project would hang the request permanently. And reading
 * a 5MB file to hand back 60KB allocated the whole 5MB first: measured, exactly
 * 5.0MB of heap for a read capped at 60KB. Size and type are properties of the
 * file, so they are checked on the file, not on the string that came back.
 */
function statRegular(abs, cap) {
  const st = statSync(abs);
  if (!st.isFile()) throw new Error('not a regular file (a directory, device or FIFO cannot be read here)');
  if (st.size > cap * 20) throw new Error(`file is ${st.size} bytes — too large to read (cap ${cap})`);
  return st;
}

/** Run one tool call. Returns the string the model sees as the tool's result. */
export function runTool(name, args, { cwd, profile, onPreview }) {
  const prof = PROFILES[profile];
  if (!prof) throw new Error(`unknown profile: ${profile}`);

  // The profile decides FIRST, using the same predicate the fleet uses. A tool
  // the profile forbids is refused here, not negotiated.
  const toolFor = { write_file: 'Write', read_file: 'Read', list_files: 'LS', open_preview: 'Read' }[name];
  if (!toolFor) throw new Error(`unknown tool: ${name}`);
  const verdict = prof.check(toolFor, { file_path: args?.path ? resolve(cwd, String(args.path)) : undefined }, cwd);
  if (!verdict.ok) throw new Error(`refused by the ${profile} profile — ${verdict.why}`);

  if (name === 'write_file') {
    const content = String(args?.content ?? '');
    if (Buffer.byteLength(content) > MAX_WRITE_BYTES) throw new Error(`refusing to write ${Buffer.byteLength(content)} bytes (max ${MAX_WRITE_BYTES})`);
    const abs = safePath(cwd, args?.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return `wrote ${relative(cwd, abs)} (${Buffer.byteLength(content)} bytes)`;
  }
  if (name === 'read_file') {
    const abs = safePath(cwd, args?.path, { mustExist: true });
    statRegular(abs, MAX_READ_BYTES);
    const body = readFileSync(abs, 'utf8');
    // Truncation is ANNOUNCED. A silently clipped file makes the model rewrite
    // the visible half and delete the rest, which looks like it worked.
    return body.length > MAX_READ_BYTES
      ? `${body.slice(0, MAX_READ_BYTES)}\n\n[truncated at ${MAX_READ_BYTES} bytes — the file is longer]`
      : body;
  }
  if (name === 'list_files') {
    const abs = safePath(cwd, args?.path || '.', { mustExist: true });
    if (!statSync(abs).isDirectory()) throw new Error('not a directory');
    // withFileTypes so the entry type comes from the SAME readdir call — the old
    // version statSync'd each name afterwards, which is a syscall per entry and
    // a TOCTOU window between listing and stat'ing.
    const names = readdirSync(abs, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.')).slice(0, 200);
    if (!names.length) return '(empty)';
    return names.map((d) => (d.isDirectory() ? `${d.name}/` : d.name)).join('\n');
  }
  // open_preview
  const abs = safePath(cwd, args?.path, { mustExist: true });
  onPreview?.(abs);
  return `showing ${relative(cwd, abs)} in the Preview tab`;
}

const SYSTEM = `You are Atlan's on-device agent. You are running on the user's own phone.

You have four tools and you SHOULD use them — do not describe a file, write it.
When the user asks for a web page: write_file the complete HTML, then open_preview it.
Paths are relative to the project root. Write whole files, never fragments.
When you have finished the task, reply with one short sentence saying what you did.`;

/**
 * Run one request through the local model with tools.
 *
 * `fetchImpl` is injectable so the suite can drive the whole loop — including
 * multi-step tool use and the runaway guards — without a model or a network.
 */
export async function localAgentRun({
  prompt, cwd, profile = 'builder', model = 'local',
  base = `${LOCAL_LLM_BASE}/v1`, fetchImpl = fetch, onEvent = () => {}, onPreview,
  maxSteps = MAX_STEPS, signal, stepTimeoutMs = 180_000,
  // Asked BEFORE each tool runs. Returning false refuses it the same way the
  // profile does — as a tool result the model can recover from, not a thrown
  // request. Defaulting to allow keeps programmatic callers (the fleet, the
  // hierarchy) unchanged; they are already bounded by the profile. Chat supplies
  // one that raises a permission card, which is what makes chat BOUNDED rather
  // than autonomous.
  approve = async () => true,
}) {
  if (!prompt?.trim()) throw new Error('empty prompt');
  if (!cwd) throw new Error('cwd is required — it IS the write boundary');

  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: String(prompt) }];
  const used = [];
  let calls = 0;

  for (let step = 0; step < maxSteps; step++) {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', max_tokens: 900 }),
      // A stalled model server used to hang the request forever: `signal` was
      // optional and there was no internal deadline, so nothing ever gave up. On
      // a phone the server can be paused by Doze mid-generation, which makes this
      // the likely case rather than the exotic one.
      signal: signal ?? AbortSignal.timeout(stepTimeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // The one error worth naming: llama-server refuses `tools` unless started
      // with --jinja, and its message is easy to miss inside a 500.
      if (/--jinja/.test(body)) throw new Error('the local model server was started without --jinja, so it refuses tools. Restart llama-server with --jinja.');
      throw new Error(`local model HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const msg = json?.choices?.[0]?.message ?? {};
    messages.push(msg);

    const toolCalls = msg.tool_calls ?? [];
    if (!toolCalls.length) {
      return { text: String(msg.content ?? '').trim(), tools: used, steps: step + 1 };
    }

    for (const tc of toolCalls) {
      if (++calls > MAX_TOOL_CALLS) {
        return { text: `stopped: more than ${MAX_TOOL_CALLS} tool calls in one request`, tools: used, steps: step + 1, halted: 'tool-cap' };
      }
      const name = tc?.function?.name;
      let args = {};
      // A grammar cannot guarantee the ARGUMENTS parse — only the call's shape —
      // so a bad payload is a tool result the model can recover from, not a throw
      // that ends the request.
      try { args = JSON.parse(tc?.function?.arguments ?? '{}'); } catch { args = {}; }
      let result;
      let ok = true;
      // The human gate comes FIRST, before the profile and before the path
      // checks: a refusal here should not depend on whether the request would
      // have been legal, and the user should never be shown a card for something
      // that already ran.
      let allowed = true;
      try { allowed = await approve({ name, args }); } catch { allowed = false; }
      if (!allowed) {
        result = 'ERROR: you declined this action';
        ok = false;
      } else {
        try { result = runTool(name, args, { cwd, profile, onPreview }); } catch (err) { ok = false; result = `ERROR: ${err.message}`; }
      }
      used.push({ name, args, ok, result: String(result).slice(0, 200) });
      onEvent({ t: 'localtool', name, args, ok, result: String(result).slice(0, 400) });
      messages.push({ role: 'tool', tool_call_id: tc.id, name, content: String(result).slice(0, MAX_READ_BYTES) });
    }
  }
  // Out of steps with tools still pending is a real outcome and says so, rather
  // than returning the last half-finished sentence as if it were an answer.
  return { text: `stopped after ${maxSteps} steps without finishing`, tools: used, steps: maxSteps, halted: 'step-cap' };
}
