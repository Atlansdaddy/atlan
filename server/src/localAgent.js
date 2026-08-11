// localAgent.js — the local model, with hands.
//
// Atlan had exactly two agent runners: the Claude SDK (canUseTool, per-tool
// cards) and exec'd CLIs (all-or-nothing approval). brains.js is the third path
// and is chat-only BY CONSTRUCTION — "no tools, no files" — so the on-device
// model could describe a hello-world page and never write one. On a phone whose
// only ready engine is llama-server, that makes the cockpit an expensive way to
// read text.
//
// HOW A SMALL MODEL EMITS A USABLE CALL. The hope was that --jinja grammar-locks
// decoding so a malformed call is unreachable. On-device that is NOT what happens:
// with tool_choice 'auto' llama.cpp lets the model produce free text and then
// PARSES it, and the parse is fragile — Llama-3.2's tool format hard-500s the
// server ("does not match the expected native format"), and Qwen-Coder writes a
// clean tool call but as a JSON block in ordinary content, not the structured
// tool_calls field. So we do NOT rely on the template: toolCallFromContent()
// reads the JSON the model actually wrote, for a known tool. The failure mode is
// then SEMANTIC (wrong tool, wrong path) — graded by deterministic checkers —
// instead of a raw 500 in the user's face.
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
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, join } from 'node:path';
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
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the project — build, test, run scripts, git, install deps, anything a file edit cannot do. Use this to actually DO things and to check your work. Output (stdout+stderr) and the exit code come back.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'the shell command, e.g. "npm test" or "git status"' } },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Change PART of an existing file: replace old_string with new_string. old_string must appear EXACTLY ONCE (include enough surrounding context to be unique). Prefer this over write_file for a small change to a big file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'file to edit, relative to the project root' },
          old_string: { type: 'string', description: 'the exact text to replace (must be unique in the file)' },
          new_string: { type: 'string', description: 'the text to replace it with' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the project for a text pattern (like grep). Use this to FIND where something lives before you read or change it.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'the text to search for' },
          path: { type: 'string', description: 'optional subdirectory to search under, relative to the project root' },
        },
        required: ['pattern'],
      },
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));

/**
 * Read a tool call the model wrote as ORDINARY CONTENT instead of a structured
 * tool_calls entry.
 *
 * Small local models under llama.cpp routinely describe the call as a JSON
 * object in prose — ```json {"name":"write_file","arguments":{…}} ``` — rather
 * than emit the native tool-call tokens. Measured on-device: Qwen-Coder-1.5B
 * does exactly this, with clean JSON and real file contents, on tool_choice
 * 'auto'; forcing 'required' or using Llama-3.2 instead broke other ways. So we
 * meet the model where it actually is: pull a well-formed {name, arguments} for
 * a KNOWN tool out of content. Unknown names are ignored — random JSON in an
 * answer is not a tool call.
 *
 * @returns {{name:string, args:object}|null}
 */
