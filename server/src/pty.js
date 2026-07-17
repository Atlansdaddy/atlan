import pty from 'node-pty';
import { getStoredKey } from './keys.js';

// Interactive CLIs launched in the Term tab should inherit the same creds the
// cockpit uses — otherwise `gemini` falls back to the dead individual OAuth
// loop. Inject stored keys (env still wins) so the raw CLI just works.
function ptyEnv() {
  const env = { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true' };
  for (const k of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY']) {
    if (!env[k]) { const v = getStoredKey(k); if (v) env[k] = v; }
  }
  return env;
}

// tmux-backed PTYs: `new-session -A` attaches if it exists, creates if not.
// The same session is reachable from Termux with: tmux attach -t atlan-<name>
// — that is the CLI↔GUI switch for every non-SDK engine.
const sessions = new Map();

export function openPty(name, ws, { cols = 80, rows = 24, cwd = '/root' } = {}) {
  let s = sessions.get(name);
  if (!s) {
    const proc = pty.spawn('tmux', ['new-session', '-A', '-s', `atlan-${name}`], {
      name: 'xterm-256color',
      cols, rows, cwd,
      env: ptyEnv(),
    });
    s = { proc, subs: new Set() };
    proc.onData((data) => {
      for (const sub of s.subs) {
        if (sub.readyState === 1) sub.send(JSON.stringify({ t: 'pty.data', name, data }));
      }
    });
    proc.onExit(() => {
      for (const sub of s.subs) {
        if (sub.readyState === 1) sub.send(JSON.stringify({ t: 'pty.exit', name }));
      }
      sessions.delete(name);
    });
    sessions.set(name, s);
  }
  s.subs.add(ws);
  ws.on('close', () => s.subs.delete(ws));
  return s;
}

export function writePty(name, data) {
  sessions.get(name)?.proc.write(data);
}

export function resizePty(name, cols, rows) {
  try { sessions.get(name)?.proc.resize(cols, rows); } catch { /* ignore race on exit */ }
}
