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
import { tmpdir, homedir } from 'node:os';
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

/** The projects root the server is actually using. */
export const projectsRoot = () => (process.env.ATLAN_PROJECTS || homedir()).replace(/\/$/, '');

/**
 * A credential-store path INSIDE the projects root.
 *
 * guards.js refuses these by NAME (the SENSITIVE families), but that check only
 * gets a turn on a path the boundary check already let through. `~/.claude/...`
 * is inside the projects root only on the home node, where HOME *is* the
 * projects root — everywhere else it is refused one layer earlier, for being
 * outside the project. Both refusals are correct; only one of them is the thing
 * these tests exist to prove. Building the path under the projects root aims
 * the assertion at the layer it names.
 *
 * The file need not exist: the name check runs before the existence check, which
 * is the point — a write to a path that merely LOOKS like a credential store is
 * refused before anything is created.
 */
export const credPath = (rel) => join(projectsRoot(), rel);

/** A path inside the checkout — `repo('server')`, `repo('package.json')`. */
export const repo = (...parts) => join(REPO, ...parts);
