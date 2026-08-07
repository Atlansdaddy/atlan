# Atlan research sweep — 2026-07-25

> **POINT-IN-TIME RECORD — research notes, July 2026. Model rows are a snapshot; the code is ground truth.** Kept as evidence and annotated, never
> rewritten (see `DOC-STATUS-CONVENTION.md`). For current state read
> `ARCHITECTURE.md` and `SECURITY.md`.

Three parallel research passes (Anthropic docs · other frontier labs · fringe-with-receipts) plus live testing of the new local model through every Atlan subsystem. Everything below is doctrine-filtered: probabilistic workers inside deterministic walls, budgets that halt, checkers that are code, ladder that escalates on checker failure only.

## A. The "advisor" — found it

Anthropic ships an **Advisor Tool** (platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool.md): a cheap executor model consults a stronger advisor model mid-generation at decision points; the advisor reads the transcript and returns strategy. Claude Code exposes it as `advisorModel` (code.claude.com/docs/en/advisor.md), Anthropic API only.

**Atlan fit:** this is the tier ladder *inside one run* — instead of failing checkers then escalating a whole link, the executor asks up-tier for guidance at the moment of uncertainty and keeps executing cheap. Plugs into ClaudeSession (Agent SDK options) and, pattern-wise, into hierarchy links as an optional `advisor` field per link. It composes with, not replaces, checker-gated escalation: advisor for *plan quality*, checkers for *output truth*.

## B. Top adoptions, merged across all three reports (payoff × proof ÷ effort)

1. **llama-server prompt-cache audit** — stable prompt prefixes (no timestamps/volatile text at position 0), `--cache-reuse 256`, slots sized to real concurrency. Free latency win; a single mutating prefix silently disables all KV reuse today. (llama.cpp discussions 13606, 20574)
2. **`--n-cpu-moe` sweep** on the 4060 Ti — tune the split to free VRAM for bigger KV/context on the 35B-A3B. One evening, pin result in the unit. (HF Doctor-Shotgun MoE offload guide)
3. **Atlan-bench** — 15–30 containerized real tasks, each with a deterministic test suite (Terminal-Bench/SWE-bench pattern). Turns tier-ladder policy into an empirical table; every model/prompt change gets re-scored. The single most doctrine-aligned investment.
4. **Prompt caching on the Claude tier** — cache_control on the stable system/tool blocks; 1h TTL env; track cache_read vs input tokens in the Fleet cost view. 90% off cached tokens.
5. **Advisor tool** (A above) — executor+advisor per fleet profile; cheap runs that self-consult instead of failing upward.
6. **DeepSeek prefix-stable prompts** — its disk cache is exact-prefix-from-zero; layout system+tools first, volatile last; use its `prompt_cache_hit_tokens` usage fields to feed budget halts with vendor truth. Cache hits ≈ 1/10 input price.
7. **`strict: true` structured outputs + machine-readable refusal** on every OpenAI-compat tier — deletes malformed-JSON checker failures at the source (OpenAI evals: 100% schema compliance).
8. **Two-pass constrained decoding on the free tier** — let the model reason unconstrained, constrain only the final answer segment; papers document a 10–30% quality tax from tight grammars plus a tool-call-suppression "constraint tax". (Our bench proved the sibling bug: qwen3.6 + grammar + thinking = token-cap death.)
9. **DSPy/GEPA offline prompt optimization scored by Atlan's own checkers** — the checkers ARE the metric function, so adoption is unusually cheap; production receipts at Shopify/Replit/Databricks. Optimize the free tier's first-pass rate → fewer paid escalations. Compile once, freeze artifact.
10. **Structured outputs / cost tracking / sessions in the Agent SDK** — per-model usage to the Fleet dashboard, session resume across cockpit restarts, output_format schemas for anything the SDK returns to checkers.
11. **One local MCP server** exposing checkers + budget ledger + project context to all three CLIs (Claude/Codex/Gemini) — one integration instead of three shims; MCP is the industry-wide standard now (Linux Foundation, all majors native).
12. **Aider-style tree-sitter repo-map** — deterministic codebase skeleton as context; raises free-tier hit rate with zero retrieval model.
13. **Codex sandbox×approval matrix** — two independent axes (sandbox capability × approval frequency) per tier + a single ToolRouter chokepoint; the open-source Rust reference is readable. Formalizes the human gate.
14. **`GEMINI.md` as a written contract** for the Gemini CLI secondary; `thinking_budget` = vendor-enforced hard budget (doctrine-native knob). Same idea: `reasoning_effort` on OpenAI-compat tiers is a ladder rung without a model switch.

