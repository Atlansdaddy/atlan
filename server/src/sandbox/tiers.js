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
// WHY THIS IS NO LONGER A LINE. It was T0 < T1 < T2 < T3 and a single integer
// compared them. That shape cannot describe a host whose supervisor takes some
// denials and leaves others: measured 2026-08-08 under Ubuntu's proot 5.1.0 on a
// WSL2 kernel, `ptrace`, `chroot` and `setuid` are carried out by the supervisor
// itself, with EPERM, KILL_PROCESS and SIGSYS all defeated — so that device
// loses one of T1's rungs while holding every rung of T2's egress denial. On a
// line it has to be called either more than it is or less than it is; both are
// lies, and the second one turns the product off.
//
// AND THE SUPERVISOR YOU HAVE IS NOT THE SUPERVISOR YOU TESTED. Later the same
// day, under TERMUX's proot 5.1.107 on an Android 15 kernel, all 16 denials HELD
// — ptrace included — while the arbitration rung still reported a tracer. Same
// tool, different fork, opposite answer. So TS is a real shape and it is NOT
// "the phone tier": which tier a phone establishes is a measurement, not a
// prediction, and this file must never name a platform where it means a rung.
//
// So dominance is DERIVED, not declared: tier A holds tier B when A's required
// rungs are a superset of B's. Nobody hand-writes the order, which means nobody
// can hand-write it wrong. TS and T1 come out INCOMPARABLE, which is the true
// answer, and T2 dominates both because it requires everything either requires.
//
// These are written to survive being screenshotted by a skeptic.

// Listed in presentation order — NOT in gating order. There is no gating order;
// see `dominates`. TS sits after T0 because that is where an operator looks for
// it, not because it is "one better than T0".
export const TIERS = ['T0', 'TS', 'T1', 'T2', 'T3'];
export const isTier = (t) => TIERS.includes(t);

/**
 * Position in the presentation list. For SORTING AND DISPLAY ONLY.
 *
 * Deliberately not called `rank`, and deliberately not used by anything that
 * decides. The previous name invited `rank(a) >= rank(b)` as a capability test,
 * which is exactly the comparison that cannot be written down as an integer once
 * TS exists — under it, a phone either outranks T1 (false: it cannot deny
 * ptrace) or is outranked by it (false: T1 has no egress boundary).
 */
export const ladderIndex = (t) => TIERS.indexOf(t);

// One-line labels for compact UI. The full statement is always available.
export const LABEL = {
  T0: 'no OS confinement',
  TS: 'capability removal under a supervisor + egress denial',
  T1: 'capability removal (kernel-enforced)',
  T2: 'capability removal + egress denial',
  T3: 'capability removal + egress + filesystem + process isolation',
};

