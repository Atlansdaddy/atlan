# ATLANTEAN — resume point

**Written 2026-07-28.** Read this first if you're picking up cold, on the phone,
or after a power cut. Everything below is verified state, not plans.

> **The experiment is called CHARIOTS OF ATLANTIS.** If it works, that's the
> game's name too. **Atlan gets a featured easter egg** — see §10.

## THE DOCUMENT SET

This file is **state** — where things are right now. The design lives in four
companions, each whole and distinct, each ending in a **gap register** because a
design document that claims completeness is lying:

| document | answers |
|---|---|
| **`BUILD-SHEET.md`** | **what the machine is being built to DO** — the top of the top-down chain. Duty cycle, competitive bar, novelty boundary, qualification ladder, autonomy policy, win thresholds. **Every threshold below cites it; nothing below picks a number locally.** **10 gaps registered.** |
| **`LANDING-MAP.md`** | **where every requirement lands** — the derived 26-gate rung-1 chain, the candidate component list, the protocol items. Closes BUILD-SHEET #9. **7 gaps registered.** |
| **`MACHINE.md`** | what the machine IS — circuit architecture, every component, deterministic control with oracle values, the car mapping, what it refuses to do. **16 gaps registered.** |
| **`GROUNDING.md`** | how output is JUDGED — seven tiers × four qualification stages, traversal depth as the score, how subjective bars become comparable. **8 gaps registered.** |
| **`METHOD.md`** | how we LEARN what the instruction set should say — calibration, ablation sweeps both directions, computed-not-generated analysis, feasibility, the value map. **9 gaps registered.** |
| **`PRIOR-ART-JRPG.md`** | the form we are building, decomposed — mechanics, math, teams, ideology |
| **`PRIOR-ART-ONESHOT.md`** | everyone who tried this before — the hits, the misses, the metrics |

**Six decisions stood between here and a defensible rung 1. Three are now
resolved** (2026-07-28 evening):