export function toolCallFromContent(content) {
  const text = String(content ?? '');
  const blocks = [];
  const fence = /```(?:json|tool_call)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = fence.exec(text))) blocks.push(m[1]);
  blocks.push(text); // also try the whole thing, for a bare object
  for (const b of blocks) {
    const s = b.indexOf('{');
    const e = b.lastIndexOf('}');
    if (s < 0 || e <= s) continue;
    let obj;
    try { obj = JSON.parse(b.slice(s, e + 1)); } catch { continue; }
    // Accept the shapes small models actually produce: {name,arguments},
    // {tool_call:{…}}, {function:{…}}.
    const call = obj?.name ? obj : (obj?.tool_call ?? obj?.function ?? null);
    if (!call || !TOOL_NAMES.has(call.name)) continue;
    let args = call.arguments ?? call.parameters ?? {};
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    return { name: call.name, args: args && typeof args === 'object' ? args : {} };
  }
  return null;
}

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
  // the profile forbids is refused here, not negotiated. run_command maps to
  // Bash (scout refuses it, builder/verifier allow), edit_file to Edit, search
  // to Grep — so the walls that grade the CLI agents grade these too.
  const toolFor = { write_file: 'Write', read_file: 'Read', list_files: 'LS', open_preview: 'Read', run_command: 'Bash', edit_file: 'Edit', search: 'Grep' }[name];
  if (!toolFor) throw new Error(`unknown tool: ${name}`);
  const verdict = prof.check(toolFor, { file_path: args?.path ? resolve(cwd, String(args.path)) : undefined }, cwd);
  if (!verdict.ok) throw new Error(`refused by the ${profile} profile — ${verdict.why}`);

  if (name === 'run_command') {
    const command = String(args?.command ?? '').trim();
    if (!command) throw new Error('empty command');
    // Real shell in the project dir — the same unconfined-on-phone posture the
    // Claude/Codex Bash path already has, gated by the SAME profile + card. A
    // deadline and an output cap so a hung or chatty command cannot wedge or
    // flood the request.
    const r = spawnSync('bash', ['-lc', command], { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    if (r.error && r.error.code === 'ETIMEDOUT') return 'ERROR: command timed out after 120s';
    const out = ((r.stdout ?? '') + (r.stderr ?? '')).slice(0, MAX_READ_BYTES);
    return `exit ${r.status ?? 'null'}\n${out || '(no output)'}`;
  }
  if (name === 'edit_file') {
    const abs = safePath(cwd, args?.path, { mustExist: true });
    statRegular(abs, MAX_READ_BYTES);
    const before = readFileSync(abs, 'utf8');
    const oldS = String(args?.old_string ?? '');
    if (!oldS) throw new Error('old_string is required — say exactly what to replace');
    const n = before.split(oldS).length - 1;
    if (n === 0) return 'ERROR: old_string not found — read the file and copy the exact text (with surrounding context)';
    if (n > 1) return `ERROR: old_string appears ${n} times — add surrounding context so it is unique`;
    const after = before.replace(oldS, String(args?.new_string ?? ''));
    if (Buffer.byteLength(after) > MAX_WRITE_BYTES) throw new Error(`edit would make the file ${Buffer.byteLength(after)} bytes (max ${MAX_WRITE_BYTES})`);
    writeFileSync(abs, after);
    return `edited ${relative(cwd, abs)} (1 replacement)`;
  }
  if (name === 'search') {
    const pattern = String(args?.pattern ?? '');
    if (!pattern) throw new Error('empty pattern');
    const root = safePath(cwd, args?.path || '.', { mustExist: true });
    const hits = [];
    const walk = (dir, depth) => {
      if (depth > 8 || hits.length >= 100) return;
      let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) { walk(p, depth + 1); continue; }
        if (!e.isFile()) continue;
        let st; try { st = statSync(p); } catch { continue; }
        if (st.size > 512 * 1024) continue; // skip big/binary blobs
        let body; try { body = readFileSync(p, 'utf8'); } catch { continue; }
        body.split('\n').forEach((line, i) => {
          if (hits.length < 100 && line.includes(pattern)) hits.push(`${relative(cwd, p)}:${i + 1}: ${line.trim().slice(0, 160)}`);
        });
      }
    };
    walk(root, 0);
    return hits.length ? hits.join('\n') : `no matches for "${pattern}"`;
  }

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

You have tools and you SHOULD use them — do not describe an action, take it.
- write_file / edit_file to create or change files (edit_file for a small change to a big file)
- read_file / list_files / search to see what is there before you change it
- run_command to actually DO things: build, test, run, git, install — and to CHECK your work
- open_preview to show a web page you wrote
When the user asks for a web page: write_file the complete HTML, then open_preview it.
Paths are relative to the project root. When you have finished, reply with one short sentence saying what you did.`;

/**
 * Run one request through the local model with tools.
 *
 * `fetchImpl` is injectable so the suite can drive the whole loop — including
 * multi-step tool use and the runaway guards — without a model or a network.
 */
export async function localAgentRun({
  prompt, cwd, profile = 'builder', model = 'local', history = [],
  base = `${LOCAL_LLM_BASE}/v1`, apiKey = null, fetchImpl = fetch, onEvent = () => {}, onPreview,
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

  // Prior turns (user/assistant only — the system prompt is ours) give the
  // agent conversational memory, so an API model is a coding assistant WITH
  // context, not amnesiac between turns.
  const messages = [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: String(prompt) }];
  const used = [];
  let calls = 0;

  for (let step = 0; step < maxSteps; step++) {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      // Bearer when driving an API provider (Gemini/OpenAI/…); absent for the
      // keyless local server. Same one OpenAI-compatible shape either way.
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
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
      // llama.cpp's --jinja tool parser HARD-500s when a model emits a tool call
      // its chat template can't parse (json.exception / "does not match the
      // expected native format"). Llama-3.2 trips this reliably; Qwen models do
      // not. It is not our bug and not the user's prompt — so say which model
      // stack is at fault and where to switch it, instead of leaking a raw 500.
      if (/parse error|does not match the expected|json\.exception|native format/i.test(body)) {
        throw new Error("this model's tool-call output couldn't be parsed by llama-server — a known llama.cpp limitation with some models (Llama-3.2 hits it, Qwen models don't). Switch the served model in Doctor → Local brain.");
      }
      throw new Error(`local model HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const msg = json?.choices?.[0]?.message ?? {};
    messages.push(msg);

    let toolCalls = msg.tool_calls ?? [];
    // Fallback: the model may have written the call as content JSON rather than
    // a structured tool_calls entry (small models do this constantly). Recover
    // it, and REWRITE the assistant turn to carry the tool_call — otherwise the
    // next request answers prose with a tool result, which the server rejects
    // as a malformed conversation.
    if (!toolCalls.length) {
      const fc = toolCallFromContent(msg.content);
      if (fc) {
        toolCalls = [{ id: `content-${step}`, type: 'function', function: { name: fc.name, arguments: JSON.stringify(fc.args) } }];
        messages[messages.length - 1] = { role: 'assistant', content: null, tool_calls: toolCalls };
      }
    }
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
