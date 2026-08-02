# PRIOR ART — one-shot game generation: the hits and the misses

**For CHARIOTS OF ATLANTIS.** Written 2026-07-28, alongside `PRIOR-ART-JRPG.md`.

That document studies the *thing we want to build*. This one studies **the
experiment itself** — everyone who has tried to get a model to produce a playable
game, what they measured, and what actually happened. John's constraint that the
golden chariot must be **one shot, not a hundred iterations** turns out to be
methodologically supported by this literature, and also much harder than the
published state of the art.

---

## 1. Why one-shot vs. iterate-to-green is not a stylistic choice

The sharpest statement of it comes from the single-pass Unity study, which ran
with **no iterative repair loops** on purpose. Their reasoning:

> iterative repair loops **"conflate what the model writes with what the loop
> fixes,"** masking intrinsic capability ceilings.

That is exactly John's instinct, stated as method. An iterate-to-green run
measures *the loop*. A one-shot run measures *the system*. Only the second tells
you whether the harness is any good — which is the entire point of building the
harness across four rungs.

It also means **our attempt-2 result was partly a loop artefact**: Codex's
`drive` role ground the checker from red to green in 336 seconds. That measured
Codex's fix-loop, not the build.

---

## 2. THE MISSES — and they are severe

### 2.1 Single-pass Unity synthesis: **zero out of 10,400**

