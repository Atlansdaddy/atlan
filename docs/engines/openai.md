# Engine: OpenAI / Codex

Verified 2026-07-15 (agent research pass — sources in session transcript).

## Codex CLI — wires in cleanly, and there's a better door than exec
- Install: `npm i -g @openai/codex` (wrapper over Rust binary) — releases ship **`codex-aarch64-unknown-linux-musl`** (static, no glibc dep → proot-safe). Latest rust-v0.144.4 (2026-07-14).
- **Headless:** `codex exec --json "task"` → JSONL events (`thread.started`, `turn.started`, `item.*`, `turn.completed` w/ token usage). `codex exec resume --last`; `--output-schema`; stdin piping; `--ephemeral`.
- **proot reality:** Linux sandbox = bwrap/user-namespaces → fails in proot. Documented escape: `--dangerously-bypass-approvals-and-sandbox` (`--yolo`) or `sandbox_mode="danger-full-access"` + `approval_policy="never"` in `~/.codex/config.toml` — officially recommended for externally-isolated environments, which proot is. Test on device: `codex exec --yolo "echo ok"`.
- **`codex app-server` — the best driver surface for Atlan:** long-lived JSON-RPC 2.0 over stdio (JSONL) — same protocol as the VS Code extension; experimental `--listen ws://` transport; typed schema via `codex app-server generate-ts`. Threads, deltas, diffs, approval callbacks → maps 1:1 onto our permission cards. Prefer this over exec for M4.
- MCP client: `codex mcp add ...` / config.toml `[mcp_servers.*]` (stdio + HTTP) → atlan MCP tools plug in.
- Auth: `codex login --device-auth` (ChatGPT plan, headless-friendly) or `CODEX_API_KEY` env.

## Models (July 2026)
- **GPT-5.6 family GA 2026-07-09**, all 1.05M ctx / 128K out: `gpt-5.6-sol` $5/$30 (flagship, Codex default), `gpt-5.6-terra` $2.50/$15, `gpt-5.6-luna` $1/$6. Reasoning effort minimal→xhigh. >272K input = 2x/1.5x billing; cache reads 90% off.
- `gpt-5.3-codex` ($1.75/$14) still usable via Responses API w/ API key.

## Responses API + Agents SDK
- Responses API is canonical (Assistants API sunsets 2026-08-26). Hosted tools on plain API key: web search $10/1k, file search, code interpreter + hosted shell ($0.03–$1.92/20min), computer use, remote MCP (free). GPT-5.6 adds programmatic tool calling (model writes code that calls tools).
- Agents SDK: python `openai-agents` v0.18.x with harness + sandboxed execution adapters; TS `@openai/agents` lags. `@openai/codex-sdk` npm wrapper exists (details unverified).
- AgentKit's Agent Builder discontinued Nov 2026 — don't build on it.

## Flags
codex-sdk API details unverified; codex-as-MCP-server status unclear; computer-use tier gating unverified; codex under proot = inference from bwrap requirement (empirical test needed).
