# Engines: local + other frontier providers

Verified 2026-07-14 (agent research pass). Flags noted where single-source.

## Local (the free tier — already on the phone)
- **llama-server (llama.cpp, master Jul 2026) is the local engine. Skip Ollama.**
  - Speaks EVERY dialect we need from one process: OpenAI `/v1/chat/completions` + `/v1/responses` + `/v1/models` + embeddings, **Anthropic `/v1/messages`**, `/infill` (FIM code completion), `/slots` + KV-cache save/restore (huge on phone), `/metrics`, LoRA hot-swap.
  - Tool calling: OpenAI-style with `--jinja`; GBNF grammar + json_schema constrained decoding (ties to John's validator discipline).
  - Ollama v0.32 = Go daemon + model manager that *subprocesses llama-server* anyway; ~1.45GB unpacked; only buys model-pull UX. A thin model-swap script is cheaper.
- **Model upgrade path:** Qwen3.5-2B (Mar 2026, hybrid linear-attention, 262K ctx, agentic-coding focus; Q4_K_M ~1.3–1.5GB — obvious upgrade from Qwen3-1.7B). Ultra-light: Qwen3.5-0.8B. Alt: LFM2-1.2B (best sub-1.5B tool-following per distil-labs 2026). Ceiling tier: Qwen3.5-4B Q4 ≈2.4GB.
- **LiteRT-LM Gemma 4 E2B** stays app-side (D2D pattern) — reachable later via a tiny HTTP bridge from the app if wanted.

## Cloud providers (all = OpenAI-compat base-URL swaps)
| Provider | Flagship Jul-2026 | Base URL | CLI agent | $/1M in/out |
|---|---|---|---|---|
| xAI | grok-4.5 (500K ctx) | api.x.ai/v1 (also Anthropic-compat) | Grok Build beta (`grok-build-0.1`, MCP, sub-agents; sub-gated) | $2/$6 |
| DeepSeek | V4 Pro / V4 Flash (1M ctx) | api.deepseek.com (+ /anthropic) | none official (community Deep Code) | $0.14/$0.28 Flash — cheapest frontier |
| Qwen | Qwen3.7-Max (⚑ single-source) | dashscope-intl…/compatible-mode/v1 | **Qwen Code** npm `@qwen-code/qwen-code` (Gemini-CLI fork; free tier ended ⚑) | ~$2.50/$7.50 |
| Mistral | Large 3 / Devstral 2 | api.mistral.ai/v1 | **Mistral Vibe CLI 2.0** (Apache-2.0, MCP, subagents) | Devstral $0.40/$2.00 |
| Moonshot | Kimi K2.6 (1T MoE open-weight) | api.moonshot.ai/v1 | **Kimi Code CLI** npm (MIT, Jun 2026) | ~$0.60/$2.50 |

## Interop
- **MCP won.** Donated to Agentic AI Foundation (Linux Foundation) Dec 2025; OpenAI/Google/Microsoft/AWS native support; every agent CLI above ships MCP client support. → One MCP server (e.g. our preview/build/doctor tools) plugs into EVERY engine.

## Unverified flags
Grok Build public availability details; Qwen3.7-Max naming/pricing + free-tier removal; "DeepSeek Code" official CLI (rumor); Kimi K2.7 Code pricing.
