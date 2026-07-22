# Atlan

**A personal AI build cockpit that runs entirely on a phone.** One page at `http://127.0.0.1:4589` puts Claude Code, other agent CLIs, local and cloud models, a live preview sandbox, a real terminal, a code editor, message attachments, an autonomous agent fleet, a worker hierarchy, a Persona+ builder, and one-button APK builds into a single tap-through app. The reference platform is Ubuntu proot under Termux on a phone; it also runs on any Linux/macOS host (see `docs/SETUP.md`). Nothing leaves the machine unless you deliberately build a tunnel.

Built by John Viruet / Mid-Atlantic AI. Licensed **Apache-2.0** — free to use and fork; keep the attribution. Its resident AI, **Atlan**, is the cockpit's living mascot — a calm presence that reacts to what's actually happening as you build.

> **Status (2026-07-22):** M1–M6 plus streaming, password auth, worker hierarchy, attachments, and a code editor all shipped. **151 automated tests green across 10 suites** (see `docs/RECEIPTS.md`). Runs loopback-only by design; the Preflight security gate goes green once you've set a password (it's part of first-run).

---

## Why it exists

Building on a phone normally means a cramped terminal and no feedback loop. Atlan makes the phone a real dev surface: you talk to an agent that edits your code, you *see* the app it's changing, its errors flow back to the agent automatically, you can hand any conversation to the command line and back, you can send agents off to work on budgets while you sleep, and you can build an installable APK from the same screen. It's opinionated toward **honesty** — every capability is labeled for what it actually is, and every dangerous thing has a wall you can see.

---

## The seven tabs, function by function

### ◆ Chat — talk to any engine
- **Project picker** — every folder in your projects directory (configurable, defaults to `/root`) with a `.git` or `package.json`. Everything else (fleet, build, terminal, editor) acts inside the picked project.
- **Streaming + thinking** — replies stream token-by-token; a collapsible panel shows the model's thinking live; a "working…" indicator fires the instant you send.
- **Attachments** — 📎 images/audio/video/files/folders (drag, paste, or reference a path). Images go to vision, files/folders become path references the agent reads, audio/video are routed to a multimodal model (Gemini/OpenAI) and folded into the turn as text.
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

### ✎ Editor — write or review code by hand
- A full code editor (CodeMirror, 122 languages, self-hosted — no CDN). Open a file by path or browse the project tree, edit with syntax highlighting, save to disk.
- **Send to Claude for review** hands the open file to a chat turn with a review prompt. Scoped to the project; credential paths (`.ssh`, keys) are refused.

### ❯_ Term — a real terminal
- `xterm.js` bound to tmux session `atlan-main` in proot. Run anything.
- **Two-way with Termux:** `tmux attach -t atlan-main` mirrors this exact screen both directions. Stored API keys are injected into its environment so CLIs authenticate like the cockpit. The GUI never traps you.

### ❖ Fleet — autonomous agents (four sub-panes)
**Runs.** Describe a job; an agent runs it alone and reports back.
- **Profiles are hard walls, not requests.** *Scout* = read-only (write/exec tools are stripped at the SDK level, provably — not merely denied). *Builder* = files + bash, file writes fenced to the project folder. *Verifier* = reads + runs checks, never edits what it grades. Off-profile tools are simply absent. (Bash *side effects* are gated by the profile's tool set, not OS-sandboxed on proot — see Security.)
- **Budgets HALT — with an honest edge.** The budget is checked between the agent's steps, so at the cap the run halts, but a single in-flight step can overshoot before the halt lands (a tiny-budget run may spend a few thousand tokens past the cap). There is no *unbounded* spend, and the ledger always reports the true number. First turn ≈ 35k tokens (Claude Code's preset system prompt, cached after), so ~50k is the practical floor.
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

**Hierarchy — the worker ladder.** A *job* is a chain of *links*; each link runs a Persona+ command on the cheapest capable tier (local Qwen → cheap cloud → frontier Claude), deterministic checkers gate each output, a checker failure **escalates up the model ladder**, and a human gate pauses where semantic (tier-3) risk concentrates. Hard job budget, blackboard wiring between links, full audit trail of which tier did what. This is the orchestrator-workers pattern: frontier plans/supervises, free local does the bulk.

### ⚒ Build — one-button APK
Runs the proven pipeline in order: `env.sh` → web build (`CAP_BUILD=1`) → Capacitor sync → Gradle using the qemu shim that lets the x86-only `aapt2` run on ARM. Log streams live. Every APK gets a unique filename + visible build stamp (defeats Android's stale-cache), served from the cockpit at `/apk/` (auth-gated). Wants ~2.5 GB free RAM — stop `llama-server` if tight.

### ✚ Doctor — health & security
- **Engine keys** — AES-256-GCM at rest (`.keys.enc` + 0600 secret), shown as last-4 only, never echoed; env vars win over stored keys.
- **Doctor checks** — every fragile proot-boundary piece: JDK 21, Android SDK, aapt2 shim, `claude` binary + auth, tmux, disk, `llama-server`, the push service worker's no-fetch promise, and whether the OS Bash sandbox is available (it isn't in proot — see Security). Green = go; red names exactly what a Termux update broke.
- **Preflight** — the *"safe to expose?"* gate (distinct from "does it work?"): loopback bind, password set, encrypted keys, no plaintext key files, gitignore coverage, no live tunnels. It goes green once you've set a password (first-run) and stored any keys encrypted; the app stays loopback-only until you deliberately expose it.

