# THE MACHINE — architecture and design philosophy

**Chariots of Atlantis.** Written 2026-07-28. This is the *concept of the
machine by which the work is performed*: what it is, why each part exists, and
what it deliberately refuses to do.

Companions: `GROUNDING.md` (how output is judged) · `METHOD.md` (how we learn
what to build) · `PRIOR-ART-JRPG.md` · `PRIOR-ART-ONESHOT.md` ·
`ATLANTEAN-RESUME.md` (state).

**§9 is a register of every known gap.** It is part of the design, not an
appendix — a design document that claims completeness is lying.

---

## 1. What the machine is, in one paragraph

A **routine that fires a whole trip.** The entire assembled system runs once,
end to end, unattended, and puts verified output in a sink. Components are
admitted to the assembly only after proving themselves alone, then in pairs,
then as subsystems. The only real grade is the complete lap. Everything before
it is qualification to be allowed on the track.

## 2. The governing idea: deterministic control, oracle values

The **program** is deterministic — order, branching, loops, protection, all
fixed at design time. At declared points it asks for something it cannot
compute: a model's output, a measurement, an aggregate. That value binds a
variable or bounds a loop; the deterministic machinery carries on.

This is the **oracle machine** shape, and in circuit terms it is a
**mixed-signal system**:

| circuit | ours |
|---|---|
| digital logic — clocked, deterministic | the circuit topology |
| analog domain — continuous, noisy, unbounded | the model |
| **ADC** — samples the analog world and *quantizes* it into a discrete value | **the structured command + its checkers** |
| sensor / reference | ground, test points |

**The ADC is why structured commands matter so much.** A raw model call wired
straight into deterministic logic is analog on a digital pin. The checker is
the quantizer: it forces a fuzzy output into a validated discrete value, or
rejects it. Demonstrated live — `RENDER_VERDICT` on the free local 35B: fuzzy
judgement in, `renders: yes|no` plus four bounded integers out, 9/9 checkers,
1,235 tokens.

**Consequence:** a value may enter control flow **only through a checker**.
An unchecked model value setting a loop bound is an unbounded run.

## 3. Why a circuit and not a role graph

In a role graph, safety is *configuration*: "halt on budget" and "may not write
back" are properties set on a node — easy to forget, invisible when reading.
As **components** they are things you can see **missing**. Nobody asked "where
is the check valve on the build stage?" before attempt 2, because in a graph
there was nothing to look for.

### The load-bearing property

> **One-shot is a feed-forward circuit. Iterate-to-green is a circuit with
> feedback.**

Not analogy — a precise restatement of the experimental variable. The
single-pass literature's core complaint is that repair loops *"conflate what the
model writes with what the loop fixes."* A `checkValve` makes the loop
physically impossible; a `feedback` component makes it measurable. Attempt 2
shipped an unintended feedback path — a build driver grinding the checker green
in 336s — and then measured the oscillation.

## 4. The component set

Implemented in `server/src/circuit.js`; 37 tests, zero model spend.

### Topology
| component | what it does |
|---|---|
| `series` | sequential; **order is the wiring**, not a timing concern |
| `parallel` | fan-out; results collected **stable-sorted by id, never arrival order** |
| `circuit` | a named, composable subcircuit |

### Sources and loads
| component | what it does |
|---|---|
| `source` | pure input; no model, no side effects |
| `load` | a worker — engine-agnostic: a fleet run, a CLI agent, a chat brain, or a stub |

### Protection
| component | what it does |
|---|---|
| `breaker` | **resettable.** Trips when spend or failure exceeds a threshold |
| `fuse` | **one-shot, not resettable.** Blows and the run is void permanently — the tamper check, where being able to reset past it would defeat the point |
| `resistor` | limits flow through a branch — spend and wall-clock caps |
| `transformer` | steps the tier up or down for everything inside |
| `checkValve` | **one-way.** Deep-freezes its output so downstream physically cannot write back |

### Measurement
| component | what it does |
|---|---|
| `ground` | the deterministic reference — a checker in code, no model in it |
| `testPoint` | reads without perturbing; a throwing probe cannot break the circuit |
| `sink` | the terminal that **refuses anything which has not cleared its gate** |

### Variance and loops
| component | what it does |
|---|---|
| `dither` | bounded, **seeded** perturbation — noisy is not the same as random |
| `iterate` | bounded loop that **classifies** its ending: converged / stuck / exhausted |
| `accumulate` | loop-until-dry; stops when N rounds produce nothing new |
| `feedback` | the deliberately-placed loop whose purpose is to be ablated |

