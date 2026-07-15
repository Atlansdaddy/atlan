# Engine: Google Gemini

Verified 2026-07-15 (agent research pass — sources in session transcript).

## Headline: Gemini CLI free login is DEAD (2026-06-18); the open-source CLI + API key is the play
- Google killed the free/Pro/Ultra "Sign in with Google" backend for Gemini CLI; successor = **Antigravity CLI (`agy`)**, closed-source Go binary.
- **BUT** open-source `@google/gemini-cli` (Apache-2.0, ~v0.49.x, pure Node → arm64/proot fine) still works with `GEMINI_API_KEY` (AI Studio) or Vertex. Unpaid key ≈ 250 req/day Flash-only (docs; conflicting reports — test empirically).

## Wiring plan (M4)
- `npm i -g @google/gemini-cli` → headless: `gemini -p "..." --output-format stream-json` (JSONL: init/message/tool_use/tool_result/error/result; exit 0/1/42/53). Approval: `--yolo` / `--approval-mode` (verify flag on installed version).
- MCP: `~/.gemini/settings.json` → `mcpServers` (command/args/env or url/httpUrl+headers) → our atlan MCP tools plug in.
- Sandbox OFF by default (Docker/Podman/bwrap would all break in proot — leave off).
- **Antigravity `agy`: treat as experimental engine.** Known non-TTY stdout-drop bug (emits nothing when piped) — our tmux PTY layer incidentally solves exactly that. TCMalloc 48-bit VA assumption can crash on 39-bit phone kernels (S24 risk; community patcher exists). Free tier ~20 req/day. No resume id in print mode. Park until stable or needed.

## Models (July 2026)
- **gemini-3.5-flash** — frontier, GA, 1M ctx, $1.50/$9.00; computer-use built in (preview); free tier limited.
- gemini-3.1-pro-preview $2/$12 (no free tier); gemini-3-flash-preview $0.50/$3 (free tier ~10RPM/1500RPD per 3rd-party); flash-lite $0.25/$1.50.
- Gemini 3.5 Pro: announced, not shipped (unverified).

## Agentic API surface
- **Interactions API** (GA Jun 2026): `/v1beta/interactions` replaces generateContent as primary; server-side state (`previous_interaction_id`), `background=true`, step traces.
- **Managed Agents**: Google-hosted sandbox agents, remote MCP, Deep Research built-in.
- Built-in tools (combinable on Gemini 3+): Search grounding, Maps grounding, code execution, URL context, file search, computer use.
- ADK v2 (python) / `@google/adk` (npm); A2A v1.0; Vertex rebranded "Gemini Enterprise Agent Platform".

## Flags
Free-tier exact quotas conflict (250 vs 1500 RPD); unpaid-key auth on current CLI builds needs an empirical test: `GEMINI_API_KEY=... gemini -p "hi" --output-format json`; agy-in-proot untested.