export const STATEMENT = {
  T0: `**No OS confinement on this run.** The agent runs as your user with no syscall filter and no filesystem boundary. It is working in a disposable copy of your project and nothing reaches your real tree until you approve a diff — that is containment against error, not against attack. This run was explicitly allowed to start ungated.`,

  TS: `**Capability removal on a host where something else arbitrates syscalls, plus a real egress boundary.** Atlan installed a syscall filter this agent cannot remove and that every process it spawns inherits, and this shell cannot open a network socket: \`socket()\` is refused for every address family, including AF_UNIX, so it cannot reach the internet, cannot reach Atlan's own cockpit on loopback, and cannot smuggle data out through Android's DNS resolver socket. \`io_uring\`, \`process_vm_readv\`, \`process_vm_writev\`, \`pidfd_getfd\`, \`userfaultfd\`, \`bpf\`, \`perf_event_open\`, \`keyctl\`, \`unshare\`, \`setns\`, \`mount\` and the 32-bit syscall table are refused by the kernel.

**Three of the denials T1 promises do NOT hold here, and naming them is why this tier exists.** \`ptrace\`, \`chroot\` and \`setuid\` are carried out by the supervisor this agent runs under, which performs them itself and writes the answer back, so the kernel never sees our refusal. This is not fixable by refusing harder: EPERM, an outright kill and a fatal SIGSYS were all measured and all defeated. **An agent here can attach to its siblings.**

Not every supervisor takes those three, and Atlan does not guess which one you are running — it attempts every denial on this device, this boot. A device whose supervisor leaves them to the kernel establishes T2 instead and says so.

**There is no filesystem boundary, so the agents on this device are not isolated from one another.** This agent can read every file your user can read, including the other agent CLIs' saved logins, and it can read another agent's memory — and Atlan's — by opening \`/proc/<pid>/mem\`. That is a file, not a syscall, and the filter above cannot single it out: the only filter that closes this one closes \`open()\` for every path, the loader included. Its writes go to a disposable copy and nothing reaches your project until you approve a diff.

**This is capability removal plus an egress boundary. It is not a sandbox.**`,

  T1: `**Capability removal, enforced by the kernel.** Before this agent started, Atlan installed a syscall filter it cannot remove and that every process it spawns inherits. It cannot use \`io_uring\`, \`ptrace\`, \`process_vm_writev\`, \`pidfd_getfd\`, \`userfaultfd\`, \`bpf\`, \`perf_event_open\`, \`keyctl\`, \`unshare\`, \`setns\`, \`mount\`, or the 32-bit syscall table.

**It does not confine the filesystem.** This agent can still read every file your user can read, including the other agent CLIs' saved logins. On an unrooted Android device that is not a setting anyone chose — there is no filesystem boundary available to an app, not to Atlan and not to anything. Its writes go to a disposable copy and nothing reaches your project until you approve a diff.

**Removing those syscalls is not process isolation, and the gap is measured rather than argued.** \`ptrace\` and \`process_vm_readv\` are genuinely refused, and a process running beside this one can still read its memory by opening \`/proc/<pid>/mem\` — a file, reached with the same \`open()\` every program needs. A syscall filter cannot single that path out: seccomp matches syscall numbers and register values and may not follow a pointer into the path, because another thread can rewrite it after the check. A filter *can* shut the door by refusing \`open()\` outright — measured, and it refuses \`/etc/hostname\` in the same breath, so it is not a boundary a toolchain runs inside. Closing this one path takes a filesystem boundary, which is T3. Nothing below T3 has one.

**This is capability removal plus containment against error. It is not a sandbox.**`,

  T2: `**Everything in T1, and this shell cannot open a network socket.** \`socket()\` is refused by the kernel for every address family, including AF_UNIX — so it cannot reach the internet, cannot reach Atlan's own cockpit on loopback, and cannot smuggle data out through Android's DNS resolver socket. The refusal is inherited by anything it starts.

**This applies to shell commands the agent runs. It does not apply to the agent itself** — an agent CLI is the thing talking to the model provider, so its own connection stays open by necessity.

**T1's process-isolation limit carries over exactly.** Closing the socket does not close \`/proc/<pid>/mem\`, so a process running beside this one can still read its memory. Only T3 closes that.`,

  T3: `**Everything above, and a real filesystem boundary.** Paths outside this workspace and its toolchain do not resolve for this agent — the kernel refuses at \`open()\`, and the refusal is inherited by every process it starts. Only this engine's own saved login is readable; the other CLIs' tokens, your SSH keys and Atlan's key store are outside the grant.

**This is also the rung where process isolation begins.** Another process's \`/proc/<pid>\` is outside the grant, so the file door into its memory — the one a syscall filter cannot single out — stops resolving, while the \`/proc\` entries the toolchain genuinely needs keep working. Atlan proves both halves every boot: it reads a sibling process's memory before the boundary is applied and fails to read it after. If that ever stops holding, this device establishes T2 instead and the Doctor names the rung that said no.

**Honest limits:** it does not cover file descriptors the agent was handed at startup, it does not hook \`stat\`/\`chmod\`/\`chown\`, the \`/proc/self\` grant reaches the process Atlan launched and not the children that process spawns, and a network-capable process inside the boundary can still send out what it can read.`,
};

// Said by the Doctor when the on-device probe returns no to Landlock. "Not
// disabled, not skipped" is the load-bearing part: the difference between a
// capability we turned off and one the platform refuses is the whole reason the
// probe is behavioural.
export const NO_FS_ON_THIS_DEVICE = `**Filesystem confinement: unavailable on this device.** Not disabled, not skipped — Android's own app syscall filter kills the calls that would create it. Atlan checks by attempting it every boot; if a future Android permits it, this turns green without a code change.`;

// Said when the probe finds a ptrace supervisor between us and the kernel. The
// distinction that matters: this is not a weaker kernel, it is a kernel we are
// no longer talking to directly, and the rungs it costs are known by name.
export const SUPERVISOR_ON_THIS_DEVICE = `**Something arbitrates syscalls above Atlan on this device.** A ptrace supervisor sits between the agent and the kernel. Whether that costs anything is a separate question and Atlan measures it separately: some supervisors carry out \`ptrace\`, \`chroot\` and \`setuid\` on the agent's behalf, and no filter can refuse those whatever action it names — others leave them to the kernel and every denial holds. The rung list says which case this device is, because the two were measured to differ on the same day, on two builds of the same tool.`;

