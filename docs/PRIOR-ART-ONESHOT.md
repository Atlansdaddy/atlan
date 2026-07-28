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

Not a failure — **an arrival at the documented frontier.**

| | published baseline | attempt 2 |
|---|---|---|
| compiles | 0/10,400 single-pass (7B–30B, Unity) | ✅ compiled, ran, 208 draw calls/frame |
| static checks | — | ✅ 20/20 |
| **playable** | **near-zero Play@3 across 10 SOTA models** | ❌ black screen |

We cleared the compile barrier — plausibly because frontier models plus a written
spec plus JS is a far easier regime than 7B-on-Unity — and then landed **exactly
on the Play@k barrier that nobody has cleared.**

That reframes the whole thing. We are not debugging a botched run; we are
standing on the known edge, with a machine (multi-tier fleet, deterministic
walls, gauntlet) that no published attempt has assembled.

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