| decision | state |
|---|---|
| gate weighting (GROUNDING #3) | **CLOSED** — gates binary; per-tier vector stored; canonical score unweighted; weighting is a *bracket* applied at analysis time |
| uneven walls across tiers (MACHINE #16) | **CLOSED** — tier sets which *operation* and which *tools*, never the threshold |
| human gates (MACHINE #10) | **PLANNED** — autonomy ladder with regression; policy agreed, component unbuilt |
| sweep interactions (METHOD #1) | **OPEN** |
| evidence scope (METHOD #2) | **OPEN** |
| pool versioning (METHOD #3) | **OPEN** |
| "reasonable composition" (GROUNDING #2) | **OPEN** — the last one blocking a rung-1 wall |

MACHINE #16 was OPEN but had been **left off the original list of six** — worth
knowing, since it was the one most directly blocking wall construction.

**New in `BUILD-SHEET.md` and OPEN:** the reference car is unnamed (#1) · panel
mechanics unset (#2) · headroom targets unset (#3) · the abbreviation (#4) ·
intervention count not measured (#10).

### DONE 2026-07-31: the landing map — see `LANDING-MAP.md`

Every requirement walked and landed. Three outputs and one correction:

- **A derived rung-1 gate chain of 26 gates.** The assumed twelve was under half,
  and omitted the **stress** and **inspection** families entirely.
- **15 candidate pool components**, all unproven, none admissible without an
  `ADOPT` verdict. C7 (*code expands the corpus*) and C8 (*propose concepts, not
  rows*) are the generation-minimal thesis stated as testable components.
- **7 protocol items** — obligations on the method, not the artifact, including
  the bare-model baseline arm that makes a matched comparison to published Play@1
  possible at all.
- **The build sheet's own rule broke.** §0 admits only *component* or *wall*;
  four requirements land in neither and none is decoration. Two more sites are
  needed — **producer** (code that expands the spec) and **protocol**. Amendment
  proposed, **not yet applied** (`LANDING-MAP.md` #7).

### NEXT

1. **Ratify the four-site rule** (`LANDING-MAP.md` #7) — the sheet is cited as
   authority everywhere, so its rule should be right before more is built on it.
2. **Decide `GROUNDING.md` #2** — `composition.twoSided` is now the *only*
   rung-1 gate that cannot be written. It is the highest-value open decision.
3. **Version the gate chain** (`LANDING-MAP.md` #1) — deriving it moved the depth
   denominator from 12 to 26, so scores are incomparable across revisions unless
   the chain is hashed and recorded per run.
4. Then build walls, starting with the tier-1 seven, which are unblocked.

---

## 0. THE ENVIRONMENT RULE (read before running anything)

**Corrected 2026-07-31.** This was written phone-side as a hardcoded *"on the
phone, cap at the 30B-MoE class."* That bakes a conclusion in where the reasoning
and a **detection** belong. A throttled cloud box has the phone's problem; a
phone on a charger partly does not. **Device identity is not the input — measured
capability is.**

### Probe three things, derive three policies

| probe | answers | derives |
|---|---|---|
| **kernel sandbox** — behaviourally | can agents be *gated*, or only *contained*? | gating mode; whether `enginePolicy` may run at all |
| **process durability** | can a long-horizon run survive to completion? | run-duration ceiling; whether autonomous runs are permitted |
| **power/thermal envelope** | does sustained high effort trigger shedding? | effort ceiling and therefore tier ceiling |

Plus cores and RAM for the concurrency cap.

### Probe by BEHAVIOUR, not by feature flag

Measured on this node 2026-07-31: `/sys/kernel/security/lsm` reads **`n/a`** —
and yet Landlock demonstrably enforces here (`codex exec -s workspace-write`
against a canary returns `Read-only file system`, receipt in §3). **A declarative
probe would have wrongly downgraded a kernel-gated host to contained-only.**

So the gating probe is a **canary test**: under the CLI's own sandbox flag,
attempt a write outside the workspace and assert refusal. Behaviour is
authoritative; a flag file is a hint.

### Fail-safe direction when a probe cannot answer

- **gating** — absence of proof of a kernel sandbox ⇒ treat as **ungated**.
  Assuming a boundary you do not have is the dangerous error.
- **thermal** — absence of thermal telemetry ⇒ unconstrained **only** when there
  is no battery. WSL reports zero thermal zones and no power supply, which is
  correct for a desktop and would be a **false negative on a laptop**. Known
  limitation; do not treat silence as headroom when a battery is present.

### Measured profiles

| | this node (WSL2) | phone (Termux/proot) |
|---|---|---|
| userns | **YES** (max 127780) | no |
| kernel gating | **YES** — Landlock, by canary | none available |
| pid 1 / durability | **systemd running** | no init; whole proot tree force-killable at once |
| battery / thermal zones | **none / 0** | present / present |
| cores · RAM | **32 · 32 GB** | few · little |
| ⇒ gating mode | **gated** | **contained** (worktree + diff gate + scrubbed env) |
| ⇒ run ceiling | long autonomous runs OK | short bounded loops only |
| ⇒ tier ceiling | full roster | ~the on-node 30B-MoE class |

**The named profile is an output, not an input.** "Phone" is shorthand for
*{no userns, no init, battery present, thermal zones present, few cores}* — and
any host matching that shape gets the same policy regardless of what it is.

**It remains a TIER cap, never a FEATURE cap.** Every host gets the full toolset
and the same surfaces; constrained hosts get smaller workers and shorter leashes.

Probe script: `/root/probe-host.sh` (not yet in the repo — it is code, so it
lands on a branch when the policy is implemented).

---

## 1. Where everything is

**Live node:** WSL2 Ubuntu on JohnPC. Repo `/root/atlan`, on `main`.
`atlan.service` :4589 · `llama-server` :8080 · active model
`/root/models/active.gguf` → `qwen36-35b-a3b.gguf`.

**Branches** (nothing but `main` is pushed):

| branch | worktree | state |
|---|---|---|
| `main` | `/root/atlan` | **pushed** — includes the helis merge + preview self-proxy fix |
| `fix/preflight-fleet-dir` | — | merged into main |
| `integration/helis-inline-ai-git-ui` | `/root/atlan-integration` | merged into main |
| `experiment/game-fleet-test` | — | game-test design + fleet defs, **not pushed** |
| `feat/cross-engine-orchestration` | `/root/atlan-gamelab` | agentExec + productions, **not pushed** |
| `pr-1` | `/root/atlan-pr` | pre-existing, untouched |

**Extra instances** (kill freely; they're scratch):
`:4689` helis verification build · `:4789` orchestration build (+ `:4790` preview).
Start with `setsid` — a plain `nohup` dies when the launching `wsl.exe` exits.

**Game project:** `/root/atlantis-2d` — its own git repo, pre-registration commit
`2d53b19` holds `ASSET-SPEC.md` + `check.mjs` before any agent ran.

---

## 2. What shipped to main today

- **helis-d's contribution merged** — inline AI edit, Git Manager, Glass skin as
  template #3, Scan promoted to its own tab. Debugger **parked** (D1): its
  `debug.start` takes a client-supplied `scriptPath`, so an allowlisted
  `Debugger.resume` is still RCE. Needs a server-side approval gate first.
- **Exposure-gate fix** — `preflight.js` read `ROOT/.fleet/auth.json` while
  `auth.js` authenticates against `join(FLEET_DIR, 'auth.json')`. Could show
  green "password set" over an instance anyone could claim.
- **Preview self-proxy fix** — pointing the preview at its own port wedged it
  (502, then no response, restart required). Now refused with a useful error.

`npm test` on main: **219 passed, 0 failed across 11 suites.**

## 3. What's built but NOT pushed

On `feat/cross-engine-orchestration` (`/root/atlan-gamelab`):

- **`enginePolicy.js`** — projects scout/builder/verifier onto each CLI's native
  gating flags. **Refuses to run rather than silently degrade to ungated.**
- **`agentExec.js`** — the missing primitive: an await-able wrapper returning
  `{text, tokens}` for codex/grok/copilot/antigravity. This is what makes
  cross-engine delegation possible at all.
- **`containment.js`** — the phone answer. Disposable git worktree + diff gate +
  credential-scrubbed env. Guards against **error, not attack** — say it that way.
- **`production.js`** — the organizer. A design-time role graph executed
  deterministically, with a durable reviewable record in `.fleet/productions.jsonl`.
- **`TIERS.agentic`** — a Codex rung on the hierarchy ladder.

204 → 213 passing across 12–13 suites on that branch.

**MEASURED, keep this:** on the WSL node, `codex exec -s workspace-write` gives a
**kernel-enforced** boundary — told to write outside its workspace it got
`/bin/bash: /root/codex-canary.txt: Read-only file system` from Landlock. All four
exec-mode CLIs expose gating (`codex -s`, `copilot --add-dir`, `grok --allow/--deny`,
`agy --sandbox`) and Atlan currently disables all of it. Correct on the phone,
wrong on a real kernel.

---

## 4. The attempt log

| # | what happened |
|---|---|
| 1 | Designed only. Never ran — the machinery couldn't express cross-engine delegation. |
| 2 | **Ran.** `check.mjs` 20/20, **black screen.** Halted on budget at 978k/900k, so the adversarial verifier never ran. |
| 3 | Next. Dungeon-crawler RPG, FF1–3 class. Not started. |

**Attempt 2's real lesson:** every static check passed on a build that draws
nothing. 104 frames, 208 draw calls, correct ortho projection, three lights,
ambient `0.12/0.13/0.20`, all four textures decode correctly — and 0/480000 lit
pixels read via `gl.readPixels` from inside the live GL context. Not a screenshot
artefact. Root cause not yet found; the lighting math zeroes out somewhere.

**Four vacuous passes found in one day** (checks that go green because a feature
is *absent*): two in Atlan's own suite, two in `check.mjs`. Assume more exist.

---

## 5. The target

**A dungeon-crawler RPG, Final Fantasy 1–3 class, but bigger.** Phased:
**dungeon → a bigger place → a land → a full 20+ hour game.** Then possibly 3D.

**Why it's the right benchmark:** FF1–3 are overwhelmingly *data* — evasion is
`48 + AGL − armor weight`, per-job growth tables, monster/item/spell tables. The
systems are ~2k lines; the content is enormous. One-shot tools cap out around
2,500 lines and "struggle with complex systems" — so the way to beat them is
**generate and validate content**, not write more engine. Comparison target:
**Rosebud AI** (Phaser, prompt-to-game, viral, VC-funded, well received).

**Deterministic walls this unlocks** — these are the point:

- **reachability solver** — every dungeon provably completable (graph search with
  key items). No model opinion involved.
- **balance invariants** — XP curve monotonic; no zone-N encounter one-shots an
  on-level party; every spell learnable; every key item obtainable.
- **play-bot** — scripted, headless, deterministic; must *win* dungeon 1.
- **render gate** — `gl.readPixels`, fail at zero lit pixels. Attempt 2 dies here.
- **vision check** — a multimodal model *looks* at a frame. A checker cannot tell
  you it looks wrong.

**`check.mjs` and `ASSET-SPEC.md` are never writable by a role that builds.** A
role with shell access and a red gate has an obvious cheap path to green. Diff
them at the end; if they moved, the run is void.

---

## 6. The Atlantean roster (org chart)

Atlantean = *of Atlantis* — the team are Atlanteans, the project is Atlantis.

**Organise by (capability class × intelligence tier), not by model.** Three
classes: hands+gated (fleet), hands+ungated (CLI, contained), no-hands (brains).

| tier | class | who | jobs |
|---|---|---|---|
| T0 | design | **Fable 5** | world bible, orchestration, memory journal |
| T1 | hands, hard | **Opus 5** `xhigh` | battle system, damage model, save format |
| T2 | hands, medium | **Opus 5** `low/med` | renderer, sim loop, map streaming |
| T3 | hands, routine | **Sonnet 5** | menus, inventory, shops, dialogue rendering |
| T4 | hands, mechanical | **Haiku 4.5** | data loaders, wiring, boilerplate |
| T5 | terminal | **Codex GPT-5.6** | build / test / fix loop |
| T6 | no-hands, judgment | **Gemini Flash** | vision check on frames, content review |
| T7 | no-hands, bulk | **local 35B** | schema-locked content, manifests, tables |
| T8 | no-hands, trivial | **local 8B** | extraction, classification, tagging |
| T9 | art | **Codex `image_gen`** + **Nano Banana Pro** (Antigravity OAuth) | sprites, tiles, portraits |
| T10 | walls | **code** | reachability, balance, play-bot, PNG conformance |

**Placement rule:** match the tier to the *decision the role makes*, not to how
important the role sounds. Flavour text and the damage formula are both
"content"; one is a lookup, one has balance consequences.

**Evidence behind the two Claude assignments:**
- **Fable 5 = manager.** Documented as the most capable widely released model for
  "the most demanding reasoning and long-horizon agentic work"; thinking always
  on; **parallel sub-agents are dependable on it** and *asynchronous* sub-agents
  outperform spawn-and-block. Give it a **memory file** — documented to improve
  its results materially.
- **Opus 5 = coder.** "Complex agentic coding," half Fable's cost, and it
  **over-delegates** — needs an explicit subagent cap. Opposite tuning to Fable.

**Economics:** the API price sheet does not govern us. Every Claude tier runs on
your Claude Code subscription, so the *most capable* manager costs nothing extra
at the margin. ~60–70% of total volume should land on free tiers.

**Known constraint:** on ChatGPT-subscription auth, `codex` **rejects any explicit
`-m`** — Sol/Terra/Luna cannot be selected from the CLI. Codex is one rung, not
three, unless we move to API keys (which breaks the subscription-first rule).

---

## 7. The gauntlet

Two phases, from the published pattern: **N independent expert-persona reviewers
→ adversarial synthesis where reviewers run again in a DIFFERENT ORDER,
peer-reviewing round one's assertions.** Only findings that survive round two, or
carry irrefutable evidence, proceed.

Married to the contextless convention: reviewers get **no authorship context**,
and review is **cross-model** — Codex and Gemini review Claude's output, never
Claude reviewing Claude. *A model is architecturally incapable of neutrality
about its own work.*

Free seats first (local 35B, Gemini Flash); Sol only for the synthesis pass.
Value comes from *diverse* seats and the reordered second pass — past ~5 seats
you're paying for correlated opinions.

**Order the gauntlet so a budget halt cannot cut it.** In attempt 2 the budget
halt killed the one role whose job was catching the black screen.

---

## 8. Open items

1. **Attempt 3 not started.** Walls first, then personas, then build.
2. **atlantis-2d renders nothing** — root cause unfound.
3. **`check.mjs` is blind to a black screen** — needs the render gate.
4. **Debugger parked** — needs a server-side `debug.start` approval gate.
5. **`spawnRun` has no `engine` field** — fleet still Claude-only. The primitive
   (`agentExec`) exists; the product decision (walls for a non-Claude fleet run)
   does not.
6. **Two branches unpushed** (§1).
7. **Beyond-SAST cockpit scanning** — design discussion never had.
8. **Uneven walls risk:** a Haiku builder and an Opus builder must be gated
   *identically*, or the cheap tier becomes the soft spot. More tiers makes the
   profile-projection work matter more, not less.

## 9. CHARIOTS OF ATLANTIS — the ladder

Named 2026-07-28. Four rungs — **but the rung count is dynamic** (John,
2026-07-28): rungs are relational to project scope and may change on target type
alone. Four is the current shape, not a constant. See `BUILD-SHEET.md` §9.

**Each rung's real deliverable is the HARNESS, not the game.** A rung that ships a working slice and no reusable harness is a
partial failure — that is exactly how attempt 2 produced a 20/20 on a black
screen.

| rung | slice | what it must hand upward |
|---|---|---|
| **1** | walls + a dungeon + characters + **endless battles** | the spec grammar, the walls, the personas, the play-bot |
| **2** | a bigger place — progression, items, equipment, a boss | content schemas, ID allocation, the balance invariants |
| **3** | a land — towns, shops, story threads, several dungeons | the link-checker, the vocabulary lock, the world bible |
| **4** | **the golden chariot** — a full NES-FF-class clone: story, sound, sprites, depth, items, spells, effects, world assets | the result |

**Why "endless battles" is rung 1** (John's pick, and it's better than starting
with dungeons+town): a battle system *is* the systemic core — jobs, stats,
damage, turn order, spells, status, targeting. Everything else is content
arranged around it. And "endless" makes it an unbounded deterministic test
surface: a bot can fight 10,000 battles headless, which tests balance
invariants, softlocks, stat overflow and status interactions in a way a town
never could.

### The golden chariot, defined

Two readings look alike; only one is achievable, so pin it:

- ❌ **one prompt to a bare model** — won't work, and is the thing we're beating.
- ✅ **one production run, no human turns, into a mature harness** — plausible,
  and measurable.

By rung 4 "one shot" means one shot into machinery three previous rungs built.

**The honest unknown:** whether error **compounds or converges** over a long
unattended run. That is not a tools question and nobody knows the answer. It is
*the* experiment. Everything below rung 4 is engineering.

### Theme is a consistency mechanism, not flavour

A named premise seeds the vocabulary lock and gives every content generator the
same gravity. "Generate 40 monsters" drifts; "generate 40 monsters for the
drowned ruins of Atlantis" drifts much less.

**The chariot should be a MECHANIC, not just a title** — a vessel carrying the
party between regions, upgraded as you progress. That's the FF airship slot, and
it maps onto the ladder exactly: rung 1 on foot in one dungeon, rung 2 the
chariot reaches a bigger place, rung 3 it crosses a land. The game's progression
spine and the experiment's rungs become the same shape, so each rung ships
something the next one builds on instead of replacing.

### CORRECTION (John, 2026-07-28): generation minimal, deterministic code maximal

An earlier framing in §5 said FF1–3's "content is enormous — so generate and
validate it." **That is wrong, and the correction matters more than the original
point.** FF1 is a ~128KB ROM: roughly 128 monsters, ~100 items, 64 spells, 12
jobs, ~60 maps. Small. What makes it feel large is *combinatorial depth*, not
volume.

**And most of what looks like content is actually FORMULA.** Stat growth is a
curve plus a small per-job table. Monster stats fall out of a difficulty curve.
Damage, hit and evasion are formulas. Shop inventories derive from progression
stage. Encounter tables derive from zone difficulty. Item prices derive from
power.

So the architecture inverts:

| | wrong (first framing) | right |
|---|---|---|
| models produce | thousands of content rows | a compact **design spec** — intent, names, flavour |
| code produces | validation only | **the corpus**, expanded deterministically from that spec |
| consistency | enforced after the fact by checkers | **structural** — a generator cannot drift |

This is the strongest answer to the consistency fear in §10: if the corpus is
*computed* from a small spec, there is nothing to drift. Checkers stop being the
primary defence and become the backstop.

It also changes tier allocation — the free tiers' job is no longer "generate 40
monsters," it's "propose 12 monster *concepts*." Far less output, far easier to
validate. And it makes rung 4 **more** achievable, not less: a one-shot run only
has to get the design spec and the systems code right, not author a world.

**The nuance worth keeping:** the interesting content is the *exceptions* to the
formula. A generator gives the baseline; design lives in the ~10% that breaks it
deliberately (the boss that ignores a resistance, the item that changes a rule).
Keep the exception list small, explicit, and reviewable — that's the authored
surface, and it should be the only one.

## 10. The consistency layer (SEPARATE from orchestration)

**Orchestration is "who does what, when." Consistency is "do their outputs
cohere."** Different problem, different machinery. An org chart that runs
perfectly can still yield two agents inventing the same spell ID and a third
writing a door into a room that doesn't exist. John named consistency as his
biggest fear; he's right, and most of the answer is deterministic.

1. **Contracts as schemas, not prose.** JSON Schema per entity type. A model
   can't drift from a schema a validator rejects. (ASSET-SPEC worked for sprite
   dimensions for exactly this reason.)
2. **IDs allocated by CODE, never by models.** Two agents independently coining
   `spell_fire2` is the classic multi-agent collision. Namespace allocation is a
   deterministic service, not a creative act.
3. **Cross-reference link-checking.** Every item in a drop table exists; every
   spell in a job list exists; every map exit lands somewhere. A graph validator
   over the content corpus catches most "these two agents disagreed" failures.
4. **Vocabulary lock.** A canonical terms file — every proper noun, place,
   mechanic, status. New terms are *added deliberately*, never invented
   in-flight; an unregistered term is a rejection. Cheapest high-value wall, and
   almost nobody builds it.
5. **The world bible is compiled once and only ever READ.** Drift comes from
   re-derivation — two agents each inferring "what kind of world is this."
   Fable writes it once; everything downstream cites it.
6. **Prose voice resists automation.** Flavour text and dialogue can't be
   schema-checked. Either one model writes ALL prose in a single serial pass
   (consistency by construction), or a voice gauntlet seat scores against
   exemplars. Start serial.

Consistency *within one run* and *across rungs* are different problems. 1–5
handle both; 6 mostly handles the first.

### Atlan's easter egg

Atlan appears in the game as a featured easter egg. It is **native, not bolted
on**: the cockpit's own lore line already reads *"ATLAN · your cockpit in the
deep — a steady light while you build."* A steady light in the deep, inside a
game about a drowned civilisation, is a beacon that belongs in the setting — the
tool that built the world appearing in it as a light that guides you.

## 11. What we have vs. what's missing (asked and answered 2026-07-28)

**Can we do it? Yes for rungs 1–3, with real confidence. Rung 4 is the open
question, and that's the point.**

**PROVEN, with receipts from 2026-07-27/28:** cross-engine execution
(`agentExec`, live Codex, real token counts) · kernel-enforced gating (Landlock
refusal) · phone containment (project untouchable with NO kernel gate) · the
organizer (9 tests: graph order, halting gates, continue-but-record gates,
durable record) · **personas + structured commands + checkers — `RENDER_VERDICT`
ran on the FREE local 35B, 1,235 tokens, 9/9 checkers, and correctly diagnosed
the checker's own blind spot** · 5 Claude tiers · 4 vendors authed.

**MISSING — and John named it first: COMMUNICATION.** What exists is a
*blackboard* (`{{role.output}}`, one-directional, design-time wired). What does
not exist is agents talking to each other: a worker asking the manager a
question mid-task, a manager steering a running subagent, two workers
reconciling an overlap. Specific cost: Fable's documented strength is
*asynchronous* subagents that stay in conversation and keep their context;
`spawnRun` is fire-and-forget-then-poll, so we currently get the weaker half of
what Fable is best at. **This is the right next build.**

Also missing: `spawnRun` engine field; the consistency layer (§10); the render
and play-bot gates.

**Grok Build** belongs in the roster properly. Its `--allow` / `--deny` take
**per-tool rules** — the closest shape to our profiles of any of the four CLIs —
so once its tool names are verified it's the best candidate after Codex for a
properly *gated* hands role. But its highest-value job is a **gauntlet seat**:
it's a third vendor (Anthropic / OpenAI / xAI / Google), and vendor diversity is
the strongest form of the perspective diversity the gauntlet runs on. Grok
reviewing Claude's code is worth more than a fifth Claude seat.

## 12. Resuming on the phone

```
cd /root/atlan && git pull --rebase origin main
cat docs/ATLANTEAN-RESUME.md
```

Then apply **§0** — run the probe, let the caps derive from what it reads. The
work doesn't change; on a constrained host the workers get smaller and the
leashes get shorter.
