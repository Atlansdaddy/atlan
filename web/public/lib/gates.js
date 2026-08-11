// gates.js — one permission default per provider, said out loud.
//
// The gates themselves already existed: claude's chat asks per tool unless a
// profile is armed, and every fleet/hierarchy run carries a profile. What did
// NOT exist was a place to SEE that arrangement per provider, or to change the
// default without re-picking it on every conversation and every spawn form.
// This panel is that place. It stores gate.<provider> server-side (prefs.js
// whitelists both key and value), and the defaults flow to wherever that
// provider's work is armed: the chat auto-approve control and the fleet and
// routine profile selects.
//
// 'ask' exists only on claude — it is the only path with a per-tool card to
// fall back to. The exec-mode CLIs run with their own approval gates off and a
// profile as the ONLY gate, so "ask every time" would be a lie in their rows.

const PROVIDERS = [
  { id: 'claude', ask: true, note: 'chat + fleet — "ask" raises a card per tool' },
  { id: 'codex', ask: false, note: 'jobs run behind the profile, nothing asks mid-run' },
  { id: 'grok', ask: false, note: 'jobs run behind the profile, nothing asks mid-run' },
  { id: 'copilot', ask: false, note: 'jobs run behind the profile, nothing asks mid-run' },
  { id: 'antigravity', ask: false, note: 'jobs run behind the profile, nothing asks mid-run' },
];

const PROFILE_LABELS = {
  ask: 'Ask every time',
  scout: 'Scout — read-only, no shell',
  verifier: 'Verifier — reads + runs checks',
  builder: 'Builder — files + bash, project-scoped',
};

/** The stored default for a provider, normalised. 'ask'/absent → null for claude-style consumers. */
export function gateDefault(prefs, provider) {
  const v = prefs?.[`gate.${provider}`];
  return v && v !== 'ask' && v in PROFILE_LABELS ? v : null;
}

/**
 * Wires the per-provider gate rows.
 *
 * @param {object}   o
 * @param {Element}  o.box       the #gatesList container
 * @param {Function} o.notify    (msg) => void, error surface
 * @param {Function} o.onChange  (prefs) => void — fresh prefs after every save,
 *                               so the consumers (chat arm control, spawn
 *                               forms) re-derive their defaults immediately
 * @returns {Function} call it to (re)load the rows
 */
export function initGates({ box, notify, onChange }) {
  function row(p, prefs) {
    const div = document.createElement('div');
    div.className = 'keyrow gaterow';
    const name = document.createElement('span');
    name.className = 'kname';
    name.textContent = p.id;
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', `${p.id} permission gate`);
    for (const v of Object.keys(PROFILE_LABELS)) {
      if (v === 'ask' && !p.ask) continue;
      const o = document.createElement('option');
      o.value = v;
      o.textContent = PROFILE_LABELS[v];
      sel.append(o);
    }
    // Absent pref = the standing defaults the code always had: claude asks,
    // exec-mode runs are scouts.
    sel.value = prefs[`gate.${p.id}`] ?? (p.ask ? 'ask' : 'scout');
    const note = document.createElement('span');
    note.className = 'khow';
    note.textContent = p.note;
    sel.addEventListener('change', () => {
      fetch('/api/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: `gate.${p.id}`, value: sel.value }),
      }).then((r) => r.json()).then((j) => {
        if (j.error) return notify(j.error);
        onChange?.(j);
      }).catch(() => notify('gate not saved — check the connection'));
    });
    div.append(name, sel, note);
    return div;
  }

  return function load() {
    fetch('/api/prefs').then((r) => r.json()).then((prefs) => {
      box.textContent = '';
      for (const p of PROVIDERS) box.append(row(p, prefs));
      onChange?.(prefs);
    }).catch(() => { /* Doctor still renders; the panel just stays empty */ });
  };
}
