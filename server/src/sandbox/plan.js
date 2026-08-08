// sandbox/plan.js — (profile, engine, workspace, insertion point) → a policy.
//
// THE PART THAT IS ACTUALLY NEW: THE CREDENTIAL SURFACE.
// Atlan's existing controls close the ENVIRONMENT path well and the FILESYSTEM
// path not at all. `guards.js`'s SENSITIVE regex protects the EDITOR — a spawned
// agent never passes through guardPath() — so today an agent CLI can read
// ~/.codex/auth.json, ~/.grok/auth.json, ~/.claude/.credentials.json, ~/.ssh/,
// and Atlan's own .fleet/auth.json and .keys.enc. docs/SECURITY.md already says
// this out loud ("everything Atlan can reach … is in blast radius"); a Landlock
// grant list is the first thing in the tree that can change it.
//
// The one grant that HAS to exist is the running engine's own login — without it
// the CLI cannot authenticate and the product stops. Everything else is absent,
// which buys a genuinely new guarantee: codex can no longer read grok's token.
//
// WHY IT REUSES guards.js RATHER THAN GROWING A SECOND LIST. guards.js exists
// because two copies of this logic were made and silently DRIFTED — the editor's
// copy lost `.fleet` and `.env` and could read the scrypt hash while its own
// comment claimed otherwise. Adding a third list here would repeat that exact
// mistake. isSensitive() IS the source of truth for "credential-shaped", and
// test/sandbox.mjs asserts every engine store we name is matched by it, so an
// engine added to agents.js without a SENSITIVE entry fails the commit.
//
// ON THE PHONE THIS LAYER DOES NOT EXIST, and the UI says the sentence rather
// than a hedge: no Landlock, no mount namespaces, no path confinement of any
// kind for an unrooted app. scrubbedEnv-style env control is all there is there,
// and it only covers the environment.

import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { APP_ROOT } from '../config.js';
import { guardPath, isSensitive, isUnder } from '../guards.js';
import { FLOOR_RUNG, tierRequires } from './tiers.js';

// Each engine's own store, keyed the way agents.js keys engines. Not a second
// credential list — every entry here must ALSO be matched by guards.js's
// SENSITIVE regex, which test/sandbox.mjs enforces.
export const ENGINE_STORE = {
  claude: '.claude',
  codex: '.codex',
  grok: '.grok',
  copilot: '.copilot',
  antigravity: '.gemini',
};

/** Everything that must be unreachable, derived rather than typed twice. */
export function denyList({ home = homedir(), engine = null } = {}) {
  const others = Object.entries(ENGINE_STORE)
    .filter(([id]) => id !== engine)
    .map(([, d]) => join(home, d));
  return [
    ...others,
    join(home, '.ssh'), join(home, '.aws'), join(home, '.gnupg'),
    join(APP_ROOT, '.keys.enc'), join(APP_ROOT, '.fleet'), join(APP_ROOT, 'server/src'),
  ];
}

/**
 * The toolchain grant, DERIVED from this process and this filesystem — never a
 * hardcoded operator path. process.execPath finds node wherever it lives;
 * $PREFIX finds Termux's usr without naming Termux; every entry is filtered by
 * existence so the list asserts rather than assumes.
 *
 * /etc AND /proc ARE GRANTED PER FILE, NOT WHOLESALE, AND THAT IS THE POINT.
 * Measured 2026-08-05 on the WSL2 node: a directory grant of /etc hands the
 * agent /etc/shadow, and under proot every process runs as uid 0 so that is a
 * real read. Naming the dozen files the loader, the resolver and the CA store
 * actually need costs nothing and keeps the credential claim true. Same for
 * /proc: the global counters are grantable, /proc/<pid>/environ is where the
 * cockpit's own token would be, and a directory grant would include it.
 *
 * Landlock rules are inode-attached at O_PATH, so a per-file grant is exact:
 * replacing the path afterwards cannot repoint the rule.
 */
