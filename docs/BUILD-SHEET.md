# THE BUILD SHEET — what this engine is being built to do

**Chariots of Atlantis.** Written 2026-07-28. **This is the top of the top-down
chain.** Every threshold in every wall below cites this document. Nothing below
picks a number locally.

Companions: `MACHINE.md` (how it is built) · `GROUNDING.md` (how it is judged) ·
`METHOD.md` (how we learn) · `PRIOR-ART-JRPG.md` (where the requirements are
derived from) · `ATLANTEAN-RESUME.md` (state).

**§10 is the gap register.**

## Status: a spec, not a standard

**This is the specification for one experimental test.** It is provisional,
revisable, and specific to this run. Nothing here is hard-coded into the machine —
the machine is agnostic (§1), and this document is one destination typed into it.

The conditions are worth stating plainly, because they cut both ways. This is one
person, at home, around a full-time job, measuring against results published by
funded lab teams. What that costs is obvious: no dedicated infrastructure, no
team, no uninterrupted weeks, and every run has to survive being picked up cold.

What it buys is less obvious, and it is the actual competitive position
(`METHOD.md` §7). Published work is compute-constrained and pays per token, so it
runs a few conditions and reports a taxonomy — the Unity study spent 10,400
records to learn that the target was mis-sized. Here every Claude tier is
flat-rate on a subscription, two tiers are free, the walls score runs
automatically with no human in the loop, and there is no publication timeline and
no compute budget to justify to anyone.

> **A hundred small, automatically-scored attempts overnight is something a lab
> cannot easily afford and this setup can.**

That is not a claim to beat them. It is a claim to be able to run the experiment
they cannot afford to run.

---

## 0. Why this document exists

Attempt 2's spec was authored from intuition, and the thing that killed it —
nothing on screen — was not in it. An engine assembled from individually correct
parts still fails qualification when nobody wrote down what it was being built
to survive.

**Principle #1 (John, 2026-07-28).** A component's acceptance criteria are set by
the application above it. A billet is not "good steel" in the abstract — it is
adequate or inadequate *for the part it becomes*, which is adequate or inadequate
for the assembly, which is adequate or inadequate for the vehicle, which is
adequate or inadequate for the track and the time it must set.

An engine assembled from pistons, rods, rings, bearings and oil will *run*. That
is not the question. The question is whether it was spec'd — for torque, for
load, for boost, for sustained high RPM — and that question has to be answered
**before** the parts are chosen, because it cannot be retrofitted.

The chain of derivation has to terminate somewhere. **It terminates here.**

### What we are actually building

**Not the car. Not even the factory.** We are building the **blueprint for the
prompt** that fills the factory — that chooses the materials, shapes them,
assembles them into components, composes components into subsystems, subsystems
into systems, and the systems into a car that goes around the track and sets a
time.

`MACHINE.md` §6 states the mechanism: the one-shot prompt is **not written — it
is compiled** from a pool of small, individually-proven components.

That fixes this document's audience. **The build sheet is read by the prompt
compiler, not by a builder.** Which puts a hard test on every line in it:

> **Every requirement here must terminate in either a pool component or a wall.**

- a **pool component** — something the instruction set tells the fleet, which has
  earned an `ADOPT` verdict from a sweep before it may enter an assembly
- a **wall** — something deterministic code checks, written so that it cannot
  pass because a feature is absent

A requirement landing in neither is decoration. It will not survive to the car,
and under the minimality rule it gets **cut, not carried**.

This also makes the build sheet the **domain source of candidate components**.
`METHOD.md` §4's candidate table is currently harness-shaped — reference example
in context, API docs in context, scaffolding present or absent. This document
supplies the *domain*-shaped candidates. It is a partial answer to `MACHINE.md`
gap #1, *who proposes candidate components?* — this does, and they enter the pool
**unproven**. Proposal is cheap; only the evidence gate is expensive.

## 1. The stated goal

> A full FF1–3-class RPG, end to end, with **equivalent or better componentry and
> performance** — built by a fleet of AI models working in small deterministic
> scopes, holding coherency across all of them.

