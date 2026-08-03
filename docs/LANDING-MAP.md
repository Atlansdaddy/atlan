# THE LANDING MAP — every requirement, and where it lands

**Chariots of Atlantis.** Written 2026-07-31. Closes `BUILD-SHEET.md` #9.

`BUILD-SHEET.md` §0 sets the test: **every requirement must terminate in either a
pool component or a wall**, and anything landing in neither is decoration to be
cut. This document walks every requirement and applies it.

**§5 is the derived gate chain. §6 is the candidate component list. §8 is the gap
register.**

---

## 0. The rule needed a correction

Walking the sheet breaks the binary. **Four requirements landed in neither
category and none of them is decoration**, which means the rule as written would
have cut load-bearing work. The landing sites are:

| site | what it is | who executes it |
|---|---|---|
| **pool component** | instruction text the compiled prompt gives the fleet | a model |
| **wall** | a deterministic check that cannot pass because a feature is absent | code |
| **producer** | deterministic code that *expands* the compact spec into the corpus | code |
| **protocol** | an experimental-method obligation — sweep arms, pre-registration, reporting discipline | the method, not the run |
| **cut** | decoration | nobody |

**Producer** and **protocol** are the additions.

A producer is not a wall — it does not check anything, it *builds*. "Code supplies
the corpus" is the single most load-bearing line in the sheet and it is neither an
instruction nor a check. Filing it as a wall would have been wrong in a way that
mattered: a wall that also generates its own input is a vacuous pass by
construction.

A protocol item is not part of the run at all. "Run a bare-model single-sample
baseline arm" is an obligation on the *sweep*, not on the car. It has no home in
the artifact and would have been cut.

> **Proposed amendment to `BUILD-SHEET.md` §0:** every requirement terminates in a
> pool component, a wall, a producer, or a protocol item. Anything else is cut.

## 1. Novelty and comparability (§3)

| requirement | lands as | name |
|---|---|---|
| the artifact must be fully novel | **wall** | `novelty.noReferenceTerms` — the corpus's proper nouns intersected with a banned-terms list built from the reference must be empty |
| ...and | **pool** | *invent names; never reuse a name from prior art* |
| FF1 constants as calibration references, never content | **wall** | `balance.regimeComparable` — our damage/accuracy/evasion curves fall inside a declared band relative to the reference *shapes* |
| what transfers / what does not (the table) | **pool** | the table itself becomes an instruction component |

**`novelty.noReferenceTerms` needs an artifact that does not exist yet:** a
banned-terms list extracted from the reference corpus. Cheap, but it is a
prerequisite and nobody has written it.

## 2. The duty cycle (§4)

The four dyno questions land as four walls — **except one.**

| question | lands as | name |
|---|---|---|
| does it miss? | **wall** | `determinism.sameSeedSameTranscript` — run twice, transcripts identical |
| does it blow? | **wall** | `stress.survives` — N battles with no crash, overflow, softlock, or unbounded memory |
| what does it make? | **wall** | `stress.throughput` — correctness sustained at volume; results do not degrade under load |
| how much boost? | **gauge, not a gate** | `stress.headroom` — records max level, max stat magnitude, max party size, max simultaneous combatants, max status stacking, longest sustained chain |

> **A limit that is only recorded is a gauge. A limit with a target is a gate.**

`stress.headroom` cannot be a gate until `BUILD-SHEET.md` #3 sets the targets. It
should still be **built now and run now** — the numbers are needed to *choose* the
targets, and a gauge that has been reading for weeks is a better basis for a
threshold than a guess.

## 3. Battle, progression, content (§5)