export function toolchainGrants(extraBins = [], home = homedir()) {
  const ro = new Set();
  const rw = new Set();
  ro.add(dirname(process.execPath));
  for (const b of extraBins) if (b) { try { ro.add(dirname(realpathSync(b))); } catch { /* unresolvable here; the grant would fail loudly at L3 */ } }
  if (process.env.PREFIX) ro.add(process.env.PREFIX);
  // Executable + library roots. Directories, because a toolchain is a tree.
  for (const r of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/system', '/apex']) ro.add(r);
  // Loader, name resolution, time zone, CA store. Files and small dirs only.
  for (const r of ['/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/ld.so.conf.d', '/etc/ssl', '/etc/pki',
    '/etc/ca-certificates', '/etc/ca-certificates.conf', '/etc/passwd', '/etc/group',
    '/etc/nsswitch.conf', '/etc/resolv.conf', '/etc/hosts', '/etc/localtime', '/etc/alternatives',
    // git dies FATALLY, not with a warning, when it cannot read its config
    // (measured: `git init` exits 128 with "unknown error occurred while
    // reading the configuration files"). A build agent without git is not a
    // build agent, so its config is toolchain, and none of these is
    // credential-shaped — assertGrantsSafe re-checks that rather than trusting
    // this comment.
    '/etc/gitconfig', join(home, '.gitconfig'), join(home, '.config/git')]) ro.add(r);
  // Global counters only. Never /proc itself, never a /proc/<pid> directory.
  for (const r of ['/proc/stat', '/proc/cpuinfo', '/proc/meminfo', '/proc/uptime', '/proc/loadavg', '/proc/self']) ro.add(r);
  ro.add('/dev/urandom'); ro.add('/dev/random');
  // The three devices programs WRITE to. A /dev directory grant would include
  // /dev/tty, and a tty fd is TIOCSTI keystroke injection.
  for (const r of ['/dev/null', '/dev/zero', '/dev/full']) rw.add(r);
  return {
    ro: [...ro].filter((p) => existsSync(p)).sort(),
    rw: [...rw].filter((p) => existsSync(p)).sort(),
  };
}

export class PolicyRefusal extends Error {
  constructor(msg) { super(msg); this.name = 'PolicyRefusal'; }
}

/**
 * Structural check, run before any policy is emitted. A grant that reaches a
 * denied path is not a smaller boundary, it is no boundary — so this refuses
 * rather than trimming, and the caller never starts the run.
 */
export function assertGrantsSafe({ ro = [], rw = [], workspace = null, engine = null, home = homedir() }) {
  const blessed = engine && ENGINE_STORE[engine] ? resolve(join(home, ENGINE_STORE[engine])) : null;
  if (workspace) {
    // The WRITABLE WORKSPACE goes through the EXISTING guard, so PROJECTS_DIR
    // scoping, APP_ROOT blocking, the credential regex and the realpath symlink
    // check are the same ones the editor gets. One guard, not two — guards.js
    // exists precisely because a second copy of this logic drifted and lost
    // `.fleet` and `.env`.
    guardPath(workspace, { mustExist: true, blockAppRoot: true, verb: 'grantable' });
  }
  for (const p of [...ro, ...rw]) {
    const abs = resolve(p);
    if (isUnder(abs, APP_ROOT)) throw new PolicyRefusal(`grant reaches Atlan's own tree (${abs}) — the cockpit's source and state are never inside an agent's boundary`);
    if (isSensitive(abs) && abs !== blessed) {
      throw new PolicyRefusal(`grant is a credential path (${abs}) and is not ${engine ?? 'this engine'}'s own store — exactly one login is grantable`);
    }
  }
  // The structural half: not "is this grant credential-shaped" but "does this
  // grant make a denied path REACHABLE". A grant of $HOME is not credential
  // shaped and hands over every token on the device.
  const denied = denyList({ home, engine });
  for (const d of denied) {
    for (const g of [...ro, ...rw, ...(workspace ? [workspace] : [])]) {
      const abs = resolve(g);
      if (isUnder(resolve(d), abs)) {
        throw new PolicyRefusal(`grant ${abs} would make ${d} reachable — that is the credential surface this layer exists to close`);
      }
    }
  }
  return true;
}

/**
 * @param {object} o
 * @param {'T0'|'T1'|'T2'|'T3'} o.declared  tier this run asks for
 * @param {'ip1-agent-cli'|'ip2-sdk-bash'} o.insertionPoint
 * @param {string} o.workspace  the disposable copy, never the project
 * @param {string|null} o.engine
 * @param {string[]} o.bins  binaries that must remain executable
 * @returns {{policy:string, confinement:object, ro:string[], rw:string[]}}
 */
export function plan({ declared, insertionPoint, workspace, engine = null, bins = [], home = homedir() }) {
  // ASK WHAT THE TIER REQUIRES, NEVER WHERE IT SITS. A magnitude test was right
  // while the ladder was a line and became unwritable the moment TS existed: it
  // requires the egress rung and not the deny-set rung, so no integer puts it in
  // the right place relative to T1. Naming the rung is also self-documenting —
  // `>= T3` needed the reader to know what T3 meant.
  const wantFs = tierRequires(declared, 'landlock-canary');
  // THE SPLIT THAT IS THE ARCHITECTURE. The process that must reach
  // api.<provider>.com and the process that must not read ~/.ssh are, for an
  // agent CLI, THE SAME PROCESS. Denying AF_INET at IP-1 does not narrow egress,
  // it stops the agent thinking. At IP-2 the process is a shell the agent asked
  // for, which has no legitimate reason to open a socket at all — so that is
  // where the first real egress boundary Atlan has ever had actually goes.
  const denyEgress = insertionPoint === 'ip2-sdk-bash' && tierRequires(declared, 'egress-denial');

  const ro = [];
  const rw = [];
  let scratch = null;
  if (wantFs) {
    const ws = resolve(workspace);
    rw.push(ws);
    // NOT /tmp. Granting it is the obvious move and it is wrong twice over: it
    // is a shared channel between concurrently confined agents, and on a layout
    // where a home directory sits under it, it makes a credential store
    // reachable — assertGrantsSafe caught exactly that case. A per-run scratch
    // dir inside the already-granted workspace costs one mkdir, and the
    // launcher points TMPDIR/TMP/TEMP at it so toolchains that hardcode /tmp
    // land inside the boundary instead of forcing us to widen it.
    scratch = join(ws, '.atlan-scratch');
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    const t = toolchainGrants(bins, home);
    ro.push(...t.ro);
    rw.push(...t.rw);
    // EXACTLY ONE auth store: the running engine's own. Without it the CLI
    // cannot authenticate and the product stops; with only it, codex can no
    // longer read grok's token, which is the new guarantee.
    const store = engine && ENGINE_STORE[engine] ? resolve(join(home, ENGINE_STORE[engine])) : null;
    if (store && existsSync(store)) ro.push(store);
    assertGrantsSafe({ ro, rw: rw.filter((p) => p !== ws), workspace: ws, engine, home });
  }

  const lines = [`tier=${declared}`, `egress=${denyEgress ? 'deny' : 'open'}`, `fs=${wantFs ? 'landlock' : 'none'}`];
  if (workspace) lines.push(`cwd=${resolve(workspace)}`);
  if (scratch) lines.push(`scratch=${scratch}`);
  for (const p of ro) lines.push(`ro=${p}`);
  for (const p of rw) lines.push(`rw=${p}`);
  // A newline inside a grant path would forge a directive. Structural refusal,
  // not an escape: there is no path we need that contains one.
  for (const l of lines) if (l.includes('\n')) throw new PolicyRefusal('a grant path contains a newline — refused rather than escaped');

  return {
    policy: lines.join('\n') + '\n',
    ro,
    rw,
    // Rides ALONGSIDE `boundary` in the ledger, never redefining it — history.jsonl
    // already carries months of records in that vocabulary and receipts read later
    // must still mean what they meant.
    confinement: {
      tier: null,            // filled by the caller from the ESTABLISHED tier
      declared,
      insertionPoint,
      fs: wantFs ? 'landlock+workspace' : 'none',
      // Never 'gated'. Sockets exist at IP-1, they reach the model, and therefore
      // they reach anywhere — an agent CLI's provider connection is a channel we
      // blessed, and calling it gated would be the lie this file exists to avoid.
      egress: denyEgress ? 'denied' : (insertionPoint === 'ip1-agent-cli' ? 'open-to-provider' : 'open'),
      caps: tierRequires(declared, FLOOR_RUNG) ? 'removed' : 'none',
      probe: null,           // filled by the caller with the rung that certified the top tier
    },
  };
}