// The rungs the kernel arbitrates for us directly. Named, never counted, so a
// reordered ladder cannot silently change what a tier means. Listed floor-first:
// `blockingRung` reports the first one in this order that said no, and the floor
// is the honest thing to report when several failed.
const KERNEL_ARBITRATED = [
  'nnp', 'seccomp-reachable', 'sentinel-errno', 'arch-echo', 'exec-inherit',
  'iouring-closed', 'fd-hygiene', 'selftest-denyset', 'selftest-defaultdeny', 'selftest-allowsanity',
];

// The rung a ptrace supervisor takes away, and the ONLY one. Measured, not
// assumed: under proot every other member of the deny set still returns our
// EPERM — 13 of 16 hold, and the three that do not (ptrace, chroot, setuid) are
// the supervisor's own job, all inside this one rung.
const SUPERVISOR_DEFEATS = ['selftest-denyset'];

/**
 * FULL rung set per tier — not the increment over the tier below.
 *
 * It used to be the increment, read by a loop that walked the line and stopped
 * at the first gap. That encoding cannot describe TS at all, and it also meant
 * `REQUIRES.T2` read as "just the egress rung" to anyone who did not know to
 * accumulate. Spelling out the closure costs a few lines and makes the
 * containment relation below a one-liner that cannot be got wrong.
 */
export const REQUIRES = {
  T0: [],
  TS: [...KERNEL_ARBITRATED.filter((id) => !SUPERVISOR_DEFEATS.includes(id)), 'egress-denial'],
  T1: [...KERNEL_ARBITRATED],
  T2: [...KERNEL_ARBITRATED, 'egress-denial'],
  T3: [...KERNEL_ARBITRATED, 'egress-denial', 'landlock-canary', 'sibling-memory'],
};

// Rung 3 is the FLOOR and is called out separately in refusals: it proves the
// kernel is arbitrating OUR decision end to end rather than that a syscall
// happened to fail. Below it, nothing above it means anything.
export const FLOOR_RUNG = 'sentinel-errno';

/** Does a run declaring `tier` require rung `id` to have passed? */
export const tierRequires = (tier, id) => (REQUIRES[tier] ?? []).includes(id);

/**
 * Does tier `a` hold everything tier `b` promises?
 *
 * The whole ordering relation, derived from the rung sets so that adding a tier
 * cannot put it in the wrong place. T2 dominates TS and T1; TS and T1 dominate
 * neither each other nor anything but T0 — which is the true shape and the one
 * an integer could not hold.
 */
export function dominates(a, b) {
  if (!isTier(a) || !isTier(b)) return false;
  const have = new Set(REQUIRES[a]);
  return REQUIRES[b].every((id) => have.has(id));
}

/**
 * The tier this ladder establishes: the satisfied tier that no other satisfied
 * tier dominates.
 *
 * Cumulative by construction, because REQUIRES holds closures — a device with
 * working egress denial but a broken sentinel satisfies neither T2 nor TS and
 * establishes T0. The ladder still cannot be climbed from the middle.
 *
 * If two incomparable tiers were ever both maximal the ladder shape would be
 * broken, and the fail-closed answer is the LOWER of them. test/ladder.mjs
 * enumerates every possible subset of rungs and asserts it never happens, so
 * this branch is a backstop against a future edit, not a live case.
 */
export function tierFromRungs(rungs) {
  const ok = new Set((rungs ?? []).filter((r) => r.ok).map((r) => r.id));
  const satisfied = TIERS.filter((t) => REQUIRES[t].every((id) => ok.has(id)));
  const maximal = satisfied.filter((t) => !satisfied.some((o) => o !== t && dominates(o, t)));
  if (!maximal.length) return 'T0';
  return maximal.reduce((lo, t) => (ladderIndex(t) < ladderIndex(lo) ? t : lo));
}

/** The first rung, in ladder order, that blocks `want` — the one a refusal names. */
export function blockingRung(want, rungs) {
  const byId = new Map((rungs ?? []).map((r) => [r.id, r]));
  for (const id of REQUIRES[want] ?? []) {
    const r = byId.get(id);
    if (!r || !r.ok) return r ?? { n: 0, id, ok: false, detail: 'rung never ran, so nothing was proven' };
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
 * it needs; if the device cannot hold everything that tier promises, the run
 * does not start and the refusal names the rung that said no. There is no
 * degraded mode and no "unsandboxed but running" path that was not asked for by
 * name.
 *
 * The comparison is CONTAINMENT, not magnitude. A device establishing TS does
 * not satisfy a run that declared T1, even though TS holds a boundary T1 does
 * not — because T1 promises a ptrace denial and TS cannot make it true.
 */
export function assertTier(declared, established, rungs) {
  if (!isTier(declared)) throw new TierRefusal(`unknown declared tier: ${declared}`, { declared, established });
  if (!isTier(established)) throw new TierRefusal(`unknown established tier: ${established}`, { declared, established });
  if (dominates(established, declared)) return true;
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
