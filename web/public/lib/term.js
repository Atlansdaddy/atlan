// term.js — the Term tab's xterm.js session.
//
// Lifted out of app.js by the ceiling ratchet when the login button needed it to
// grow. Worth extracting on its own merits: the tab owns three coupled pieces of
// state (the terminal, whether it has been opened, and whether the shell behind
// it has spoken yet) that nothing else should be able to reach past.
//
// READINESS IS A REAL PROBLEM, NOT A PRECAUTION. `pty.open` is a request, not a
// prompt. Input sent between the request and the shell's first byte is dropped
// on the floor — so anything that types FOR the user (the engine login button)
// would look broken while doing everything correctly. `ready()` resolves on the
// first output, which is the only trustworthy signal that a shell exists.

export function createTerm({ mount, send, cwd }) {
  let term = null;
  let opened = false;
  let fitAddon = null;
  let resolveReady = null;
  let readyPromise = null;

  function fit() {
    if (!term || !fitAddon) return;
    try {
      fitAddon.fit();
      send({ t: 'pty.resize', name: 'main', cols: term.cols, rows: term.rows });
    } catch { /* tab is hidden — no geometry to measure */ }
  }

  function open() {
    if (opened) { fit(); return; }
    opened = true;
    readyPromise = new Promise((res) => { resolveReady = res; });
    term = new Terminal({ fontSize: 13, fontFamily: 'ui-monospace, monospace', theme: { background: '#000814' }, cursorBlink: true });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(mount());
    fit();
    term.onData((data) => send({ t: 'pty.input', name: 'main', data }));
    send({ t: 'pty.open', name: 'main', cols: term.cols, rows: term.rows, cwd: cwd() });
    window.addEventListener('resize', fit);
  }

  return {
    open,
    fit,
    write: (t) => term?.write(t),
    /** Feed a pty.data frame in; the first one settles ready(). */
    data(text) {
      term?.write(text);
      if (resolveReady) { resolveReady(); resolveReady = null; }
    },
    exit(msg) { term?.writeln(msg); },
    /**
     * After a socket reconnect, ask for the PTY again with the SAME geometry.
     * Takes its own sender because reconnect happens before the app's queued
     * send() is usable — the frame has to go straight down the new socket.
     */
    reopen(rawSend) {
      if (!opened || !term) return;
      rawSend({ t: 'pty.open', name: 'main', cols: term.cols, rows: term.rows });
    },
    /** null once the shell has spoken — awaiting it again would never settle. */
    ready: () => (resolveReady ? readyPromise : null),
  };
}
