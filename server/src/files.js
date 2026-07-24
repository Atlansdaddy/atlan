import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { APP_ROOT, PROJECTS_DIR } from './config.js';
import { SENSITIVE, isUnder, guardPath } from './guards.js';

// File read/write/list for the in-app code editor. Path safety is the SHARED
// guard in guards.js (the editor and attachments must use the SAME rules — they
// drifted once, see guards.js). The editor additionally refuses Atlan's OWN repo
// (blockAppRoot): it's a tool for your projects, not for editing the cockpit's
// source or state. So `.fleet`/`.env`/keys AND server/src/*.js are all off-limits.
const MAX = 2 * 1024 * 1024; // 2MB — don't load huge files into a browser editor

const guard = (p, opts = {}) => guardPath(p, { blockAppRoot: true, verb: 'editable', ...opts });

export function readFile(p) {
  const abs = guard(p);
  const st = statSync(abs);
  if (st.isDirectory()) throw new Error('that is a folder');
  if (st.size > MAX) throw new Error(`file too large to edit here (>${MAX / 1024 / 1024}MB)`);
  return { path: abs, name: basename(abs), content: readFileSync(abs, 'utf8') };
}

export function writeFile(p, content) {
  const abs = guard(p, { mustExist: false });
  if (typeof content !== 'string') throw new Error('content must be text');
  if (content.length > MAX) throw new Error('content too large');
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return { path: abs, name: basename(abs), bytes: Buffer.byteLength(content) };
}

// Directory listing for the file tree — folders first, hidden/sensitive hidden.
export function listDir(p) {
  const abs = guard(p || PROJECTS_DIR);
  if (!statSync(abs).isDirectory()) throw new Error('not a folder');
  const entries = [];
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(abs, name);
    if (SENSITIVE.test(full)) continue;
    if (isUnder(full, APP_ROOT)) continue; // hide Atlan's own repo from the file tree
    let dir = false;
    try { dir = statSync(full).isDirectory(); } catch { continue; }
    entries.push({ name, path: full, dir });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { path: abs, parent: abs === PROJECTS_DIR ? null : dirname(abs), entries };
}
