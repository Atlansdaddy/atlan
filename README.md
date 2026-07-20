# Atlan

**A personal AI build cockpit that runs entirely on a phone.** One page at `http://127.0.0.1:4589` puts Claude Code, other agent CLIs, local and cloud models, a live preview sandbox, a real terminal, an autonomous agent fleet, a Persona+ builder, and one-button APK builds into a single tap-through app — served from Ubuntu proot under Termux on a Samsung S24 Ultra. Nothing leaves the phone unless you deliberately build a tunnel.

Built by John Viruet / Mid-Atlantic AI. Personal tool first; shared to the community when it's good. Its resident AI, **Atlan**, is the cockpit's living mascot — a calm presence that reacts to what's actually happening as you build.

> **Status (2026-07-20):** M1–M6 shipped. 124 automated tests green across 8 suites (see `docs/RECEIPTS.md`). Preflight security gate all-green. Runs loopback-only by design.

---

## Why it exists

Building on a phone normally means a cramped terminal and no feedback loop. Atlan makes the phone a real dev surface: you talk to an agent that edits your code, you *see* the app it's changing, its errors flow back to the agent automatically, you can hand any conversation to the command line and back, you can send agents off to work on budgets while you sleep, and you can build an installable APK from the same screen. It's opinionated toward **honesty** — every capability is labeled for what it actually is, and every dangerous thing has a wall you can see.

---

## The six tabs, function by function