*Knowledge-Conditioned, Single-Pass LLM Synthesis of Executable Unity Game
Scenes* ([arXiv 2607.10187](https://arxiv.org/html/2607.10187)).

Setup: four open-weight models (7B Qwen2.5, 16B DeepSeek, 22B Codestral, 30B
Qwen3), **26 goal-based gameplay patterns**, 4 schema-conditioning levels, 20
seeds, 5 model configs = **10,400 generation records**, each attempt final.

**Result: zero successful compilations.** Not a low rate — zero. No generated
script produced a runnable scene on the first attempt.

**The error taxonomy is the most useful thing in this entire document.** 99
distinct C# error codes, split two ways:

| class | codes | what it is |
|---|---|---|
| **Hygiene** | **81 of 99** | structural/syntactic — missing semicolons, unmatched braces. **Requires no engine knowledge whatsoever.** |
| **Grounding** | **18 of 99** | domain-specific — invented types like `GuardAI`, missing engine members. **Requires knowing the API.** |

Of 90,673 error occurrences: **CS1003 (syntax) 31.5%**, **CS1002 (missing
semicolon) 17.6%**, and among grounding codes **CS0246 (type/namespace not
found) 13.6%**.

Three conclusions the authors draw, each of which changes our design:

1. **Schema conditioning fixes format, not knowledge.** Stricter JSON schemas
   improved format compliance for larger models but **did not improve
   compilation success** — they "scaffolded the syntactic layer" while leaving
   engine-knowledge gaps intact. Worse, strict schemas *degraded* small models,
   causing **70–85% sanitizer rejection**.
2. **Scale does not fix grounding.** 7B → 30B produced **no improvement in
   compilation success**, only a shift in failure composition.
3. **The bottleneck is missing engine-specific knowledge**, and patterns needing
   engine mechanics (stealth, perception, physics coupling) concentrated
   grounding failures, while patterns reducible to pure state logic concentrated
   hygiene failures.

**HONEST CAVEAT, and it matters:** these were **open-weight 7B–30B models writing
Unity C#**. We run frontier models writing JavaScript for the browser — a domain
where training data is vastly denser. **Do not read "zero" as our expected
result.** Read the *taxonomy* as transferable and the *conclusions about
mechanism* as directly applicable.

### 2.2 PlayCoder / PlayEval: **near-zero Play@3** on playability

*PlayCoder: Making LLM-Generated GUI Code Playable*
([arXiv 2604.19742](https://arxiv.org/abs/2604.19742), FSE'2026, Tencent).

PlayEval is a repository-aware benchmark over **43 multilingual GUI applications**
(Python, TypeScript, JavaScript) across six categories. It introduces **Play@k** —
whether **at least one of k generated candidates can be played end-to-end without
logical errors** — because test-case correctness is inadequate for interactive,
event-driven systems that need correct state transitions across sequences of user
actions.

**The finding:** 10 state-of-the-art code LLMs achieve **near-zero Play@3 despite
high compilation rates.**

That sentence describes attempt 2 exactly. It compiled. It ran. 208 draw calls.
Black screen.

PlayCoder's own intervention lifts this to **38.1% Exec@3 and 20.3% Play@3** — so
even a purpose-built system gets roughly **one in five, given three tries.**

**This is the honest bar: nobody one-shots a playable interactive application
reliably. Published state of the art for playable-in-three is ~20%.**

#### The oracle — and why we cannot use theirs

Playability is judged by **PlayTester**, an LLM agent with three parts: a
**Visual Observer** capturing screenshots, an **Action Executor** issuing real GUI
operations (clicks, typing, scrolling), and a **Test Manager** using a
vision-language model to plan the interaction. Two modes: **goal-driven** for
games with explicit win conditions, **coverage-driven** for feature traversal.

A failure is a **"silent logic flaw"** — code that throws nothing yet violates a
fundamental requirement. Their canonical example is a Flappy Bird in which **the
bird passes through the pipe**. That is attempt 2's failure class, named a year
before we hit it.

**But their oracle is a model.** `METHOD.md` §5 forbids a model reading results
and reporting what mattered, and `MACHINE.md` §8 rules out self-critique as a
wall. So: **adopt the definition, replace the oracle.** Our deterministic
equivalent is the scripted play-bot plus GameGen-Verifier's keypoint injection
(§3.1) — same question, reproducible answer.

#### The leaderboard (Python subset, base models, no harness)

| model | Exec@1 | Exec@3 | Play@1 | **Play@3** |
|---|---|---|---|---|
| Claude Sonnet 4 | 17.9% | 18.6% | 6.4% | **9.9%** |
| Claude Sonnet 3.7 | 10.8% | 13.1% | 4.7% | **7.5%** |
| DeepSeek-V3 (671B) | 11.7% | 15.1% | 5.0% | **7.2%** |
| GPT-4o | 13.7% | 13.8% | 3.8% | **6.7%** |
| GPT-5 | 17.4% | 17.5% | **6.6%** | 6.9% |
| GLM-4.5 (355B) | 7.6% | 17.8% | 5.9% | **6.3%** |
| Qwen3-Coder (480B) | 14.0% | 18.8% | 4.9% | **6.1%** |
| Grok-3-mini | 13.9% | 16.6% | 4.6% | **5.8%** |
| GPT-5-mini | 12.4% | 13.7% | 4.3% | **5.2%** |
| GPT-4o-mini | 10.3% | 12.7% | 2.1% | **2.6%** |

The six categories: **game emulation, classic games, game engine, standalone
applications, desktop widgets, MMORPG games.**

"Near-zero Play@3" concretely means **2.6%–9.9%**.

#### The funnel — and the calibration prior it hands us

```
compiles        high
  → executes    ~18%
    → playable  ~6.6%   (one shot)
```

**That funnel is `GROUNDING.md` §3's tier structure, measured independently.**
Tier 1 hygiene passes easily, tier 2 (runs) kills ~80%, tier 3 (playable) kills
most of the remainder.

It also gives `METHOD.md` §3 a **calibration prior**: full-size published tasks
land near 0.07 at tier 3, deep in floor-effect territory. The 0.2–0.8 informative
band therefore requires a substantial shrink, and now there is a number behind
that instead of an instinct.

#### What the harness bought — the most relevant number in the literature

| model | Play@3 base | Play@3 in PlayCoder | lift |
|---|---|---|---|
| Claude Sonnet 4 | 9.9% | **20.3%** | 2.05× |
| Qwen3-Coder (480B) | 6.1% | **18.9%** | **3.10×** |

Exec@3 moved 18.6% → 36.8% and 18.8% → **38.1%**.

> **A harness is worth 2–3× on playability with the model held fixed.**

That is this project's entire thesis, measured by someone else and published at
FSE'2026.

#### The surprises

1. **Claude Sonnet 4's 47% cliff** — Exec@3 18.6% → Play@3 9.9%. Half of
   everything that *ran* was not playable. The paper's headline: syntactic
   validity gives no assurance of interactive correctness.
2. **Qwen3-Coder won inside the harness** — top Exec@3 at 38.1%, from a base 38%
   below Sonnet 4's, so the harness lifted it 3.1× against 2.05×. The paper's
   reading: **parameter scale correlates weakly with GUI-specific reasoning.**
   That is the evidence behind our tier allocation and the free-tier strategy.
3. **GLM-4.5's k-sensitivity** — Exec@1 7.6% → Exec@3 17.8%, a 2.3× jump from two
   extra tries alone. Variance is model-dependent, which bears directly on
   `METHOD.md` #6: one seed budget across all tiers will be wrong for some.

### 2.5 GameCraft-Bench: complete games in a real engine

*Can Agents Build Playable Games End-to-End in a Real Game Engine?*
([arXiv 2606.17861](https://arxiv.org/html/2606.17861v1)).

**140 tasks across 15 game families** in **Godot 4**. Agents get a spec, an
editable workspace and shared assets, and must return a complete project **plus
replayable input traces**. Pipeline: task packaging → generation → build gate →
trace replay → scoring by a multimodal judge (GPT-4.5) against hidden rubrics.

`Score = BUILD × (0.15×M + 0.35×D + 0.15×V + 0.35×A)` — mechanics, depth,
visuals, art.

| model | overall | mechanics | depth | visuals | art |
|---|---|---|---|---|---|
| Claude Opus 4.7 | **41.46%** | 55.34% | 39.48% | 42.78% | 36.86% |
| GPT-5.5 | 39.49% | 54.36% | 38.61% | 41.84% | 32.94% |
| Kimi-K2.6 | 30.65% | 39.76% | 28.07% | 33.66% | 27.99% |
| MiMo-V2.5-Pro | 24.10% | — | — | — | — |
| GLM-5.1 | 18.29% | — | — | — | — |
| MiniMax-M2.7 | 10.95% | — | — | — | — |
| DeepSeek-V4-Pro | **2.15%** | — | — | — | — |

**Two findings that change our design:**

1. **Every strong agent is best at core mechanics and worst at content depth and
   art.** They build a working loop and fail to fill a world. That is the
   *opposite* of the usual assumption, and it is direct support for
   `ATLANTEAN-RESUME.md` §9's correction — **generation minimal, deterministic
   code maximal** aims code precisely at the measured weakness while leaving
   models the thing they measurably do best.
2. **DeepSeek-V4-Pro scored 2.15% by ignoring the demonstration-trace
   requirement entirely.** A contract failure, not a capability failure. A model
   that will not honour the harness protocol scores zero regardless of how good
   it is — which is the argument for the ADC in `MACHINE.md` §2: structured
   commands with checkers, and no value entering control flow except through one.

**Note it is not comparable to Play@3.** GameCraft-Bench's 41% is a rubric score
from a model judge; PlayEval's 20.3% is a playability rate. Different
measurements — never put them on one axis.

### 2.3 V-GameGym: top models ~45%

2,219 curated Pygame samples, **70 models evaluated**, top performers succeeding
only **~45%** — with a large gap between proprietary and open-source systems.

### 2.4 Self-critique doesn't rescue it

A recurring finding across this literature: **prompted LLM feedback often does
not yield consistent improvements, requiring external feedback mechanisms
instead.** Models asked to review their own output do not reliably improve it.

That is the same conclusion the gauntlet reaches from a different direction, and
the same reason our walls are code.

---

## 3. THE HITS — and precisely what made them work

### 3.1 GameGen-Verifier: verify runtime, not source

*Parallel Keypoint-Based Verification for LLM-Generated Games via Runtime State
Injection* ([arXiv 2605.07442](https://arxiv.org/abs/2605.07442)).

Their framing of the problem is the best I have found:

> game correctness is defined over **long-horizon interaction**: a game may
> appear correct while violating core mechanics such as state updates,
> interaction rules, and phase transitions.

Their method, and it's clever:

- **Decompose the spec into verifiable keypoints** — each a *localized behavioural
  assertion*, turning correctness into a **bounded local check** rather than a
  global trajectory judgement.
- **Runtime state injection** — the verifier has the source as well as the
  running game, so it **synthesises state snapshots satisfying each keypoint's
  precondition and injects them into the runtime**, starting verification from a
  controlled point instead of playing from the beginning.
- **GGV-Harness** handles concurrency, runtime isolation and fault recovery.

**This is a better play-bot than the one I designed.** Mine plays from the start
and must reach a state to test it. Theirs *teleports* to the state. For an RPG
that means testing "level-20 party vs. the final boss" without grinding to level
20 — every balance invariant becomes cheap and parallel.

### 3.2 RPGAgent: staged multi-agent, narrative-first

*RPGAgent: Driving Coherent Story-to-Play Generation with an LLM-Based
Multi-Agent System* (CHI 2026).

A **three-stage pipeline**: narrative generation → scene generation → mechanic
implementation. A prompt as thin as *"a missing child in a mountain village"*
expands into dialogue arcs, spatial layouts, and interactable logic.

**The mechanism worth stealing:** the narrative stage **segments the story into
discrete structured steps that serve as a scaffold for every later stage.** That
is the *compiled frame* from the JRPG study — Horii's outline, Chrono Trigger's
`outline → Kato → three directors` — arrived at independently by a research team
and shown to produce coherence.

### 3.3 Retrieval / grounding as the fix for the grounding half

The consistent remedy across 2026 work for grounding errors is **RAG**: inject
retrieved, domain-specific context into the prompt so output is grounded in
actual API surface rather than recalled approximations. Given that the Unity
study showed **scale does not fix grounding**, supplying knowledge is the only
lever that does.

---

## 4. The metric lesson

Everyone who has measured this seriously has converged on the same point:
**compile rate is a vanity metric.**

| metric | measures | verdict |
|---|---|---|
| compiles | syntax | necessary, nearly worthless |
| tests pass | unit behaviour | insufficient — attempt 2 scored 20/20 |
| **Exec@k** | it runs | better |
| **Play@k** | **playable end-to-end without logic errors** | **the real one** |
| keypoint verification | specific mechanics hold, checked at injected state | best, and cheapest to parallelise |

Our `check.mjs` measured the top row and reported it as the bottom row. That's
the whole story of attempt 2.

---

## 5. Where attempt 2 actually sits

**RETRACTED 2026-08-02.** This section previously read *"landed exactly on the
Play@k barrier that nobody has cleared."* **Attempt 2 is not on the Play@k axis
at all**, and putting it there was a category error.

`ASSET-SPEC.md`, the pre-registered contract, **never asked for a game** — it
specified assets, shaders, a draw-call budget, a fixed timestep and a frame-time
target, and nothing about a player, rules, or a win condition. The artifact is a
512-sprite lit rendering benchmark. Full writeup:
`findings/attempt-2-was-never-asked-for-a-game.md`.

| | published baseline | attempt 2 |
|---|---|---|
| compiles | 0/10,400 single-pass (7B–30B, Unity) | ✅ compiled, ran, 208 draw calls/frame |
| static checks | — | ✅ 20/20 — **honest**, it verified the contract that existed |
| **executes / renders** | ~18% Exec@3 across 10 SOTA models | ✅ 478,376/480,000 lit pixels, three lights, normal mapping correct |
| **playable** | near-zero Play@3 across 10 SOTA models | **N/A — nothing playable was requested** |

**Play@k measures whether a generated artifact can be played end to end.** Attempt
2 produced nothing playable because nothing playable was specified. That is not a
failure against the barrier; it is not a measurement against the barrier.

The secondary correction — the reported black screen was a broken probe reading
an already-presented drawing buffer — is real but minor next to this.

What survives: the machine (multi-tier fleet, deterministic walls, gauntlet) that
no published attempt has assembled, and evidence that a fleet **hits a tight
technical contract well**. What changes: **our first Play@k measurement has not
happened yet.** Every comparison to the published numbers in §2 is, for now, a
comparison we have not earned.

---

## 6. What this changes

**6.1 The harness's job is now precisely definable.** Eliminate both error
classes *before* the model writes anything:

- **Hygiene (81/99 of error codes)** — 100% eliminable by deterministic tooling.
  Generators emit boilerplate; templates supply structure; a parser (`node
  --check`), formatter and linter run before anything else is judged. **No model
  should ever be the thing that gets a semicolon right.**
- **Grounding (18/99, but the hard 18)** — eliminable only by *supplying
  knowledge*, never by a bigger model. Ship the API surface, the spec, and
  working reference examples **in-context**. This is why the compiled frame and
  the world bible matter more than raw model tier.

**6.2 Steal runtime state injection.** Keypoint assertions checked from injected
state, not from a playthrough. Turns every balance invariant into a cheap
parallel check and makes Ito's two-sided test (see `PRIOR-ART-JRPG.md` §13.3)
affordable.

**6.3 Play@k is our headline metric, and one-shot means k=1.** State it plainly:
**Play@1 on a full RPG slice would be beyond published state of the art.** That
is the point, and it is also why early attempts should be expected to fail and
be mined rather than judged.

**6.4 Narrative-first staging is validated twice.** RPGAgent found it; Chrono
Trigger did it in 1995. The frame is compiled first and everything downstream
cites it.

**6.5 Never trust schema compliance as correctness.** Schemas made output
*well-formed* without making it *right*, and strict schemas actively broke
smaller models. Our free tiers are the small models. Keep their schemas simple.

**6.6 Self-critique is not a wall.** Documented not to reliably improve output.
Cross-model gauntlet and deterministic checks only.

---

## Sources

- [Knowledge-Conditioned, Single-Pass LLM Synthesis of Executable Unity Game Scenes (arXiv 2607.10187)](https://arxiv.org/html/2607.10187)
- [PlayCoder: Making LLM-Generated GUI Code Playable (arXiv 2604.19742)](https://arxiv.org/abs/2604.19742)
- [PlayCoder — Tencent (GitHub)](https://github.com/Tencent/PlayCoder)
- [GameGen-Verifier: Parallel Keypoint-Based Verification via Runtime State Injection (arXiv 2605.07442)](https://arxiv.org/abs/2605.07442)
- [V-GameGym: Visual Game Generation for Code Large Language Models (arXiv 2509.20136)](https://arxiv.org/pdf/2509.20136)
- [GameCraft-Bench: Can Agents Build Playable Games End-to-End in a Real Game Engine? (arXiv 2606.17861)](https://arxiv.org/html/2606.17861v1)
- [RPGAgent: Coherent Story-to-Play Generation with an LLM-Based Multi-Agent System (CHI 2026)](https://dl.acm.org/doi/10.1145/3772318.3790326)
- [From Code to Play: Benchmarking Program Search for Games Using LLMs (arXiv 2412.04057)](https://arxiv.org/abs/2412.04057)
- [lmgame-Bench: How Good are LLMs at Playing Games? (arXiv 2505.15146)](https://arxiv.org/html/2505.15146v1)
- [Why AI Models Still Can't Handle Your Favorite Video Games — IEEE Spectrum](https://spectrum.ieee.org/ai-video-games-llms-togelius)
- [A Survey on LLM-Based Game Agents (ACM CSUR) — reading list](https://github.com/git-disl/awesome-LLM-game-agent-papers)
