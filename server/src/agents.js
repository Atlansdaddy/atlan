import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getStoredKey } from './keys.js';

// Agent CLIs (Codex, Antigravity, Grok Build, Copilot) driven headlessly —
// Antigravity (`agy`) replaced the Gemini CLI when Google retired its free
// Sign-in-with-Google backend on 2026-06-18. Unlike Claude (Agent SDK with
// per-tool permission cards), exec-mode CLIs are all-or-nothing on approvals —
// so they run full-auto and the UI labels them that way. Claude stays the
// gated primary; these are extra hands for repos you trust them in.

export function agentStatus() {
  const home = process.env.HOME ?? '/root';
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
  return existsSync(`${process.env.HOME ?? '/root'}/.copilot`);
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
  return existsSync(`${process.env.HOME ?? '/root'}/.grok/auth.json`);
}

// Antigravity CLI (agy) — Gemini CLI's successor (Google retired the gemini
// command for individuals 2026-06-18; subscription OAuth works again here).
// Auth = browser sign-in on first interactive run (token lands in the system
// keyring; the config dir appears then), or ANTIGRAVITY_API_KEY. Headless =
// `agy -p` — plain text out, no stream-json in 1.x; `-c` continues the most
// recent conversation, which is how a chat thread persists across turns.
export function agyBin() {
  const home = process.env.HOME ?? '/root';
  if (existsSync(`${home}/.local/bin/agy`)) return `${home}/.local/bin/agy`;
  return existsSync('/usr/local/bin/agy') ? '/usr/local/bin/agy' : null;
}
function agyAuthed() {
  return existsSync(`${process.env.HOME ?? '/root'}/.gemini/antigravity-cli`);
}

export function agentTurn({ engine, cwd, text, send, state, model = null }) {
  if (state.running) {
    send({ t: 'chat.err', msg: 'agent is mid-turn — wait for it to finish' });
    return;
  }
  state.running = true;
  send({ t: 'atlan.mood', mood: 'building' });

  // picker sends `default` (or the engine id itself) to mean "CLI's choice"
  const pickedModel = model && model !== 'default' && model !== engine ? model : null;
  let cmd, args, env = { ...process.env };
  if (engine === 'codex') {
    cmd = 'codex';
    args = state.codexThread
      ? ['exec', 'resume', state.codexThread, '--json', '--dangerously-bypass-approvals-and-sandbox', text]
      : ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', text];
    if (pickedModel) args.splice(1, 0, '-m', pickedModel);
  } else if (engine === 'antigravity') {
    cmd = agyBin() ?? 'agy';
    args = [...(state.agyStarted ? ['-c'] : []), ...(pickedModel ? ['--model', pickedModel] : []), '--dangerously-skip-permissions', '-p', text];
    const akey = process.env.ANTIGRAVITY_API_KEY || getStoredKey('ANTIGRAVITY_API_KEY');
    if (akey) env.ANTIGRAVITY_API_KEY = akey;
  } else if (engine === 'grok') {
    cmd = grokBin() ?? 'grok';
    args = ['--no-auto-update', ...(state.grokStarted ? ['-c'] : []), ...(pickedModel ? ['-m', pickedModel] : []), '--always-approve', '-p', text];
    const xkey = process.env.XAI_API_KEY || getStoredKey('XAI_API_KEY');
    if (xkey) env.XAI_API_KEY = xkey;
  } else if (engine === 'copilot') {
    cmd = copilotBin() ?? 'copilot';
    args = [...(state.copilotStarted ? ['--continue'] : []), ...(pickedModel ? ['--model', pickedModel] : []), '--allow-all', '-p', text];
  } else {
    state.running = false;
    return send({ t: 'chat.err', msg: `unknown agent: ${engine}` });
  }

  const child = spawn(cmd, args, { cwd, env });
  child.stdin.end(); // codex waits on stdin otherwise
  let stderrTail = '';
  let sawText = false;
  let buf = '';
  let geminiText = '';
  let killedFor = null;
  const turnTimeout = setTimeout(() => { killedFor = 'turn timeout (8min)'; child.kill(); }, 480000);

  const handleEvent = (e) => {
    // Codex events
    if (e.type === 'thread.started' && e.thread_id) state.codexThread = e.thread_id;
    if (e.type === 'item.completed' && e.item) {
      const it = e.item;
      const itype = it.type ?? it.item_type;
      if (itype === 'agent_message' && it.text) { sawText = true; send({ t: 'chat.msg', role: 'claude', engine: engineLabel(engine), text: it.text }); }
      else if (itype === 'command_execution') send({ t: 'tool.use', name: 'shell', input: String(it.command ?? '').slice(0, 300) });
      else if (itype === 'file_change') send({ t: 'tool.use', name: 'edit', input: (it.changes ?? []).map((c) => c.path).join(', ').slice(0, 300) || 'files changed' });
      else if (itype === 'mcp_tool_call') send({ t: 'tool.use', name: it.tool ?? 'mcp', input: JSON.stringify(it.arguments ?? {}).slice(0, 200) });
      else if (itype === 'reasoning') { /* keep the thread quiet */ }
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
      if (finalText) { sawText = true; send({ t: 'chat.msg', role: 'claude', engine: engineLabel(engine), text: finalText }); }
      geminiText = '';
      send({ t: 'chat.result', subtype: 'success', brain: engine, tokens: e.stats?.total_tokens ?? null });
    }
    if (e.type === 'error') send({ t: 'chat.err', msg: `${engineLabel(engine)}: ${e.message ?? JSON.stringify(e).slice(0, 200)}` });
  };

  child.stdout.on('data', (chunk) => {
    // agy and grok print a plain-text response (no event stream we trust yet) —
    // collect it whole and flush as ONE bubble at close, not a bubble per line.
    if (engine === 'antigravity' || engine === 'grok' || engine === 'copilot') { geminiText += chunk.toString(); return; }
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { handleEvent(JSON.parse(line)); }
      catch { if (line.length > 2) { sawText = true; send({ t: 'chat.msg', role: 'claude', engine: engineLabel(engine), text: line }); } }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-600);
    // unauthenticated codex retries 401s forever — kill it with a useful message
    if (!killedFor && /401 Unauthorized|not logged in|invalid api key/i.test(stderrTail)) {
      killedFor = engine === 'codex'
        ? 'not logged in — run `codex login --device-auth` in the Term tab'
        : 'auth rejected — check the key in Doctor → Engine keys';
      child.kill();
    }
  });

  child.on('close', (code) => {
    clearTimeout(turnTimeout);
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
      if (out) { sawText = true; send({ t: 'chat.msg', role: 'claude', engine: engineLabel(engine), text: out }); }
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
