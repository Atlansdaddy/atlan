// tiers.js — the confinement ladder, its ordering relation, and THE ONLY HOME
// of the sentences Atlan says about it.
//
// WHY THE STRINGS LIVE IN CODE AND NOT IN THE UI. This repo has a documented
// two-week doc-drift recurrence and a recorded case where two docs diverged from
// each other on the same finding. An honest sentence about a security boundary
// has to have exactly one home and a test that fails the commit which changes it
// — so the UI imports these, docs/SECURITY.md quotes them verbatim, and
// test/docdrift.mjs asserts the quote byte-for-byte. Nobody retypes them.
//
// WHY THE LADDER IS DEVICE CAPABILITY, NOT RUN CONFIGURATION. `established` is
// the highest tier THIS device proved it can hold, measured by attempting every
// operation on this boot. `declared` is what a run asked for. They are compared,
// never conflated, and a run whose declaration outruns the device does not start.
//
// These are written to survive being screenshotted by a skeptic.

export const TIERS = ['T0', 'T1', 'T2', 'T3'];
export const rank = (t) => TIERS.indexOf(t);
export const isTier = (t) => rank(t) >= 0;

// One-line labels for compact UI. The full statement is always available.
export const LABEL = {
  T0: 'no OS confinement',
  T1: 'capability removal (kernel-enforced)',
  T2: 'capability removal + egress denial',
  T3: 'capability removal + egress + filesystem',
};

export const STATEMENT = {
  T0: `**No OS confinement on this run.** The agent runs as your user with no syscall filter and no filesystem boundary. It is working in a disposable copy of your project and nothing reaches your real tree until you approve a diff — that is containment against error, not against attack. This run was explicitly allowed to start ungated.`,

  T1: `**Capability removal, enforced by the kernel.** Before this agent started, Atlan installed a syscall filter it cannot remove and that every process it spawns inherits. It cannot use \`io_uring\`, \`ptrace\`, \`process_vm_writev\`, \`pidfd_getfd\`, \`userfaultfd\`, \`bpf\`, \`perf_event_open\`, \`keyctl\`, \`unshare\`, \`setns\`, \`mount\`, or the 32-bit syscall table.

**It does not confine the filesystem.** On an unrooted Android device there is no filesystem boundary available to an app — not to Atlan, not to anything. This agent can still read every file your Termux user can read, including the other agent CLIs' saved logins. Its writes go to a disposable copy and nothing reaches your project until you approve a diff.

**This is capability removal plus containment against error. It is not a sandbox.**`,

  T2: `**Everything in T1, and this shell cannot open a network socket.** \`socket()\` is refused by the kernel for every address family, including AF_UNIX — so it cannot reach the internet, cannot reach Atlan's own cockpit on loopback, and cannot smuggle data out through Android's DNS resolver socket. The refusal is inherited by anything it starts.

**This applies to shell commands the agent runs. It does not apply to the agent itself** — an agent CLI is the thing talking to the model provider, so its own connection stays open by necessity.`,

  T3: `**Everything above, and a real filesystem boundary.** Paths outside this workspace and its toolchain do not resolve for this agent — the kernel refuses at \`open()\`, and the refusal is inherited by every process it starts. Only this engine's own saved login is readable; the other CLIs' tokens, your SSH keys and Atlan's key store are outside the grant.

**Honest limits:** it does not cover file descriptors the agent was handed at startup, it does not hook \`stat\`/\`chmod\`/\`chown\`, and a network-capable process inside the boundary can still send out what it can read.`,
};

// Said by the Doctor when the on-device probe returns no to Landlock. "Not
// disabled, not skipped" is the load-bearing part: the difference between a
// capability we turned off and one the platform refuses is the whole reason the
// probe is behavioural.
export const NO_FS_ON_THIS_DEVICE = `**Filesystem confinement: unavailable on this device.** Not disabled, not skipped — Android's own app syscall filter kills the calls that would create it. Atlan checks by attempting it every boot; if a future Android permits it, this turns green without a code change.`;

// Which rungs must be green for each tier. Named, not counted, so a reordered
// ladder cannot silently change what a tier means.
export const REQUIRES = {
  T0: [],
  T1: ['nnp', 'seccomp-reachable', 'sentinel-errno', 'arch-echo', 'exec-inherit',
    'iouring-closed', 'fd-hygiene', 'selftest-denyset', 'selftest-defaultdeny', 'selftest-allowsanity'],
  T2: ['egress-denial'],
  T3: ['landlock-canary'],
};

// Rung 3 is the FLOOR and is called out separately in refusals: it proves the
// kernel is arbitrating OUR decision end to end rather than that a syscall
// happened to fail. Below it, nothing above it means anything.
export const FLOOR_RUNG = 'sentinel-errno';

/**
 * Highest tier this ladder supports. Cumulative: T2 needs T1's rungs too, so a
 * device with working egress denial but a broken sentinel establishes T0 — the
 * ladder cannot be climbed from the middle.
 */
export function tierFromRungs(rungs) {
  const ok = new Set((rungs ?? []).filter((r) => r.ok).map((r) => r.id));
  let top = 'T0';
  for (const t of ['T1', 'T2', 'T3']) {
    if (!REQUIRES[t].every((id) => ok.has(id))) break;
    top = t;
  }
  return top;
}

/** The first rung, in ladder order, that blocks `want` — the one a refusal names. */
export function blockingRung(want, rungs) {
  const byId = new Map((rungs ?? []).map((r) => [r.id, r]));
  for (const t of ['T1', 'T2', 'T3']) {
    for (const id of REQUIRES[t]) {
      const r = byId.get(id);
      if (!r || !r.ok) return r ?? { n: 0, id, ok: false, detail: 'rung never ran, so nothing was proven' };
    }
    if (t === want) break;
  }
  return null;
}

export class TierRefusal extends Error {
  constructor(msg, { declared, established, rung }) {
    super(msg);
    this.name = 'TierRefusal';
    this.declared = declared;
    this.established = established;
    this.rung = rung ?? null;
  }
}

/**
 * FAIL-CLOSED, MEASURED AGAINST THE DECLARATION — not against an absolute.
 *
 * An absolute rule ("no isolation, no run") turns the primary platform off, and
 * a design that turns the phone off is a design the operator disables, which is
 * the same outcome as no boundary with extra steps. So: a run declares the tier
 * it needs; if the device establishes less, the run does not start and the
 * refusal names the rung that said no. There is no degraded mode and no
 * "unsandboxed but running" path that was not asked for by name.
 */
export function assertTier(declared, established, rungs) {
  if (!isTier(declared)) throw new TierRefusal(`unknown declared tier: ${declared}`, { declared, established });
  if (!isTier(established)) throw new TierRefusal(`unknown established tier: ${established}`, { declared, established });
  if (rank(established) >= rank(declared)) return true;
  const r = blockingRung(declared, rungs);
  const where = r
    ? `Rung ${r.n} (${r.id}) said no: ${r.detail}.`
    : (rungs?.length
      // Cannot happen from a real probe — `established` is derived FROM these
      // rungs — so if it does, the ladder and the verdict disagree and the only
      // safe reading is that we did not measure this device.
      ? `The ladder and the verdict disagree, so this device was not measured.`
      : `No rung was recorded, so nothing was proven.`);
  throw new TierRefusal(
    `This run asked for ${declared} and this device establishes ${established}. ${where} Nothing was started.`,
    { declared, established, rung: r },
  );
}
