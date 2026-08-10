// term.js — the Term tab's xterm.js session.
//
// Lifted out of app.js by the ceiling ratchet when the login button needed it to
// grow. Worth extracting on its own merits: the tab owns four coupled pieces of
// state (the terminal, whether it has been opened, WHICH tmux session it is
// attached to, and whether the shell behind that session has spoken yet) that
// nothing else should be able to reach past.
//
// SESSIONS ARE NAMED, AND THE NAME MATTERS. openPty(name) attaches to tmux
// `atlan-<name>`, and `main` is the operator's own shell — reachable from Termux
// with `tmux attach -t atlan-main`. Anything that types on the user's behalf must
// NOT go there: a command injected while they are mid-edit lands inside whatever
// is running. The engine-login button therefore gets its own session, so the
// worst case is a spare terminal rather than a corrupted one.
//
// READINESS IS A REAL PROBLEM, NOT A PRECAUTION. `pty.open` is a request, not a
// prompt. Input sent between the request and the shell's first byte is dropped on
// the floor — so anything typing FOR the user would look broken while doing
// everything correctly. ready() resolves on the first output, which is the only
// trustworthy signal that a shell exists.

export function createTerm({ mount, send, cwd }) {
  let term = null;
  let fitAddon = null;
  let current = null;        // tmux session this terminal is attached to
  let resolveReady = null;
  let readyPromise = null;

  function fit() {
    if (!term || !fitAddon) return;
    try {
      fitAddon.fit();
      send({ t: 'pty.resize', name: current, cols: term.cols, rows: term.rows });
    } catch { /* tab is hidden — no geometry to measure */ }
  }

  function attach(name) {
    current = name;
    readyPromise = new Promise((res) => { resolveReady = res; });
    term.reset(); // the previous session's scrollback is not this session's
    send({ t: 'pty.open', name, cols: term.cols, rows: term.rows, cwd: cwd() });
  }

  /**
   * @param {string} [name] session to attach to. Omitted means "whatever is
   * already showing" — so tapping the Term tab after a login does not yank the
   * user back to `main` and hide what they were reading.
   */
  function open(name) {
    if (!term) {
      term = new Terminal({ fontSize: 13, fontFamily: 'ui-monospace, monospace', theme: { background: '#000814' }, cursorBlink: true });
      fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(mount());
      fit();
      // The name rides on every keystroke, so switching sessions cannot leave
      // input going to the previous one.
      term.onData((data) => send({ t: 'pty.input', name: current, data }));
      window.addEventListener('resize', fit);
      attach(name ?? 'main');
      return;
    }
    fit();
    if (name && name !== current) attach(name);
  }

  return {
    open,
    fit,
    session: () => current,
    write: (t) => term?.write(t),
    /** Send it the whole pty.data frame; the first one settles ready(). */
    data(frame) {
      if (!frame || (frame.name ?? 'main') !== current) return; // another session's output
      term?.write(frame.data);
      if (resolveReady) { resolveReady(); resolveReady = null; }
    },
    exit(frame, msg) {
      if (frame && (frame.name ?? 'main') !== current) return;
      term?.writeln(msg);
    },
    /**
     * After a socket reconnect, re-attach the SAME session with the same
     * geometry. Takes its own sender because reconnect happens before the app's
     * queued send() is usable — the frame has to go straight down the new socket.
     */
    reopen(rawSend) {
      if (!term || !current) return;
      rawSend({ t: 'pty.open', name: current, cols: term.cols, rows: term.rows });
    },
    /** null once the shell has spoken — awaiting it again would never settle. */
    ready: () => (resolveReady ? readyPromise : null),
  };
}
