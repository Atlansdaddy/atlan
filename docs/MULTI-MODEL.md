# Multi-model working together — what the evidence actually supports

**Status: RESEARCH + DESIGN, 2026-08-02.** Written because "council of N / MoE /
round table" is intuitive and **the literature says the intuitive version makes
things worse.** Every claim here carries its source. Nothing below is built yet.

---

## 0. The headline, before the detail

Three findings, each with numbers, and each one cuts against the obvious design:

| intuition | what the evidence says |
|---|---|
| "mix many models → better" | **Self-MoA (one strong model sampled N times) beats mixed-MoA by 6.6% on AlpacaEval 2.0 and 3.8% average** across MMLU/CRUX/MATH |
| "more diversity → better" | **Quality dominates diversity.** Regression coefficients: quality α = 2.558–4.719, diversity β = 1.421–2.839. Optimum sits at *high quality, relatively LOW diversity* |
| "let them debate → better" | Multi-agent debate **fails to consistently beat a single agent and sometimes degrades below it** |

So the naive build — throw every engine at the question and let them argue —
is the one shape the research specifically warns about.

## 1. Mixture-of-Agents: real, but not the way it sounds

**MoA works.** Layered proposers → aggregator scored **65.1% on AlpacaEval 2.0
vs GPT-4o's 57.5%, using only open-source models** ([arXiv
2406.04692](https://arxiv.org/abs/2406.04692), ICLR). MoA-Lite (2 layers, smaller
aggregator) still beat GPT-4o at 59.3%.

