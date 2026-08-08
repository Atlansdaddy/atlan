import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getStoredKey } from './keys.js';
import { killTree } from './procTree.js';
import { interactiveGate } from './enginePolicy.js';
import { confineMode, declaredTier, APP_ROOT } from './config.js';
import { confinedSpawn, unconfinedSpawn } from './lib/sandbox.js';
import { childEnv, credentialTargets, credentialPreflight, homeReadable, VENDOR_STORES } from './lib/credblind.js';
import { confineSpawn } from './sandbox/confine.js';

// ── live chat-path agent CLIs ─────────────────────────────────────────────
// Every child spawned here is REGISTERED, because every child spawned here runs
// with its own approval system switched off (see interactiveGate). Until this
// existed the child was held in a local `const` and nothing else: it survived
// the WebSocket that started it, Fleet showed no run, KILL ALL walked only the
// fleet's own map and answered `killed: 0`, and SIGKILLing the whole cockpit
// left it running — the supervisor then respawned a server that knew nothing
// about it. An agent explicitly launched WITHOUT a permission gate is the one
// that most has to stay reachable. docs/WORKER-DESIGN.md's "all children
// tracked; KILL is real (no orphans surviving)" is now true of this path too.
// (Cross-vendor adversarial review, 2026-08-06.)
const liveTurns = new Map(); // seq → { child, engine, cwd, owner, startedAt }
let turnSeq = 0;

/** Kill the tracked chat-path CLIs matching `filter`. Returns how many were signalled. */
export function killAgentTurns(filter = () => true) {
  let n = 0;
  for (const [seq, t] of [...liveTurns]) {
    if (!filter(t)) continue;
    liveTurns.delete(seq);
    if (killTree(t.child)) n++;
  }
  return n;
}
/** What is running on the chat path right now — for the fleet surface and tests. */
export function liveAgentTurns() {
  return [...liveTurns.values()].map(({ engine, cwd, startedAt }) => ({ engine, cwd, startedAt }));
}

// Agent CLIs (Codex, Antigravity, Grok Build, Copilot) driven headlessly —
// Antigravity (`agy`) replaced the Gemini CLI when Google retired its free
// Sign-in-with-Google backend on 2026-06-18. Unlike Claude (Agent SDK with
// per-tool permission cards), exec-mode CLIs are all-or-nothing on approvals —
// so they run full-auto and the UI labels them that way. Claude stays the
// gated primary; these are extra hands for repos you trust them in.

/**
 * The command each agent engine ACTUALLY spawns, resolved exactly the way
 * agentTurn resolves it.
 *
 * agentStatus() answers "is there a credential", which is not the same question
 * as "will this run" — a CLI can be authenticated and uninstalled, or installed
 * and logged out, and both looked identical from chat: silence. The Doctor pane
 * asks the other half by running the binary. test/unit.mjs asserts this list and
 * agentStatus() name the same engines, so neither can quietly grow past the other.
 */
export function agentBinaries() {
  return [
    { id: 'codex', cmd: 'codex' },
    { id: 'antigravity', cmd: agyBin() ?? 'agy' },
    { id: 'grok', cmd: grokBin() ?? 'grok' },
    { id: 'copilot', cmd: copilotBin() ?? 'copilot' },
  ];
}