### ◆ Chat — talk to any engine
- **Project picker** — every folder in `/root` with a `.git` or `package.json`. Everything else (fleet, build, terminal) acts inside the picked project.
- **Engine switcher**, four honest groups:
  - **Claude Code (agent)** — `fable-5`, `opus-4.8`, `sonnet-5`, `haiku-4.5`. Real hands: reads/edits files, runs tools, builds. Permission-carded.
  - **Agent CLIs** — Codex and Gemini CLI, running headless full-auto in your repo (all-or-nothing approvals; Claude stays the careful, card-gated primary).
  - **On-phone (free)** — local models via `llama-server` (chat only).
  - **Cloud brains** — Gemini/OpenAI/DeepSeek via one OpenAI-compatible adapter (chat only; they'll tell you they have no hands).
  - Unavailable options are disabled and say exactly what they need.
- **Permission cards** — when Claude wants a risky action you get Allow/Deny. Deny is always safe; the agent is told why and adapts.
- **Session handoff** — after each turn a line shows cost + session id; tap to copy `claude --resume <id>` and continue the *same* conversation in any terminal.
- **Auto-attached preview context** — console errors and 📸 snapshots from the Preview tab ride along on your next message automatically.

### ▣ Preview — see the app you're building
- Point at any local dev server (`127.0.0.1` only — a deliberate SSRF boundary), rendered through a proxy that injects a watcher.
- **Console strip** mirrors the app's logs. **Errors** queue and auto-attach to Claude's next turn with file:line — you never copy-paste a stack trace again.
- **📸 Snapshot** saves a real PNG the agent reads with vision ("the button overlaps the header" becomes verifiable).
- HMR / live-reload passes straight through.

### ❯_ Term — a real terminal
- `xterm.js` bound to tmux session `atlan-main` in proot. Run anything.
- **Two-way with Termux:** `tmux attach -t atlan-main` mirrors this exact screen both directions. Stored API keys are injected into its environment so CLIs authenticate like the cockpit. The GUI never traps you.

### ❖ Fleet — autonomous agents (three sub-panes)
**Runs.** Describe a job; an agent runs it alone and reports back.
- **Profiles are hard walls, not requests.** *Scout* = read-only (write/exec tools are stripped at the CLI level, provably — not merely denied). *Builder* = files + bash, writes fenced to the project folder. *Verifier* = reads + runs checks, never edits what it grades. Off-profile tools are simply absent.
- **Budgets HALT.** At the cap every tool call is refused and the run stops — no runaway spend, by construction. (First turn ≈ 35k tokens for the system-prompt cache write, so 50k is the practical floor.)
- **Top-up.** A budget-halted run resumes its *exact* session with fresh budget — nothing lost.
- **Inbox.** Report cards carry live burn bar, tokens/cost, denials, final report; they survive restarts (`.fleet/history.jsonl`). Chat gets a ping line; the Fleet tab shows an unseen-count badge.
- **Push** — enable once (`🔔`) for real notifications with the app closed, via a push-only service worker (no fetch handler ⇒ can never serve a stale app; Doctor asserts this).
- **KILL ALL** — immediate, always present.

**Routines.** Scheduled fleet runs: every-N-minutes or daily-at-HH:MM. Each fire is a normal budgeted run labeled `routine:<name>` in the inbox. **Missed-run rule:** if the server was off past a slot, the routine is flagged *missed* and does nothing until you tap "run late" — a rebooting phone never spends by surprise. Global pause; per-routine enable/disable.

**Builder — Persona+ compiled to real agent parts.**
- A **persona** (NAME / FOCUS / BIO / SKILLS / NO_NOS / TEMPLATE / INSTRUCTIONS) compiles into the agent's system prompt, plus a fleet profile.
- A **structured command** compiles into a typed tool: VARIABLES → JSON-schema parameters; TEMPLATE fields → a constrained JSON answer (models with constrained decoding literally can't return the wrong shape).
- **Checkers** are deterministic assertions graded by *code, never by a model*: `enum ∈`, `range`, `regex`, `⊆ input-variable` (no invented values), `max-length`, and `arith` formulas (`total = qty*price`) evaluated by a safe parser with no `eval` reachable.
- **Test harness** runs any command against a chosen engine (free local first), shows every checker's pass/fail with evidence, and on failure **escalates** the identical command to a Claude fleet run in one tap — the small-model-does-the-reps, frontier-catches-the-hard-5% ladder.

### ⚒ Build — one-button APK
Runs the proven pipeline in order: `env.sh` → web build (`CAP_BUILD=1`) → Capacitor sync → Gradle using the qemu shim that lets the x86-only `aapt2` run on ARM. Log streams live. Every APK gets a unique filename + visible build stamp (defeats Android's stale-cache), served from the cockpit at `/apk/` (token-gated). Wants ~2.5 GB free RAM — stop `llama-server` if tight.

### ✚ Doctor — health & security
- **Engine keys** — AES-256-GCM at rest (`.keys.enc` + 0600 secret), shown as last-4 only, never echoed; env vars win over stored keys.
- **Doctor checks** — every fragile proot-boundary piece: JDK 21, Android SDK, aapt2 shim, `claude` binary + auth, tmux, disk, `llama-server`, and the push service worker's no-fetch promise. Green = go; red names exactly what a Termux update broke.
- **Preflight** — the *"safe to expose?"* gate (distinct from "does it work?"): loopback bind, auth token, encrypted keys, no plaintext key files, gitignore coverage, no live tunnels. **All green today**, and the app still stays loopback-only until you choose otherwise.

### Atlan himself
Mood is real state: **calm** (idle — idle is free) · **building** (agents/builds active; orbiting lights = running agents) · **alarmed** (Doctor red or a run needs you) · **proud** (something surfaced). Time-aware greetings, event commentary, and a night dimming pass 22:00–06:30. Canvas-rendered, battery-safe (animation pauses when the tab is hidden). *A steady light while you build.*

---

## Architecture

```
Browser PWA (127.0.0.1:4589, token-gated)
  Chat · Preview · Term · Fleet · Build · Doctor · Atlan canvas · xterm.js
        │  WebSocket (events, PTY)      │  HTTP (REST, static, /apk)
atlan-server (Node 22, proot)
  auth.js       token gate: /api, /apk, WS — timing-safe, brute-throttled
  claudeEngine  Claude Agent SDK: perms→cards, usage, resume-id handoff
  agents.js     Codex + Gemini CLI headless (JSONL → chat events)
  brains.js     one OpenAI-compat adapter (llama-server / Gemini / OpenAI / DeepSeek)
  fleet.js      profiled, hard-budgeted runs; burn ledger; inbox; top-up resume
  routines.js   in-server scheduler; missed-run flags (never auto-fire late)
  personas.js   Persona+ compiler + deterministic checker engine + harness
  preview.js    proxy local dev server, inject console/error/snapshot hook
  build.js      APK pipeline (env.sh → cap sync → gradle/qemu-aapt2)
  keys.js       AES-256-GCM key store   doctor.js/preflight.js  health+gate
  push.js       Web Push (VAPID)        pty.js  tmux-backed PTYs
```

Front-end is deliberately **no-build vanilla** (no vite/bundler process, no app service worker) — fewer moving parts to break in proot, and no stale-SW landmine.

## Run it

```bash
cd /root/atlan
node server/src/index.js          # http://127.0.0.1:4589 (loopback)
```
First boot generates `.auth-token` (0600). Open the app, paste the token (`cat /root/atlan/.auth-token`), take the guided tour (the `?` button reopens it and the searchable handbook any time).

## Test it

```bash
npm test                          # boots if needed, runs all 8 suites, writes docs/RECEIPTS.md
node test/run-all.mjs             # same, against an already-running server
```
Suites: `unit` · `function` (+ data-store durability) · `connection` (WS/PTY) · `security` (pentest) · `adversarial` · `e2e` · `ui.spec` · `tour.spec`.

## Security posture (honest)

Loopback-only; all API/WS/APK surfaces token-gated (timing-safe, 20-bad-tokens/min throttle). Preflight is the gate to *ever* exposing this, and it's green — but exposure remains a deliberate act and should go through **Cloudflare Tunnel + Access, never a bare port** (`docs/SECURITY.md`). Accepted, documented gaps: the preview proxy (4590) is unauthenticated loopback; builder/verifier Bash is unscoped *within* the project folder; cloud "brains" see your prompts under their own ToS.

## Docs
- `docs/SETUP.md` — clone-and-run guide for a fresh instance
- `docs/SPEC.md` — full spec + milestone history
- `docs/HANDOFF.md` — onboarding + recovery playbook (for John or a future maintainer)
- `docs/RECEIPTS.md` — verbatim output of every test
- `docs/SECURITY.md` — exposure model, why Workers can't host it, iOS reality
- `docs/engines/` — per-engine research briefs (Claude, Codex, Gemini, local)
