// Scratch state for a suite run DIRECTLY, e.g. `node test/unit.mjs`.
//
// run-all.mjs points ATLAN_FLEET_DIR at a throwaway directory before it spawns
// anything, so a full-suite run has always been clean. A single file run on its
// own skips that entirely, and config.js then resolves FLEET_DIR to the REAL
// .fleet — so the suite writes its fixtures into the operator's actual chat
// store. That is not hypothetical: it left eight stray archives and ten index
// entries titled "archive me and give me back" in a live History tab, where they
// are indistinguishable from real conversations someone lost.
//
// This must be the FIRST import in any suite that reaches config.js, because
// FLEET_DIR is resolved once at module evaluation and module evaluation follows
// import order. `??=` so run-all's directory always wins when there is one.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ATLAN_FLEET_DIR ??= mkdtempSync(join(tmpdir(), 'atlan-test-'));