Not an homage, not a slice, not a demo, not a tech showcase.

### The machine is agnostic — this is one car

**The machine does not build RPGs. It builds to a build sheet**, and the RPG is
one car type built for one purpose. Circuit, walls, sweep, assembly and
containment are form-independent; what makes this vehicle a dungeon-crawler is
*this document*, not the machinery.

**So this file is an instance, not a fixture.** A different build sheet — another
genre, another artifact class entirely — drives the same assembly line to a
different vehicle. `METHOD.md` §8 already records each subsystem's
transferability as a consolation if the game fails; this states the same thing as
a **design constraint** while it is still succeeding.

The practical consequence, and it is enforceable: **nothing in the machine may
hard-code an assumption that lives in this document.** Where a wall needs an RPG
fact, it reads it from here.

### The product, in one line

> **Tesla FSD for video games — put in a destination, get driven there.**

The build sheet is the destination. The human sets it and does not drive. And a
destination has to be well-formed: FSD takes an address, not a vibe. "Make me a
good RPG" is not a destination — this document is what turns intent into
coordinates.

Where the analogy holds, and where it deliberately breaks:

| FSD | ours |
|---|---|
| you supply a destination, not a route | you supply a build sheet, not a decomposition |
| the vehicle plans its route at runtime | **we do not.** `MACHINE.md` §8 forbids a runtime planner — the route is the circuit topology, fixed at design time |
| autonomy is graded in levels, hands-on → mind-off | the rungs are an **autonomy ladder**; rung 4's "no human turns" is Level 5 |
| measured in miles per disengagement | measured in **traversal depth per human-gate trip** — and we do not yet record the second half |

### The game is the proving ground, not the product

**The deliverable is the system and the data it produces.** The RPG is the test
case — chosen because it is the hardest one available at this scale, not because
the goal is to ship a game.

`METHOD.md` §8 currently frames transferability as *value if the game fails
entirely*. **That framing is inverted.** Transferability is the point; the game
is how it gets proven. A system sophisticated enough to build a coherent RPG end
to end is a system that can be pointed at other work — that is the claim under
test, and it is why the machine is agnostic by construction rather than by
accident.

### Why every job is small

The published attempts hand **one agent a whole game.** PlayEval prompts a model
for an application; GameCraft-Bench hands an agent a spec, a workspace and shared
assets and asks for a finished Godot project. Those are long-horizon tasks, and
long-horizon is precisely where error compounds.

**Here every agent gets a job far smaller than any of those**, and the sum of
those outputs is what produces the artifact. That converts one long-horizon
problem into many short-horizon problems with deterministic walls between them,
each independently verifiable, each cheap to redo.

**This is GameGen-Verifier's insight applied to the other half of the pipeline.**
They decomposed *verification* into bounded local keypoint checks rather than a
global trajectory judgement, precisely because long-horizon correctness is not
locally observable. This decomposes *generation* the same way. In the surveyed
literature the verification half is published and **the generation half is not.**

**The autonomy reading gives `MACHINE.md` #10 its shape.** A human gate is a
driver touching the wheel. The ladder then becomes a *schedule for removing
them*: every rung must retire a class of intervention, or rung 4's one-shot claim
is unreachable by construction. That converts the open question from "where does
the human intervene" into "**what is the disengagement schedule**" — a
substantially easier thing to answer, and one that can be checked.

It also exposes a hole in the score. A run reaching gate 9 with two human
interventions is plainly worse than a run reaching gate 8 with none, and
traversal depth as specified **cannot express that.** Distance without a
disengagement count is not an autonomy measurement.

## 2. The bar is competitive, not indie-fun

This is the most consequential line in the document, because it sets every
tolerance beneath it. The same parts list builds a car for weekend fun and a car
that lines up against another shop's car — and the difference is entirely in the
tolerances, never in the parts.

**Ours lines up against the genuine article.** The measurement is a **blind
adversarial comparison** — `GROUNDING.md` §6's tier-7 panel: candidate and
reference *unlabelled*, reviewers cross-model and contextless, majority vote.

