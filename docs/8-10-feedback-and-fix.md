# 8-10 feedback and fix

Field report from a tester running Atlan on a **Pixel, in native Termux**, plus what
the code actually says. Every claim below was re-read against `420b639` on
2026-08-10 — not against memory, and not against the version the report was
written on.

---

## The one root cause

The tester is in **native Termux (bionic libc)**. Atlan's supported Android path is
**Termux + proot-distro ubuntu (glibc)**. Three unrelated-looking native-binary
failures all fall out of that single fact.

`docs/SETUP.md:40` already documents the proot path correctly. Nothing checks it,
nothing enforces it, and nothing says so at the moment of failure — so a capable
user spent a night reverse-engineering three separate dead ends that one line of
output would have prevented. **That is the actual bug in this report.**

---

## 1. Claude Code — their read is wrong, and we already fixed it

**They said:** `install.cjs` deliberately refuses `android-arm64` though
`linux-arm64` is supported; the binary "almost certainly exists" and Anthropic is
gatekeeping.

**Verified:** the gate is honest. The `linux-arm64` binary is glibc/musl-linked and
would not execute on bionic even if the installer handed it over. There is no
bionic build to fetch.

**Status: CLOSED upstream.** `2e00b7c` ("engine: the agent SDK reaches the container
claude on the phone") hit the same wall from the other side — *"the agent SDK
bundles a CLI per platform, android is not one of them, and the real claude sits
inside the proot container."* Independent confirmation of the diagnosis, and the
fix is reaching the container's claude, not defeating an installer check.

---

## 2. Antigravity — working standalone, will still fail through Atlan

**They said:** got `agy --version` → 1.1.11 via `pkg install glibc` + `patchelf
--set-interpreter`, run with inline `LD_PRELOAD=""` and `LD_LIBRARY_PATH=...`.
Open question: does `agents.js` pass those env vars?

**Verified: no, deliberately.** `server/src/lib/credblind.js:48` defines `ENV_ALLOW`
as a strict allowlist — `PATH, HOME, USER, LOGNAME, SHELL, PWD, TMPDIR, LANG…,
TERM, TZ, XDG_*`. Children receive *only* that list. `LD_LIBRARY_PATH` and
`LD_PRELOAD` are absent. Their binary works in their shell and dies the moment
Atlan spawns it.

**Good news:** Antigravity is already a first-class engine —
`server/src/agents.js:62,90` — and `agyBin()` (`:179`) looks in `~/.local/bin/agy`
then `/usr/local/bin/agy`, which is where their install landed. No wiring needed.

**Fix (theirs, and strictly better than what they have):**

```sh
patchelf --set-rpath /data/data/com.termux/files/usr/glibc/lib <path-to-agy>
```

`--set-rpath` bakes the library path into the ELF, so no `LD_LIBRARY_PATH` is
needed at runtime. It survives the env allowlist, and it retires the footgun they
already got bitten by — a global `LD_LIBRARY_PATH` pointed at glibc breaks Termux's
own `bash`/`cat`. Their `libc.so.6` symlink shim likely becomes unnecessary too.

**We will not add `LD_*` to `ENV_ALLOW`.** Same class as `NODE_OPTIONS`, which that
file excludes by name with the reasoning written out: arbitrary code injection into
every CLI we launch. Solving a packaging problem by opening a preload vector is a
bad trade.

---

## 3. node-pty — this one is OURS

**They said:** server crash-loops on `Cannot find module
'./prebuilds/android-arm64//pty.node'`; a platform gap, "not anything wrong with
the Atlan app logic."

**Too generous to us.** Verified:

- `server/src/pty.js:1` — `import pty from 'node-pty'`, a **static top-level ESM
  import**. `server/src/index.js:9` statically imports `pty.js`.
- A native-module load failure therefore kills the process during **module-graph
  evaluation, before a single line of server code runs**.
- The `try/catch` in `openPty` cannot help; its own comment says it is a win32
  *spawn* guard, and this fails long before spawn.
- `node_modules/node-pty/prebuilds/` ships **darwin-arm64, darwin-x64, win32-arm64,
  win32-x64 — no Linux prebuild for anyone.** It always compiles from source. On
  this proot phone `build/Release/pty.node` exists, which is exactly why it works
  here and cannot there.

**One optional tab takes down chat, preview, fleet and doctor.** `654aa13` fixed the
*adjacent* bug (tmux missing from PATH) one level higher up; this one is still open.
Note `c1cbb3a` ("a socket message could kill the whole cockpit, and one did") is the
same class — single failure path, whole process. That class has now been fixed
twice; this is the third instance.

**On the intermittency:** the "cockpit is up" banner comes from
`server/src/index.js:904`, so when they see it, node genuinely booted. Alternating
success/failure with one binary usually means **two node versions on PATH** and an
ABI mismatch (`NODE_MODULE_VERSION`), the supervisor's PATH differing from the
interactive shell's. Ask for `which -a node`. Hypothesis, not conclusion.

---

## Proposed fixes

| # | Fix | Whose | Why |
|---|-----|-------|-----|
| 1 | Dynamic-import `node-pty`; Term tab reports unavailable; Doctor names why | ours | A failed native build should cost one tab, not the cockpit. Real on every platform. |
| 2 | Bionic-vs-proot preflight in `bin/atlan-serve.sh` | ours | Doctor is proot-aware (~8 checks) but **needs a running server** — useless in precisely this failure. The launcher has no platform detection today (its 4 Termux mentions are wake-lock/boot only). |
| 3 | Surface the Android path earlier than `SETUP.md:40` | ours | The runbook is correct and buried; nothing in the README quick path warns native Termux is a dead end. |
| 4 | `patchelf --set-rpath` for `agy` | theirs | Survives the env allowlist without weakening it. |

Ordering: 1 and 2 are the ones that convert a lost night into a readable error.
3 prevents the lost night entirely.

---

## What the tester got right

The glibc + patchelf route was rediscovered from first principles with no docs —
that is real work, and it is precisely what proot provides for free. The `agy`
question was the right question to ask and had a non-obvious answer. They offered
to test fixes; they are capable enough to give a clean signal, and `--set-rpath` is
a good first thing to hand back.
