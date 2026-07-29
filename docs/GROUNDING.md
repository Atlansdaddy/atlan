# GROUNDING — what the gates measure, and how far the trip got

**Chariots of Atlantis.** Written 2026-07-28. This document defines **judgement**:
what "good" means at each level, how subjective bars become comparable numbers,
and what a run's score actually is.

Companions: `MACHINE.md` (how it is built) · `METHOD.md` (how we learn) ·
`PRIOR-ART-JRPG.md` (where the bars come from) · `PRIOR-ART-ONESHOT.md` (what
everyone else measured and got wrong).

**§9 is the gap register for judgement.**

---

## 1. Two orthogonal axes

Judgement is a **matrix**, not a list. Confusing the two axes is how attempt 2
scored 20/20 on a black screen.

- **TIER** — *what dimension* is measured (hygiene → comparative). §3.
- **STAGE** — *at what level of integration* (bench → full trip). §4.

"Does the shader work", "does the shader work with the sim", and "does the whole
thing complete a lap" are three different questions with three different answers.

## 2. The rule that generates every gate

> **A gate must be unable to pass because a feature is absent.**

Four vacuous passes were found in a single day (two in Atlan's own suite, two in
`check.mjs`) — checks that went green because the thing they tested wasn't there.
Every gate below is written so that absence is a failure, and the standing
assumption is that **more exist and have not been found yet**.

Corollaries:
- **compile rate is a vanity metric.** Ten SOTA code LLMs achieve near-zero
  Play@3 *despite high compilation rates*.
- **a green static check is not a passing game.** It has earned the right to be
  measured.

## 3. The seven tiers

| tier | asks | how measured | basis |
|---|---|---|---|
| **1 · Hygiene** | parses; assets conform; schemas validate; **every index resolves** | pure code | the 81-of-99 error class; ROM tables crashed on a dangling index |
| **2 · Runs** | boots; **lit pixels > 0**; fixed step present; dt clamped; no per-frame allocation | pure code + `gl.readPixels` | attempt 2 died here at 20/20 |
| **3 · Playable** | bot completes the slice; every dungeon provably reachable *and exitable*; no softlock; win state achievable | graph search + play-bot | Play@k — the barrier nobody has cleared |
| **4 · Balanced** | **no composition degenerate**; **every reasonable composition can finish**; XP curve monotonic; accuracy monotonic in Hit%; no zone-N one-shot; every spell learnable; every key item obtainable; economy solvent | invariants + **state injection** | **Ito's two-sided test**; the FF1 accuracy clamp |
| **5 · Paced** | encounters ≈ minimum to next XP threshold; battle-length p50/p95; grind ratio; time-to-first-decision | derived numbers | the documented "lazy maps + high encounter rate" failure |
| **6 · Perceptual** | silhouette distinctness; palette separation; legible at native size; 8 audio cues present; **vision check: does the frame show what the spec says** | computable + one multimodal call | Toriyama at 16×16; Sugiyama's eight themes |
| **7 · Comparative** | story coherence, writing, character distinctness, is it any good | **relative, never absolute** — §6 | the subjective bar |

### Tier 4 in detail — the headline invariant

Hiroyuki Ito established FF5's job balance by **playing**: hunting combinations
that made a party effectively invincible, while verifying diverse compositions —
including an all-Monk party — could still beat the final boss. Stated as a
property, measured twice:

- **no composition is degenerate** (nothing trivialises the game)
- **every reasonable composition can finish** (the all-Monk test)

He brute-forced it. We use **runtime state injection** (GameGen-Verifier's
method): synthesise a state satisfying a keypoint's precondition and inject it,
rather than playing from the start. A level-20 party vs the final boss is
testable **without grinding to level 20**, which makes the invariant cheap and
parallel.

### The monotonicity family — the bugs playtesting cannot see

FF1 shipped with Base Chance to Hit **clamped at 255 before evasion is
subtracted**, so past a threshold, stacking accuracy silently stops working. It
survived for years. Assert across the *full* stat range:

- accuracy monotonic in Hit%
- damage monotonic in Attack
- XP thresholds strictly increasing
- no stat overflow at max level

### Anti-softlock guarantees are placed, not emergent

FF1's "minimum 1 damage" is a deliberate floor. Ours: every fight winnable by an
on-level party; every dungeon reachable and exitable; no resource state that
cannot recover.

## 4. The four qualification stages

Components earn admission to the assembly the way a car is built:

| stage | what runs | what it proves |
|---|---|---|
| **bench** | one component alone | it works at all |
| **mated** | two components, where the second already passed bench | the interface holds |
| **subsystem** | a group | they cooperate |
| **full trip** | the whole machine, one lap, end to end | **the only grade** |

Everything before the lap is *permission to be on the track*. A component that
passes bench but fails mated does not enter the assembly.

## 5. TRAVERSAL DEPTH — the score

Pass/fail is brittle. A failed run tells you almost nothing, and that is exactly
the floor effect that would make early ablations uninterpretable — the
single-pass study's 10,400 runs at zero success taught a taxonomy and nothing
about which condition was better.

> **The score is how far along the chain the trip got.**

