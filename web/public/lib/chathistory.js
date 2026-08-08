// chathistory.js — the conversation survives a refresh, and you can go back to it.
//
// A pull-to-refresh is the easiest gesture on a phone, and until now it deleted
// the conversation: chat lived in the DOM and in a per-socket map the server
// clears on close. This module holds the client half — which conversation we are
// in, replaying it after a reload, and browsing the ones before it.
//
// THE ID LIVES IN localStorage AND THE TRANSCRIPT DOES NOT. Only the pointer is
// local, so an evicted localStorage costs you the thread you were on and none of
// the history; the bytes are under FLEET_DIR with the rest of the durable state.
// The id is generated here, and the server re-validates its SHAPE before it ever
// becomes a path — a client is not trusted to name a file.

const KEY = 'atlan.conv';
const SHAPE = /^[a-z0-9][a-z0-9-]{7,39}$/;   // must match chatlog.js validId

export function newConversation() {
  const id = `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try { localStorage.setItem(KEY, id); } catch { /* private mode: stay in-memory for this load */ }
  cached = id;
  return id;
}

let cached = null;
export function convId() {
  if (cached && SHAPE.test(cached)) return cached;
  let id = null;
  try { id = localStorage.getItem(KEY); } catch { /* unavailable */ }
  if (!id || !SHAPE.test(id)) return newConversation();
  cached = id;
  return id;
}

const when = (ms) => {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Replay the active conversation into the log after a reload.
 *
 * Returns the number of messages restored so the caller can decide whether to
 * keep its greeting. A failure here is SILENT on purpose: a cockpit that will
 * not open because a transcript could not be read has traded a small problem
 * for a total one.
 *
 * @param {Function} addMsg  (role, text, engineLabel) => void, from app.js
 */
export async function restoreChat(addMsg, id = convId()) {
  try {
    const r = await fetch(`/api/chats/${encodeURIComponent(id)}`);
    if (!r.ok) return 0;
    const j = await r.json();
    const msgs = Array.isArray(j.messages) ? j.messages : [];
    for (const m of msgs) addMsg(m.role === 'user' ? 'user' : m.role, m.text, m.engine);
    return msgs.length;
  } catch { return 0; }
}

/**
 * Render the conversation list into `panel` and wire its rows.
 *
 * @param {object}   o
 * @param {HTMLElement} o.panel
 * @param {Function} o.onOpen   (id) => void — caller clears the log and replays
 */
export async function openHistory({ panel, onOpen }) {
  if (!panel) return;
  panel.hidden = false;
  panel.textContent = '';

  const head = document.createElement('div');
  head.className = 'hist-head';
  const title = document.createElement('span');
  title.textContent = 'Conversations';
  const close = document.createElement('button');
  close.className = 'btn ghost';
  close.textContent = 'close';
  close.addEventListener('click', () => { panel.hidden = true; });
  head.append(title, close);

  // A list you have to scroll is a list you stop using. Filtering is on titles
  // only — searching message BODIES would mean reading every conversation on
  // every keystroke, which is the one thing this store is not shaped for.
  const search = document.createElement('input');
  search.className = 'hist-search';
  search.type = 'search';
  search.placeholder = 'Search conversations…';
  search.setAttribute('aria-label', 'search conversations');

  const list = document.createElement('div');
  list.className = 'hist-list';
  panel.append(head, search, list);

  let chats = [];
  try {
    const r = await fetch('/api/chats');
    chats = (await r.json()).chats ?? [];
  } catch { /* fall through to the empty state */ }

  if (!chats.length) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = 'No saved conversations yet — this one is being saved as you talk.';
    list.append(p);
    return;
  }

  const active = convId();
  const paint = (q = '') => {
    list.textContent = '';
    const needle = q.trim().toLowerCase();
    const shown = needle ? chats.filter((c) => c.title.toLowerCase().includes(needle)) : chats;
    if (!shown.length) {
      const p = document.createElement('div');
      p.className = 'hint';
      p.textContent = `Nothing matching “${q}”.`;
      list.append(p);
      return;
    }
    for (const c of shown) {
      const row = document.createElement('button');
      row.className = 'hist-row' + (c.id === active ? ' active' : '');
      const t = document.createElement('div');
      t.className = 'hist-title';
      t.textContent = c.title;                   // textContent, never innerHTML: a title is user text
      const meta = document.createElement('div');
      meta.className = 'hist-meta';
      const bits = [when(c.updatedAt)];
      // An archived conversation opens exactly like any other. It says so, and
      // then it behaves that way — the gzip it came out of is our problem.
      if (c.archived) bits.push('archived');
      else if (c.bytes) bits.push(`${Math.max(1, Math.round(c.bytes / 1024))} KB`);
      if (c.engines?.length) bits.push(c.engines.join(', '));
      if (c.id === active) bits.push('current');
      meta.textContent = bits.join(' · ');
      row.append(t, meta);
      row.addEventListener('click', () => {
        try { localStorage.setItem(KEY, c.id); } catch { /* private mode */ }
        cached = c.id;
        panel.hidden = true;
        onOpen?.(c.id);
      });
      list.append(row);
    }
  };

  search.addEventListener('input', () => paint(search.value));
  paint();
}
