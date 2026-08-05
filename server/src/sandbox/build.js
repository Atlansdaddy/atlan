// sandbox/build.js — get a working atlan-confine binary, or say we have none.
//
// COMPILER DISCOVERY IS BEHAVIOURAL, like everything else here. `which cc` is a
// flag file wearing a hat: it answers "is there a name on PATH", not "does this
// toolchain produce a binary that runs on this device". Measured 2026-08-05 on
// the WSL2 accessory node: `cc` and `gcc` work and `clang` is not installed at
// all; on Termux the situation is inverted and `clang` is the only one there. A
// design that hardcoded either name would be wrong on one of the two platforms
// Atlan ships to. So we compile a trivial file with each candidate AND RUN THE
// RESULT, and the first one whose output actually executes wins.
//
// THE BINARY NEVER ENTERS THE REPO. No prebuilts, no per-arch artifacts, no
// "which libc" question, and the 16 KB-page split on newer Android devices
// resolves itself because the compile happens on the device that will run it.
//
// THE FILENAME IS A HINT, NEVER A CLAIM. It carries the machine and the source
// hash so a stale binary cannot be picked up after an edit, but a cached binary
// is only USED once `--probe` returns the sentinel — the name is bookkeeping and
// the probe is the evidence. This is the same rule that forbids flag files.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { machine, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLEET_DIR } from '../config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SOURCE = join(HERE, '../../native/atlan-confine.c');

// Ordered by likelihood, not preference — every one is still tested by use.
const CANDIDATES = ['cc', 'gcc', 'clang', 'tcc'];
const TRIVIAL = 'int main(void){return 0;}\n';

export function sourceHash() {
  return createHash('sha256').update(readFileSync(SOURCE)).digest('hex').slice(0, 12);
}

export function binaryPath() {
  return join(FLEET_DIR, 'native', `atlan-confine-${machine()}-${sourceHash()}`);
}

/** Compile a trivial program and RUN it. A compiler that emits an unrunnable
 *  binary (wrong arch, missing runtime, a broken cross-toolchain) is not a
 *  compiler for our purposes, and only running the output can tell us. */
export function workingCompiler() {
  const dir = mkdtempSync(join(tmpdir(), 'atlan-cc-'));
  try {
    const src = join(dir, 't.c');
    writeFileSync(src, TRIVIAL);
    for (const cc of CANDIDATES) {
      const out = join(dir, `t-${cc}`);
      const c = spawnSync(cc, ['-O0', src, '-o', out], { stdio: 'ignore', timeout: 60000 });
      if (c.status !== 0 || !existsSync(out)) continue;
      const r = spawnSync(out, [], { stdio: 'ignore', timeout: 10000 });
      if (r.status === 0) return cc;
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Returns { ok, bin, cc, why }. Never throws: "we have no launcher" is a normal
 * answer on a device without a toolchain, and it means the established tier is
 * T0 — which is a refusal for any run declaring more, decided upstream.
 */
export function ensureBinary({ force = false } = {}) {
  const bin = binaryPath();
  if (!force && existsSync(bin)) return { ok: true, bin, cc: 'cached', why: `cached build for ${machine()} at source ${sourceHash()}` };
  if (!existsSync(SOURCE)) return { ok: false, bin: null, cc: null, why: `launcher source missing at ${SOURCE}` };
  const cc = workingCompiler();
  if (!cc) return { ok: false, bin: null, cc: null, why: 'no compiler on this device produced a binary that runs (tried ' + CANDIDATES.join(', ') + ')' };
  mkdirSync(dirname(bin), { recursive: true });
  // Compile to a temp name and rename: a half-written binary under the final
  // name would be picked up by the next boot's existsSync and probed as if it
  // were a build. Same reasoning as fsutil.atomicWrite, applied to a binary.
  const tmp = `${bin}.building.${process.pid}`;
  const r = spawnSync(cc, ['-O2', '-o', tmp, SOURCE], { encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0 || !existsSync(tmp)) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    return { ok: false, bin: null, cc, why: `${cc} failed to build the launcher: ${String(r.stderr ?? r.error ?? '').trim().slice(0, 300)}` };
  }
  chmodSync(tmp, 0o700);
  // Editing over a Windows→WSL share strips the exec bit; 0700 above is set on
  // the artifact we produced, so that only bites the source, never this.
  try { rmSync(bin, { force: true }); } catch { /* first build */ }
  renameSync(tmp, bin);
  return { ok: true, bin, cc, why: `built with ${cc} for ${machine()} at source ${sourceHash()}` };
}
