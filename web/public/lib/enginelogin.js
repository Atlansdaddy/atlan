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
 * The sign-in list itself, at the TOP of Doctor.
 *
 * The buttons started life on a check row near the bottom of the tab, under ten
 * "paste key" boxes. That is the wrong order: on a phone the subscription
 * engines are the ones people actually use, and they do not take a key at all —
 * so the first thing the tab offered was a form for the wrong kind of
 * credential, and the right one was a scroll away.
 *
 * Rows render for every engine, including the ones already signed in and the
 * ones with no binary, because "why can't I pick Grok" is answered by seeing
 * Grok listed as not installed — not by its absence.
 *
 * @param {Element}  list     container
 * @param {Array}    engines  agentStatus() rows: {id,label,installed,ready,login}
 * @param {Function} onLogin  (engine) => void, invoked with the row
 */
export function renderSignIn(list, engines, onLogin) {
  if (!list) return;
  list.textContent = '';
  for (const e of engines) {
    const row = document.createElement('div');
    row.className = 'keyrow';

    const name = document.createElement('span');
    name.className = 'kname';
    name.textContent = e.id;

    const state = document.createElement('span');
    state.className = 'kstate';
    if (e.ready) { state.textContent = 'signed in'; state.classList.add('ok'); } else if (e.installed) state.textContent = 'not signed in';
    else state.textContent = 'not installed';

    row.append(name, state);

    if (e.installed && !e.ready && e.login) {
      const b = document.createElement('button');
      b.className = 'mini';
      b.textContent = 'Log in';
      b.title = e.login; // the literal line — the button hides nothing
      b.addEventListener('click', () => onLogin(e));
      row.append(b);
    } else if (!e.installed) {
      // `needs` carries the install line for an engine that was never set up.
      const how = document.createElement('span');
      how.className = 'khow';
      how.textContent = e.needs ?? '';
      row.append(how);
    }
    list.append(row);
  }
}

/**
 * Wires the sign-in list to its data. /api/engines already serves agentStatus(),
 * so this needs no new endpoint for something the client fetches anyway.
 *
 * @returns {Function} call it to (re)load the list
 */
export function initSignIn({ list, run }) {
  return function load() {
    fetch('/api/engines').then((r) => r.json()).then((all) => {
      renderSignIn(list, all.filter((e) => e.group === 'agent'), (e) => run(e.login, `Log in to ${e.id}`));
    }).catch(() => { /* Doctor still renders; the list just stays empty */ });
  };
}

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
  async function run(command, label) {
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
  }
  // The Doctor check rows dispatch this; the sign-in list calls run() directly.
  panel?.addEventListener('atlan:run-in-term', (ev) => run(ev.detail?.command, ev.detail?.label));
  return { run };
}
