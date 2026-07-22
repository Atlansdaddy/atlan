import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { PROJECTS_DIR } from './config.js';

// File read/write/list for the in-app code editor. Same guards as attachments:
// everything stays under PROJECTS_DIR, and credential-shaped paths are refused.
const SENSITIVE = /(^|\/)\.(ssh|aws|gnupg|gcloud|docker|kube)(\/|$)|(^|\/)(\.auth-token|\.keys\.enc|\.keysecret|id_rsa|id_ed25519)(\/|$)/;
const MAX = 2 * 1024 * 1024; // 2MB — don't load huge files into a browser editor

function guard(p, { mustExist = true } = {}) {
  const abs = resolve(String(p || ''));
  const root = PROJECTS_DIR.endsWith('/') ? PROJECTS_DIR : PROJECTS_DIR + '/';
  if (abs !== PROJECTS_DIR && !abs.startsWith(root)) throw new Error(`path must be under ${PROJECTS_DIR}`);
  if (SENSITIVE.test(abs)) throw new Error('that path looks like credentials/secrets — not editable here');
  if (mustExist && !existsSync(abs)) throw new Error('no such path');
  return abs;
}

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
    let dir = false;
    try { dir = statSync(full).isDirectory(); } catch { continue; }
    entries.push({ name, path: full, dir });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { path: abs, parent: abs === PROJECTS_DIR ? null : dirname(abs), entries };
}