### Why `dither` exists
Parallel samples from one model on one prompt come back **correlated** — N near
copies, not N perspectives. For gauntlet seats that means fewer findings; for
sweeps, a point estimate wearing a distribution's clothes. Dither is the
standard fix and it is literal: small bounded noise added to improve measurement
resolution. Seeded, so perturbation is reproducible.

### Why `iterate` classifies rather than counts
**The same failure twice and two different failures both read as "2 iterations"
and mean opposite things.**

- **stuck** — same signature recurred. *More iterations will not help.* Change
  tier, change approach, or stop.
- **exhausted** — still producing new results at the bound. *Raising the bound
  may help.*

Deliberately opposite advice; a retry that cannot tell them apart grinds forever
on the first and gives up too early on the second. Both read off a
caller-supplied **signature** — "is this the same thing we already saw?"

### Why `sink` exists
Attempt 2's output was *whatever happened to be on disk when it stopped*. A sink
makes that ambiguity structurally impossible: one answer to "what did this run
produce," and unverified work cannot drift into the deliverable.

## 5. Determinism, and why it is not hygiene

**It is a precondition of the science.** If ordering is nondeterministic, two
runs with identical factors differ for unattributable reasons and every ablation
is uninterpretable.

Mechanisms:
- seeded PRNG threaded throughout; child seeds derived stably, so adding a
  branch does not perturb its siblings
- parallel results **stable-sorted by id**
- a **deadline on every await** — a hang is a recorded outcome, not a wedge
- `transcript.js` records every oracle value, giving:

> **the run is deterministic given (seed + oracle transcript)**

Keys are **positional** (component path, nth call), never content-hashed —
hashing the prompt is the obvious choice and is wrong, because a prompt that
legitimately varies (dither, an upstream value) would miss its own recording and
silently fall through to a live call, producing a "replay" that is a fresh run.
**A miss therefore throws.**

## 6. The instruction set is a build artifact

`server/src/assembly.js`. The one-shot prompt is **not written — it is
compiled** from a pool of small, individually-proven components. The gate:

> **a component may enter a one-shot assembly only if a sweep recorded an ADOPT
> verdict for it**

Nothing gets in because it sounded good. Attempt 2's spec was authored from
intuition, and the thing that killed it — nothing on screen — was not in it.

- **Emission order is fixed by KIND**, not per component, so adding a fragment
  cannot reshuffle a prompt and invalidate prior measurements.
- **Grounding is emitted first.** Not stylistic: 18 of 99 error codes in the
  single-pass study were grounding failures, and model scale provably does not
  fix them — only supplied knowledge does.
- Assembly is deterministic regardless of insertion order, and **hashed**, so a
  run is attributable to an exact inspectable instruction set.
- The pool **accumulates across rungs**. By the top rung, "one shot" means one
  shot into an instruction set that four rungs of measurement assembled.

## 7. The car, mapped completely

| part | ours |
|---|---|
| **engine** | the models — the energy source, *not* the driver |
| **fuel** | tokens; subscription tiers are flat at the margin, free tiers are free |
| **transmission** | the tier/routing layer (`transformer`) — how much power reaches each component. Tuning it changes *which tier does what* without touching the topology |
| **route** | the circuit topology |
| **gauges** | test points and the probe log |
| **sink** | where verified output collects — the deliverable |
| **the driver** | the power flowing through, not any single component. No one agent owns the outcome |
| **the track** | the full trip, start to finish |

### Qualification, the way a car is built

1. **bench** — engine spun by hand, alone
2. **mated** — engine on the transmission, *because the transmission passed its
   own tests first*
3. **subsystem** — groups running together
4. **full trip** — the car on the track, one lap, end to end

**Only the lap is a grade.** Everything before is permission to be on the track.
This is orthogonal to the grounding tiers in `GROUNDING.md`: those say *what* is
measured, these say *at what level of integration*.

## 8. What the machine deliberately will not do

- **No runtime planner.** Decomposition is design-time. A planner agent is the
  largest source of compounding error and is unnecessary when the graph is known.
- **No self-critique as a wall.** Documented not to reliably improve output.
  Walls are code; review is cross-model.
- **No model in the analysis.** Correlations and verdicts are arithmetic. A
  model summarising the results would contaminate the measurement with the thing
  being measured.
