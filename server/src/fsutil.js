import { writeFileSync, renameSync, rmSync } from 'node:fs';

// Atomic file write: write to a temp sibling, then rename over the target.
// rename(2) is atomic on the same filesystem, so a crash/kill mid-write can never
// leave a truncated or half-JSON state file — a reader always sees the old file
// or the new one, never a corrupt in-between. (Peer review: sync writes on
// sessions/personas/ledger had no atomicity; a bad file could brick a store.)
// The temp inherits `opts.mode`, and rename preserves it, so 0600 stays 0600.
export function atomicWrite(path, data, opts = {}) {
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, data, opts);
    renameSync(tmp, path);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}
