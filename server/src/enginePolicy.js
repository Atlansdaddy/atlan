import { existsSync, readFileSync } from 'node:fs';

// Projecting an Atlan PROFILE onto a non-Claude CLI's native gating flags.
//
// WHY THIS EXISTS. Atlan's profiles (scout / builder / verifier) are enforced
// on the Claude path by the Agent SDK's `disallowedTools` + `canUseTool`. The
// four exec-mode CLIs have no such API — so agents.js launches all four with
// their gates switched OFF (`--dangerously-bypass-approvals-and-sandbox`,
// `--allow-all`, `--always-approve`, `--dangerously-skip-permissions`) and
// ARCHITECTURE.md honestly records that nothing gates them at either end.
//
// That was a correct decision for the PHONE and a wrong one everywhere else.
// On Termux/proot no sandbox can initialise — there are no user namespaces, so
// bypassing is the only thing that works. On the WSL2 home node, user
// namespaces and Landlock are both present, and every one of the four CLIs
// turns out to expose real gating. Bypassing there discards a boundary the
// kernel is willing to enforce for free.
//
// MEASURED, not assumed (2026-07-27, this node, codex-cli 0.145.0):
//   codex exec -s workspace-write, told to write /root/codex-canary.txt:
//     /bin/bash: /root/codex-canary.txt: Read-only file system
//   ...while the same invocation created a file inside the workspace fine.
//   That is Landlock refusing the write, not the model declining politely.
//
// THE HARD RULE HERE: an engine that cannot honestly enforce a profile does
// not get to run under it. We refuse instead of pretending. A profile that
// silently degrades to "no gate" on some engines is worse than no profile —
// it makes a promise the runtime does not keep, which is the one thing the
// deterministic-walls thesis cannot survive.

// ── host capability ───────────────────────────────────────────────────────
// The CLIs' OS sandboxes need kernel features proot cannot provide. Detect
// rather than infer from platform: a WSL2 kernel and an Android proot kernel
// are both "linux".
export function sandboxCapableHost() {
  // Force the no-kernel-sandbox path. Two real uses: testing the phone's
  // behaviour from a PC (otherwise the proot path is unreachable on the only
  // machine that can run the test suite), and letting a cautious user demand
  // Atlan-side containment even where the kernel would have helped.
  if (process.env.ATLAN_ASSUME_NO_SANDBOX === '1') {
    return { ok: false, why: 'ATLAN_ASSUME_NO_SANDBOX=1 — treating this host as proot/Termux' };
  }
  try {
    // proot has no user namespaces; every OS sandbox mode depends on them.
    const maxUserNs = Number(readFileSync('/proc/sys/user/max_user_namespaces', 'utf8').trim());
    if (!Number.isFinite(maxUserNs) || maxUserNs <= 0) return { ok: false, why: 'no user namespaces (proot/Termux) — no OS sandbox can initialise' };
    if (existsSync('/proc/sys/kernel/unprivileged_userns_clone')) {
      const v = readFileSync('/proc/sys/kernel/unprivileged_userns_clone', 'utf8').trim();
      if (v === '0') return { ok: false, why: 'unprivileged user namespaces disabled by sysctl' };
    }
    return { ok: true, why: 'user namespaces available' };
  } catch {
    return { ok: false, why: 'cannot read /proc — assuming no sandbox' };
  }
}

// ── per-engine capability + projection ────────────────────────────────────
// `fidelity` is the honest claim about how well an engine can express our
// three profiles:
//   full    — every profile maps to a distinct, enforced native mode
//   binary  — the engine has one on/off gate; it cannot distinguish read-only
//             from write, so only profiles that gate coarsely are allowed
//   unverified — flags exist in --help but their semantics are NOT confirmed
//             on this machine, so we refuse rather than trust a help string
//
// Anything below `full` is not a defect to hide; it is the reason the agentic
// tier defaults to codex.
export const ENGINE_POLICY = {
  codex: {
    fidelity: 'full',
    // VERIFIED on this node. -s read-only still executes shell commands; it
    // makes the filesystem read-only, which is exactly the verifier contract
    // (reads and runs checks, never edits the work it grades).
    profiles: {
      scout: ['-s', 'read-only'],
      verifier: ['-s', 'read-only'],
      builder: ['-s', 'workspace-write'],
    },
    bypass: ['--dangerously-bypass-approvals-and-sandbox'],
  },
  copilot: {
    fidelity: 'unverified',
    // --add-dir + path verification (ON by default) and separable
    // --allow-all-tools / --allow-all-paths / --allow-all-urls are all in
    // --help, so a cwd-scoped builder looks expressible. Not exercised here,
    // so not offered. Verify with a canary before promoting to 'full'.
    profiles: {},
    bypass: ['--allow-all'],
  },
  grok: {
    fidelity: 'unverified',
    // --allow/--deny take per-tool RULES, the closest shape to our profiles of
    // any of the four. Blocked only on not knowing grok's tool names; once a
    // canary run confirms them this is likely 'full'.
    profiles: {},
    bypass: ['--always-approve'],
  },
  antigravity: {
    fidelity: 'binary',
    // --sandbox is on/off ("terminal restrictions"), with no read vs write
    // axis, so it cannot distinguish scout from builder. It can honestly
    // express "sandboxed at all", which is enough for scout only if we accept
    // that the restriction is coarser than Claude's. It is not, so: none.
    profiles: {},
    bypass: ['--dangerously-skip-permissions'],
  },
};

export const engineFidelity = (engine) => ENGINE_POLICY[engine]?.fidelity ?? 'unknown';

// Returns the argv fragment that enforces `profile` on `engine`, or throws.
// Throwing is the feature: a caller asking for a guarantee we cannot deliver
// gets an error, never a silent bypass.
export function policyArgs(engine, profile, { allowUnsandboxed = false } = {}) {
  const spec = ENGINE_POLICY[engine];
  if (!spec) throw new Error(`unknown engine: ${engine}`);

  const host = sandboxCapableHost();
  if (!host.ok) {
    // The phone. Bypassing is the only thing that runs, so it is allowed —
    // but only when the caller has explicitly acknowledged it, and the result
    // is labelled so nothing downstream can call it gated.
    if (!allowUnsandboxed) {
      throw new Error(`${engine} cannot be gated on this host (${host.why}) — pass allowUnsandboxed to run it ungated, and label the run`);
    }
    return { args: spec.bypass, enforced: false, why: host.why };
  }

  const args = spec.profiles[profile];
  if (!args) {
    if (!allowUnsandboxed) {
      throw new Error(`${engine} cannot enforce profile "${profile}" (fidelity: ${spec.fidelity}) — refusing rather than running it ungated`);
    }
    return { args: spec.bypass, enforced: false, why: `no ${profile} mapping for ${engine} (${spec.fidelity})` };
  }
  return { args, enforced: true, why: `${engine} native ${profile} gate` };
}

// For the Doctor surface: say plainly what is and isn't gated here.
export function policyReport() {
  const host = sandboxCapableHost();
  return {
    host,
    engines: Object.entries(ENGINE_POLICY).map(([id, spec]) => ({
      id,
      fidelity: spec.fidelity,
      profiles: Object.keys(spec.profiles),
      gatedHere: host.ok && Object.keys(spec.profiles).length > 0,
    })),
  };
}
