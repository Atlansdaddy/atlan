# Attempt 2 was never asked for a game

**Finding, 2026-08-02.** Two corrections, and the second matters more than the
first.

1. **There was no black screen.** The renderer works; the probe was broken.
2. **The pre-registered contract never specified a game.** It specified a
   renderer. Attempt 2 built one, correctly, and `check.mjs` verified it
   faithfully. **20/20 was honest.**

Receipt: `docs/evidence/atlantis-2d-renders-2026-08-02.png`, captured from the
untouched attempt-2 tree at `/root/atlantis-2d`.

---

## 1. What the artifact actually is

512 sprites bouncing off the edges of the viewport, over a tiled floor, lit by
three lights with normal mapping. That is the whole thing.

`src/sim/world.js` `step()` in full: copy position to prev, integrate by
velocity, reflect at the bounds. `src/main.js` wires it to the renderer and
starts a fixed-step loop.

**There is no player. No input handler. No rules. No objective. No win or lose
state. No entities with behaviour. No collision between sprites. No score.**

It is a rendering benchmark, and a competent one.

## 2. Why that is not a failure

**`ASSET-SPEC.md` — written before any agent ran, held in the pre-registration
commit `2d53b19` — does not ask for a game.** Its six requirement sections are:

| § | specifies |
|---|---|
| 1 | four PNGs, 64×64, alpha and normal-map encoding |
| 2 | coordinate conventions — pixels, top-left origin, +y down |
| 3 | shader rules — `#version 300 es`, precision qualifier, sample the normal map, clamp before `pow`, no per-light branching |
| 4 | rendering budget — WebGL2 required, one draw call per layer, zero allocation in the frame loop |
| 5 | simulation — fixed 1/60 timestep, accumulator, clamped dt, frame-rate independence |
| 6 | performance — p50/p95 ≤ 16.6 ms, p99 ≤ 20 ms, max ≤ 33 ms |

Read that list again. **Every line is a rendering or performance property.**
There is not one sentence about gameplay anywhere in the document.

So the fleet built exactly what it was contracted to build, and `check.mjs`
checked exactly what the contract said. Both did their jobs.

## 3. The trap: the contract says "game" without specifying one

`ASSET-SPEC.md` uses the word *game* repeatedly — *"the classic one-shot failure
in an AI-built game," "a green `check.mjs` is not a passing game," "never a black
canvas"* — and its closing line is deliberately humble:

> a green `check.mjs` is **not** a passing game. It is a game that has earned the
> right to be measured.

**That sentence is true and was still misleading**, because the document never
defined what would make it a game. The humility is about *frame time*, not about
gameplay. A reader — including everyone who wrote the doc set afterwards — comes
away believing a game was attempted.

**This is a vocabulary failure with structural consequences.** The word carried
an expectation the specification never encoded, and no checker can catch a
requirement that was never written.

## 4. What attempt 2 therefore does and does not tell us

**Tested, and passed:** can a multi-agent fleet, given a tight technical
contract, produce a decomposed, correct, performant WebGL2 renderer with matching
generated art? Yes — 11 modules, correct batching, zero frame allocation,
deterministic sim, working normal-mapped lighting on a real driver (8/8 on
`gpucheck.mjs`).

**Not tested, at all:** can a fleet build a *game*? Attempt 2 has nothing to say
about it. There was no gameplay requirement, so there is no evidence either way.

**Consequences for claims made elsewhere in the doc set:**

- **"Landed exactly on the Play@k barrier"** — no. Play@k measures whether a
  generated artifact can be *played end to end*. Attempt 2 produced nothing
  playable because nothing playable was requested. It is not a frontier arrival;
  it is off that axis entirely.
- **"20/20 on a black screen"** — wrong twice. The screen was not black, and the
  20 checks were an honest measure of the contract that existed.
- **"Attempt 2 died at tier 2"** — no. Its traversal depth was never measured,
  and most of the tier 3–4 gates are inapplicable to an artifact with no rules.

## 5. This is principle #1, failing exactly as predicted

