# NEW SESSION PRIMER — Chariots of Atlantis

**Paste this, or say "read docs/NEW-SESSION-PRIMER.md".** Written 2026-07-28 at
the end of a long session, specifically so the next one starts warm.

---

## 1. Read these first, in this order

| file | what it gives you |
|---|---|
| `docs/ATLANTEAN-RESUME.md` | **current state** — branches, worktrees, running instances, what shipped, the phone rule |
| `docs/BUILD-SHEET.md` | **what it is being built to DO** — the top of the top-down chain. Read before anything that picks a number |
| `docs/LANDING-MAP.md` | **where every requirement lands** — the derived 26-gate rung-1 chain, the candidate components, the protocol items |
| `docs/MACHINE.md` | what the machine IS — components, architecture, what it refuses to do |
| `docs/GROUNDING.md` | how output is JUDGED — tiers × stages, traversal depth |
| `docs/METHOD.md` | how we LEARN what the instruction set should say |
| `docs/PRIOR-ART-JRPG.md` | the form being built, decomposed |
| `docs/PRIOR-ART-ONESHOT.md` | everyone who tried this before, and their numbers |

**The docs are authoritative over your recollection.** If your instinct differs
from a document, the document wins — it was written against sources and receipts.

## 2. The one-paragraph version

Build a **dungeon-crawler RPG, FF1–3 class**, using a multi-tier / multi-model /
multi-source / multimodal / multi-agent fleet inside deterministic walls. The
experiment is **Chariots of Atlantis**; if it works, that is the game's name.
Four rungs — **dungeon → bigger place → a land → the golden chariot** (a full
NES-FF-class clone). The top rung must be **ONE SHOT**: one routine invocation,
no human turns, into a harness three rungs built. Each rung's real deliverable
is **the harness, not the game**.

## 3. HOW TO INTERPRET THE DOCUMENTS

This is the part that is not in them.

**Gap registers are a decision queue, not a bug list.** Every design doc ends in
one. `OPEN` means *John decides* — do not close it by picking an answer and
proceeding. `PLANNED` means the resolution is agreed and it needs building.
`CLOSED` means resolved in that document.

