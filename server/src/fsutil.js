import { writeFileSync, renameSync, rmSync, readFileSync, existsSync } from 'node:fs';

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

/**
 * Read a JSON state file, distinguishing MISSING from CORRUPT.
 *
 * Every store in this codebase was written as `try { JSON.parse(read(f)) }
 * catch { return <empty> }`, which conflates two completely different events:
 *   · the file isn't there yet   — normal, first run, return the empty value
 *   · the file is there and unreadable — DATA LOSS, and the next persist()
 *     writes the empty value straight over the evidence
 *
 * Observed on three stores: a truncated burn.json silently zeroed the daily
 * token cap (the one global spend wall) and the next finish() overwrote the
 * 5.1M-token record for good; a truncated routines.json dropped every scheduled
 * routine with no notify, no broadcast and no log line, and the first state
 * change made the loss permanent. Nothing in the UI, the Doctor or the logs
 * said anything.
 *
 * So: a corrupt file is MOVED ASIDE, never overwritten, and the caller is told.
 * The bad bytes stay on disk under a timestamped name so the schedules or the
 * ledger can be recovered by hand, and `corrupt` is returned so callers that
 * gate on the value (the spend cap) can fail CLOSED instead of open.
 * (Cross-vendor adversarial review, 2026-08-06.)
 *
 * @returns {{ value:any, corrupt:false|string }} `corrupt` is the quarantine path.
 */
export function readJsonState(path, fallback) {
  if (!existsSync(path)) return { value: fallback, corrupt: false };
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return { value: fallback, corrupt: false }; } // unreadable ≠ corrupt (permissions, race)
  try { return { value: JSON.parse(raw), corrupt: false }; } catch { /* fall through */ }
  const quarantine = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { renameSync(path, quarantine); } catch { /* keep going: reporting matters more than moving */ }
  console.error(`[atlan] ${path} was unreadable JSON — moved to ${quarantine} and started empty. NOTHING WAS DELETED; recover by hand if you need it.`);
  return { value: fallback, corrupt: quarantine };
}
