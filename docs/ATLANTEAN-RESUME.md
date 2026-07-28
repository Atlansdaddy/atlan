# ATLANTEAN — resume point

**Written 2026-07-28.** Read this first if you're picking up cold, on the phone,
or after a power cut. Everything below is verified state, not plans.

---

## 0. THE PHONE RULE (read before running anything)

**On the phone, cap the intelligence tier at roughly the on-node 30B-MoE class
(qwen3.6-35B-A3B).** Concretely:

| on the phone, use | do NOT use on the phone |
|---|---|
| local on-phone model (brains) | Claude Fable 5 |
| Gemini 3.6 Flash (free tier) | Claude Opus 5 at `xhigh` / `max` |
| Claude **Haiku 4.5** / **Sonnet 5** (hands) | long-horizon autonomous runs |
| Codex for short build loops | anything expected to run > a few minutes |

**Why, so the rule survives being questioned later:**

1. **Fable 5 turns run for minutes** on hard tasks — that is documented, expected
   behaviour, not a hang. A phone session cannot reliably hold one: Android's
   thermal governor sheds background apps, and the whole Termux/proot tree can be
   force-killed at once (this has happened, see HANDOFF.md recovery playbook).
2. **No kernel sandbox exists on proot** — no user namespaces, so no CLI's OS
   sandbox can initialise. The phone runs agents *contained* (disposable git
   worktree + diff gate + scrubbed env), never *gated*. A bigger model with hands
   on the weaker boundary is the wrong trade.
3. **Thermals** — a long high-effort run heats the phone, which triggers the very
   shedding that kills the run.

The phone is the host and gets the full toolset — this is a *tier* cap, not a
feature cap. Same surfaces, smaller workers.

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

## 9. Resuming on the phone

```
cd /root/atlan && git pull --rebase origin main
cat docs/ATLANTEAN-RESUME.md
```

Then apply **§0** — cap the tier. The work doesn't change; the workers get
smaller.