### Atlan himself
Mood is real state: **calm** (idle — idle is free) · **building** (agents/builds active; orbiting lights = running agents) · **alarmed** (Doctor red or a run needs you) · **proud** (something surfaced). Time-aware greetings, event commentary, and a night dimming pass 22:00–06:30. Canvas-rendered, battery-safe (animation pauses when the tab is hidden). *A steady light while you build.*

---

## Architecture

```
Browser PWA (127.0.0.1:4589, password + httpOnly session cookie)
  Chat · Preview · Editor · Term · Fleet · Build · Doctor · Atlan canvas · xterm.js · CodeMirror
        │  WebSocket (events, PTY)      │  HTTP (REST, static, /apk)
atlan-server (Node 22)
  config.js     env > atlan.config.json > defaults (paths, ports, branding)
  auth.js       password (scrypt) + httpOnly session cookie on /api, /apk, WS; bearer header for automation
  claudeEngine  Claude Agent SDK: streaming + thinking, perms→cards, resume-id handoff
  agents.js     Codex + Gemini CLI headless (JSONL → chat events)
  brains.js     one OpenAI-compat adapter (llama-server / Gemini / OpenAI / DeepSeek)
  fleet.js      profiled, hard-budgeted runs; burn ledger; inbox; top-up resume
  hierarchy.js  job = chain of checker-gated links across the model tier ladder
  routines.js   in-server scheduler; missed-run flags (never auto-fire late)
  personas.js   Persona+ compiler + deterministic checker engine + harness
  attachments.js  upload/reference + audio/video → multimodal model
  files.js      code-editor read/write/tree, scoped + secrets-guarded
  preview.js    proxy local dev server, inject console/error/snapshot hook
  build.js      APK pipeline (env.sh → cap sync → gradle/qemu-aapt2)
  keys.js       AES-256-GCM key store   doctor.js/preflight.js  health+gate
  push.js       Web Push (VAPID)        pty.js  tmux-backed PTYs
```

Front-end is deliberately **no-build vanilla** (no vite/bundler process, no app service worker) — fewer moving parts to break in proot, and no stale-SW landmine.

## Run it

```bash
npm install
node server/src/index.js          # http://127.0.0.1:4589 (loopback)
```
On first load you **set a password** (8+ chars); a long-lived httpOnly session cookie keeps you logged in across restarts. Take the guided tour (the `?` button reopens it and the searchable handbook any time). See `docs/SETUP.md` for the full clone-and-run guide.

## Test it

```bash
npm test                          # boots a throwaway instance, runs every suite, writes docs/RECEIPTS.md
```
Ten suites: `unit` · `function` (+ data-store durability) · `connection` (WS/PTY) · `security` (pentest) · `adversarial` · `hierarchy` · `attachments` · `editor` · `ui.spec` · `tour.spec`. Tests run on a separate throwaway instance (own port + temp state), so they never touch your live cockpit. The `e2e` suite makes real Claude runs and is opt-in via `RUN_PAID=1`.

## Security posture (honest)

Loopback-only. Human access is a **password** (scrypt-hashed) plus an httpOnly, `SameSite=Strict` session cookie; automation uses a bearer header (never a URL). Failed logins are throttled. Preflight is the gate to *ever* exposing this; exposure remains a deliberate act and should go through **Cloudflare Tunnel + Access, never a bare port** (`docs/SECURITY.md`).

Accepted, documented limits (nothing hidden):
- **Bash isn't OS-sandboxed on proot.** Claude Code's OS-level Bash sandbox needs kernel namespaces (bubblewrap) or Landlock, which proot doesn't provide. So a builder/verifier agent's Bash is gated by its *tool profile*, not OS-confined within the machine — though proot itself confines everything to the Termux app sandbox (an agent can't escape to the phone). Run untrusted/autonomous work on a native Linux host to get the real OS sandbox. The Doctor shows which you have.
- The preview proxy (:4590) is unauthenticated loopback.
- Cloud "brains" and multimodal delegation send your prompt/media to that provider under its own ToS.

## Docs
- `docs/SETUP.md` — clone-and-run guide for a fresh instance
- `docs/SPEC.md` — full spec + milestone history
- `docs/HANDOFF.md` — onboarding + recovery playbook (for John or a future maintainer)
- `docs/RECEIPTS.md` — verbatim output of every test
- `docs/SECURITY.md` — exposure model, why Workers can't host it, iOS reality
- `docs/engines/` — per-engine research briefs (Claude, Codex, Gemini, local)

## License

Apache-2.0 (`LICENSE`, `NOTICE`). Free to use, modify, and distribute — the one requirement is preserving the attribution to John Viruet / Mid-Atlantic AI. 🧇
