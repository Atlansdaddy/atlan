# Atlan — Token Optimization Plan

*Grounded in a July-2026 deep-research pass (106 verified sources, 3-vote adversarial verification that killed three inflated claims). This doc is the reference; the build follows it, and every lever is measured before it's declared a win — vendor demo numbers are treated as hypotheses, not facts.*

---

## The load-bearing truths (everything hangs on these)

1. **Input tokens dominate agentic-coding cost — ~154:1 over output — even with caching on**, because the whole history is re-fed each round. → *Context discipline is the dominant lever, not output trimming.*
2. **More tokens do NOT buy more accuracy.** Accuracy peaks at *intermediate* spend and then flatlines/declines ("inverse test-time scaling", arXiv 2604.22750). → *We can cut aggressively without fearing quality loss.*
3. **Model choice is a first-order cost lever** — models burn 1.5M+ different tokens on identical tasks. → *Cheapest-capable-first + escalate-on-failure (our hierarchy) is validated.*

These reframe the goal: **not "spend fewer tokens per call" but "keep the re-fed context small, stable, and cache-warm, and route work to the cheapest model that passes the checkers."**

---

## The levers — ranked by (safe × consistent × proven ÷ effort)

Each: **what · evidence · Atlan-fit · risk · how we implement · how we MEASURE it.**

