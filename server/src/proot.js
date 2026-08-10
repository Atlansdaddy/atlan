// Where the agent CLIs actually live on a phone.
//
// Claude Code, Codex, Grok and Copilot are glibc binaries that shell out to FHS
// paths like /usr/bin/env. Termux is bionic with a $PREFIX tree, so they install
// cleanly and then refuse to run. The working arrangement on the S9 is a
// proot-distro Ubuntu container — which means the cockpit, running in Termux,
// cannot see any of them on its own PATH and reported all four as "not
// installed" while they sat there working.
//
// DETECTION ASKS THE CONTAINER, IT DOES NOT GUESS A PATH. proot-distro has
// already moved its rootfs directory once (installed-rootfs/ → containers/) and
// dropped `list --installed` in the same window; code that hardcodes either is a
// silent regression waiting for the next upgrade. `command -v` inside the
// container is authoritative and survives the layout changing again.
//
// Every lookup is cached, because each one pays a real proot start.
import { execFileSync } from 'node:child_process';

/** Which container to look in. Overridable for anyone whose distro is not ubuntu. */
export const DISTRO = process.env.ATLAN_PROOT_DISTRO ?? 'ubuntu';

const TIMEOUT = 20000; // proot cold start on a 2018 phone is seconds, not ms
let availability = null;
const whichCache = new Map();

function run(args) {
  return execFileSync('proot-distro', args, {
    timeout: TIMEOUT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * True when a usable container exists. False on every desktop that has no
 * proot-distro, which is the common case — so this must be cheap and quiet, and
 * must never throw into a caller that is only asking a question.
 */
export function prootAvailable() {
  if (availability !== null) return availability;
  try {
    run(['login', DISTRO, '--', 'true']);
    availability = true;
  } catch {
    availability = false;
  }
  return availability;
}

/** Absolute path of `bin` INSIDE the container, or null. Cached. */
export function prootWhich(bin) {
  if (!/^[\w.-]+$/.test(bin)) return null; // never interpolate a shell metacharacter
  if (whichCache.has(bin)) return whichCache.get(bin);
  if (!prootAvailable()) { whichCache.set(bin, null); return null; }
  let found = null;
  try {
    const out = run(['login', DISTRO, '--', 'bash', '-lc', `command -v ${bin}`]).trim();
    // A Termux path means proot leaked the host PATH into the container and
    // found the bionic copy — the broken one. That is not an install.
    if (out && !out.startsWith('/data/data/com.termux/')) found = out;
  } catch { /* not installed in the container */ }
  whichCache.set(bin, found);
  return found;
}

/** True when `path` exists inside the container. Used for credential markers. */
export function prootExists(path) {
  if (!prootAvailable()) return false;
  if (!/^[\w./-]+$/.test(path)) return false;
  try {
    run(['login', DISTRO, '--', 'test', '-e', path]);
    return true;
  } catch { return false; }
}

/**
 * argv that runs `argv` inside the container. Returned as an ARRAY, never a
 * joined string, so nothing downstream has to think about quoting.
 */
export function prootArgv(argv) {
  return ['proot-distro', 'login', DISTRO, '--', ...argv];
}

/**
 * The same thing as a line a human can read and a terminal can run. This is what
 * a "Log in" button types into the Term tab, so it has to be exactly what the
 * operator would type themselves — no wrapper they cannot reproduce.
 */
export function prootCommandLine(cmd) {
  return `proot-distro login ${DISTRO} -- ${cmd}`;
}

/** Tests and the Doctor's refresh need to re-ask after an install. */
export function clearProotCache() {
  availability = null;
  whichCache.clear();
}