| requirement | lands as | name / note |
|---|---|---|
| acting party 3–4 | **wall** | schema assert |
| verb set closed at 5 + one class verb | **wall** | `battle.verbSetClosed` — exactly the declared verbs exist, **and no more**. This is the anti-padding wall for mechanics |
| turn order by speed stat | **wall** | `battle.turnOrderMonotonicInSpeed` |
| targeting single and group, ranks | **wall** | `battle.targetingTotal` — every enemy reachable by at least one mode |
| resolution: hit → damage → mitigation | **wall** | `battle.resolutionOrder` — verified by injecting known values and observing order of application |
| status as a parallel layer | **wall** | `battle.statusIndependent` — status state advances independently of HP state |
| randomness bounded and legible | **wall** | `battle.damageBandBounded` — every roll inside the declared band over N samples |
| formulas of two to three terms | **pool** (+ weak wall) | instruction is primary. An AST term-count wall is possible but brittle; do not lean on it |
| explicit minimum-damage floor | **wall** | `battle.minimumDamageFloor` — for all stat combinations in range, damage ≥ 1 |
| stat vector ~5 + HP/MP | **wall** | schema assert |
| growth per-class, table-driven | **wall** | `progression.growthTabular` — growth is a table, monotone per class |
| XP curve exponential, strictly increasing | **wall** | `progression.xpStrictlyIncreasing` |
| encounter rate ≈ minimum to next threshold | **wall, blocked** | `pacing.encounterRateDerived` — **blocked on `GROUNDING.md` #7**, and tier 5, so it belongs to rung 2 |
| class system costly and legible | **pool** | plus `graph.ruleCountBounded` if we want the "one rule, three numbers" property enforced |
| content scale (~128/100/64/12/60) | **wall** | `budget.entityCounts` — counts inside a declared band. The anti-padding wall for content |
| **code supplies the corpus** | **producer** | the corpus generator |
| ...and its check | **wall** | `corpus.reproducible` — regenerate from the spec and byte-compare. **A hand-edited row fails.** This is the strongest wall available and it costs almost nothing |
| eight audio cues | **wall** | `audio.cuesPresent` — count and names |
| art: silhouette, palette, legibility | **wall, deferred** | computable, but the threshold is unset (`GROUNDING.md` #5) and tier 6 belongs to rung 3 |
| IDs allocated by code | **producer + wall** | allocator is a producer; `ids.noModelCoined` asserts no ID-shaped token appears in model output |
| referential integrity | **wall** | `refs.allResolve` — the link-checker |

## 4. Budget, story, provenance (§§6–8)

| requirement | lands as | name / note |
|---|---|---|
| systems code within a few thousand lines | **wall** | `budget.systemsLoc` |
| authored exceptions small and explicit | **wall** | `budget.exceptionCount` — plus every exception must be referenced by the generator, or it is dead |
| pyramid depth minimal | **wall** | `graph.depthBounded` — checkable because the production graph is design-time |
| world bible compiled once, only ever read | **wall** | `frame.readOnly` — bible hash unchanged during the run; a write **voids** via `fuse` |
| vocabulary lock | **wall** | `vocab.noUnregisteredTerms` — every proper noun in output appears in the terms file |
| story sets the shape, then guides | **protocol** | an ordering obligation on the production graph, not a check |
| prose written serially by one model | **pool** | |
| provenance auditable end-to-end | **wall** | `provenance.complete` — every artifact resolves to component + instruction-set hash + oracle values. Currently unbuilt (`BUILD-SHEET.md` #8) |
| `check.mjs` and spec unwritable by a builder | **wall** | `tamper.contractUnmoved` — diffed at the end; movement voids |
| intervention count | **blocked** | `BUILD-SHEET.md` #10 is OPEN — no measurement defined, so nothing to land |

## 5. THE DERIVED GATE CHAIN — rung 1

`GROUNDING.md` §8 opens tiers 1–4 at rung 1. Derived from the sheet rather than
assumed, the rung-1 chain is **26 gates, not 12.**

### Tier 1 · Hygiene
1. `parse` — everything parses
2. `schema` — all content validates
3. `refs.allResolve` — every cross-reference lands
4. `ids.noModelCoined` — no model-coined identifiers, no collisions
5. `vocab.noUnregisteredTerms` — no unregistered proper nouns
6. `budget.entityCounts` · `budget.systemsLoc` · `budget.exceptionCount`
7. `corpus.reproducible` — regenerates byte-identical from the spec

### Tier 2 · Runs
8. `boot`
9. **`render.litPixels`** — > 0 via `gl.readPixels`. *Attempt 2 dies here*
10. `loop.fixedStep` — fixed timestep present, dt clamped
11. `alloc.noPerFrameGrowth`

### Tier 3 · Playable
12. `bot.completesSlice`
13. `softlock.none` — no unrecoverable state; win state reachable

### Tier 4 · Balanced
14. `monotonic.accuracy` — in Hit%, across the full range
15. `monotonic.damage` — in Attack
16. `monotonic.xp` — strictly increasing
17. `overflow.none` — at max level
18. `battle.damageBandBounded`
19. `battle.minimumDamageFloor`
20. `battle.turnOrderMonotonicInSpeed`
21. `battle.verbSetClosed`
22. `battle.targetingTotal`
23. `composition.twoSided` — **blocked on `GROUNDING.md` #2**

### Stress — the family the twelve-gate draft omitted entirely
24. `determinism.sameSeedSameTranscript`
25. `stress.survives`
26. `stress.throughput`
— `stress.headroom` runs as a **gauge**, outside the count, until #3 sets targets

### Inspection — conformance, not performance (ladder stage 5)
These are not scored in traversal depth. **They are pass/void.**
- `novelty.noReferenceTerms`
- `balance.regimeComparable`
- `frame.readOnly`
- `tamper.contractUnmoved`
- `provenance.complete`

### What this changes

- **The assumed chain was under half the derived one**, and it was missing two
  whole families: stress and inspection. `BUILD-SHEET.md` #7 predicted the first;
  the second was unnoticed.
- **The depth denominator moves**, so `7/12`-style scores are not comparable
  across chain revisions. The chain must therefore be **versioned and hashed**,
  exactly like the component pool — otherwise traversal depth has the same silent
  staleness problem as `METHOD.md` #3. This is a new gap.
- **Inspection gates must not be counted in depth.** They are conformance; a
  conformance failure voids rather than scoring lower. Mixing them into the
  denominator would make an illegal car look like a slow one.

## 6. CANDIDATE COMPONENT LIST — the domain-shaped pool

Each enters the pool **unproven**. None may reach an assembly without an `ADOPT`
verdict from a sweep (`METHOD.md` §6). Proposal is cheap; the evidence gate is the
expensive part.

| # | component | kind |
|---|---|---|
| C1 | the verb set is closed at five plus one class verb; do not add verbs | constraint |
| C2 | formulas are two to three terms; there is no simulation | constraint |
| C3 | randomness is a bounded legible band, never a distribution | constraint |
| C4 | place an explicit minimum-damage floor | requirement |
| C5 | the stat vector is five stats plus HP/MP | schema |
| C6 | growth is a per-class table, modest per level | schema |
| C7 | produce a compact design spec; code expands the corpus | architecture |
| C8 | propose *concepts*, not rows — twelve monster concepts, not forty monsters | scoping |
| C9 | never coin an identifier | prohibition |
| C10 | never invent a proper noun outside the terms file | prohibition |
| C11 | cite the world bible; never re-derive the world | grounding |
| C12 | the exception list is the only authored surface; keep it small | scoping |
| C13 | eight audio cues, named | schema |
| C14 | silhouette-first: readable by shape before colour | requirement |
| C15 | the transfers/does-not-transfer boundary | constraint |

**C7 and C8 are the thesis.** If the generation-minimal claim is right, those two
carry most of the effect, and the sweep should be able to see it.

## 7. PROTOCOL ITEMS — obligations on the method, not the artifact

These would have been cut by the original rule. All are live.

| # | obligation | source |
|---|---|---|
| P1 | run a **bare-model single-sample baseline arm** so a matched comparison to published Play@1 exists | §2 claims discipline |
| P2 | pre-register thresholds before the run — 3% / 50% | §2, `METHOD.md` #9 |
| P3 | a number never travels without its protocol | §2 |
| P4 | the ❌/✅ one-shot definition travels with every external claim | §2 |
| P5 | ablate the feedback path (present vs. absent) so the loop's value is quantified | `METHOD.md` §4 |
| P6 | story sets the shape *before* parallel execution begins | §7 |
| P7 | transferability tags recorded per subsystem | `METHOD.md` #8 |

## 8. GAP REGISTER — the landing map

| # | gap | status | resolution |
|---|---|---|---|
| 1 | **The gate chain is unversioned** | **OPEN** | Deriving the chain moved the depth denominator from 12 to 26. Scores are not comparable across chain revisions unless the chain is content-hashed and recorded with every run — the same staleness problem as `METHOD.md` #3, in a place nobody was watching. |
| 2 | **Inspection gates have no home in the score** | **OPEN** | They are pass/void, not graded. Proposal: they sit outside traversal depth entirely and a failure routes to `fuse`. Needs confirming, because it changes what a "failed run" means. |
| 3 | **The banned-terms list does not exist** | PLANNED | `novelty.noReferenceTerms` needs proper nouns extracted from the reference corpus. Cheap, unwritten, and a prerequisite for inspection. |
| 4 | **`composition.twoSided` is blocked** | **OPEN** | Carried from `GROUNDING.md` #2. It is now the **only** rung-1 gate that cannot be written, which makes it the highest-value open decision. |
| 5 | **`stress.headroom` has no target** | **OPEN** | Carried from `BUILD-SHEET.md` #3. Build and run it as a gauge now; the readings are the honest basis for setting the target later. |
| 6 | **Term-count wall is brittle** | PLANNED | The two-to-three-terms requirement is enforced by instruction (C2) and only weakly by AST inspection. If it matters, it needs a better mechanism than parsing. |
| 7 | **`BUILD-SHEET.md` §0's rule is wrong as written** | **CLOSED** | Applied 2026-07-31. §0 now admits four landing sites — pool component, wall, **producer**, **protocol** — and records both failure cases that forced it. |
