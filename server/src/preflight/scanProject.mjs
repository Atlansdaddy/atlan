// server/src/preflight/scanProject.mjs
//
// Walk a project directory into the { path, content }[] shape PreFlight's engine
// expects, applying PreFlight's own shouldScanFile() so file selection matches
// the product scan, then run scan(). This is the cockpit Scan surface's core —
// and what dogfoods Atlan against its own vendored engine.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { scan } from './engine/lib/cockpit-scan.js';
import { shouldScanFile } from './engine/lib/file-filter.js';

const MAX_BYTES = 500_000; // PreFlight's per-file cap
// Never scan these — machinery, deps, or the vendored engine itself (that's
// PreFlight's code, not the host project's).
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
const SKIP_REL = ['server/src/preflight/engine', 'web/public/vendor'];
// Vendored third-party single files (e.g. vendor-html2canvas.js) — not the
// host's own code, so their console/empty-catch/bloat findings are noise.
const VENDOR_FILE = /(^|\/)vendor-|\.min\.js$/;

export function collectFiles(rootDir) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(rootDir, abs).split(sep).join('/');
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || SKIP_REL.some((s) => rel === s || rel.startsWith(s + '/'))) continue;
        walk(abs);
      } else if (e.isFile()) {
        if (SKIP_REL.some((s) => rel.startsWith(s + '/'))) continue;
        if (VENDOR_FILE.test(rel)) continue;
        if (!shouldScanFile(rel)) continue;
        let st;
        try { st = statSync(abs); } catch { continue; }
        if (st.size > MAX_BYTES) continue;
        let content;
        try { content = readFileSync(abs, 'utf8'); } catch { continue; }
        files.push({ path: rel, content });
      }
    }
  };
  walk(rootDir);
  return files;
}

export function scanProject(rootDir) {
  const files = collectFiles(rootDir);
  const result = scan(files);
  return { ...result, filesCollected: files.length };
}
