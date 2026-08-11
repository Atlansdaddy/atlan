import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getStoredKey } from './keys.js';
import { PROJECTS_DIR } from './config.js';

// node-pty is NATIVE, and its absence must be a CONDITION, not a crash. It
// ships no Linux prebuild at all (darwin + win32 only), so on this platform
// family it always compiles from source — which succeeds on a proot phone
// with a toolchain and fails on native bionic Termux. As a static import that
// failure killed the process during module-graph evaluation, before a single
// line of server code ran: one optional tab took down chat, preview, fleet
// and doctor together (docs/8-10-feedback-and-fix.md §3, a Pixel tester's
// lost night). Third instance of the one-failure-path-owns-the-process class
// (654aa13, c1cbb3a) — this ends it for the terminal.
let pty = null;
let ptyLoadError = null;
try {
  pty = (await import('node-pty')).default;
} catch (err) {
  ptyLoadError = String(err?.message ?? err).split('\n')[0];
}

/** The Term tab asks before promising a terminal; the Doctor names the why. */
export function ptyAvailable() { return !!pty; }
export function ptyLoadFailure() { return ptyLoadError; }

/**
 * tmux, if this host has it — resolved from PATH once, never assumed.
 *
 * It WAS assumed, and on a phone without it the Term tab was not degraded but
 * dead: pty.spawn forks a live terminal and the exec fails in the CHILD, so the
 * user got "execvp(3) failed.: No such file or directory" and an exit, with
 * nothing naming tmux as the missing piece. Everything downstream of the
 * terminal went with it, including the engine-login buttons.
 *
 * What tmux actually buys is PERSISTENCE and the CLI↔GUI handoff: `new-session
 * -A` reattaches, so a dropped socket rejoins the same shell and `tmux attach -t
 * atlan-main` from Termux reaches the same session. Worth having — not worth
 * being the difference between a terminal and no terminal.
 */
let tmuxResolved = false;
let tmuxPath = null;
function findTmux() {
  if (tmuxResolved) return tmuxPath;
  tmuxResolved = true;
  for (const dir of String(process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    try {
      const p = join(dir, 'tmux');
      if (existsSync(p)) { tmuxPath = p; break; }
    } catch { /* an unreadable PATH entry is not an error, just not tmux */ }
  }
  return tmuxPath;
}

/** Tests re-ask after installing (or hiding) tmux. */
export function _resetTmuxProbe() { tmuxResolved = false; tmuxPath = null; }

/** True when a session survives a dropped socket; false on the shell fallback. */
export function ptyPersistent() { return process.platform !== 'win32' && !!findTmux(); }

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
// — that is the CLI↔GUI switch for every non-SDK engine. On win32 there is no
// tmux, so the PTY is a bare shell and that CLI↔GUI handoff does not exist.
const sessions = new Map();

// The try/catch below is a win32 guard, NOT a general one — do not read it as
// "spawn failures are handled". Measured on node-pty 1.x / Linux: a missing
// binary does NOT throw. pty.spawn() forks a live PTY and returns a valid
// terminal; the exec fails in the CHILD, surfacing asynchronously as
// onData "execvp(3) failed.: No such file or directory" + onExit {exitCode:1}.
// So on the phone and the home node a missing tmux flows through the normal
// data/exit path (the user does see the execvp line), and this catch never
// fires. It earns its place on win32, where a bad COMSPEC can throw
// synchronously out of the WS message handler. Returns null on that path; the
// caller ignores the return value, so a dead PTY degrades rather than taking
// the socket down with it.
export function openPty(name, ws, { cols = 80, rows = 24, cwd } = {}) {
  // Same degradation contract as the spawn guard below: the caller ignores the
  // return, the socket lives, and the user reads WHY in the tab itself instead
  // of watching the whole cockpit crash-loop.
  if (!pty) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        t: 'pty.data', name,
        data: `\r\n[No terminal on this host — node-pty failed to load: ${ptyLoadError}]`
          + '\r\n[On Android this means native Termux (bionic): the supported path is Termux + proot-distro ubuntu — docs/SETUP.md]\r\n',
      }));
    }
    return null;
  }
  let s = sessions.get(name);
  if (!s) {
    // win32 has no tmux. The default cwd is the projects root, which config
    // already resolves per-platform (cwd on win32, the operator's home
    // elsewhere) — no '/root' literal anywhere in this chain anymore.
    const isWin = process.platform === 'win32';
    const targetCwd = cwd || PROJECTS_DIR;

    // Three cases, in order of preference: tmux (persistent, reattachable),
    // win32's COMSPEC, or a plain login shell. The last one is the phone without
    // tmux — a real terminal that simply does not survive a reconnect, which
    // beats an execvp error that named nothing.
    const tmux = isWin ? null : findTmux();
    const shell = isWin ? (process.env.COMSPEC || 'powershell.exe')
      : (tmux ?? process.env.SHELL ?? '/bin/sh');
    const args = tmux ? ['new-session', '-A', '-s', `atlan-${name}`] : [];

    try {
      const proc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols, rows, cwd: targetCwd,
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
    } catch (err) {
      console.error(`Failed to spawn PTY (${shell}):`, err.message);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ t: 'pty.data', name, data: `\r\n[PTY Spawn Error: ${err.message}]\r\n` }));
      }
      return null;
    }
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