### L1 — Prompt-caching discipline  ⟶ ADOPT FIRST (biggest safe win, ~zero risk)
- **What:** keep the cacheable prefix byte-stable so cache reads (0.1× input price) hit instead of re-writing (1.25–2×).
- **Evidence (high):** system-prefix caching cut cost ~78.5% / TTFT ~22.9% on Sonnet 4.5 (arXiv 2601.06007); Anthropic docs confirm 0.1× read multiplier. *Refuted by verification: the "41–80% across all providers" and "system-prompt is the bulk of savings" claims — so we don't overpromise a number and we cache the whole stable prefix.*
- **Atlan-fit:** the Agent SDK / `claude` manage caching automatically; our job is to **not bust it** — no timestamps, run-IDs, or volatile content early in the prompt; stable tool sets; dynamic content last.
- **Risk:** none (it's hygiene). The only failure mode is *accidentally* busting it, which is the bug we're fixing.
- **Implement:** audit `claudeEngine.js`, `fleet.js`, `hierarchy.js` prompt construction. Move any per-run/volatile strings (budget numbers, run IDs, timestamps) out of the cacheable prefix / to the end.
- **Measure:** run the same task twice back-to-back; record `cache_creation_input_tokens` vs `cache_read_input_tokens` from the SDK usage. **Win = turn-2 reads dominate, writes ≈ 0.** Regression test asserts no volatile tokens precede stable content.

### L2 — Server-side context editing (auto-clear stale tool results)  ⟶ ADOPT (long runs)
- **What:** `clear_tool_uses` drops old re-fetchable tool outputs past a threshold, server-side, at **zero inference cost**; client keeps full history.
- **Evidence (high, but vendor-sourced):** ~48–64% input cuts in Anthropic cookbook demos — *illustrative, not guaranteed; we verify on our own runs.*
- **Atlan-fit:** fleet/hierarchy runs that read many files accumulate stale tool results — prime candidates.
- **Risk:** low. Trade-off: clearing invalidates cache prefixes → **clear in big batches (`clear_at_least` ≥ ~5K), never trickle** (or it's a net loss against L1).
- **Implement:** if the Agent SDK exposes context-editing options, enable with a high threshold + large `clear_at_least`. If not exposed, note it and revisit.
- **Measure:** long run with/without editing; compare peak input tokens + total cost. **Win only if net cost drops *after* accounting for cache-write cost from invalidation.**

### L3 — Persistent structured memory / blackboard (the LLM-wiki, done right)  ⟶ ADOPT (on-thesis, medium effort)
- **What:** a compact, structured store a later run *loads* (~3K tokens) instead of re-deriving; queryable by grep, not re-fed wholesale.
- **Evidence (high):** file-backed memory tool pattern persists compact findings across sessions (Anthropic cookbook). This is your Persona+ **LLM-wiki / vault** thesis, validated as a real efficiency pattern.
- **Atlan-fit:** extends the hierarchy blackboard (intra-job) to a persistent, cross-run vault. Grounds the "scope is the moat" idea — a page grown once, queried cheaply forever.
- **Risk:** medium — must stay *structured + grep-queryable* (not a blob that gets re-stuffed). Self-growth needs the same gate discipline as the self-repair vault (no slop accumulation).
- **Implement:** a markdown vault under the project, agent reads/writes scoped pages, loads relevant pages by grep instead of re-reading sources. Start read-only (authored), add gated growth later.
- **Measure:** a repeat task that would re-derive knowledge — tokens with cold vault vs warm vault. **Win = warm run loads a small page instead of re-reading N files.**

### L4 — Tier routing  ⟶ ALREADY BUILT (lean harder)
- **What:** cheapest capable tier first (local Qwen), escalate on checker failure. **This is the worker hierarchy.** Research ranks model choice a first-order lever.
- **Action:** default local for bulk more aggressively; make routing visible in the burn ledger (per-tier tokens).
- **Measure:** % of links resolved at local tier vs escalated; tokens saved vs all-frontier.

### L5 — System-prompt / tool trimming  ⟶ PARTLY BUILT
- **What:** `excludeDynamicSections` + fewer tools = smaller cacheable prefix. Fleet already uses it.
- **Action:** apply to hierarchy/chat where capability allows; trim tool sets per profile (already do via `disallowedTools`).
- **Measure:** turn-1 write size before/after (fewer tools → smaller schema → smaller write).

---

## Avoid / experimental (verification said so)

- **Image-as-context / vision-token packing** — **NO verified 2026 evidence it wins.** Do not build as a saver; park it. (Your instinct to research first was right.)
- **Compaction/summarization on numeric data** — 49–59% cuts BUT **lossy: preserved 3/3 high-level facts, 0/3 precise numbers.** Atlan's checkers/estimates live on exact numbers → **never compact the numeric/checker data.** Narrative context only.
- **Embedding/vector RAG for code** — grep matches/beats it at 1/35th latency. Don't stand up an index; keep grep.

---

## Measurement methodology (how we know it's "peak")

We don't trust vendor numbers — we measure our own. A repeatable experiment harness (`test/token-bench.mjs`):
1. A **fixed benchmark task** (deterministic prompt, same cwd) run through the real engine.
2. Records SDK usage per turn: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, cost.
3. Runs **baseline vs each lever**, prints a delta table.
4. Each lever is only marked ✅ in this doc once its own measurement confirms a real, consistent saving with **no checker/quality regression** (the existing 151-test suite must stay green).

**"Peak / complete" = ** L1 hygiene proven (reads dominate on repeat), L2 net-positive on long runs, L3 warm-vault beats cold, L4/L5 confirmed — all with the full suite green and the honest numbers (ours, not Anthropic's) recorded in `docs/RECEIPTS.md` and here.

---

## Status
| Lever | State | Measured saving (OURS, `test/token-bench.mjs`) |
|---|---|---|
| L1 caching | ✅ **verified live** | Warm/resumed turn: fresh tokens **39,740 → 1,218 (−97%)**, cost **$0.043 → $0.006 (−85%)**; warm run 98.5% cache-read. The ~40k prefix is paid once, cache-read (~free) after, within the cache TTL. |
| L2 context editing | ⓘ SDK-managed | The Agent SDK exposes no `clear_tool_uses` option; the CLI **auto-compacts** long sessions (PreCompact/PostCompact hooks). We benefit automatically; nothing to configure. |
| L3 memory/vault | ⏳ next build | — (the LLM-wiki / persistent blackboard; on-thesis structural win) |
| L4 tier routing | ✅ built (hierarchy) | cheapest-tier-first + escalate; per-tier tokens in the run audit |
| L5 sys-prompt trim | ✅ fleet + hierarchy + bench | `excludeDynamicSections` on all non-chat runs shrinks the cacheable write |

**Visibility shipped:** fleet runs + the burn meter now show `cached` tokens (cache-read) alongside fresh tokens, so the caching win is honest and on-screen.

### What the measurement taught us (the real lever)
Caching is enormous **but only within the cache TTL and only if the session/prefix is reused**. So the dominant practical lever for Atlan is **session continuity + prefix stability**, both already true: chat resumes its session, fleet top-up resumes, and every non-chat run uses the stable `excludeDynamicSections` preset. The bench (`RUN_PAID=1 node test/token-bench.mjs`) is the regression guard — if a future change busts the cache, the warm run stops reading and it fails.

*Nothing above is marked "done" on a vendor's word — only on our own measured, regression-free numbers. L1/L4/L5 are done; L3 is the remaining structural build.*
