// enginelogin.js — the button that replaced an instruction.
//
// Doctor rows used to end at prose: "run: codex login --device-auth (Term tab)".
// That is a sentence telling you to go somewhere else and retype something the
// cockpit already knew. Now the row carries the literal command and this runs
// it: switch to the terminal, wait for a shell that actually exists, send the
// line.
//
// WHAT IT DELIBERATELY DOES NOT DO IS LOG YOU IN. Every one of these engines
// uses a device-code or browser flow that only the account holder can complete.
// The button's whole job is to put you at that prompt. No credential is read,
// stored, forwarded or seen by Atlan at any point — the sign-in happens between
// you and the vendor, in a terminal you are looking at.
//
// The command is echoed before it runs, so nothing is hidden: if a CLI ever
// changes its flags, the line on screen is the thing to correct.

/**
 * @param {object}   o
 * @param {Element}  o.panel      the Doctor list — where the action event lands
 * @param {Function} o.openTerm   switches to the Term tab and opens the PTY
 * @param {Function} o.termReady  () => Promise that settles when the shell speaks
 * @param {Function} o.write      (text) => void, echoes into the terminal
 * @param {Function} o.send       (frame) => void, the WebSocket sender
 * @param {Function} o.session    () => the tmux session the terminal is on now
 */
export function initEngineLogin({ panel, openTerm, termReady, write, send, session }) {
  if (!panel) return;
  panel.addEventListener('atlan:run-in-term', async (ev) => {
    const { command, label } = ev.detail ?? {};
    if (!command) return;
    openTerm();
    // A PTY that is already open has no fresh output coming, so waiting on it
    // would hang forever. The race is the timeout, not the happy path: keystrokes
    // sent before the shell starts are silently dropped, which is how a button
    // that did everything right would look broken.
    await Promise.race([
      Promise.resolve(termReady?.()),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    write?.(`\r\n\x1b[36m— ${label ?? 'sign in'} — finish it below; Atlan never sees the credential —\x1b[0m\r\n`);
    // Addressed to whatever session openTerm() attached, which is deliberately
    // NOT the operator's `main` shell. Read rather than assumed, so this cannot
    // start typing into `main` if the default ever changes.
    send({ t: 'pty.input', name: session?.() ?? 'login', data: command + '\r' });
  });
}