`BUILD-SHEET.md` §0 was written on 2026-07-28 because *"the chain of derivation
had no top."* Attempt 2 is that diagnosis with a receipt.

**`ASSET-SPEC.md` is a billet spec.** Material properties (64×64 RGBA,
tangent-space normals, `(128,128,255)` flat) and machining tolerances (one draw
call per layer, zero allocation, p95 ≤ 16.6 ms). Excellent ones — it is a
genuinely good document for what it is.

**What it never states is what part the billet becomes, or what vehicle the part
goes in.** So the fleet optimised the billet. It hit every tolerance. And nobody
could say whether the result was any good, because *good for what* was never
written down.

> **A component built to a perfect component spec, with no vehicle spec above it,
> is a perfect component for no particular vehicle.**

That is the entire argument for the build sheet, demonstrated at a cost of one
full attempt.

## 6. The black screen — the smaller correction

Kept because the defect class matters, not because the result does.

| probe | result |
|---|---|
| `check.mjs` (static) | 20/20 |
| `gpucheck.mjs` (real driver, correct read) | 8/8 |
| screenshot | fully rendered scene |
| `readPixels` **inside** the rAF turn | **478,376 / 480,000 lit** |
| `readPixels` **outside** the rAF turn | **0 / 480,000** |

**Root cause:** `src/render/gl.js` sets `preserveDrawingBuffer: false` — correct
for production. The drawing buffer is invalidated once presented, so a
`readPixels` issued after the rAF callback returns reads a buffer that no longer
exists. Chromium returns zeros.

**The disproof was inside the original data.** Every pixel read `0,0,0`, but the
clear colour is `(4,5,10)` in 8-bit. **Not even `gl.clear()` appeared.** A frame
that renders nothing is still the clear colour; a frame of pure zeros is no
buffer at all. Recorded verbatim 2026-07-28, never read.

### The defect class: a VACUOUS FAILURE

`GROUNDING.md` §2 has always required that **a gate be unable to pass because a
feature is absent.** The converse was never written and cost more:

> **A gate must be unable to FAIL because of how it measures.**

A vacuous pass leaves you over-confident about work that exists, and a later gate
can still catch it. A vacuous failure sends you hunting something that was never
there — this one consumed the run's remaining budget at 978k/900k, which killed
the adversarial verifier whose job was catching exactly this.

Three obligations, now in `GROUNDING.md` §2 and `gates.rung1.json`:

1. **Observe every gate both red and green** before trusting either reading.
2. **A catastrophic reading needs a second, independent probe.** One probe
   reporting disaster is a claim, not a finding. The screenshot took a minute.
3. **Read the raw reading, not the verdict.**

**And a smell worth naming:** *"Not a screenshot artefact"* was asserted in the
original writeup, never tested. A pre-emptive denial in a finding makes the
disproving check *less* likely to be run.

## 7. What this changes going forward

**7.1 The build sheet is validated, and so is the landing map's insistence that
every requirement terminate somewhere real.** `ASSET-SPEC` would have survived
that walk — every line lands as a wall. What it would have exposed is the
*absence*: no requirement landing on gameplay at all, because there were none.

**7.2 A spec needs a completeness check, not just a conformance check.**
`check.mjs` asks *"does the build meet the spec?"* Nothing asks *"does the spec
cover the goal?"* That second question is what `BUILD-SHEET.md` §9's derivation
chain is for, and it needs to be a gate in its own right — the inspection family
is the natural home.

**7.3 Rung 1's target must state its gameplay requirements explicitly**, in the
same hard-requirement register `ASSET-SPEC` uses for pixel dimensions. "Endless
battles" is a phrase, not a contract. Turn order, action legality, win/lose
conditions, and what the bot must be able to *do* all have to be written with the
same specificity as `64×64 RGBA`.

**7.4 The attempt log needs rewriting.** Attempt 2 is not a failed game build. It
is a **successful renderer build against a renderer spec**, plus a broken probe,
plus a scope gap nobody noticed for four days.
