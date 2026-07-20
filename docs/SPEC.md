# ATLAN — phone-native AI cockpit / IDE

Mid-Atlantic AI · John Viruet. Personal tool first; shared to the community when it's good.
One sentence: **Claude Code in a phone IDE with a live preview sandbox, Mid-Atlantic branding, Atlan (the logo bot) alive inside it, every frontier + local engine pluggable, and a CLI you can drop to at any time.**

## Architecture

```
┌─ Browser (PWA, 127.0.0.1:4589) ────────────────────────────┐
│  Chat · Preview(iframe sandbox) · Fleet · Build · Doctor    │
│  Atlan mood engine (canvas) · xterm.js Terminal pane        │
└──────────────▲ WebSocket (events) ▲ HTTP (files/assets) ────┘
┌─ atlan-server (Node 22, proot) ─────────────────────────────┐
│ sessions/   tmux-backed PTYs (node-pty) — every engine CLI  │
│             runs inside tmux ⇒ attachable from Termux ANY   │
│             time; xterm.js renders the same tmux session    │
│ engines/    claude.ts   → @anthropic-ai/claude-agent-sdk    │
│                           (structured: perms→cards, usage,  │
│                            subagents, hooks; resume-id      │
│                            handoff to `claude --resume`)    │
│             codex.ts    → Codex CLI headless (research TBD) │
│             gemini.ts   → Gemini CLI headless (research TBD)│
│             openaiCompat.ts → ONE adapter, base-URL swap:   │
│                           llama-server :8080 · x.ai ·       │
│                           deepseek · mistral · moonshot ·   │
│                           dashscope (+ ollama if ever)      │
│ preview/    proxy target dev server into sandboxed iframe;  │
│             inject console/error hook → WS → engine context │
│             snapshot endpoint (iframe PNG → session image)  │
│ build/      APK pipeline runner (proven recipe: env.sh,     │
│             qemu-aapt2, CAP_BUILD=1, unique filename,       │
│             build stamp) + http.server install link         │
│ doctor/     boundary checks (JDK, SDK, aapt2 daemon probe,  │
│             claude symlink, tmux, disk, keys) — ALL         │
│             proot-fragile logic lives here, nowhere else    │
│ mcp/        atlan MCP server exposing preview/build/doctor  │
│             tools → works in EVERY engine (MCP is the       │
│             cross-engine standard now)                      │
└─────────────────────────────────────────────────────────────┘
```

## The two session kinds
1. **Structured (Claude Code via Agent SDK)** — first-class: permission cards, tool chips, token/cost events, subagent fleet, hooks enforce budget halts. CLI↔GUI switch = session-id handoff (`~/.claude/projects/<cwd>/<id>.jsonl` shared store; turn-based, not simultaneous — GUI shows "open in CLI" state).
2. **PTY (everything else + raw claude)** — engine CLI inside tmux; GUI renders via xterm.js; `tmux attach -t atlan-<name>` from Termux = the escape hatch. GUI parses what it can (JSON output modes where CLIs offer them).

## Engine roster (docs/engines/*.md for verified facts)
- Claude Code (agent, primary) · Codex CLI (agent) · Gemini CLI (agent) · Qwen Code / Vibe / Kimi Code (agent CLIs, later)
- API brains: OpenAI, Gemini, Grok, DeepSeek, Mistral, Kimi — one OpenAI-compat adapter
- Local free: llama-server (Qwen3.5-2B upgrade path), LiteRT Gemma 4 E2B app-side later

## Identity
- Brand: Mid-Atlantic AI palette (from midatlantic.ai): navies #03203D→#1B4F8A (depth ladder), teals #6BD4D8/#89EBEF (bioluminescence), coral #FF6723/#FF8A4F (hot actions), #D2D2DB neutrals.
- Atlan = the logo bot (web/public/img/atlan-bot.svg); mood engine driven by real state (idle/building/alarmed/proud). (Personal origin story lives in the author's notes, not in the shipped product.)

## Guardrails (from John's OpenClaw/Hermes teardown — non-negotiable)
- Hard per-run token budget → PreToolUse hook halts, not warns
- Verify agents in separate contexts; deterministic checkers first; nothing grades its own work
- Nothing runs unless spawned or scheduled; idle = zero tokens
- Per-agent permission profiles; outbound always gated through John

## Milestones
- **M0 scaffold** ✓ repo, tokens, docs
- **M1 cockpit-claude** ✓ server + WS + Chat live against Agent SDK, permission cards, session resume, xterm.js tmux pane. *Usable daily from here.*
- **M2 preview** ✓ iframe proxy + console capture + error auto-attach + snapshot-to-session
- **M3 build+doctor** ✓ APK button wired to recipe, doctor checks real; keys AES-256-GCM; preflight gate
- **M4 engines** ✓ Codex + Gemini CLIs headless + openai-compat brains adapter + switcher UI; all authed E2E
- **M5a fleet core** ✓ profiled runs, hard budgets, burn ledger, KILL ALL
- **M5b reports/needs-you** ✓ push-only SW, chat ping + nav badge, durable inbox, budget top-up resume
- **M5c routines** ✓ in-server scheduler, missed-run flags (never auto-fire late), pause, run-late
- **M5d Persona+ builder** ✓ persona + structured-command builders, deterministic checker engine, compile viewer, test harness with escalation ladder
- **M6 atlan-alive** ✓ mood engine on real state (halo canvas, orbiting agents), time greetings, night dimming
- **Auth layer** ✓ token-gated /api + /apk + WS (timing-safe, throttled); preflight blocker cleared — 0 blockers
- **Onboarding** ✓ 27-step in-app spotlight tour + searchable handbook + `docs/HANDOFF.md`
- **Test campaign** ✓ 124 tests / 8 suites green; `docs/RECEIPTS.md` auto-generated

### Backlog (post-handoff)
- Persona in Chat (not just fleet/routines); M5d worker hierarchy (frontier writes scope → local Qwen executes under grammar constraint → checkers verify → escalate)
- Builder/verifier Bash sandboxing (currently unscoped within project — honest caveat in-app)
- Atlan-as-APK dogfood wrapper; Cloudflare Tunnel + Access exposure (only when John chooses)
