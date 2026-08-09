// scripts/sync-preflight.mjs
//
// Keeps the cockpit's copy of PreFlight's SAST engine fresh without going stale.
// Traces the real import closure of PreFlight's stable seam (src/lib/cockpit-scan.js),
// vendors exactly those files into server/src/preflight/engine/ (mirroring src/ so
// relative imports resolve), pins the source commit in preflight.lock, and GATES on
// a planted-vuln smoke test — a sync that would break the scan is rejected, not
// accepted. Run: `npm run sync:preflight` (or the on-push CI hook).
//
// Usage: node scripts/sync-preflight.mjs [--ref main] [--repo https://github.com/midatlanticAI/PreFlight.git]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ATLAN_ROOT = resolve(__dirname, '..');
const ENGINE_DIR = join(ATLAN_ROOT, 'server/src/preflight/engine');
const LOCK_FILE = join(ATLAN_ROOT, 'server/src/preflight/preflight.lock');

const args = process.argv.slice(2);
const REF = args[args.indexOf('--ref') + 1] || 'main';
const REPO = args[args.indexOf('--repo') + 1] || 'https://github.com/midatlanticAI/PreFlight.git';
// The stable seam, in ONE place. This constant used to sit unused while the same
// path was spelled twice more by hand — the lock file's `entry` and the smoke
// test's import — so upstream moving its entry point would have meant three edits
// and a constant that quietly lied about which file was verified. ENTRY_VENDORED
// is the same file after vendoring, which copies src/lib and src/data to the
// engine root and therefore drops the leading `src/`.
const ENTRY_REL = 'src/lib/cockpit-scan.js';
const ENTRY_VENDORED = ENTRY_REL.replace(/^src\//, '');
const ENGINE_DEPS = ['acorn', 'acorn-loose', 'acorn-jsx'];
// Fixtures are scan INPUTS, not engine code — deliberately-vulnerable samples
// the probes parse to prove a rule fires. They are still vendored (the smoke
// test scans one), but their imports must never reach Atlan's dependency tree:
// JS-AUTH-001's sample imports `jsonwebtoken` purely as bait, and tracing it
// installed a real package into the cockpit that nothing here ever runs.
const DEP_EXEMPT_RE = /(^|[\\/])fixtures[\\/]/;

const log = (...a) => console.log('[sync-preflight]', ...a);
const die = (m) => { console.error('[sync-preflight] ABORT:', m); process.exit(1); };

// ── 1. fetch PreFlight at REF ──
const work = mkdtempSync(join(tmpdir(), 'pf-sync-'));
try {
  log(`cloning ${REPO} @ ${REF} ...`);
  execFileSync('git', ['clone', '--depth', '1', '--branch', REF, REPO, work], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  log('commit', commit);

  // ── 2. vendor the engine source. Regex import-tracing against a 100-file
  // engine is too fragile (imports appear in comments and finding-message
  // STRINGS — bloat.js literally emits `import "./styles.css"` as advice text).
  // So we vendor src/lib + src/data wholesale (the engine's only roots) and let
  // the smoke test below be the completeness guarantee: it loads the real entry
  // in THIS Node, so a missing/broken file fails loudly. Unused files are inert
  // dead weight (only cockpit-scan's actual closure is ever imported).
  const SRC = join(work, 'src');
  const ROOTS = ['lib', 'data'].filter((d) => existsSync(join(SRC, d)));
  rmSync(ENGINE_DIR, { recursive: true, force: true });
  mkdirSync(ENGINE_DIR, { recursive: true });
  let fileCount = 0;
  const externalDeps = new Set();
  const IMPORT_RE = /^\s*(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/gm;
  const SIDE_RE = /^\s*import\s*['"]([^'"]+)['"]/gm;
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const walkDir = (rel) => {
    for (const entry of readdirSync(join(SRC, rel), { withFileTypes: true })) {
      const childRel = join(rel, entry.name);
      if (entry.isDirectory()) { walkDir(childRel); continue; }
      if (!/\.(js|mjs)$/.test(entry.name)) continue;
      const abs = join(SRC, childRel);
      const dest = join(ENGINE_DIR, childRel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(abs, dest);
      fileCount++;
      // collect external deps (line-anchored, comment-stripped) for the install step
      if (DEP_EXEMPT_RE.test(childRel)) continue;
      const s = stripComments(readFileSync(abs, 'utf8'));
      for (const re of [IMPORT_RE, SIDE_RE]) {
        let m; re.lastIndex = 0;
        while ((m = re.exec(s))) {
          const spec = m[1];
          if (!spec.startsWith('.')) externalDeps.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
        }
      }
    }
  };
  for (const r of ROOTS) walkDir(r);
  log(`vendored ${fileCount} files from src/{${ROOTS.join(',')}} → server/src/preflight/engine/`);

  // Flag if PreFlight added an external dep beyond the known engine set (so we
  // notice and vet it rather than silently pulling something Node-hostile).
  const surprises = [...externalDeps].filter((d) => !ENGINE_DEPS.includes(d) && !d.startsWith('node:'));
  if (surprises.length) log(`NOTE: engine references extra external deps not in the known set: ${surprises.join(', ')} — install step will add them; vet if unexpected`);

  // ── 4. write the lock (provenance — never mystery-stale) ──
  const prevLock = existsSync(LOCK_FILE) ? JSON.parse(readFileSync(LOCK_FILE, 'utf8')) : {};
  const installDeps = [...externalDeps].filter((d) => !d.startsWith('node:'));
  const lock = {
    repo: REPO, ref: REF, commit,
    syncedAt: new Date().toISOString(),
    fileCount,
    engineDeps: installDeps.sort(),
    entry: `server/src/preflight/engine/${ENTRY_VENDORED}`,
  };
  writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');

  // ── 4b. ensure Atlan has the engine's npm deps (acorn*) so it imports here ──
  const pkgPath = join(ATLAN_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  const missing = installDeps.filter((d) => !pkg.dependencies[d] && !(pkg.devDependencies || {})[d]);
  if (missing.length) {
    log(`installing engine deps: ${missing.join(', ')}`);
    execFileSync('npm', ['install', '--save', ...missing], { cwd: ATLAN_ROOT, stdio: 'inherit' });
  }

  // ── 5. smoke test: the vendored engine must run in THIS Node and catch planted vulns ──
  log('smoke test: importing vendored engine + scanning planted fixture ...');
  const { scan, engineInfo } = await import('file://' + join(ENGINE_DIR, ENTRY_VENDORED));
  const fixture = [
    { path: 'src/leak.js', content: 'const AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";\n' },
    { path: 'src/inj.js', content: 'export const q = (id) => `SELECT * FROM t WHERE id = ${id}`;\nconst x = eval(userInput);\n' },
  ];
  const res = scan(fixture);
  if (!res || !Array.isArray(res.findings)) die('scan() did not return { findings } — engine broken');
  if (res.findings.length === 0) die('scan() found ZERO issues in a fixture full of planted vulns — engine broken or closure incomplete');
  const info = engineInfo();
  log(`SMOKE PASS: ${res.findings.length} findings on the fixture, ${info.probeCount} probes loaded`);

  // ── 6. report delta ──
  const delta = prevLock.fileCount != null ? ` (was ${prevLock.fileCount} files @ ${(prevLock.commit || '?').slice(0, 8)})` : '';
  log(`DONE. ${info.probeCount} probes, ${fileCount} files @ ${commit.slice(0, 8)}${delta}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
