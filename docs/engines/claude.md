# Engine: Claude Code (primary — the only engine wired for v0.1)

Verified 2026-07-14 against code.claude.com docs (agent research pass).

## Integration surface
- **SDK:** `@anthropic-ai/claude-agent-sdk` — `query(prompt|AsyncIterable, options)` → async generator of structured messages.
- **Streaming input** = `prompt: AsyncIterable<{type:"user", text}>`; mid-stream `q.setModel("sonnet")`.
- **Permissions → GUI cards:** `canUseTool(toolName, input, {decisionReason})` async callback → `{approved:bool}`. Permission modes: default | dontAsk | acceptEdits | bypassPermissions | plan | auto.
- **Tool events:** assistant messages contain `content[].type==="tool_use"` (name, input, id — dedupe by message id).
- **Cost/usage:** per-step `message.usage` tokens; final `result.total_cost_usd` + `result.modelUsage[model]` breakdown. → feeds the burn meter + switcher usage strip.
- **Subagents:** `agents:{name:{description,prompt,tools,model}}` + `"Agent"` in allowedTools. → Fleet screen.
- **Hooks:** `hooks:{PreToolUse:[{matcher,hooks:[cb]}],...}` — programmatic; PreToolUse can allow/deny/rewrite input. → budget halt enforcement point.
- **MCP:** `mcpServers:{name:{command,args,env}|{type:"http",url,headers}}` + allowlist `mcp__name__*`.

## CLI ↔ GUI switching (THE feature)
- Sessions live at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` — same store for SDK and CLI.
- GUI (SDK) captures `session_id` → user runs `claude --resume <id>` in Termux → later GUI resumes same id via `resume: sessionId`.
- NOT simultaneous attach — it's turn-based handoff (one process per turn). GUI shows "session open in CLI" state when it detects the handoff.
- Headless CLI: `claude -p --output-format stream-json --resume <id> --permission-mode ... --allowedTools ...`.

## Auth
- Precedence: ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY > apiKeyHelper > CLAUDE_CODE_OAUTH_TOKEN > subscription OAuth (`~/.claude/.credentials.json`, 0600).
- John already logged in via subscription in proot → SDK inherits it. BYOK field = optional ANTHROPIC_API_KEY override.
- `claude setup-token` → 1-year token if we ever need env-only auth.

Docs: code.claude.com/docs/en/agent-sdk/typescript.md, /headless.md, /sessions.md, /permissions.md, /mcp.md, /authentication.md, /cost-tracking.md
