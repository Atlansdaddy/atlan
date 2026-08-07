// Where the repo is, and where a test may write.
//
// Tests hardcoded `/root/atlan` for the checkout and `/root` for scratch space.
// Both are one machine's layout: CI runs as a non-root user, so
// `mkdtempSync('/root/atlan-git-test-')` throws EACCES and takes the whole suite
// down with it — three suites reported "0 pass, 1 fail" on the first CI run for
// exactly that reason, and the checkout is at /home/runner/work/atlan/atlan
// anyway.
//
// Same class as the Playwright import and `HOME ?? '/root'`: it works where it
// was written and nowhere else.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

/** The repository root, derived from this file's own location (test/lib → up 2). */
export const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** A writable scratch directory, wherever the OS puts one. */
export const scratch = (prefix) => mkdtempSync(join(tmpdir(), prefix));

/**
 * Scratch INSIDE the projects root.
 *
 * For tests that exercise project-scoped APIs: those endpoints refuse any path
 * outside PROJECTS_DIR, so a plain tmpdir() scratch gets a correct 400 and the
 * test reads it as a failure. Falls back to tmpdir() when the var is unset, so
 * a suite run standalone still has somewhere to write.
 */
export const projectScratch = (prefix) =>
  mkdtempSync(join(process.env.ATLAN_PROJECTS || tmpdir(), prefix));

/** A path inside the checkout — `repo('server')`, `repo('package.json')`. */
export const repo = (...parts) => join(REPO, ...parts);
