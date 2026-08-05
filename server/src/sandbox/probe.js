// sandbox/probe.js — ask the device, believe only the device.
//
// CACHING RULE, STRICTER THAN THE OBVIOUS ONE. A verdict is cached IN MEMORY,
// for this process only, keyed on the launcher binary's own path. Never a file.
// A file cache is a flag file wearing a hat, and this project's hard rule is
// that flag files lie: the reason we probe at all is that
// /sys/kernel/security/lsm reads "n/a" where Landlock is actively enforcing and
// /proc/sys/user/max_user_namespaces reads a large positive number on kernels
// built without user namespaces. A cached verdict outlives the boot, the OS
// update and the Termux package upgrade that invalidated it — which is the same
// class of lie with our own name on it.
//
// A MALFORMED OR SLOW PROBE IS T0, NEVER "assume last time's answer". Timeout,
// bad JSON, a missing sentinel, or a rung list we do not recognise all mean we
// did not measure this device, and not-measured is not a capability.

import { spawnSync } from 'node:child_process';
import { ensureBinary } from './build.js';
import { tierFromRungs } from './tiers.js';

const SENTINEL = 'atlan-confine/1';
const cache = new Map(); // bin path → verdict (this process only, never a file)

export function clearProbeCache() { cache.clear(); }

/**
 * @returns {{tier, rungs, why, bin, arch, landlockAbi, pageSize, marker}}
 *   `tier` is what THIS DEVICE ESTABLISHES, not what any run asked for.
 */
export function probe({ force = false } = {}) {
  const built = ensureBinary({ force });
  if (!built.ok) return t0(built.why, null);
  if (!force && cache.has(built.bin)) return cache.get(built.bin);

  const r = spawnSync(built.bin, ['--probe'], { encoding: 'utf8', timeout: 30000 });
  if (r.error || r.status !== 0) {
    return t0(`--probe did not complete: ${String(r.error?.message ?? `exit ${r.status}, signal ${r.signal}`)}`, built.bin);
  }
  let j;
  try { j = JSON.parse(r.stdout); } catch {
    return t0('--probe emitted output we could not parse — a launcher we cannot read is a launcher we cannot trust', built.bin);
  }
  if (j?.sentinel !== SENTINEL) {
    return t0(`--probe sentinel is ${JSON.stringify(j?.sentinel)}, expected ${SENTINEL} — the cached binary is not the launcher this source builds`, built.bin);
  }
  if (!Array.isArray(j.rungs) || !j.rungs.length) return t0('--probe returned no rungs', built.bin);

  const v = {
    tier: tierFromRungs(j.rungs),
    rungs: j.rungs,
    bin: built.bin,
    arch: j.arch ?? null,
    auditArch: j.auditArch ?? null,
    marker: j.marker ?? null,
    pageSize: j.pageSize ?? null,
    landlockAbi: j.landlockAbi ?? -1,
    why: built.why,
  };
  cache.set(built.bin, v);
  return v;
}

function t0(why, bin) {
  // Deliberately NOT cached: a device that failed to produce a launcher this
  // boot may produce one after the user installs a compiler, and caching the
  // failure would make the Doctor's re-check meaningless.
  return { tier: 'T0', rungs: [], bin, arch: null, auditArch: null, marker: null, pageSize: null, landlockAbi: -1, why };
}

/** Rung-by-rung, in ladder order — what the Doctor renders and the PR attaches. */
export function ladderLines(v) {
  if (!v.rungs.length) return [`no ladder: ${v.why}`];
  return v.rungs.map((r) => `${r.ok ? '✓' : '✗'} rung ${r.n} ${r.id} — ${r.detail}`);
}
