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
import { findAuthPrompt } from './authcode.js';

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
 * @param {Element}  o.panel     the Doctor list — where the action event lands
 * @param {Element}  o.card      where the "open this link / copy this code" card goes
 * @param {object}   o.term      the lib/term.js session (whole object, not five callbacks)
 * @param {Function} o.openTerm  switches to the Term tab and attaches the login session
 * @param {Function} o.send      (frame) => void, the WebSocket sender
 */
export function initEngineLogin({ panel, card, term, openTerm, send }) {
  async function run(command, label) {
    if (!command) return;
    openTerm();
    // A PTY that is already open has no fresh output coming, so waiting on it
    // would hang forever. The race is the timeout, not the happy path: keystrokes
    // sent before the shell starts are silently dropped, which is how a button
    // that did everything right would look broken.
    await Promise.race([
      Promise.resolve(term?.ready?.()),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    term?.write?.(`\r\n\x1b[36m— ${label ?? 'sign in'} — finish it below; Atlan never sees the credential —\x1b[0m\r\n`);
    // Addressed to whatever session openTerm() attached, which is deliberately
    // NOT the operator's `main` shell. Read rather than assumed, so this cannot
    // start typing into `main` if the default ever changes.
    send({ t: 'pty.input', name: term?.session?.() ?? 'login', data: command + '\r' });
    watchForPrompt();
  }

  /**
   * Watch the terminal for the link and code the flow is about to print.
   *
   * This exists because the flow DEAD-ENDS on a phone without it. The engine
   * prints both and expects you to move them into a browser; xterm.js selection
   * is unusable with a thumb, tmux swallows a bare `c`, and a canvas has no
   * clipboard. The values are on screen and unreachable.
   *
   * Bounded to a few minutes, because a listener left on the terminal forever
   * would keep re-showing a stale card over unrelated work later.
   */
  function watchForPrompt() {
    if (!card || !term?.onOutput) return;
    let buf = '';
    let shown = '';
    const stop = term.onOutput((text) => {
      buf = (buf + text).slice(-8000); // a rolling window: a code can straddle two frames
      const p = findAuthPrompt(buf);
      const key = `${p?.url ?? ''}|${p?.code ?? ''}`;
      if (p && key !== shown) { shown = key; showAuthCard(card, p); }
    });
    setTimeout(stop, 240000);
  }

  // The Doctor check rows dispatch this; the sign-in list calls run() directly.
  panel?.addEventListener('atlan:run-in-term', (ev) => run(ev.detail?.command, ev.detail?.label));
  return { run };
}

/**
 * The card: open the link, copy the code. Both as targets you can hit.
 *
 * The code is shown as TEXT as well as a button, because clipboard writes are
 * refused in plenty of mobile contexts and a button that silently does nothing
 * is worse than no button. If the copy fails, the value is still readable and
 * selectable as ordinary DOM text — which the terminal canvas never was.
 */
export function showAuthCard(card, { url, code }) {
  card.textContent = '';
  card.hidden = false;

  const title = document.createElement('div');
  title.className = 'authcard-title';
  title.textContent = 'Finish signing in';
  card.append(title);

  if (url) {
    const a = document.createElement('a');
    a.className = 'mini authcard-open';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Open the sign-in page';
    card.append(a);
  }
  if (code) {
    const val = document.createElement('code');
    val.className = 'authcard-code';
    val.textContent = code; // selectable text, not a canvas — the fallback that always works
    const b = document.createElement('button');
    b.className = 'mini';
    b.textContent = 'Copy code';
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        b.textContent = 'Copied';
      } catch {
        // Say so rather than pretending. The code above is still readable.
        b.textContent = 'Copy blocked — select it above';
      }
      setTimeout(() => { b.textContent = 'Copy code'; }, 2500);
    });
    card.append(val, b);
  }

  const dismiss = document.createElement('button');
  dismiss.className = 'mini authcard-x';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => { card.hidden = true; });
  card.append(dismiss);
}
