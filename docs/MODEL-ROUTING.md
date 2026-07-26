# Model routing — which model for which job

Researched 2026-07-26 against **what is actually authed on this device**, not a
generic leaderboard. A model that benchmarks well and isn't logged in is worth
zero.

## The two facts that decide everything

**1. Subscription engines cost nothing at the margin.** Claude Code (Agent SDK)
and Codex (GPT-5.6) both run on subscription logins. The hierarchy's `frontier`
tier already goes through `frontierExecute` → Agent SDK → subscription. Local
Qwen is free. API-key tiers are the only metered ones.

**2. The benchmark split is real and it is not "one model is best".**

| Benchmark | Leader | Meaning |
|---|---|---|
| SWE-bench Verified | Claude Opus ~80.8% (Gemini 3.1 Pro 80.6%) | code *editing* — patches, refactors, multi-file changes |
| Terminal-Bench 2.1 | GPT-5.5 78.2% vs Opus 4.8 74.6% | *agentic shell* — build loops, test runs, tool sequencing |

So Claude for changing code, GPT/Codex for driving a terminal. Routing to one
model for both leaves measurable capability on the table.

GPT-5.6 ships as three: **Sol** (ceiling), **Terra** (value default), **Luna**
(cost champion for high volume).

## What was wrong with the ladder

`TIERS` was `local → cloud-sm → frontier`, where:

- `cloud-sm` = DeepSeek, requiring `DEEPSEEK_API_KEY` — **not configured**. The
  middle rung throws `cloud-sm needs DEEPSEEK_API_KEY` on every escalation.
- It was also the **only metered rung** in the ladder.
- There was **no Codex/GPT rung at all**, despite an authed GPT-5.6 subscription
  that is free at the margin and leads the agentic benchmark.

Net: escalation fell from free-local straight to frontier through a broken paid
step, and never used the best agentic model available.

## The routing

| Job | Route to | Why |
|---|---|---|
| Bulk mechanical work, extraction, classification, scoped single-step tasks | **local Qwen3-1.7B** | free, on-device, proven when the prompt does the scoping. Fails open reasoning — see below. |
| Cheap cloud rung | **Gemini 3.6 Flash** | free-tier key already works (verified 200, ~1.6–2 s). Replaces the dead DeepSeek rung at zero cost. |
| Agentic shell — builds, test loops, tool sequencing | **Codex (GPT-5.6)** | Terminal-Bench leader; subscription, free at margin |
| Code editing, refactors, multi-file changes, hard escalations | **Claude Opus 5** | SWE-bench leader; subscription via Agent SDK |
| Image generation | **Codex `image_gen`** | subscription, no per-image billing |
| Audio/video description | **Gemini 3.6 Flash** | free key, native multimodal |
| Verification / code review | **Claude Opus 5**, `verifier` profile | high real-bug rate; profile forbids editing what it grades |

### Known local-model ceiling

Qwen3-1.7B answered `3 boxes × 4 bags × 5 marbles` as **120** (truth 60), twice,
reproducibly, while Gemini got it in 1.6 s. It is not a reasoning tier. Route it
bulk and scoped work only — which is exactly what the constrained-tier design
already assumes.

## Call sequence

Escalation stays checker-gated — a rung is only left on **deterministic checker
failure**, never on a model's own opinion of itself.

```
local (free, on-device)
  ↓ checker fail
cloud-sm → Gemini 3.6 Flash (free key)
  ↓ checker fail
agentic → Codex GPT-5.6        [shell/build/test-shaped work]
  ↓ checker fail
frontier → Claude Opus 5        [code-editing-shaped work]
  ↓ still failing
human gate
```

The `agentic` and `frontier` rungs are ordered by *job shape*, not just strength
— for a shell-heavy link Codex is both cheaper in wall-clock and better on the
benchmark; for a patch-shaped link Claude is the stronger rung.

## Not adopted, and why

- **`claude-fable-5` as the frontier default.** It's the highest tier ($10/$50
  where metered) and its thinking cannot be disabled. Opus 5 leads the coding
  benchmark at half the cost. Fable is the right escalation for genuinely
  hardest long-horizon work, not the standing default.
- **Paid API rungs generally.** While subscription engines cover the same jobs at
  zero marginal cost, a metered rung is strictly worse. Revisit if subscription
  rate limits become the binding constraint.