- **No agent creates work.** Agents may ask; only the orchestrator spawns.
- **No unbounded loop.** Every loop has a bound and a classified ending.
- **No Ohm's law.** The parts of the metaphor that map, map. The rest is
  dropped. Computing impedance means we have stopped designing.

## 9. GAP REGISTER — known holes, and how each is closed

Listed because a design document claiming completeness is lying. Status is
**CLOSED** (resolved here), **PLANNED** (resolution decided, unbuilt), or
**OPEN** (needs a decision).

| # | gap | status | resolution |
|---|---|---|---|
| 1 | **Who proposes candidate components?** | PLANNED | Design-time human, plus a model *proposing* candidates that enter the pool unproven. Proposal is cheap; only the evidence gate is expensive. A proposed component with no sweep can never reach a one-shot. |
| 2 | **One-at-a-time sweeps cannot see INTERACTIONS** (A helps only with B) | **OPEN** | Real limitation, honestly labelled in `sweep.js`. Mitigation: after the one-at-a-time pass, run a small factorial over the ADOPTed set only. Needs a decision on budget. |
| 3 | **Signature design per gate** | PLANNED | Each gate declares its own signature. Too coarse → progress looks like sticking; too fine → sticking looks like progress. To be tuned empirically per gate at rung 0. |
| 4 | **Who picks the calibration target size?** | PLANNED | Automated shrink: start at the intended slice, halve scope until baseline lands in the 0.2–0.8 informative band. `calibration()` already detects floor/ceiling; the shrink loop is unbuilt. |
| 5 | **A component that helps at rung 1 but hurts at rung 3** | **OPEN** | Evidence is currently unscoped. Needs `evidence.scope` (which rung/target it was measured against) and a rule for re-measurement on scale change. |
| 6 | **Agent↔agent communication** | PLANNED | Unbuilt. Mailboxes, correlation IDs, park-don't-spin, orchestrator-owns-work-creation. Deliberately deprioritised: Chrono Trigger's thirty-odd people stayed coherent via a **compiled frame**, not bandwidth. The frame matters more and is cheaper. |
| 7 | **Program-level budget** (per-run exists; total does not) | PLANNED | A program budget above the routine, with the sweep halting rather than the individual run. |
| 8 | **Failure taxonomy for OUR domain** | PLANNED | The single-pass study's hygiene/grounding split is for Unity C#. Ours must be built empirically for JS/WebGL2/RPG at rung 0 — it is an output of the first sweeps, not an input. |
| 9 | **Art and audio qualification** | PLANNED | Sketched in `GROUNDING.md` tier 6 (silhouette distinctness, palette separation, legibility at native size, 8 cues present, vision check). Specification exists; implementation does not. |
| 10 | **Where does the human intervene?** | **OPEN** | The hierarchy has `humanGate`; the circuit has none. Needs an explicit component and a policy for which gates are human-gated. Attempt 2 had none and nobody noticed the black screen. |
| 11 | **Policy for fuse vs breaker** | PLANNED | Mechanism exists, policy is unwritten. Proposed: **fuse** = the contract or the gate moved, or a wall was bypassed (run is void). **breaker** = spend or repeated failure (run is stopped but not invalidated). |
| 12 | **Pool versioning** | **OPEN** | Components change; evidence was measured against a version. Needs a content hash per component and invalidation of evidence when the text changes. Currently a silent staleness risk. |
| 13 | **Secondary-value instrumentation** | PLANNED | Each subsystem carries a transferability tag; the sweep records both game-relevance and standalone class-of-problem value, so a failed game still yields a value map. Designed, unbuilt. |
| 14 | **Traversal depth** | PLANNED | The metric — "how far along the chain it can traverse" — solves the floor-effect problem that would otherwise make early ablations uninterpretable. Specified in `GROUNDING.md` §5, unbuilt. |
| 15 | **`spawnRun` has no engine field** | PLANNED | The fleet is still Claude-only. `agentExec` exists; the product decision (walls for a non-Claude fleet run) does not. |
| 16 | **Uneven walls across tiers** | **OPEN** | A Haiku builder and an Opus builder must be gated **identically** or the cheap tier becomes the soft spot. More tiers makes the profile-projection work matter more, not less. |

**Three of these are genuinely undecided and should be decided before rung 1
runs: #2 (interactions), #10 (human gates), #12 (pool versioning).** The rest
have a resolution and need building.
