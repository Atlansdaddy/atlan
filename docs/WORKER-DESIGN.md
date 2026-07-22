# Atlan hardened execution worker (Rust) — design

*The answer to the peer review's #1: "make the execution boundary real." An out-of-process Rust worker that runs agent shell/build work inside real OS sandboxing, with a resource governor. Node stays the control plane; this is additive, not a rewrite. Language choice = John's priorities: safety, security, performance, consistency — Rust is memory-safe, GC-free, and the native language of the sandboxing primitives. Toolchain proven in proot (cargo 1.93, builds + runs). `worker/` crate scaffolded.*

## Why a separate process (not in-Node)
- **A boundary you can't cross by accident.** Node runs the orchestrator + the Agent SDK; the worker runs *untrusted* shell/build work. Separate processes = a compromised command can't reach the control plane's memory (keys, sessions) — the exact blast-radius the review flagged.
- **The sandbox lives where the danger is.** Only the worker needs OS-level confinement; the control plane stays a normal Node process.
- **Cross-platform, one worker.** Tauri (desktop) and the Node server both spawn the same `atlan-worker` binary.

## Per-OS sandbox strategy (honest-degrade, Doctor reports which)
| Platform | Confinement | Status |
|---|---|---|
| **Linux (desktop/native)** | Landlock (FS) + seccomp (syscalls) + namespaces; or bubblewrap | the real thing — this is what "PC makes it safer" means |
| **macOS** | `sandbox-exec` / Seatbelt profile | real |
| **Windows** | Job Objects (resources) + AppContainer/restricted token (FS/priv) | real |
| **proot / phone** | **no OS sandbox possible** (namespaces/Landlock blocked — tested) → falls back to profile tool-gating + resource governor only | honest degrade; Doctor shows "reduced" |

The worker probes its own capabilities at startup and reports them; the control plane and Doctor surface exactly what confinement is active. **Never claim a boundary that isn't there** (the review's core lesson).

## What the worker enforces
1. **Filesystem confinement** — writes restricted to the run's project dir + a scratch tmp; reads denied to credential paths (`.ssh`, key stores, other projects). Real (Landlock/Seatbelt/AppContainer), not path-string checks.
2. **Network policy** — deny-by-default egress; allowlist per run (so a malicious dependency can't exfiltrate through arbitrary hosts).
3. **Resource governor** (the review's "resource governor, not just token budgets"): per-run memory ceiling, CPU/time limit, max child processes, and a global concurrency cap. Thermal/battery awareness on mobile. Kills the tree on breach.
4. **Clean process tree** — all children tracked; KILL is real (no orphans surviving — the review noted our JS `pkill` can leave strays).

## IPC contract (stdio, newline-delimited JSON)
The control plane spawns `atlan-worker` and speaks a small typed protocol:
```
→ {"id":"run_ab12","cmd":"exec","argv":["bash","-lc","npm test"],
   "cwd":"/proj","limits":{"mem_mb":2048,"secs":600,"procs":64},
   "fs":{"write":["/proj","/tmp/scratch"],"deny_read":["~/.ssh"]},
   "net":{"allow":["registry.npmjs.org"]}}
← {"id":"run_ab12","ev":"sandbox","mode":"landlock+seccomp"}
← {"id":"run_ab12","ev":"stdout","data":"..."}
← {"id":"run_ab12","ev":"exit","code":0,"peak_mem_mb":812,"killed":null}
```
Typed on both ends (serde on the Rust side). This is also the "split execution workers from the control plane" the review recommended.

## How Atlan routes through it
- **Fleet builder/verifier + hierarchy links that run Bash** → dispatched to the worker instead of the Agent SDK's in-process Bash. Scout (read-only) can stay in-SDK.
- **Build tab** (Gradle/APK) → run under the worker's resource governor (fixes the "APK build + llama-server RAM contention" the review raised).
- Each run gets a **git worktree** (the review: worktree ≠ sandbox — correct, so the worktree is for source isolation and the *worker* provides the actual execution boundary; together they cover both).

## Packaging (cross-platform, John's intent)
- **Desktop (Windows/Mac/Linux):** Tauri shell (Rust) hosting the web UI + spawning the worker. Small binary, real capability model, the OS sandbox actually works here.
- **Mobile:** the existing Capacitor APK path (worker degrades to profile-gating on-device).
- **Universal fallback:** the current PWA + Node server.

## Phasing
1. **Worker MVP (Linux):** IPC protocol + `exec` with Landlock FS confinement + resource limits + clean kill. Route one fleet builder run through it; Doctor reports the mode.
2. **Harden Linux:** seccomp syscall filter + network deny/allowlist.
3. **macOS + Windows** confinement backends.
4. **Tauri desktop** shell.
5. Then Stage-2 self-repair can finally run in a *real* sandbox (the review's precondition).

## Non-goals (kept honest)
- This does not make the *phone* safe for untrusted autonomous work — proot can't. It makes the **desktop** safe, and makes the phone **honest** about what it can't confine.
- Not a rewrite. The Node control plane, UI, tests, and features stay.
