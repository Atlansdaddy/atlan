# METHOD — how we learn what the instruction set should say

**Chariots of Atlantis.** Written 2026-07-28. `MACHINE.md` is how it is built,
`GROUNDING.md` is how output is judged. This is **the experimental program**:
the reason it exists, its ordering, its statistics, and what makes a result
believable.

**§9 is the gap register for method.**

---

## 1. The ordering problem, and why it decides everything

The one-shot needs an instruction set. **We do not know what it must contain.**
Writing it from intuition is what produced attempt 2 — which failed on something
nobody predicted, and on something the spec did not mention at all.

So the instruction set is the **output** of the experiments, not the input:

```
walls (the instrument)
  └─ calibration: find a target where success is neither 0% nor 100%
       └─ ablations: vary ONE factor at a time, measure
            └─ the instruction set (derived, not invented)
                 └─ scale up, re-verify, repeat
                      └─ golden chariot
```

**The walls come first because the walls are the measuring instrument.** You
cannot run the experiment without them. That is not a preference — it is the
only order that works.

## 2. Fix the target, vary the harness

The ladder (dungeon → bigger place → land) varies the **target**. That is
backwards for learning. Within a rung, **hold the target fixed and small while
varying the harness**, so any change in outcome is attributable. Scale the
target only once the harness stops improving.

So rung 1 is not "build endless battles." It is: *pick one tiny fixed target,
run it one-shot many times, change one thing about the harness each time, and
see what moves the score.*

## 3. Calibration — the step that cannot be skipped

**Floor and ceiling effects destroy signal.** If every condition scores 0, or
every condition scores 1, the sweep tells you nothing except that the target was
mis-sized.

The cautionary case is exact: the single-pass Unity study ran **10,400 records
across four conditions and got zero successes.** It learned a valuable taxonomy
and *nothing whatsoever* about which condition was better, because there was no
variance to attribute.

**Before any ablation:** shrink the target until baseline lands in the
**0.2–0.8 informative band**. `calibration()` in `sweep.js` detects floor and
ceiling and refuses to proceed. The target may end up smaller than feels
satisfying — possibly "one battle, two characters, three monsters, win/lose."
That is an instrument calibration, not a game.

**Traversal depth (see `GROUNDING.md` §5) widens the band considerably**, because
a run scoring 0 on "did it ship" still scores 7-of-12 on depth. That is the
main reason it exists.

## 4. The sweep

Implemented in `server/src/sweep.js`. 

### Both directions, always
> **"We added things until it worked" is not evidence.**

A factor earns its place only if **adding it helps AND removing it hurts**.
Positive and negative sweeps run for every factor and are reported as a pair. A
factor that looks good one way and null the other is **flagged, not adopted**.

### Multiple seeds, always
Generation is stochastic; **N=1 is an anecdote**. Each condition runs `seeds`
times and reports a distribution. The single-pass study used 20 seeds per
condition; we plan 8–24 depending on cost.

### One factor at a time
Honest compromise, labelled as such in the source: a full factorial would be
more powerful and is not affordable. **This cannot see interactions** (A helps
only when B is present) — see gap #1.

### Candidate factors for rung 0/1

| factor | question it answers |
|---|---|
| worked reference example in context | does grounding come from examples? |
| API surface docs in context | does grounding come from docs? |
| pre-generated scaffolding / templates | how much hygiene can be deleted outright? |
| formal spec vs. prose spec | does formality help, or only constrain format? |
| model tier (Haiku → Fable) | does scale matter **in our domain**? The Unity study says no for grounding — check it |
| computed corpus vs. generated corpus | the generation-minimal thesis, tested |
| feedback path present vs. absent | **what the loop is actually worth** |

Each is a line in the eventual instruction set — *if the data says it earns one*.

## 5. The analysis is computed, never generated

> **No model reads the results and reports what mattered.**

That would contaminate the measurement with the thing being measured — the same
reason the walls are code and the gauntlet is cross-model. Every number is
arithmetic on recorded outcomes: mean, stdev, Pearson r, Cohen's d, cost delta.
Verdicts come from thresholds, not prose.

| verdict | condition |
|---|---|
| `ADOPT` | positive delta and \|d\| ≥ 0.5 |
| `WEAK POSITIVE` | positive delta, smaller effect — retest with more seeds |
| `NULL` | \|d\| < 0.2 — effect smaller than noise, do not adopt |
| `HARMFUL` | removing it hurt — it is load-bearing |

**A bug the suite caught, and the worst kind:** two conditions with zero variance
— a factor where every run with it succeeded and every run without it failed —
produced a pooled stdev of 0, so Cohen's d came back 0 and the verdict called a
**perfect separation "NULL — smaller than noise."** The strongest finding
available, silently discarded. Now returns signed Infinity, with a regression
test. Assume more of these exist.

## 6. From evidence to instruction set

`evidenceFromSweep()` turns a completed sweep into per-component evidence, so
promotion is mechanical rather than a judgement call. Then the assembly gate:

