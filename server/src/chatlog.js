// chatlog.js — chat that survives a refresh.
//
// THE BUG THIS EXISTS FOR. Chat lived in exactly two places, both of them
// temporary: the DOM on the client, and `brainHistory` on the server, which
// `ws.on('close')` clears by design so a flaky phone link cannot leak sessions.
// So a pulled-to-refresh — the single easiest gesture on a phone — destroyed the
// conversation with no warning and no way back. On the primary platform that is
// not an edge case, it is Tuesday.
//
// WHY THE SERVER AND NOT localStorage. Three reasons, in order of weight: a
// mobile browser evicts localStorage under pressure without telling anyone; the
// transcript should outlive the browser that happened to render it; and every
// other piece of durable state in this cockpit (routines, sessions, keys) already
// lives under FLEET_DIR, so a second convention would be the drift this repo
// keeps having to fix.
//
// WHY JSONL AND NOT A JSON DOCUMENT. A conversation is append-only, and
// rewriting the whole document per message turns a long chat into O(n^2) writes
// on a phone's flash. One line per message, opened O_APPEND, is a single write
// syscall. A truncated final line loses one message rather than the file —
// `readChat` drops unparseable lines instead of throwing, because a transcript
// that refuses to open is worse than one missing its last turn.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FLEET_DIR } from './config.js';

const DIR = join(FLEET_DIR, 'chats');

/** Longest single message we will store. Beyond this a paste is a file, not a chat turn. */
export const MAX_TEXT = 32_000;
/** Messages kept per conversation. Older ones are dropped on read, never silently on write. */
export const MAX_MESSAGES = 4000;
/** Conversations kept. Oldest are pruned when a new one is created. */
export const MAX_CHATS = 200;

/**
 * THE ID IS UNTRUSTED. It arrives from the client, and it is about to become a
 * path. `../../.keys.enc` is the attack and it is not hypothetical — guards.js
 * exists in this repo because a path built from input got it wrong once already.
 * So this is an allow-list of shape, not an escape or a sanitiser: anything that
 * is not plainly [a-z0-9-] of a sane length is refused outright, and the caller
 * gets null rather than a fallback path it did not ask for.
 */
export function validId(id) {
  const s = String(id ?? '');
  return /^[a-z0-9][a-z0-9-]{7,39}$/.test(s) ? s : null;
}

const fileFor = (id) => join(DIR, `${id}.jsonl`);

function ensureDir() {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

/** Append one message. Returns false rather than throwing — a failed transcript write must never take a live turn down with it. */
export function appendChat(id, { role, text, engine = null, at = Date.now() } = {}) {
  const key = validId(id);
  if (!key) return false;
  const body = String(text ?? '');
  if (!body.trim()) return false;
  try {
    ensureDir();
    const fresh = !existsSync(fileFor(key));
    if (fresh) pruneChats();
    appendFileSync(fileFor(key), JSON.stringify({
      at,
      role: String(role ?? 'claude').slice(0, 16),
      engine: engine ? String(engine).slice(0, 40) : null,
      text: body.slice(0, MAX_TEXT),
    }) + '\n', { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Messages for one conversation, oldest first. Unparseable lines are skipped, not fatal. */
export function readChat(id, { limit = MAX_MESSAGES } = {}) {
  const key = validId(id);
  if (!key || !existsSync(fileFor(key))) return [];
  let raw;
  try { raw = readFileSync(fileFor(key), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last write; keep the rest */ }
  }
  return out.slice(-limit);
}

/**
 * The list a dashboard renders. Title is the first USER message, because the
 * first assistant message is often a tool preamble and makes every row look the
 * same.
 */
export function listChats() {
  if (!existsSync(DIR)) return [];
  let names;
  try { names = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  const rows = [];
  for (const f of names) {
    const id = f.slice(0, -6);
    if (!validId(id)) continue;
    let st;
    try { st = statSync(join(DIR, f)); } catch { continue; }
    const msgs = readChat(id, { limit: MAX_MESSAGES });
    if (!msgs.length) continue;
    const firstUser = msgs.find((m) => m.role === 'user');
    rows.push({
      id,
      title: (firstUser?.text ?? msgs[0].text ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'untitled',
      count: msgs.length,
      startedAt: msgs[0].at ?? st.birthtimeMs,
      updatedAt: msgs[msgs.length - 1].at ?? st.mtimeMs,
      engines: [...new Set(msgs.map((m) => m.engine).filter(Boolean))].slice(0, 4),
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteChat(id) {
  const key = validId(id);
  if (!key) return false;
  try { rmSync(fileFor(key), { force: true }); return true; } catch { return false; }
}

/** Keep the store bounded. Called only when a NEW conversation starts, so an active chat is never pruned mid-turn. */
function pruneChats() {
  try {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: statSync(join(DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const { f } of files.slice(MAX_CHATS - 1)) rmSync(join(DIR, f), { force: true });
  } catch { /* pruning is housekeeping; never let it break a turn */ }
}

export const _testInternals = { DIR, fileFor };