**Then the follow-up took it apart.** *Rethinking Mixture-of-Agents* ([arXiv
2502.00674](https://arxiv.org/html/2502.00674v1), Princeton) asked whether the
*mixing* was doing the work — and found it mostly wasn't:

- **Self-MoA** — same top model sampled repeatedly, same aggregation — **beat
  mixed-MoA by 6.6% on AlpacaEval 2.0**, and **3.8% averaged** over MMLU, CRUX
  and MATH.
- **Mixed-MoA won only under narrow conditions**: when proposers were of
  *comparable* quality (Llama-3.1-8B and Qwen2-7B both ~66% on MMLU → 70.73% vs
  Self-MoA's 69.01–71.27%), and on a deliberately blended benchmark — where it
  led by **0.17–0.35 percentage points.** That is the *best* case for mixing.
- **Task specialisation is where the real gain is.** Qwen2-7B best at MMLU
  (66.16%), DeepSeek-Coder-V2-Lite best at CRUX (49.51%), Qwen2-Math-7B best at
  MATH (69.57%). Routing each task to its specialist and self-MoA-ing *that*
  model beat mixed-MoA by **3.8%**.

> **The lesson isn't "don't use many models." It's "don't dilute a strong model
> with weaker ones on the same question." Route first, then deepen.**

**Self-MoA-Seq** matters for the phone: a sliding window of six slots (three
reserved for synthesised output) aggregates an arbitrary number of samples
without exceeding context — *"comparable to, or slightly better than, Self-MoA"*
while removing the context ceiling. That is how an 8k-context local model
participates at all.

## 2. Debate and councils: the documented failure modes

Multi-agent debate (MAD) is the round-table shape, and it is the weakest-evidenced
of the three. Current MAD methods **fail to consistently outperform simpler
single-agent strategies even with more compute**, and can **degrade** below a
lone agent ([ICLR 2025 blog](https://d2jud02ci9yv69.cloudfront.net/2025-04-28-mad-159/blog/mad/),
[arXiv 2509.05396](https://arxiv.org/html/2509.05396v1)). Four named mechanisms:

1. **Agreement over reasoning.** Models flip from correct to incorrect in
   response to peer reasoning — they favour agreeing over challenging a flawed
   argument. Sycophancy at the protocol level.
2. **Persuasion beats correctness.** *A single strategically persuasive agent can
   degrade collective accuracy and induce false consensus* ([Scientific
   Reports](https://www.nature.com/articles/s41598-026-42705-7)). One confident
   wrong seat poisons the room.
3. **A weak judge cannot adjudicate strong debaters.** Performance degrades when
   the judge can't fully evaluate the arguments it is ranking.
4. **Role-play degrades consistency.** Some models reason worse when told to
   hold a role.

**Independent convergence worth noting:** Anthropic's own Advisor tool enforces
that *the advisor model must be at least as capable as the executor* — an invalid
pairing is a hard 400, not a warning. That is failure mode 3 turned into an API
constraint. When a vendor's API refuses the thing the papers say breaks, the rule
is real.

**What survives:** *independent* answers, aggregated — not cross-talk. Our
existing gauntlet already has this shape (N reviewers, no shared context, then a
reordered second pass). Keep it. Do **not** upgrade it to a debate.

## 3. The SDK question, answered

**Yes — the Claude Agent SDK ships subagents natively.** It is the "batteries
included" harness: built-in Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch,
plus MCP and **subagents**. Atlan already runs on it (`claudeEngine.js`,
`fleet.js`).

**Managed Agents goes further** with a first-class coordinator:
`multiagent: {type: "coordinator", agents: [...]}` — up to **20 unique agents**,
**25 concurrent threads**, each subagent getting its own context-isolated thread
with its own model, system prompt and tools. **One level of delegation only, and
it is enforced** — rostering an agent that itself has a roster fails validation.

That depth cap is not a limitation to work around; it matches the evidence.
Deeper delegation trees are where compounding error lives.

**But note what we do NOT get from it here:** Managed Agents runs the loop on
Anthropic's infrastructure. Atlan's whole thesis is a local cockpit driving the
user's own subscriptions. So the *pattern* transfers; the *hosting* does not.

## 4. What this means for Atlan — four modes, in evidence order

Ranked by strength of evidence, not by how impressive they sound.

### Mode 1 — ROUTE (mixture-of-experts). Strongest evidence, build first.

Pick the engine by **task shape**, run one model, done. This is the 3.8% win, and
it is the cheapest thing on the list.

Atlan already has the pieces: `engineCapabilities()` knows what each engine can
do, `TIERS` knows the ladder, `MODEL-ROUTING.md` already records that Codex is
routed terminal work and Claude patch-shaped work *"ordered by job shape, not
just strength."* That document independently arrived at the paper's conclusion.

**Build:** a `route` surface in chat — "pick for me" — that reads task shape and
picks the engine, showing *why*. No new orchestration required.

### Mode 2 — ESCALATE. Already built, just unreachable from chat.

Cheapest tier first, climb only when a deterministic checker fails. This is
`hierarchy.js` (`local → cloud-sm → frontier`) and it works today — it is simply
not exposed in the chat surface.

**Build:** expose the ladder as a chat "model" option. Biggest phone win on the
list for the least new code.

### Mode 3 — SAMPLE-AND-AGGREGATE (Self-MoA). Strong evidence, moderate build.

Ask the **same strong model** N times, aggregate with that same model. Beats
mixing. On a small-context local model, use the **Self-MoA-Seq** sliding window
so the aggregation isn't context-bound.

**Build:** N-sample + aggregate over one engine. Deliberately *not* multi-engine.

### Mode 4 — COUNCIL. Weakest evidence. Build last, with hard rules.

If built at all, the constraints come straight from the failure modes:

| rule | why |
|---|---|
| **Same-tier seats only** | quality dominates diversity; a weak seat drags the mixture down |
| **No cross-talk — independent answers** | kills sycophancy and the persuasion attack |
| **Aggregator ≥ strongest seat** | a weak judge can't adjudicate strong arguments |
| **Show disagreement, don't resolve it** | a split panel is information; a forced consensus is noise |
| **Cross-vendor seats** | vendor diversity is the perspective diversity that survives |
| **Cap ~5 seats** | past that, opinions correlate — already recorded in `ATLANTEAN-RESUME.md` §7 |

**Where a council genuinely earns its keep is judgement, not correctness** —
blind A/B on writing quality, design direction, "is this any good." That is
`GROUNDING.md` tier 7, and it is already specified that way.

## 5. What NOT to build, and why

- **A round-table where models see each other's answers and revise.** This is
  precisely the MAD shape that degrades. If you want revision, use
  proposer → *independent* aggregator, not a conversation.
- **A council that mixes the local 8B with frontier seats.** Textbook
  quality-diversity mistake. The local model's seat is *bulk and schema-locked
  work*, not a vote on a hard question.
- **Deep delegation trees.** Managed Agents enforces one level. Copy the cap.
- **Consensus scoring that hides a split.** Record the disagreement.

## 6. Open questions — mine, not settled

1. **Does the specialisation finding transfer to our engine set?** The paper's
   specialists were fine-tuned small models. Codex-vs-Claude-vs-Grok on *our*
   task shapes is an empirical question our own sweep machinery could answer —
   and that is exactly what `METHOD.md` is for.
2. **Is subscription-flat pricing a reason to over-sample?** Self-MoA costs N×
   tokens. On flat-rate subscriptions the marginal cost is ~0, which may make
   N=5 rational for us where it wouldn't be for a metered lab. Untested.
3. **Does the phone change the ranking?** Self-MoA-Seq exists for exactly this
   constraint but has not been tried on the on-node 35B.

---

## Sources

- [Mixture-of-Agents Enhances LLM Capabilities (arXiv 2406.04692)](https://arxiv.org/abs/2406.04692) · [ICLR proceedings](https://proceedings.iclr.cc/paper_files/paper/2025/file/5434be94e82c54327bb9dcaf7fca52b6-Paper-Conference.pdf) · [Together MoA repo](https://github.com/togethercomputer/moa)
- [Rethinking Mixture-of-Agents: Is Mixing Different LLMs Beneficial? (arXiv 2502.00674)](https://arxiv.org/html/2502.00674v1) — Self-MoA, the quality-diversity tradeoff, Self-MoA-Seq
- [Multi-LLM-Agents Debate — Performance, Efficiency and Scaling Challenges (ICLR 2025 blog)](https://d2jud02ci9yv69.cloudfront.net/2025-04-28-mad-159/blog/mad/)
- [Talk Isn't Always Cheap: Failure Modes in Multi-Agent Debate (arXiv 2509.05396)](https://arxiv.org/html/2509.05396v1)
- [When collaboration fails: persuasion-driven adversarial influence in multi-agent LLM debate (Scientific Reports)](https://www.nature.com/articles/s41598-026-42705-7)
- [Mixture of Complementary Agents for Robust LLM Ensemble (arXiv 2605.24048)](https://arxiv.org/pdf/2605.24048)
- Claude Agent SDK subagents + Managed Agents `multiagent` coordinator — Anthropic `claude-api` skill, `shared/managed-agents-multiagent.md`