**Three of the original six are resolved** (2026-07-28 evening): gate weighting
(GROUNDING #3, **CLOSED**), uneven walls across tiers (MACHINE #16, **CLOSED** —
it had been left off the original list of six despite blocking wall
construction), human gates (MACHINE #10, **PLANNED**).

**Still OPEN and blocking:** sweep interactions (METHOD #1) · evidence scope
(METHOD #2) · pool versioning (METHOD #3) · what counts as a "reasonable
composition" (GROUNDING #2). Full table, including the new `BUILD-SHEET.md`
gaps, is in `ATLANTEAN-RESUME.md`.

**Everything derives from `BUILD-SHEET.md`.** A threshold chosen locally —
without citing what the rung above requires of it — is a design error even when
the number looks sensible. That is principle #1, and it is the rule the whole
doc set now hangs from.

**The score is traversal depth, not pass/fail.** "Cleared 7 of 12 gates, stopped
at the render gate" is the shape of a result. Binary scoring destroys the signal
that early rungs depend on.

**The order is not negotiable:** walls → calibration → ablation → instruction
set → scale → one-shot. Jumping ahead to "build the game" is *the* failure mode
and is how attempt 2 happened.

**Attempt 2 is not an embarrassment to fix.** It scored 20/20 on a black screen
— which is the documented Play@k barrier that ten SOTA models also fail. It is a
frontier arrival, not a botch. Do not treat it as a bug hunt.

**Vacuous passes are the recurring enemy.** Four were found in a single day —
two in Atlan's own suite, two in `check.mjs`, plus one in the sweep analysis
where a *perfect* effect was reported as "NULL, smaller than noise." Assume more
exist. Every gate must be **unable to pass because a feature is absent**.

**The analysis is never model-generated.** No model reads sweep results and
reports what mattered. That contaminates the measurement with the thing being
measured. Same reason walls are code and gauntlet review is cross-model.

## 4. Settled — do not re-litigate

- **Atlantean** = *of Atlantis*. The team are Atlanteans; the project is Atlantis.
- **Environment rule** — the tier/gating policy is **detected, not hardcoded**.
  Probe kernel sandbox (behaviourally, via canary — a flag file lies), process
  durability, and power/thermal envelope; the caps derive from the readings.
  Device identity is not the input. It remains a TIER cap, never a FEATURE cap.
  `ATLANTEAN-RESUME.md` §0, with both profiles measured.
- **One-shot** = one production run, no human turns, into a mature harness.
  *Not* one prompt to a bare model.
- **Fable 5 = manager/orchestrator. Opus 5 = coder.** Evidence in
  `ATLANTEAN-RESUME.md` §6. Fable wants MORE delegation; Opus 5 over-delegates
  and needs a cap. Opposite tuning.
- **Generation minimal, deterministic code maximal.** Most of what looks like
  RPG content is formula. Models produce a compact design spec; code expands the
  corpus.
- **`check.mjs` and the spec are never writable by a building role.** If they
  moved during a run, the run is void.

## 5. Where the code is

**Design docs are on `main`. The implementation is NOT.**

| branch | worktree | contains |
|---|---|---|
| `main` | `/root/atlan` | all docs; the merged helis work; **pushed** |
| `feat/cross-engine-orchestration` | `/root/atlan-gamelab` | `circuit.js`, `sweep.js`, `assembly.js`, `transcript.js`, `production.js`, `agentExec.js`, `containment.js`, `enginePolicy.js` — **269 tests green, NOT pushed** |
| `experiment/game-fleet-test` | — | earlier game-test design; not pushed |

Game project: `/root/atlantis-2d` — own git repo, pre-registration commit holds
`ASSET-SPEC.md` + `check.mjs` from before any agent ran. **It renders nothing;
root cause unfound.**

## 6. Environment traps that cost real time

- **`wsl.exe` double-shell-expands quotes.** Never inline pipes, quotes or
  `$vars` in `wsl -- bash -lc "..."`. Write a script file, copy it in, run
  `bash /root/script.sh`. This will bite you within three commands otherwise.
- **PowerShell commands over ~965 bytes** produce visible parse warnings. Use
  script files.
- **A plain `nohup` background process dies** when the launching `wsl.exe` exits
  — the whole interop tree is torn down. Use `setsid`.
- **Node processes are identified by cwd**, not by the command line — they all
  run `node server/src/index.js`. Match on `/proc/<pid>/cwd`.
- **Three instances may be running:** `:4589` live (systemd), `:4689` helis
  verification, `:4789` orchestration (+`:4790` preview). Killing the wrong one
  is easy.
- **Playwright/Chromium ARE installed** globally at `/usr/lib/node_modules`.
  ESM will not resolve them by bare name — import by absolute path.
- **Never point the preview at its own port.** It self-proxies and wedges.
  Guarded now, but the instinct is worth keeping.

## 7. Working conventions

- **Every commit ends on a green `npm test`.** The only gate in Atlan is
  `npm test` — there is no format/lint/build script. (That is PreFlight's
  convention, not this repo's.)
- **Nothing is pushed until John names a push state.** `main` is currently
  pushed and clean; the two feature branches deliberately are not.
- **Rebase, never force.**
- **Contextless adversarial review** — any build also gets independent agents
  attacking it with no authorship context. Self-authored suites passing is not
  enough.
- **Never echo secrets** in chat. Refer to them by description.
- **Research/verify, then discuss with John, BEFORE any deletion.** Always.
- **Obvious config hygiene** (gitignore, headers, cookie flags) — fix and report,
  don't ask.

## 8. What to do first in a new session

1. Read `ATLANTEAN-RESUME.md`, then this file's §3.
2. `git -C /root/atlan status -sb` and `git -C /root/atlan log --oneline -5` —
   confirm state matches the doc; the doc may be stale, the repo is not.
3. **The landing map is done** (`LANDING-MAP.md`, 2026-07-31). The rung-1 chain
   is **26 gates**, derived. **Do not use the twelve-gate chain sketched in
   conversation** — it was assumed, was under half the real size, and omitted the
   stress and inspection families entirely.
4. Three things want deciding before more is built on them: the four-site landing
   rule (`LANDING-MAP.md` #7), `GROUNDING.md` #2 (the only unbuildable rung-1
   gate), and gate-chain versioning (`LANDING-MAP.md` #1).
5. **The tier-1 seven are unblocked** and are the place to start building walls.

**Do not start by building game code.** The walls come first because the walls
are the measuring instrument.