`cleared 7 of 12 gates, stopped at the render gate` is a graded result with real
resolution. It means:

- a run that never finishes **still produces signal**
- a factor moving you from gate 5 to gate 9 **registers as an improvement even
  though nothing shipped**
- the sweep has something to correlate against when nothing works yet
- early rungs get a target that is not binary: **get further than last time**

The full lap remains the only *success*. Traversal depth is how progress toward
it is measured.

It also answers *to what ends the strengths are*: **where runs consistently
stall is where the system is weak; how far they reliably get is where it is
strong.** That falls straight out of recording depth per run instead of a bit.

### Reporting shape

```
depth        7 / 12
stopped_at   render.litPixels
tier_reached 2
stage        full-trip
how          stuck        (same signature 2x — more iterations will not help)
```

`how` comes from `iterate`'s classification and is part of the score:
**stuck** and **exhausted** at the same depth are different findings.

## 6. Making tier 7 honest

You cannot score "good writing" absolutely. You *can* score it structurally and
relatively, and those are real numbers:

| bar | measured as | determinism |
|---|---|---|
| **consistency** | vocabulary-lock violations, count | fully deterministic |
| **distinctness** | pairwise similarity between characters/monsters below threshold | computable |
| **coverage** | every character has a defined arc beat; every region has its cues | fully deterministic |
| **quality** | **blind A/B against a reference** — cross-model panel, contextless, candidate and reference *unlabelled*, majority vote | reproducible, not absolute |

**Tier 7 is never "ask a model if it's good."** It is structural checks plus a
blind comparative panel — the gauntlet doing what the gauntlet is for. Reviewers
get no authorship context and are **cross-model**: Codex and Gemini review
Claude's output, never Claude reviewing Claude, because a model is
architecturally incapable of neutrality about its own work.

## 7. Gates open in order

**Story coherence is not measured until mechanics pass.** A beautiful world with
a broken battle system fails at tier 4, and tier 7 on it is noise.

| rung | tiers gated |
|---|---|
| 0 / 1 — walls, characters, endless battles | **1–4** (all deterministic, all cheap) |
| 2 — a bigger place | + **5** |
| 3 — a land | + **6** |
| 4 — the golden chariot | + **7** |

Each rung's gate is the **entry condition** for the next experiment, and each
opened tier promotes proven components into the pool.

## 8. What is void versus what merely failed

| outcome | mechanism | meaning |
|---|---|---|
| **void** | `fuse` | the contract or the gate moved, or a wall was bypassed. The result means nothing and cannot be reset past. |
| **stopped** | `breaker` | spend or repeated failure. The run ended early but its partial result is still evidence. |
| **failed** | `ground` | a gate said no. Depth is recorded; this is a normal, informative outcome. |
| **refused** | `sink` | output did not clear its gate, so it is not a deliverable. |

**`check.mjs` and the spec are never writable by a building role.** A role with
shell access and a red gate has an obvious cheap path to green. They are diffed
at the end; if they moved, the run is void.

## 9. GAP REGISTER — judgement

| # | gap | status | resolution |
|---|---|---|---|
| 1 | **Tier 6 and 7 are specified but unbuilt** | PLANNED | Rungs 3 and 4 need them; rungs 0–2 do not. Build when the gate opens, not before. |
| 2 | **"Reasonable composition" is undefined** | **OPEN** | Ito's all-Monk test needs a formal definition of which compositions must be able to finish. Every legal one? Every single-job one? Needs a decision before tier 4 can be implemented. |
| 3 | **Gate weighting in traversal depth** | **CLOSED** | Decided 2026-07-28. **A gate is binary — no partial credit, ever.** The stored artifact is a **per-tier depth vector**; the canonical score is the **unweighted sum**, and every statistic computes on that so it can never be retroactively rescaled. Weighting becomes a **bracket** applied at analysis time and re-appliable to historical runs, since the raw vector is retained. Pre-register the canonical scalar (`METHOD.md` #9) so post-hoc weight-shopping cannot creep in. Rationale: weights are an un-versioned input to every stored verdict, and they compress signal in the gate range where all early data actually lives while amplifying it where there is none. |
| 4 | **Blind-panel agreement threshold** | PLANNED | Majority of an odd panel, cross-vendor, with disagreement recorded rather than resolved. Panel size to be set by the diminishing-returns finding (past ~5 seats, correlated). |
| 5 | **Silhouette distinctness metric** | PLANNED | Computable (alpha-mask IoU + palette distance) but the threshold is unset; calibrate against the FF1/DQ sprite set as a reference corpus. |
| 6 | **Economy solvency check** | PLANNED | "Can afford required gear by the time you need it" needs a formal statement over the shop/drop/price tables. Straightforward once the schemas exist. |
| 7 | **Pacing targets are relative, with no absolute anchor** | **OPEN** | "Encounters ≈ minimum to next XP threshold" is measurable, but the acceptable band is a design choice nobody has made. |
| 8 | **Our domain's failure taxonomy does not exist yet** | PLANNED | The hygiene/grounding split is Unity C#. Ours is an *output* of rung 0's sweeps, not an input. |

**Undecided and needed before tier 4 / traversal are implemented: #2, #3, #7.**