> **a component may enter a one-shot assembly only if a sweep recorded an ADOPT
> verdict for it**

The pool **accumulates across rungs**. Each rung's sweeps promote fragments;
by the top rung, "one shot" means one shot into an instruction set that four
rungs of measurement assembled — which is what makes it plausible rather than a
wish.

## 7. Feasibility, honestly

### The arithmetic
Six factors × two levels × 8 seeds ≈ **~100 one-shot runs** for a first full
sweep. A small-target run is perhaps 50–150k tokens.

### Why that number sinks a lab and not us
- every Claude tier runs on **subscription** — flat, not per-token
- Codex likewise
- local 35B and Gemini Flash are **free**
- the walls score runs **automatically**, so no human is in the loop per run

**That asymmetry is the actual competitive position.** Published work is
compute-constrained and pays per token, so it runs a few conditions and reports
a taxonomy. We can run a hundred small attempts overnight for effectively
nothing. **Volume of cheap, automatically-scored one-shot attempts is the one
resource we have that they do not** — and it is exactly what this question
needs.

### What the bar actually is
Published state of the art for *playable in three tries* is roughly **20%
Play@3** (PlayCoder, after a purpose-built intervention). Ten SOTA models score
near-zero without it.

> **Play@1 on a full RPG slice would be beyond published state of the art.**

That is the point, and it is why early rungs should be **mined rather than
judged**.

### Where attempt 2 sits
Not a failure — an **arrival at the documented frontier**. It cleared the
compile barrier that stopped 10,400 single-pass runs (frontier models + a
written spec + JS is a far easier regime than 7B-on-Unity), and then landed
exactly on the Play@k barrier nobody has cleared.

## 8. The value map — the point, not the consolation

**Reframed 2026-07-31 (John).** This section previously read as *value if the
game fails entirely*. That is inverted. **The deliverable is the system and the
data it produces; the game is the proving ground** — the hardest test case
available at this scale, chosen because a system that can build a coherent RPG
end to end can be pointed at other work. The transferability below is the
**claim under test**, not a fallback. See `BUILD-SHEET.md` §1.

Every subsystem carries a **transferability tag**, and the sweep records two
things: did it move the score *on this game*, and what **class of problem** does
it solve independently.

**The claim is testable and cheap to test:** point the machine at a non-game
build sheet and see how far it gets. The machine is agnostic by construction, so
a different destination should just work — and where it does not is where an RPG
assumption leaked into machinery that was supposed to be form-independent.

| subsystem | value independent of this game |
|---|---|
| circuit layer | deterministic multi-agent orchestration with real protection — any agent pipeline |
| sweep + analysis | measuring whether a prompt fragment earns its place — every LLM product |
| assembly / component pool | instruction sets as compiled artifacts with evidence — arguably the most transferable thing here |
| cross-engine + containment | walls for exec-mode CLIs — a security story, not a games story |
| the vacuous-pass discipline | checks that cannot pass because a feature is absent |

Game succeeds → a game *and* the machinery. Game fails → a measured account of
which machinery worked and where else it applies. **The only outcome that
produces nothing is not instrumenting it.**

## 9. GAP REGISTER — method

| # | gap | status | resolution |
|---|---|---|---|
| 1 | **One-at-a-time cannot see interactions** | **OPEN** | After the one-at-a-time pass, run a small factorial over the ADOPTed set only. Needs a budget decision. |
| 2 | **Evidence has no scope** | **OPEN** | A factor proven at rung 1 may not hold at rung 3. Needs `evidence.scope` and a re-measurement rule on scale change. |
| 3 | **Pool versioning / stale evidence** | **OPEN** | Component text can change after it was measured. Needs a content hash per component and automatic evidence invalidation on edit. Currently a silent staleness risk. |
| 4 | **Automated calibration shrink** | PLANNED | `calibration()` detects the band; the loop that halves target scope until it lands there is unbuilt. |
| 5 | **Multiple-comparisons risk** | PLANNED | Many factors × many sweeps will produce false ADOPTs by chance. Mitigation: require the negative direction to agree, and re-verify any ADOPT before it enters a one-shot. Not yet enforced. |
| 6 | **Seed count is a guess** | PLANNED | 8–24 chosen by cost, not by a power calculation. Once baseline variance is measured at rung 0, compute the seeds needed for the effect size we care about. |
| 7 | **Program-level budget** | PLANNED | Per-run budgets exist; a total program ceiling that halts the *sweep* does not. |
| 8 | **Transferability tags** | PLANNED | Designed in §8, not instrumented. |
| 9 | **No pre-registration mechanism** | PLANNED | Failure predictions were written before attempt 2 and that was valuable. It should be a **required field on a sweep**, recorded before the run, so post-hoc narrative cannot creep in. |

**Undecided and needed before rung 1: #1, #2, #3.** Together with `MACHINE.md`
#10 (human gates) and `GROUNDING.md` #2/#3 (composition definition, gate
weighting), that is **six decisions standing between here and a defensible
rung 1.**