export function agentStatus() {
  // homedir() is right on every platform; `HOME ?? '/root'` broke auth
  // detection for anyone not running as root (and always on Windows).
  const home = homedir();
  return [
    {
      id: 'codex',
      label: 'Codex (GPT-5.6) — agent, full-auto',
      model: 'codex',
      // No model tiers: with ChatGPT-subscription auth codex rejects ANY
      // explicit -m ("model is not supported when using Codex with a ChatGPT
      // account", 400 — verified 2026-07-25). The CLI picks its own model.
      group: 'agent',
      ready: existsSync(`${home}/.codex/auth.json`) || !!process.env.CODEX_API_KEY,
      needs: 'run: codex login --device-auth (Term tab)',
    },
    {
      id: 'antigravity',
      label: 'Antigravity (Gemini) — agent, full-auto',
      model: 'antigravity',
      // from `agy models` (1.1.7) — Antigravity serves a multi-vendor roster
      models: ['default', 'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low',
        'gemini-3.5-flash-high', 'gemini-3.5-flash-medium', 'gemini-3.5-flash-low',
        'gemini-3.1-pro-high', 'gemini-3.1-pro-low', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'],
      group: 'agent',
      ready: !!agyBin() && (agyAuthed() || !!(process.env.ANTIGRAVITY_API_KEY || getStoredKey('ANTIGRAVITY_API_KEY'))),
      needs: agyBin() ? 'run: agy (Term tab) → Sign in with Google' : 'install: curl -fsSL https://antigravity.google/cli/install.sh | bash',
    },
    {
      id: 'grok',
      label: 'Grok Build (xAI) — agent, full-auto',
      model: 'grok',
      models: ['default', 'grok-4.5'], // from `grok models` — expands with the plan
      group: 'agent',
      ready: !!grokBin() && (grokAuthed() || !!(process.env.XAI_API_KEY || getStoredKey('XAI_API_KEY'))),
      needs: grokBin() ? 'run: grok login (Term tab)' : 'install: npm i -g @xai-official/grok',
    },
    {
      id: 'copilot',
      label: 'GitHub Copilot — agent, full-auto',
      model: 'copilot',
      // Copilot supports --model (default Claude Sonnet 4.5; also Sonnet 4, GPT-5)
      // but the exact --model ids aren't confirmed until login; single option for
      // now, tiers added once `copilot` /model is inspected on an authed box.
      group: 'agent',
      ready: !!copilotBin() && (copilotAuthed() || !!(process.env.GH_COPILOT_TOKEN || process.env.GITHUB_TOKEN)),
      needs: copilotBin() ? 'run: copilot login (Term tab)' : 'install: npm i -g @github/copilot',
    },
  ];
}

// GitHub Copilot CLI (GA 2026-02, `copilot` binary). Requires an active Copilot
// subscription: `copilot login` → ~/.copilot. Headless = `-p` (default text
// output; --output-format json exists, schema unversioned → plain + one-bubble
// flush), `--continue` resumes the most recent session, `--allow-all` is the
// full-auto belt (files + shell + urls), `--model` picks the model.
export function copilotBin() {
  if (existsSync('/usr/bin/copilot')) return '/usr/bin/copilot';
  return existsSync('/usr/local/bin/copilot') ? '/usr/local/bin/copilot' : null;
}
function copilotAuthed() {
  return existsSync(`${homedir()}/.copilot`);
}

// Grok Build (xAI's official CLI, open to SuperGrok / X Premium+ since
// 2026-05-25). `grok login` = browser OAuth → ~/.grok/auth.json; XAI_API_KEY
// is the metered fallback. Headless = `-p` (plain text; --output-format
// json/streaming-json exists but its event schema is unversioned — plain +
// one-bubble flush until we pin it), `-c` continues the most recent session
// in this cwd, `--always-approve` = full-auto, --no-auto-update for automation.
export function grokBin() {
  if (existsSync('/usr/bin/grok')) return '/usr/bin/grok';
  return existsSync('/usr/local/bin/grok') ? '/usr/local/bin/grok' : null;
}
function grokAuthed() {
  return existsSync(`${homedir()}/.grok/auth.json`);
}

// Antigravity CLI (agy) — Gemini CLI's successor (Google retired the gemini
// command for individuals 2026-06-18; subscription OAuth works again here).
// Auth = browser sign-in on first interactive run (token lands in the system
// keyring; the config dir appears then), or ANTIGRAVITY_API_KEY. Headless =
// `agy -p` — plain text out, no stream-json in 1.x; `-c` continues the most
// recent conversation, which is how a chat thread persists across turns.
export function agyBin() {
  const home = homedir();
  if (existsSync(`${home}/.local/bin/agy`)) return `${home}/.local/bin/agy`;
  return existsSync('/usr/local/bin/agy') ? '/usr/local/bin/agy' : null;
}
function agyAuthed() {
  return existsSync(`${homedir()}/.gemini/antigravity-cli`);
}

// ── how an exec-mode CLI is actually launched ─────────────────────────────
// All four of these run with their own approval gates OFF (there is no other
// headless mode), so everything that constrains them has to be ours. Two things
// happen here that did not before:
//
// 1. THE CHILD'S ENVIRONMENT IS AN ALLOWLIST. It used to be `{...process.env}`,
//    verbatim — which handed codex the xAI key, handed grok the Anthropic key,
//    and handed all four ATLAN_TOKEN, the credential the 2026-08-04 incident
//    used to drive the cockpit's own API. Now each engine receives the
//    allowlist plus exactly its own key and nothing else.
//
// 2. EVERY OTHER VENDOR'S AUTH STORE IS MASKED OUT of its filesystem view, along
//    with the cockpit's own state and the usual ~/.ssh, ~/.aws, ~/.git-credentials.
//    HOME stays — the subscription login is the whole reason these engines run
//    without an API key — so the one store this engine needs stays readable and
//    writable. That is the honest shape of the guarantee: not "the agent sees no
//    credential", but "the agent sees exactly the one credential it authenticates
//    with, and no other."
//
// The vendor store is also the only writable path besides the project: codex
// records threads under ~/.codex, and Studio collects generated images from
// there after the run.
export function spawnAgentCli(engine, cmd, args, { cwd, grant = {}, stdio } = {}) {
  const home = homedir();
  const env = childEnv(process.env, { grant });
  const mask = credentialTargets({ appRoot: APP_ROOT, home, keepFor: engine });
  const writable = [
    cwd,
    ...(VENDOR_STORES[engine] ?? []).map((d) => join(home, d)),
    // /run is replaced by an empty tmpfs so no agent can reach docker.sock,
    // tailscaled's control socket or the system bus. $XDG_RUNTIME_DIR is the one
    // thing that has to come back: the antigravity CLI keeps its token in the
    // system keyring and reaches it over D-Bus at /run/user/<uid>/bus. Declared,
    // so it is one named path rather than the whole of /run.
    ...(process.env.XDG_RUNTIME_DIR ? [process.env.XDG_RUNTIME_DIR] : []),
  ].filter((p) => existsSync(p));
  // net:'shared' is the honest setting, not a convenience: these CLIs have to
  // reach their provider, and Atlan has no egress allowlist yet. The descriptor
  // records network as unenforced so nothing downstream can claim otherwise.
  // HOME is replaced by an empty tmpfs and only these come back: the engine's own
  // auth store (writable — it rewrites its token on refresh) and ~/.gitconfig
  // (read-only — without it every commit an agent makes is authorless). Every
  // other credential under HOME is gone by construction rather than by name.
  const readable = homeReadable(home);
  // detached: its own process GROUP, so killTree's negative-PID signal reaches
  // the shells and tool children these CLIs spawn — without it a kill hits only
  // the immediate pid and the real workers carry on. NEITHER branch had this
  // line: confinement never needed it, and the tracking work that did need it
  // spawned directly rather than through here. It exists only because the merge
  // put it back, and test/walls.mjs's orphaned-child assertion is what would
  // have caught its absence.
  // stdio is forwarded because the seccomp launcher nested inside receives its
  // policy on an extra file descriptor. Dropping it here silently disarmed the
  // inner layer: the launcher would find nothing on the fd and the namespace
  // layer would still report enforced:true. Two layers, one descriptor — the
  // outer one has to carry the inner one's channel.
  const opts = { cwd, env, writable, readable, mask, net: 'shared', home, detached: true, ...(stdio ? { stdio } : {}) };
  const mode = confineMode();

  // The one bypass a path mask cannot cover: a hardlink planted earlier is a
  // second directory entry for the same inode, and the mask follows the path,
  // not the inode. MEASURED — the alias reads the secret straight through a
  // working mask. It is detectable though, because st_nlink on a credential file
  // is 1 unless somebody made another name for it. A fact about the inode, not a
  // pattern match on a filename.
  //
  // Under `strict` that is a refusal: someone has already staged the bypass, and
  // starting the run anyway would be enforcing a boundary we know is open. Under
  // `1` it rides along on the descriptor so the Doctor and the caller can see it
  // — a legitimate backup can produce the same signal, and bricking a working
  // phone-node setup over an ambiguous signal is the wrong trade.
  const credIssues = credentialPreflight(mask);
  if (mode === 'strict' && credIssues.some((p) => p.kind === 'hardlinked')) {
    throw new Error(
      `refusing to run: ${credIssues.filter((p) => p.kind === 'hardlinked').map((p) => p.path).join(', ')} — ` +
      'a second name for this inode already exists, so the credential mask would not actually hide it. Nothing was spawned.',
    );
  }

  if (mode === 'off') {
    const c = unconfinedSpawn(cmd, args, { ...opts, acknowledgeUnconfined: true });
    c.confinement.credentialIssues = credIssues;
    return c;
  }
  try {
    const c = confinedSpawn(cmd, args, opts);
    c.confinement.credentialIssues = credIssues;
    return c;
  } catch (err) {
    // strict = the run does not happen. This is the fail-closed branch, and it
    // throws rather than returning a child, so a caller cannot use the result
    // by accident.
    if (mode === 'strict') throw err;
    // ATLAN_CONFINE=1 on a host that cannot confine (the phone). Runs, but the
    // descriptor carries the kernel's own reason it could not be gated.
    const c = unconfinedSpawn(cmd, args, { ...opts, acknowledgeUnconfined: true });
    c.confinement.credentialIssues = credIssues;
    return c;
  }
}

export function agentTurn({ engine, cwd, text, send, state, model = null, owner = null }) {
  if (state.running) {
    send({ t: 'chat.err', msg: 'agent is mid-turn — wait for it to finish' });
    return;
  }
  state.running = true;
  send({ t: 'atlan.mood', mood: 'building' });

  // picker sends `default` (or the engine id itself) to mean "CLI's choice"
  const pickedModel = model && model !== 'default' && model !== engine ? model : null;
  // The gate flags come from enginePolicy's table, NOT from a literal spelled
  // out here. They were duplicated: preflight.js told the user "every dangerous
  // tool asks you first" while these four lines passed --dangerously-* on every
  // turn, and nothing connected the claim to the code. One table, read by both
  // the launcher and the honesty check, is what stops that.
  const gate = interactiveGate(engine);
  if (!gate) {
    state.running = false;
    return send({ t: 'chat.err', msg: `unknown agent: ${engine}` });
  }
  // `grant` is the ONLY provider credential this engine will be able to see.
  // It replaces `env = { ...process.env }`, which handed codex the xAI key,
  // grok the Anthropic key, and all four ATLAN_TOKEN — the credential the
  // 2026-08-04 incident used to drive the cockpit's own API.
  let cmd, args, grant = {};
  if (engine === 'codex') {
    cmd = 'codex';
    args = state.codexThread
      ? ['exec', 'resume', state.codexThread, '--json', ...gate.args, text]
      : ['exec', '--json', ...gate.args, '--skip-git-repo-check', text];
    if (pickedModel) args.splice(1, 0, '-m', pickedModel);
  } else if (engine === 'antigravity') {
    cmd = agyBin() ?? 'agy';
    args = [...(state.agyStarted ? ['-c'] : []), ...(pickedModel ? ['--model', pickedModel] : []), ...gate.args, '-p', text];
    const akey = process.env.ANTIGRAVITY_API_KEY || getStoredKey('ANTIGRAVITY_API_KEY');
    if (akey) grant.ANTIGRAVITY_API_KEY = akey;
  } else if (engine === 'grok') {
    cmd = grokBin() ?? 'grok';
    args = ['--no-auto-update', ...(state.grokStarted ? ['-c'] : []), ...(pickedModel ? ['-m', pickedModel] : []), ...gate.args, '-p', text];
    const xkey = process.env.XAI_API_KEY || getStoredKey('XAI_API_KEY');
    if (xkey) grant.XAI_API_KEY = xkey;
  } else if (engine === 'copilot') {
    cmd = copilotBin() ?? 'copilot';
    // gate.args comes from enginePolicy's table — it is what replaced the
    // literal '--allow-all' that used to sit here.
    args = [...(state.copilotStarted ? ['--continue'] : []), ...(pickedModel ? ['--model', pickedModel] : []), ...gate.args, '-p', text];
    // Copilot authenticates from ~/.copilot, or from one of these when a user
    // is key-authed instead. Granted only to copilot — codex and grok used to
    // receive GITHUB_TOKEN too, purely because the whole environment was copied.
    for (const k of ['GH_COPILOT_TOKEN', 'GITHUB_TOKEN']) if (process.env[k]) grant[k] = process.env[k];
  } else {
    state.running = false;
    return send({ t: 'chat.err', msg: `unknown agent: ${engine}` });
  }

  // ── the two layers, nested ────────────────────────────────────────────────
  //
  // They are not alternatives and the ORDER is the design. confineSpawn rewrites
  // (cmd, args) into (atlan-confine, [policy…, cmd, …args]) — a small launcher
  // that installs a seccomp filter and then execs. spawnAgentCli then runs THAT
  // under unshare + setpriv. Final argv:
  //
  //     unshare <ns> -- setpriv --bounding-set=-all -- atlan-confine <policy> -- cmd
  //
  // Outermost is the namespace layer: a real filesystem and PID boundary, and
  // unavailable on an unrooted phone (no GKI arm64 config ships CONFIG_USER_NS,
  // and Android's zygote filter blocks mount and chroot outright). Innermost is
  // seccomp, which is the one kernel control that DOES survive there — allowlisted
  // for app processes, not intercepted by PRoot, irrevocable once no_new_privs is
  // set, inherited across fork and preserved across execve.
  //
  // So a desktop gets both. A phone gets the inner one alone, and says so.
  let conf = null;
  try {
    conf = confineSpawn({ declared: declaredTier(), cmd, args, cwd, engine });
  } catch (err) {
    // Refusal, not degradation: the run declared a tier this device does not
    // establish, and the message names the rung that said no.
    state.running = false;
    send({ t: 'chat.err', msg: `${engine}: ${String(err?.message ?? err)}` });
    send({ t: 'atlan.mood', mood: 'alarmed' });
    return;
  }

  let child;
  try {
    child = conf
      ? spawnAgentCli(engine, conf.file, conf.args, { cwd, grant, stdio: conf.stdio })
      : spawnAgentCli(engine, cmd, args, { cwd, grant });
  } catch (err) {
    // ATLAN_CONFINE=strict on a host that cannot confine. Nothing was spawned;
    // say why in the same words the kernel used.
    state.running = false;
    return send({ t: 'chat.err', msg: `refused to launch ${engine}: ${err.message}` });
  }
  // The policy travels on a file descriptor, never a path — a path is a TOCTOU
  // surface, and the launcher's own configuration is the last thing that should
  // be swappable between resolution and read.
  if (conf) conf.writePolicy(child);
  // Registered because it runs with its own approval system switched off. Both
  // halves of this line arrived from different branches and neither works alone:
  // confinement decides what the child may touch, registration decides whether
  // we can still reach it. Before registration existed the child outlived the
  // WebSocket that started it, Fleet showed no run, and KILL ALL answered 0.
  // Registered because it runs with its own approval system switched off.
  // Confinement decides what the child may touch; registration decides whether
  // we can still reach it. Before this existed the child outlived the WebSocket
  // that started it, Fleet showed no run, and KILL ALL answered 0.
  const seq = ++turnSeq;
  liveTurns.set(seq, { child, engine, cwd, owner, startedAt: Date.now() });
  const unregister = () => liveTurns.delete(seq);
  child.stdin.end(); // codex waits on stdin otherwise
  let stderrTail = '';
  let sawText = false;
  let buf = '';
  let geminiText = '';
  // A turn on these engines showed the user NOTHING until it ended: no thinking,
  // no output, no way to tell working from hung from broken. Both flags exist to
  // fix that, and both reuse frames the client already renders — the thinking
  // panel and the streaming bubble — so none of this needs new UI.
  let thinkOpen = false;
  let streamOpen = false;
  let killedFor = null;
  const turnTimeout = setTimeout(() => { killedFor = 'turn timeout (8min)'; killTree(child); }, 480000);

  const handleEvent = (e) => {
    // Codex events
    if (e.type === 'thread.started' && e.thread_id) state.codexThread = e.thread_id;
    if (e.type === 'item.completed' && e.item) {
      const it = e.item;
      const itype = it.type ?? it.item_type;
      if (itype === 'agent_message' && it.text) { sawText = true; send({ t: 'chat.msg', role: 'assistant', engine: engineLabel(engine), text: it.text }); }
      else if (itype === 'command_execution') send({ t: 'tool.use', name: 'shell', input: String(it.command ?? '').slice(0, 300) });
      else if (itype === 'file_change') send({ t: 'tool.use', name: 'edit', input: (it.changes ?? []).map((c) => c.path).join(', ').slice(0, 300) || 'files changed' });
      else if (itype === 'mcp_tool_call') send({ t: 'tool.use', name: it.tool ?? 'mcp', input: JSON.stringify(it.arguments ?? {}).slice(0, 200) });
      else if (itype === 'reasoning') {
        // Was dropped "to keep the thread quiet". The cost of that quiet was
        // that a working turn and a hung one looked identical, which is the
        // single most reported problem with these engines. It goes to the same
        // collapsible panel Claude's thinking uses.
        const r = String(it.text ?? it.summary ?? it.content ?? '').trim();
        if (r) {
          if (!thinkOpen) { thinkOpen = true; send({ t: 'chat.thinkstart' }); }
          send({ t: 'chat.think', text: r });
        }
      }
    }
    if (e.type === 'turn.completed') {
      const u = e.usage ?? {};
      send({ t: 'chat.result', subtype: 'success', brain: engine, tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) || null });
    }
    // Gemini events (parsed defensively — schema shifts across 0.x).
    // message events are deltas and include a user-prompt echo: skip user
    // role, accumulate assistant text, flush as ONE bubble at result time.
    if (e.type === 'message' && e.role !== 'user' && (e.content || e.text)) {
      geminiText += e.content ?? e.text;
    }
    if (e.type === 'tool_use') send({ t: 'tool.use', name: e.name ?? 'tool', input: JSON.stringify(e.args ?? e.input ?? {}).slice(0, 200) });
    if (e.type === 'result') {
      const finalText = geminiText || e.response || '';
      if (finalText) { sawText = true; send({ t: 'chat.msg', role: 'assistant', engine: engineLabel(engine), text: finalText }); }
      geminiText = '';
      send({ t: 'chat.result', subtype: 'success', brain: engine, tokens: e.stats?.total_tokens ?? null });
    }
    if (e.type === 'error') send({ t: 'chat.err', msg: `${engineLabel(engine)}: ${e.message ?? JSON.stringify(e).slice(0, 200)}` });
  };

  child.stdout.on('data', (chunk) => {
    // agy and grok print a plain-text response (no event stream we trust yet) —
    // collect it whole and flush as ONE bubble at close, not a bubble per line.
    if (engine === 'antigravity' || engine === 'grok' || engine === 'copilot') {
      // These print plain text with no event stream, and used to be buffered
      // whole and flushed at close — so the user watched an empty screen for the
      // entire turn. Stream it instead, through the SAME textstart/delta frames
      // Claude already uses, and skip the duplicate bubble at close.
      const s = chunk.toString();
      geminiText += s;
      if (!streamOpen) { streamOpen = true; send({ t: 'chat.textstart', engine: engineLabel(engine) }); }
      send({ t: 'chat.delta', text: s });
      return;
    }
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { handleEvent(JSON.parse(line)); }
      catch { if (line.length > 2) { sawText = true; send({ t: 'chat.msg', role: 'assistant', engine: engineLabel(engine), text: line }); } }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-600);
    // unauthenticated codex retries 401s forever — kill it with a useful message
    if (!killedFor && /401 Unauthorized|not logged in|invalid api key/i.test(stderrTail)) {
      killedFor = engine === 'codex'
        ? 'not logged in — run `codex login --device-auth` in the Term tab'
        : 'auth rejected — check the key in Doctor → Engine keys';
      killTree(child);
    }
  });

  child.on('error', (err) => {
    clearTimeout(turnTimeout);
    unregister();
    state.running = false;
    send({ t: 'chat.err', msg: `${engineLabel(engine)} failed to start: ${err.message}` });
    send({ t: 'atlan.mood', mood: 'alarmed' });
  });

  child.on('close', (code) => {
    clearTimeout(turnTimeout);
    unregister();
    state.running = false;
    if (killedFor) {
      send({ t: 'chat.err', msg: `${engineLabel(engine)}: ${killedFor}` });
      send({ t: 'atlan.mood', mood: 'alarmed' });
      return;
    }
    if (code !== 0) {
      send({ t: 'chat.err', msg: `${engineLabel(engine)} exited ${code}: ${stderrTail.trim().slice(-300) || 'no error output'}` });
      send({ t: 'atlan.mood', mood: 'alarmed' });
      return;
    }
    if (engine === 'antigravity' || engine === 'grok' || engine === 'copilot') {
      // future turns continue the conversation (agy/grok use -c, copilot --continue)
      if (engine === 'antigravity') state.agyStarted = true;
      else if (engine === 'grok') state.grokStarted = true;
      else state.copilotStarted = true;
      const out = geminiText.trim();
      geminiText = '';
      // If it streamed, the bubble is already on screen and complete — sending
      // chat.msg here too would print the whole answer a second time.
      if (out && !streamOpen) { sawText = true; send({ t: 'chat.msg', role: 'assistant', engine: engineLabel(engine), text: out }); }
      if (out && streamOpen) sawText = true;
      send({ t: 'chat.result', subtype: 'success', brain: engine, tokens: null });
      send({ t: 'atlan.mood', mood: 'proud' });
      return;
    }
    if (!sawText) send({ t: 'chat.result', subtype: 'success', brain: engine, tokens: null });
    send({ t: 'atlan.mood', mood: 'proud' });
  });
}

function engineLabel(engine) {
  return { codex: 'Codex · full-auto', antigravity: 'Antigravity · full-auto', grok: 'Grok Build · full-auto', copilot: 'Copilot · full-auto' }[engine] ?? `${engine} · full-auto`;
}