That panel is not a nicety appended at rung 4. **It is the finish line the entire
build is aimed at,** and every rung below it is qualification to be allowed on
the track.

### The defining qualification: it completes the track

Before any comparison is possible, this car has to **go down the strip start to
finish.** Not compile. Not render. Complete a lap. That is `GROUNDING.md` §4's
full trip, and in the literature it is **Play@k** — which is exactly where the
frontier sits: published state of the art for playable-in-three-tries is roughly
**20% Play@3** after a purpose-built intervention, and ten SOTA models score
near-zero without one (`METHOD.md` §7).

Attempt 2 is the proof that this is the real barrier and not a formality:
**20/20 on `check.mjs`, 5 of 12 gates, black screen.** Every static check green on
a build that draws nothing.

**A car that does not finish has no time, and a car with no time cannot be
compared to anything.** Track completion is therefore the *entry condition* for
tier 7, not a parallel goal.

### What counts as a win

The bar is competitive and the odds are long. Both are true, and the thresholds
get set **before** the run rather than negotiated after it:

| result | reading |
|---|---|
| **~3% Play@1 on a full RPG slice** | **A win.** Published one-shot state of the art is ~6.6% Play@1 on 43 *small GUI applications* — a dramatically easier target than an RPG. Landing in that numeric neighbourhood on this one, built solo and part-time, is a frontier result and not a consolation prize. |
| **~50%** | **Top level.** The best published Play@3 anywhere is 20.3% *given three tries*; GameCraft-Bench's strongest agent scores 41.46% on a rubric, not on playability. 50% on a harder target would be substantially beyond the state of the art — and a system that reliable is complex enough to be pointed at other domains. |
| **0%, instrumented** | Still a result. Traversal depth records where it stopped; the value map records which subsystems transferred. |

> **The only outcome that produces nothing is an uninstrumented one**
> (`METHOD.md` §8).

**Thresholds are written down before the run, not negotiated after it.** "3% is a
win" is defensible stated in advance and indistinguishable from moving the
goalposts if stated afterward. This is `METHOD.md` #9's pre-registration
requirement applied to the headline number.

### Claims discipline — what would actually make this cheating

Nothing about a harness, a fleet, or iteration is cheating. **PlayCoder is a
harness** and is published on PlayEval at 20.3% Play@3, reported alongside the
base models. **GameCraft-Bench is an agent benchmark** that supplies a workspace,
shared assets and tools. The single-pass Unity study banned repair loops for a
stated reason — loops *"conflate what the model writes with what the loop fixes"*
— because it was measuring **intrinsic model capability**. That is a different
objective. This measures **harness capability**, where the loop is not a
contaminant but the subject, and `METHOD.md` §4 ablates it (*feedback path
present vs. absent*) so its contribution is quantified rather than hidden.

Three things *would* make it cheating. Each already has a countermeasure:

| the failure | countermeasure |
|---|---|
| **Protocol mismatch in a claim** — quoting our Play@1 beside a published Play@1 that was a bare model, one sample, no tools, no repair | a number never travels without its protocol; run a **bare-model single-sample baseline arm** in the sweep so a matched comparison actually exists |
| **"One shot" read as one prompt to a bare model** | `ATLANTEAN-RESUME.md` §9's ❌/✅ definition travels with every external claim, not just the internal doc |
| **Grading our own homework** — walls quietly tuned until green | `check.mjs` and the spec unwritable by any building role, diffed at the end, `fuse` voiding non-resettably (`GROUNDING.md` §8), plus the contextless cross-model gauntlet |

**Supplying knowledge in-context is not cheating.** Reference examples, API
surface, scaffolding — the Unity study's central finding is that supplying
knowledge is the *only* lever that fixes grounding, since scale does not and
schemas do not. Using the documented remedy is engineering. It becomes cheating
only if the result is then reported as a model-capability finding.