## C. Evidence-based non-adoptions (receipts in the full reports)

- **Speculative decoding**: benchmarked *negative* on exactly our model class + GPU tier (Qwen3.6-35B-A3B, consumer cards). Re-test only on a large dense model.
- **A2A protocol**: real standard, wrong problem (inter-org agent federation; Atlan is single-operator).
- **Mistral/xAI hosted agents**: execution loop leaves our walls; per-invocation costs can't be pre-bounded.
- **NeMo Guardrails / Guardrails AI as trust anchors**: probabilistic (LLM+vector similarity) underneath — borrow only the named input-rail/output-rail *shape*.
- **mem0 / Letta frameworks**: model-summarizing-model conflicts with doctrine; adopt the *pattern* (small deterministic always-in-context project card + file/grep retrieval), not the stack.
- **Open Interpreter**: no verified current production adoption.
- **Llama Stack**: strategic risk, no unique win over llama.cpp + OpenAI-compat conventions.

## D. Killing the WSL babysitting (research verdict)

Root cause has names: `instanceIdleTimeout` (default 15s — systemd services don't count as "alive", microsoft/WSL#13416, open) and `vmIdleTimeout` (60s). A Windows service can NEVER hold WSL — session 0 is walled off (WSL#9231, open) — which is why only fragile at-logon tasks existed.

**Applied now (belt + suspenders, no babysitter):**
- `%UserProfile%\.wslconfig`: `vmIdleTimeout=-1` + `[general] instanceIdleTimeout=-1`
- In-distro `wsl-keepalive.service`: systemd spawns a Windows-side `wsl.exe --exec sleep infinity` via interop — the distro holds ITSELF open and self-heals; needs nothing on the Windows side after first start.
- The old scheduled task stays only as the cold-boot starter; hardened triggers (logon + unlock + resume-from-sleep, retry ×3) are the remaining recommendation.

**Roadmap (the real answer): split architecture.** llama-server (official Windows CUDA release zips — no toolkit needed, slightly faster than GPU-PV) + cockpit Node as real Windows services (Servy/WinSW; services are fine for plain exes) + Tailscale `--unattended` — all boot-persistent with nobody logged in. WSL then becomes an **on-demand execution sandbox**: `wsl -d atlan-sandbox -- bash -lc <cmd>` per agent command against a stripped distro (interop off, /mnt automount off → agents can't even see C:). Cold start ~1–2s, VM free to idle out — *nothing needs keeping alive anymore*, and isolation is better than today. This is the "it should just work out of the box" story: an `atlan setup-windows` script writes two config files, installs two services, registers one task.

**Native no-WSL tier (documented honestly):** the Codex-on-Windows model — restricted token + Job Object + file allowlists + elevated firewall on a sandbox user. Works on any Home box, full native CUDA, but it's a *policy* boundary, not a *kernel* boundary; label it compatibility mode, never the security tier. Windows Sandbox is disqualified (non-persistent, CUDA broken); Docker/Podman are WSL2 underneath (the irony).

**Optional strongest rung:** remote execution (E2B/Daytona/Modal microVMs) as an opt-in `execution: remote` target — someone else's kernel, zero local sandbox setup, costs money, agents lose local files.

## E. Live test results (2026-07-25, qwen36-35b-a3b active)

- **Hierarchy, real local tier**: 3/3 checker-gated runs PASS (enum+arith+not-empty), correct math every case, ~1.5–2.5s / ~237 tokens per link.
- **Persona+ harness, local**: PASS (passed=true, correct line_total).
- **Chat engines over the real WS**: local brain ✓, codex agent ✓ (subscription login), Claude Agent SDK session ✓ (full stream: session/thinking/delta/result).
- **Fix found by testing**: hierarchy.js and personas.js had their own local-engine calls WITHOUT the qwen3.5/3.6 thinking off-switch — patched (`chat_template_kwargs.enable_thinking:false`, local only), same as brains.js.
- Fleet paid E2E: run separately (RUN_PAID=1).
