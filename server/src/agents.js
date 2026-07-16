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
      id: 'gemini-cli',
      label: 'Gemini CLI — agent, full-auto',
      model: 'gemini-cli',
      group: 'agent',
      ready: !!(process.env.GEMINI_API_KEY || getStoredKey('GEMINI_API_KEY')),
      needs: 'GEMINI_API_KEY (Doctor → Engine keys)',
    },
  ];
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
  } else if (engine === 'gemini-cli') {
    cmd = 'gemini';
    args = ['-p', text, '-o', 'stream-json', '--approval-mode', 'yolo'];
    const key = process.env.GEMINI_API_KEY || getStoredKey('GEMINI_API_KEY');
    if (key) env.GEMINI_API_KEY = key;
  } else {
    state.running = false;
    return send({ t: 'chat.err', msg: `unknown agent: ${engine}` });
  }

  const child = spawn(cmd, args, { cwd, env });
  child.stdin.end(); // codex waits on stdin otherwise
  let stderrTail = '';
  let sawText = false;
  let buf = '';
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
    // Gemini events (parsed defensively — schema shifts across 0.x)
    if (e.type === 'message' && (e.content || e.text)) { sawText = true; send({ t: 'chat.msg', role: 'claude', engine: engineLabel(engine), text: e.content ?? e.text }); }
    if (e.type === 'tool_use') send({ t: 'tool.use', name: e.name ?? 'tool', input: JSON.stringify(e.args ?? e.input ?? {}).slice(0, 200) });
    if (e.type === 'result') {
      if (!sawText && e.response) { sawText = true; send({ t: 'chat.msg', role: 'claude', engine: engineLabel(engine), text: e.response }); }
      send({ t: 'chat.result', subtype: 'success', brain: engine, tokens: e.stats?.total_tokens ?? null });
    }
    if (e.type === 'error') send({ t: 'chat.err', msg: `${engineLabel(engine)}: ${e.message ?? JSON.stringify(e).slice(0, 200)}` });
  };

  child.stdout.on('data', (chunk) => {
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
    if (!sawText) send({ t: 'chat.result', subtype: 'success', brain: engine, tokens: null });
    send({ t: 'atlan.mood', mood: 'proud' });
  });
}

function engineLabel(engine) {
  return engine === 'codex' ? 'Codex · full-auto' : 'Gemini CLI · full-auto';
}
