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

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { FLEET_DIR } from './config.js';

const DIR = join(FLEET_DIR, 'chats');
// Archives sit BESIDE the live store, not inside it, so a listing of
// conversations can never accidentally walk into one.
const ARCHIVE_DIR = join(FLEET_DIR, 'chats-archive');
const ARCHIVE_INDEX = join(ARCHIVE_DIR, 'index.jsonl');

/** Longest single message we will store. Beyond this a paste is a file, not a chat turn. */
export const MAX_TEXT = 32_000;
/** Messages returned per conversation on read. Nothing is dropped on disk. */
export const MAX_MESSAGES = 4000;

/**
 * NOTHING IS EVER DELETED TO MAKE ROOM. An earlier version of this file pruned
 * the oldest conversations whenever a new one started, which is silent data loss
 * dressed up as housekeeping — a cap that quietly eats your history is worse
 * than a full disk, because a full disk tells you.
 *
 * So the store is unbounded on disk and BOUNDED BY ATTENTION instead: usage is
 * measured, surfaced in the Doctor, and when it crosses a threshold or the
 * DEVICE itself is under pressure, the user is asked whether to archive. The
 * answer is theirs. Archiving writes a single gzipped file and only then removes
 * the originals.
 */
export const ARCHIVE_SUGGEST_BYTES = Number(process.env.ATLAN_CHAT_ARCHIVE_BYTES ?? 15 * 1024 ** 3);
/** Below this much free disk, size stops being the question and space does. */
export const LOW_DISK_BYTES = 2 * 1024 ** 3;
/** Below this fraction of RAM available, the phone is the constraint, not the store. */
export const LOW_MEM_FRACTION = 0.10;

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
export function appendChat(id, { role, text, engine = null, cwd = null, at = Date.now() } = {}) {
  const key = validId(id);
  if (!key) return false;
  const body = String(text ?? '');
  if (!body.trim()) return false;
  try {
    ensureDir();
    appendFileSync(fileFor(key), JSON.stringify({
      at,
      // 'assistant', not 'claude'. The protocol used to name a vendor as the
      // word for "the thing that answered", so Codex, Grok, Copilot and
      // Antigravity output was all stored and rendered under Claude's role.
      // Readers still accept the old value — transcripts written before this
      // exist and must keep opening.
      role: String(role ?? 'assistant').slice(0, 16),
      engine: engine ? String(engine).slice(0, 40) : null,
      // The PROJECT this turn happened in. Recorded because a conversation that
      // does not know where it lives cannot be addressed by anything except its
      // id — and nobody thinks in ids. It is also the first half of what waking
      // a dormant conversation needs (project, engine, model).
      cwd: cwd ? String(cwd).slice(0, 400) : null,
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
  if (!key) return [];
  // An archived conversation opens exactly like a live one. The caller does not
  // have to know which it is, which is the whole point of archiving rather than
  // deleting: from the app, nothing moved.
  if (!existsSync(fileFor(key))) {
    const arch = readArchived(key);
    return arch.length ? arch.slice(-limit) : [];
  }
  let raw;
  try { raw = readFileSync(fileFor(key), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last write; keep the rest */ }
  }
  return out.slice(-limit);
}

/** Bytes read per conversation to build a list row. A title lives in the first
 *  message or two; nothing past this is worth a page fault. */
const HEAD_BYTES = 8192;

/** Read at most n bytes from the front of a file, without pulling in the rest. */
function readHead(path, n = HEAD_BYTES) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(n);
    const got = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* already gone */ }
  }
}

/**
 * The list a dashboard renders. Title is the first USER message, because the
 * first assistant message is often a tool preamble and makes every row look the
 * same.
 *
 * IT READS THE HEAD OF EACH FILE, NOT THE FILE. The first version called
 * readChat() per conversation, which meant building a list of titles read every
 * message of every conversation: measured at the storage cap it walked 18.5 MB
 * to produce 200 rows. That is 25 ms on a desktop NVMe and a great deal worse on
 * phone flash under proot — and the cost grows with total transcript volume,
 * which is exactly the thing that grows. Now the cost is one stat plus one
 * bounded read per conversation, regardless of how long the conversations are.
 *
 * The consequence is honest and deliberate: there is no exact message COUNT in
 * this list, because a count cannot be known without reading everything. Size
 * and last-updated can, so those are what the row carries. A number that costs
 * a full scan is not worth having in a list you open to find something else.
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
    if (!st.size) continue;

    let title = '';
    let fallback = '';
    let project = null;
    let startedAt = st.birthtimeMs;
    const engines = new Set();
    const head = readHead(join(DIR, f));
    // The last line of a bounded read is usually truncated — drop it rather
    // than let a torn record decide a title.
    const lines = head.split('\n');
    if (head.length >= HEAD_BYTES) lines.pop();
    let first = true;
    for (const line of lines) {
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (first) { startedAt = m.at ?? startedAt; first = false; }
      if (!project && m.cwd) project = m.cwd;
      if (m.engine) engines.add(m.engine);
      if (!title && m.role === 'user' && m.text) title = m.text;
      if (!fallback && m.text) fallback = m.text;
    }
    // The fallback is applied AFTER the scan, never during it. Applying it inline
    // meant an assistant preamble on line 1 won the title and the user's actual
    // question two lines later never got a chance — which is the exact thing
    // titling-by-first-user-message exists to prevent.
    if (!title) title = fallback;
    if (!title) continue;

    rows.push({
      id,
      title: title.replace(/\s+/g, ' ').trim().slice(0, 90) || 'untitled',
      bytes: st.size,
      startedAt,
      updatedAt: st.mtimeMs,
      engines: [...engines].slice(0, 4),
      project,
      projectName: project ? project.split('/').filter(Boolean).pop() : null,
    });
  }
  // Archived conversations are part of the SAME list. They render with a badge
  // and open on tap like anything else; a user should never have to know that
  // one of these rows lives in a gzip.
  const live = new Set(rows.map((r) => r.id));
  for (const a of listArchived()) if (!live.has(a.id)) rows.push(a);
  return rows.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Turn "who do you mean" into one conversation id.
 *
 * Nobody addresses a conversation by its id. They mean "that chat" or "whatever
 * is working in the auth project", so both are accepted:
 *
 *   { to: 'c1a2b3...' }        an exact conversation
 *   { project: '/path/to/x' }  the conversation working there
 *
 * A project can hold several conversations, so the choice is: a LIVE one first
 * (a message to a project means "tell whoever is working on this", and someone
 * with the tab open is that person), then the most recently touched. `isLive`
 * is injected because liveness is the server's socket registry, not something a
 * transcript store should know about.
 */
export function resolveTarget({ to = null, project = null, isLive = () => false } = {}) {
  const exact = validId(to);
  if (exact) return { id: exact, why: 'named conversation' };
  if (!project) return { id: null, why: 'no conversation or project given' };

  const want = String(project);
  const inProject = listChats().filter((c) => c.project === want);
  if (!inProject.length) return { id: null, why: `no conversation has run in ${want} yet` };

  const live = inProject.find((c) => isLive(c.id));
  if (live) return { id: live.id, why: `live conversation in ${want}` };
  // listChats is already sorted newest-first.
  return { id: inProject[0].id, why: `most recent conversation in ${want}` };
}

/** Distinct projects that have conversations, newest activity first. */
export function listProjects() {
  const seen = new Map();
  for (const c of listChats()) {
    if (!c.project || seen.has(c.project)) continue;
    seen.set(c.project, { project: c.project, name: c.projectName, updatedAt: c.updatedAt, chats: 0 });
  }
  for (const c of listChats()) if (c.project && seen.has(c.project)) seen.get(c.project).chats++;
  return [...seen.values()];
}

export function deleteChat(id) {
  const key = validId(id);
  if (!key) return false;
  try { rmSync(fileFor(key), { force: true }); return true; } catch { return false; }
}

/**
 * What the store costs, and whether the DEVICE is the reason to care.
 *
 * Deliberately measures the machine rather than assuming which machine it is:
 * the same code answers on a phone, a tablet and a PC because it reads free
 * space and available memory instead of branching on a platform name.
 */
export function chatUsage() {
  let bytes = 0, count = 0;
  try {
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.jsonl')) continue;
      bytes += statSync(join(DIR, f)).size;
      count++;
    }
  } catch { /* no store yet */ }

  let freeDisk = null;
  try { const s = statfsSync(existsSync(DIR) ? DIR : FLEET_DIR); freeDisk = s.bavail * s.bsize; } catch { /* unsupported fs */ }

  // MemAvailable, not MemFree: free memory on Linux is a meaningless number
  // because the kernel spends it on cache on purpose. MemAvailable is the one
  // that answers "can this device do more work".
  let memAvailable = null, memTotal = null;
  try {
    const mi = readFileSync('/proc/meminfo', 'utf8');
    const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+) kB`, 'm').exec(mi)?.[1] ?? 0) * 1024;
    memAvailable = kb('MemAvailable') || null;
    memTotal = kb('MemTotal') || null;
  } catch { /* not Linux, or a kernel without it */ }

  const lowDisk = freeDisk != null && freeDisk < LOW_DISK_BYTES;
  const lowMem = memAvailable != null && memTotal != null && memAvailable / memTotal < LOW_MEM_FRACTION;
  const big = bytes >= ARCHIVE_SUGGEST_BYTES;
  return {
    bytes, count, freeDisk, memAvailable, memTotal,
    lowDisk, lowMem, big,
    // The ONLY thing this function decides. It never acts on it.
    suggestArchive: big || lowDisk || lowMem,
    reason: big ? 'transcripts are large'
      : lowDisk ? 'the disk is nearly full'
        : lowMem ? 'this device is low on memory'
          : null,
  };
}

/**
 * Archive conversations into ONE gzipped JSONL file, then remove the originals.
 *
 * WRITE FIRST, VERIFY, THEN DELETE — in that order, with no shortcut. The whole
 * point of archiving rather than pruning is that nothing is lost, so a failed or
 * partial write must leave every original exactly where it was.
 *
 * The archive is gzipped JSONL and not a tar, so it needs no external binary
 * (Termux may not have one) and stays readable with `zcat`. Each line carries
 * its conversation id, which is what makes it restorable by hand.
 *
 * @param {object} o
 * @param {number} [o.keepNewest]   conversations to leave in place
 * @param {number} [o.olderThanMs]  archive anything untouched since this epoch ms
 */
export function archiveChats({ keepNewest = 20, olderThanMs = null } = {}) {
  if (!existsSync(DIR)) return { archived: 0, file: null, bytes: 0 };
  let files;
  try {
    files = readdirSync(DIR)
      .filter((f) => f.endsWith('.jsonl') && validId(f.slice(0, -6)))
      .map((f) => ({ f, id: f.slice(0, -6), m: statSync(join(DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
  } catch { return { archived: 0, file: null, bytes: 0, error: 'could not read the store' }; }

  const doomed = olderThanMs != null
    ? files.filter((x) => x.m < olderThanMs)
    : files.slice(Math.max(0, keepNewest));
  if (!doomed.length) return { archived: 0, file: null, bytes: 0 };

  mkdirSync(ARCHIVE_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(ARCHIVE_DIR, `atlan-chats-${stamp}.jsonl.gz`);

  // The index is what keeps an archived conversation VISIBLE. Archiving must not
  // remove anything from the product — only from the hot path. A user who
  // archives should see the same list they saw before, with older rows marked,
  // and be able to open any of them. If the only way back were `zcat`, this
  // would be deletion with extra steps.
  let blob = '';
  const indexRows = [];
  for (const { id } of doomed) {
    const msgs = readChat(id, { limit: Number.MAX_SAFE_INTEGER });
    if (!msgs.length) continue;
    for (const m of msgs) blob += JSON.stringify({ id, ...m }) + '\n';
    const firstUser = msgs.find((m) => m.role === 'user');
    indexRows.push({
      id,
      title: (firstUser?.text ?? msgs[0].text ?? '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'untitled',
      startedAt: msgs[0].at ?? null,
      updatedAt: msgs[msgs.length - 1].at ?? null,
      engines: [...new Set(msgs.map((m) => m.engine).filter(Boolean))].slice(0, 4),
      file: `atlan-chats-${stamp}.jsonl.gz`,
    });
  }
  if (!indexRows.length) return { archived: 0, file: null, bytes: 0 };

  try {
    writeFileSync(out, gzipSync(Buffer.from(blob, 'utf8')), { mode: 0o600 });
    // Verify the bytes are really on disk BEFORE anything is removed. This
    // ordering is the difference between archiving and losing.
    if (!existsSync(out) || statSync(out).size === 0) throw new Error('archive is empty');
    appendFileSync(ARCHIVE_INDEX, indexRows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  } catch (err) {
    try { rmSync(out, { force: true }); } catch { /* nothing written */ }
    return { archived: 0, file: null, bytes: 0, error: `archive not written, nothing removed: ${err.message}` };
  }

  let removed = 0;
  for (const r of indexRows) { try { rmSync(fileFor(r.id), { force: true }); removed++; } catch { /* leave it */ } }
  return { archived: removed, file: out, bytes: statSync(out).size };
}

/** Every archived conversation, as list rows — same shape live ones use. */
export function listArchived() {
  if (!existsSync(ARCHIVE_INDEX)) return [];
  const rows = [];
  try {
    for (const line of readFileSync(ARCHIVE_INDEX, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push({ ...JSON.parse(line), archived: true, bytes: 0 }); } catch { /* torn line */ }
    }
  } catch { return []; }
  return rows;
}

/** Pull one archived conversation back out of its gzip. */
export function readArchived(id) {
  const key = validId(id);
  if (!key) return [];
  const row = listArchived().find((r) => r.id === key);
  if (!row) return [];
  try {
    const raw = gunzipSync(readFileSync(join(ARCHIVE_DIR, row.file))).toString('utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { const m = JSON.parse(line); if (m.id === key) out.push(m); } catch { /* torn line */ }
    }
    return out;
  } catch { return []; }
}

export const _testInternals = { DIR, ARCHIVE_DIR, fileFor };
