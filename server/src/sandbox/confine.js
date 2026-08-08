// sandbox/confine.js — the two insertion points, and the refusal in front of both.
//
// IP-1  agent CLIs (agents.js). The model client itself. Egress CANNOT be closed
//       here: this process IS the thing talking to the provider, so denying
//       AF_INET does not narrow exfiltration, it stops the agent thinking. What
//       IP-1 gets is capability removal, and — where the device proves it — a
//       filesystem boundary that leaves exactly one saved login readable.
//
// IP-2  Bash children of the Claude Agent SDK (fleet.js canUseTool). NOT the
//       model client: the SDK process is Node, in-process, and stays unconfined.
//       A shell the agent asked for has no legitimate reason to open a socket,
//       so this is where egress is closed completely and for the first time.
//
// UNCOVERED IN V1, NAMED HERE SO THE NEXT READER DOES NOT ASSUME COVERAGE THE
// CODE DOES NOT HAVE: build.js:71 (`bash -c script`), pty.js:46 (Term tab) and
// studio.js:72 (codex studio) all still spawn unwrapped.
//
// WHY IP-2 CLAIMS PER CALL AND NOT PER RUN. fleet.js:38 records the incident
// live on 2026-07-17: "canUseTool alone is NOT a gate — the CLI auto-approves
// 'safe' sandboxed Bash without ever calling it." We cannot prove from inside
// canUseTool that canUseTool was always called, so the ledger counts the calls
// we actually rewrote instead of asserting a boundary over calls we never saw.
// That is why the counters below exist and why they are reported, not rounded.

import { probe } from './probe.js';
import { plan } from './plan.js';
import { assertTier, isTier, TierRefusal } from './tiers.js';

export { TierRefusal };

/** Probe the device, compare against the declaration, refuse before anything starts. */
export function establish(declared) {
  const v = probe();
  assertTier(declared, v.tier, v.rungs);
  const top = [...v.rungs].reverse().find((r) => r.ok);
  return { ...v, certifiedBy: top ? `rung${top.n} ${top.id}: ${top.detail}` : 'no rung' };
}

/**
 * IP-1. Returns the spawn triple plus a writer for the policy.
 * The policy travels on a FILE DESCRIPTOR, never a path: a path is a TOCTOU
 * surface and the launcher's own configuration is the last thing that should be
 * swappable between resolution and read.
 */
export function confineSpawn({ declared, cmd, args, cwd, engine = null }) {
  if (!isTier(declared)) throw new TierRefusal(`unknown declared tier: ${declared}`, { declared, established: null });
  if (declared === 'T0') return null; // T0 = the caller spawns as before
  const v = establish(declared);
  const p = plan({ declared, insertionPoint: 'ip1-agent-cli', workspace: cwd, engine, bins: [cmd] });
  return {
    file: v.bin,
    args: ['@3', '--', cmd, ...args],
    // fd 3 carries the policy. fd 0/1/2 stay as the caller had them; the launcher
    // replaces stdin with /dev/null and refuses outright if 1 or 2 is a tty.
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    policy: p.policy,
    confinement: { ...p.confinement, tier: v.tier, probe: v.certifiedBy },
    writePolicy(child) { try { child.stdio[3].end(p.policy); } catch { /* child already gone; the run fails on its own terms */ } },
  };
}

// Shell-quote for the one place a command must survive re-parsing by the SDK's
// own shell. Not a sanitiser and not pattern matching — it is quoting, which is
// total: every byte comes out the other side as itself.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * IP-2. Rewrites the Bash tool's `command` so the shell runs under the launcher.
 * Returns null at T0 so the caller keeps today's behaviour verbatim.
 */
export function confineBash({ declared, command, cwd }) {
  if (!isTier(declared)) throw new TierRefusal(`unknown declared tier: ${declared}`, { declared, established: null });
  if (declared === 'T0') return null;
  const v = establish(declared);
  const p = plan({ declared, insertionPoint: 'ip2-sdk-bash', workspace: cwd, engine: null, bins: [] });
  // Semicolons stand in for newlines: the policy has to survive one trip through
  // argv, and argv is frozen by execve — nothing can swap it between our write
  // and the launcher's read, which is exactly the property a path lacks.
  const inline = p.policy.trim().split('\n').join(';');
  return {
    command: `${shq(v.bin)} ${shq(inline)} -- /bin/sh -c ${shq(command)}`,
    confinement: { ...p.confinement, tier: v.tier, probe: v.certifiedBy },
  };
}