**In the product frame the question does not arise at all.** A blind comparison
against a real game does not care how it was built; nobody claims a thirty-person
team cheated. The only rules there are that the artifact is genuinely ours and
genuinely novel — which is §3.

### The provenance claim is part of the result

The other shop's car was built by a team of humans over a year. Ours is built by
models working in small deterministic scopes. **That claim is only worth making
if it is auditable** — which promotes the transcript, the assembly hash and the
production record from scientific hygiene to *evidence*. A win we cannot
demonstrate was machine-built is not the result we are after.

Concretely, the run must be able to answer: which component produced this, from
which instruction set, at which hash, with which oracle values.

## 3. Novel, and comparable — the boundary

Inspiration is drawn from the prior art. **The artifact must be fully novel.**

| transfers | does not transfer |
|---|---|
| system architecture — separable world traversal and encounter resolution | names, characters, places, monsters, spells, items |
| formula *shape* — two-to-three terms, bounded legible randomness | any specific text, dialogue or flavour |
| the two-sided balance invariant (Ito's method) | art, sprites, palettes, music, sound |
| explicit anti-softlock floors | the FF constant set as shipped content |
| integer IDs, table-driven content, referential integrity | job/class names and their identities |
| gated traversal as the pacing spine | the abbreviation, the naming convention, the branding |
| silhouette-first readability as an art requirement | |
| the eight-cue audio palette as a *spec* | |

**The subtle case, stated so nobody has to guess later:** FF1's real constants —
base hit 168, evasion `48 + AGL − armour weight`, damage rolled 1×–2× minus
Absorb with a floor of 1, one extra attack per 32 Hit% — are used as
**calibration references**, never as content. They tell us whether our curves
land in a comparable regime. `PRIOR-ART-JRPG.md` §6 already says it: *the shape
matters more than the specific constants.*

"Equivalent or better" requires a comparison basis. This is how we get one
without importing the thing we are being compared against.

## 4. The duty cycle — a stress test, not a soak

**Correction (John, 2026-07-28):** endless battles is a **stress test**. A soak
test asks only whether the motor survives. A stress test asks whether it survives
**and what it makes while doing it** — under real applied load, at the limit.

**The protocol is derived, exactly like the thresholds are.** If the purpose were
to cruise, qualification would be a dyno run at cruise rate for cruise duration —
enough to prove it has the chops for the demand it was produced to meet, and
nothing beyond that. A commuter is never pulled to redline. A marine engine is
held at 5,800rpm for fourteen hours. A drag motor is taken to the limit and asked
what it made. **Same dyno, different protocol, and the purpose picks which.**

This build is competitive (§2), so the protocol is the limit pull. A cruise
protocol would be an entirely legitimate build sheet — just not this one's. That
distinction belongs to the machine, not to this car: the protocol is an output of
the purpose, and a different build sheet declares a different one.

The dyno asks four questions, and all four are gates:

| question | what it means here | failure signature |
|---|---|---|
| **does it miss?** | wrong result, dropped input, nondeterminism | same seed → different outcome |
| **does it blow?** | crash, overflow, softlock, unbounded memory growth | run terminates or state corrupts |
| **what does it make?** | correctness sustained at volume and speed | throughput collapses, or results degrade under load |
| **how much boost will it take?** | headroom past nominal before failure | the limit itself is the reading |

### Headroom is measured, not asserted

**You cannot claim "equivalent or better performance" without knowing where it
breaks.** A green gate at nominal load tells you nothing about margin — it is the
engine that runs, not the engine that was spec'd.

So the rung-1 stress gate does not only assert that nominal passes. It **pulls to
the limit and records it**: maximum level, maximum stat magnitude, maximum party
size, maximum simultaneous combatants, maximum status stacking, longest sustained
battle chain — each one measured as a number, not a boolean.

That number is the torque curve. It is also the only honest input to "better."

### Why endless battles is the right rig

The battle system is the systemic core — jobs, stats, damage, turn order, spells,
status, targeting. Everything else is content arranged around it. Making it
*endless* turns it into an unbounded deterministic load surface: a bot can fight
10,000 battles headless, which exercises balance invariants, softlocks, stat
overflow and status interaction in a way no town ever could.

`PRIOR-ART-JRPG.md` §13.3 states it directly: this is not a demo, it is **the rig
that proves the invariant**.

## 5. Requirements derived from the prior art

Derived from `PRIOR-ART-JRPG.md`, which was written against sources. These are
requirements on the *form*, not content to copy.

### 5.1 Battle

| requirement | value | source |
|---|---|---|
| acting party members | 3–4 | §5.1 |
| verb set | Attack / Magic / Item / Defend / Flee + one class verb | §5.1 |
| turn order | determined by a speed/agility stat | §5.1 |
| targeting | single and group, enemies in ranks | §5.1 |
| resolution | hit check → damage roll → mitigation | §5.1 |
| status | a parallel state layer | §5.1 |
| randomness | bounded and legible — a band, not a distribution | §6, §12.1 |
| formula complexity | two to three terms; no simulation | §6 |
| anti-softlock floor | explicit minimum damage, deliberately placed | §6, §13.4 |

**Depth comes from `status × element × target-count × resource`, not from more
verbs.** The verb set does not grow.

### 5.2 Progression

| requirement | value | source |
|---|---|---|
| stat vector | ~5 stats plus HP/MP | §5.2 |
| growth | per-class, table-driven, modest per level | §5.2 |
| XP curve | exponential, strictly increasing | §5.6 |
| encounter rate | ≈ minimum to reach the next XP threshold or boss — **derived with a checker, never a constant a model picks** | §13.7 |
| class/job system | costly and legible; one rule and three numbers can carry a metagame | §2, §5.2 |

### 5.3 Content scale (FF1 reference figures)

~128 monsters · ~100 items · 64 spells · 12 jobs · ~60 maps · in a ~128KB ROM.

**Small.** What makes the form feel large is combinatorial depth, not volume —
and most of what looks like content is formula. Models supply intent and names;
**code supplies the corpus** (`ATLANTEAN-RESUME.md` §9 correction).

### 5.4 Audio, art, integrity

| requirement | value | source |
|---|---|---|
| audio | **eight cues**: title, castle/keep, town, field, dungeon, battle, final battle, ending | §9, §13.8 |
| art | distinct silhouette, distinct palette, legible at native size — a requirement, not a taste | §10, §13.9 |
| IDs | integer, **allocated by code**, never coined by a model | §7 |
| referential integrity | every drop, shop entry, spell list, map exit and key-item gate resolves — a hard gate | §7, §13.6 |

## 6. The self-imposed budget

The NES forced density: roughly 1MB code/data, 64KB VRAM on SNES, 32 sprites per
scanline, three melodic channels. `PRIOR-ART-JRPG.md` §8 is blunt about what that
produced — **developers focused on what mattered and made dense experiences
rather than filling games with unnecessary content.**

We have no such limit, and **an AI fleet's natural failure mode is exactly
padding**: more monsters, more items, more rooms, none of it denser.

> **A budget is a design tool, not an apology.**

This is where the minimality rule becomes numeric. John, 2026-07-28: *whatever
the pyramid needs **minimally** to achieve the stated goal, with safety and
redundancy **minimally** to cover graceful error.* Not zero safety — minimum
sufficient safety.

| budget | limit | rationale |
|---|---|---|
| systems code | a few thousand lines | §13.1 — an FF1-class engine is small; sprawl past it means content was misidentified as code |
| authored exceptions | small, explicit, reviewable | the ~10% that deliberately breaks the formula is the only authored surface |
| pyramid depth | the fewest layers that reach the stated goal | principle: minimal layers, minimal sufficient redundancy |

## 7. Where story enters

**Order matters and it is not the same as priority.**

1. The confines are set first — this document.
2. **Story sets the shape within them.** It decides how many layers the pyramid
   has and where it branches, which is what stops it becoming an
   impossibly-levelled incoherent thing.
3. **Story then becomes the top-down guide** for everything below it.

Story is not derived like a component. It is the coherence constraint on the
decomposition itself — sourced from prior art, directive questioning, and
derivation of intent.

`PRIOR-ART-JRPG.md` §4 and §13.10 arrive at the same place from the other
direction: consistency on a thirty-person team came from **a compiled frame, not
communication bandwidth**. The outline, art bible and world were fixed *first*,
and parallel execution stayed coherent because of it. Chrono Trigger's
`outline → specialist finaliser → parallel directors` is the production graph;
Horii→Nakamura is the intent-holder/implementer interface.

## 8. The qualification ladder

`MACHINE.md` §7 has four stages — bench, mated, subsystem, full trip — and stops
at the first complete lap. **The real chain is longer**, and the stages it is
missing are where a competitive result is won or lost (John, 2026-07-28):

| # | stage | what runs | what it proves |
|---|---|---|---|
| 1 | **build** | assembly from the compiled instruction set | there is something to test |
| 2 | **component test** | one component alone | the part is in spec |
| 3 | **subsystem test** | components that must cooperate | the interfaces hold |
| 4 | **system test** | a whole system under its own load | it works as a unit |
| 5 | **full vehicle test + inspection** | the assembled artifact, end to end, then conformance | it is a car — and it is *legal* |
| 6 | **practice runs** | short, smaller-scoped goals | it completes a lap at all, repeatedly |
| 7 | **the full run** | the whole track, start to finish | **it sets a time** |
| 8 | **competition** | blind adversarial comparison (§2) | the time is good enough |

### Inspection asks a different question from every other stage

Stages 1–4 and 6–8 all ask *does it work*. **Inspection asks whether it is
allowed to compete** — conformance, not performance. Here that means the novelty
boundary (§3), the provenance audit (§2), the budget (§7), and the void
conditions in `GROUNDING.md` §8: the contract did not move, the gate did not
move, no wall was bypassed.

`GROUNDING.md` §8's `fuse` **is the tech inspection**, and it is one-shot and
non-resettable for the same reason a scrutineer's ruling is.

> **A car that is fast and illegal does not get a time.**

### Three different things are called "gate"

`MACHINE.md` #16's phrase *"gated identically"* is ambiguous across three
mechanisms with three different derivations. Pinning them:

| | governs | derived from | varies by |
|---|---|---|---|
| **wall / quality gate** (`ground`) | what output must satisfy | the application above — principle #1 | **component**, never builder |
| **containment gate** (`enginePolicy`, `containment`) | what a builder is permitted to *do* — filesystem, network | the weakest boundary the host offers | **engine**; identical across tiers |
| **circuit protection** (`breaker`, `fuse`, `resistor`) | when a run stops or voids | spend, repetition, tamper | **run**, not component |

The reasons for uniformity differ and both matter. Quality gates are
builder-blind for **measurement validity**. Containment gates are tier-uniform
for **security** — that is the literal soft-spot argument, and why
`enginePolicy.js` refuses to run rather than silently degrade to ungated.
Circuit protection derives from spend and validity, **not** top-down from the
rung above.

### The autonomy axis — earned, and revocable

Each stage requires **less intervention than the one before it**. That is not an
aspiration attached to the ladder; it is a pass condition of the ladder.

> **No autonomy until earned. Consistent loss of consistency means regression —
> back to the last stage where it held.**

**Who holds the gate:** John, and his son as a volunteer. They gate the process
that builds the machine, verifying components individually before any of them are
allowed to combine. That is the intervention budget across stages 1–5, and the
ladder's whole job is to shrink it stage by stage until stage 7 needs none of it.

Four properties, and the fourth is the one that matters:

- autonomy is granted **per stage**, never globally
- it is granted on **demonstrated consistency**, not on one good run
- it is **revocable**
- revocation **resets to the last stage that held** — so the ladder is a ratchet
  with a reverse gear

**This supersedes the "disengagement schedule" framing** drafted earlier against
`MACHINE.md` #10. A schedule only says when human gates come *out*; it is silent
on what happens when the system gets *worse*. This is not — and getting worse is
a live expectation, since the honest unknown at rung 4 is precisely whether error
**compounds or converges** over a long unattended run (`ATLANTEAN-RESUME.md` §9).

The consequence for the top rung: **"no human turns" is not a switch thrown at
the end.** It is the terminal state of a ratchet that has been climbing since
stage 1 — and if the ratchet cannot reach it, the ladder records where it
stopped, which is itself a result.

## 9. What derives from this sheet

Everything below cites it and nothing below re-decides it:

- **the gate chain** — which gates exist, in what order, at what rung
- **the qualification protocol** — which dyno regime the purpose demands (§4)
- **every threshold** — derived from the application above, never chosen locally
- **tier and job assignment** — which operation a tier is assigned, and its tools
- **the autonomy grant per stage** — how much intervention each rung is allowed,
  and what triggers regression (§8)
- **the budget** — code size, exception count, pyramid depth
- **the vocabulary lock** — seeded by the premise, once story sets the shape

**Rung count is dynamic.** Rungs are relational to project scope and may change
on target type alone (John, 2026-07-28). Four is the current shape, not a
constant — which supersedes the fixed-four framing in `ATLANTEAN-RESUME.md` §9.

## 10. GAP REGISTER — the build sheet

| # | gap | status | resolution |
|---|---|---|---|
| 1 | **The reference car is unnamed** | **OPEN** | Tier 7 is a blind A/B against a reference. Which specific title, at which version, is the yardstick? Needed before the panel can run, and it defines "equivalent or better" operationally. |
| 2 | **Panel mechanics are unset** | **OPEN** | The win thresholds are now set in §2 (3% a win, ~50% top level). What is still unspecified is the blind panel itself: how many seats, which vendors, what margin over the reference counts as a win, and how disagreement is recorded rather than resolved. Ties to `GROUNDING.md` #4. |
| 3 | **Headroom targets are unset** | **OPEN** | §4 requires headroom be measured. What multiple of nominal must it survive to qualify? A limit that is merely recorded is a gauge; a limit with a target is a gate. |
| 4 | **The abbreviation is undecided** | **OPEN** | `PRIOR-ART-JRPG.md` §13.11 — `CoA` will land in IDs, file prefixes and the vocabulary lock whether chosen or not. FF's team chose the abbreviation first, then the name. |
| 5 | **Composition scope at rung 1** | **OPEN** | Carried from `GROUNDING.md` #2. Jobs-only is exhaustive at 35 cases with 4 jobs in 4 slots; rung 2 introduces equipment and the space explodes, needing a collapse rule. |
| 6 | **Graceful error is required but unspecified** | PLANNED | A blown motor must be autopsy-able. Attempt 2 blew up and root cause is *still* unfound — the lesson the failure was supposed to buy was lost. Every gate failure must capture enough state to diagnose it; currently only `iterate`'s stuck/exhausted classification does. |
| 7 | **No soak/stress gate exists in the chain** | PLANNED | §4's four dyno questions are not represented in the twelve-gate draft. The chain must be re-derived from this sheet rather than assumed. |
| 8 | **Provenance is claimed, not yet verifiable end-to-end** | PLANNED | §2 makes auditability part of the result. Transcript, assembly hash and production record exist separately; nothing yet composes them into a single answer to "who built this line." |
| 9 | **No landing map from requirement → component or wall** | PLANNED | §0 requires every line here to terminate in a pool component or a wall. That mapping is unwritten, so it is not yet known which requirements are decoration. Producing it yields the candidate component list *and* the derived gate chain in one pass — it is the bridge from this document to rung 1. |
| 10 | **Interventions are not counted** | **OPEN** | §8 sets the *policy* — autonomy earned per stage, revoked on consistency loss, reset to the last stage that held. What is still unspecified is the *measurement*: traversal depth records distance and nothing records interventions, so depth-9-with-two-touches outranks depth-8-untouched. Needs a decision on whether intervention count is a second axis or a modifier on depth. |
