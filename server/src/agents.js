import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getStoredKey } from './keys.js';

// Agent CLIs (Codex, Gemini) driven headlessly. Unlike Claude (Agent SDK with
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
      group: 'agent',
      ready: existsSync(`${home}/.codex/auth.json`) || !!process.env.CODEX_API_KEY,
      needs: 'run: codex login --device-auth (Term tab)',
    },
    {
      id: 'antigravity',
      label: 'Antigravity (Gemini) — agent, full-auto',
      model: 'antigravity',
      group: 'agent',
      ready: !!agyBin() && (agyAuthed() || !!(process.env.ANTIGRAVITY_API_KEY || getStoredKey('ANTIGRAVITY_API_KEY'))),
      needs: agyBin() ? 'run: agy (Term tab) → Sign in with Google' : 'install: curl -fsSL https://antigravity.google/cli/install.sh | bash',
    },
  ];
}

// Antigravity CLI (agy) — Gemini CLI's successor (Google retired the gemini
// command for individuals 2026-06-18; subscription OAuth works again here).
// Auth = browser sign-in on first interactive run (token lands in the system
// keyring; the config dir appears then), or ANTIGRAVITY_API_KEY. Headless =
// `agy -p` — plain text out, no stream-json in 1.x; `-c` continues the most
// recent conversation, which is how a chat thread persists across turns.
function agyBin() {
  const home = process.env.HOME ?? '/root';
  if (existsSync(`${home}/.local/bin/agy`)) return `${home}/.local/bin/agy`;
  return existsSync('/usr/local/bin/agy') ? '/usr/local/bin/agy' : null;
}
function agyAuthed() {
  return existsSync(`${process.env.HOME ?? '/root'}/.gemini/antigravity-cli`);
}

export function agentTurn({ engine, cwd, text, send, state }) {
  if (state.running) {
    send({ t: 'chat.err', msg: 'agent is mid-turn — wait for it to finish' });
    return;
  }
  state.running = true;
  send({ t: 'atlan.mood', mood: 'building' });

  let cmd, args, env = { ...process.env };
  if (engine === 'codex') {
    cmd = 'codex';
    args = state.codexThread
      ? ['exec', 'resume', state.codexThread, '--json', '--dangerously-bypass-approvals-and-sandbox', text]
      : ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', text];
  } else if (engine === 'antigravity') {
    cmd = agyBin() ?? 'agy';
    args = [...(state.agyStarted ? ['-c'] : []), '--dangerously-skip-permissions', '-p', text];
    const akey = process.env.ANTIGRAVITY_API_KEY || getStoredKey('ANTIGRAVITY_API_KEY');
    if (akey) env.ANTIGRAVITY_API_KEY = akey;
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
    // agy prints a plain-text response (no event stream) — collect it whole
    // and flush as ONE bubble at close instead of a bubble per line.
    if (engine === 'antigravity') { geminiText += chunk.toString(); return; }
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
    if (engine === 'antigravity') {
      state.agyStarted = true; // future turns use -c to continue the conversation
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
  return engine === 'codex' ? 'Codex · full-auto' : 'Antigravity · full-auto';
}
