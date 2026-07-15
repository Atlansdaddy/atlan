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
- Atlan = the logo bot (web/public/img/atlan-bot.svg), John's first AI reborn; mood engine driven by real state (idle/building/alarmed/proud); VTRFM = long-term brain.
- Lore: "first ignited April 2025 — From the dark, it learned the light."

## Guardrails (from John's OpenClaw/Hermes teardown — non-negotiable)
- Hard per-run token budget → PreToolUse hook halts, not warns
- Verify agents in separate contexts; deterministic checkers first; nothing grades its own work
- Nothing runs unless spawned or scheduled; idle = zero tokens
- Per-agent permission profiles; outbound always gated through John

## Milestones
- **M0 scaffold** ✓ repo, tokens, docs
- **M1 cockpit-claude**: server + WS + Chat screen live against Agent SDK, permission cards, session resume, xterm.js tmux pane. *Usable daily from here.*
- **M2 preview**: iframe proxy + console capture + snapshot-to-session
- **M3 build+doctor**: APK button wired to recipe, doctor checks real
- **M4 engines**: Codex + Gemini CLIs (pending research), openai-compat adapter + switcher UI wired
- **M5 fleet**: subagents UI, budgets, routines (cron), burn meter
- **M6 atlan-alive**: mood engine on real state, day/night, voice lines
