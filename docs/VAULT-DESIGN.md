# L3 — The Knowledge Vault (design sketch, for review)

*Two of your ideas fused into one thing: the **token-optimization vault** (query a small page instead of re-deriving — the proven L3 lever) and the **gated self-repair vault** (Atlan learns from what breaks and can propose fixes — behind hard gates so it never becomes an evolving slop-bot). This is a design for sign-off; nothing is built yet. The gating is the whole ballgame, so it's front-and-center.*

---

## What it is (your thesis, made real)
A **vault/** of small, scoped, `[[wikilinked]]` markdown pages — the "10k atomic pages" idea. Each page is a compiled, scoped knowledge unit: a Persona+ seed *grown* with accumulated specifics. The agent **queries** the vault (grep, not embeddings — the research is clear grep wins for this) and loads one small relevant page instead of re-reading N source files or re-deriving what it already learned. A page grown once is queried cheaply forever. That's the token win, and it grounds "scope is the moat."

## Page shape
```markdown
---
title: nhtsa-vin-decode
scope: automotive/vin
tags: [vin, nhtsa, api]
confidence: verified        # unverified | verified
source: run-6810987 / John
updated: 2026-07-22
---
VIN is 17 chars, positions 4-8 = vehicle attributes...
See [[dtc-p0300-family]].
```
Small (size-capped to stay atomic), typed frontmatter, links between pages. Compaction is **never** applied to numeric/precise pages (research: compaction loses 0/3 precise numbers) — those stay verbatim.

## How the agent reads it (the token lever)
Two tools, grep-backed:
- `vault_search(query)` → matching page titles + snippets
- `vault_read(page)` → the full small page

Before working, the agent searches the vault, loads the matched page(s), and skips re-deriving. Measurable via `token-bench` (cold vault vs warm vault).

---

## STAGE 1 — read + human-gated growth  (build first; safe, delivers the token win)

The vault can **grow**, but never autonomously. Every add/edit is a **proposal**, never a direct write:

1. **Propose, don't commit.** The agent emits a page diff into a *proposals queue*. It cannot write the vault directly.
2. **Deterministic checkers gate it** (reuse the M5d checker engine): valid frontmatter, size within the atomic cap, scope declared, source cited, **dedup** against existing pages (no near-duplicate slop), links resolve. Malformed → auto-rejected, no human needed.
3. **Human gate.** You see each proposal (diff + provenance), and approve / edit / reject. Nothing enters the vault without your yes. (Same pattern as the hierarchy's tier-3 gate.)
4. **Provenance + confidence.** Every page records what proposed it, when, and its source; unverified pages are marked and can't override verified ones.
5. **Gates live in code, not the vault.** A page can never contain instructions that change the gate. (Same principle as "the sandbox can't edit its own settings.")

Stage 1 gives you: cheaper repeated work + a growing, *curated*, auditable knowledge base — with zero autonomy risk.

**UI:** a Vault view — browse/search pages (tree + grep box), a Proposals inbox (approve/edit/reject with the diff shown), provenance + confidence on each page.

---

## STAGE 2 — gated self-repair  (design now, build later, OFF by default, opt-in)

This is the ambitious one — "fix things that error and rebuild" — and it's where the slop-bot risk lives. So it's **maximally gated, and every guarantee is by construction, not by trust:**

**The loop:**
1. **Detect** — an error is captured (build fail, fleet run error, checker fail). It becomes a *fix candidate*, nothing more.
2. **Diagnose** — a scoped fix-agent reads the error + relevant vault pages, proposes (a) a bounded code diff and (b) a fix/postmortem page. Proposal only.
3. **Gate A — checkers** (deterministic): the diff is size-bounded, touches only allowed paths (never the gate code, auth, `.fleet`, settings), changes no gate/guardrail, and is well-formed.
4. **Gate B — verify in isolation**: the fix is applied in a **throwaway git worktree** and the full test suite runs there. Fails → discarded, logged. It never touches your real tree unverified.
5. **Gate C — human**: you approve the fix *and* the rebuild. **Nothing self-modifies or rebuilds without your explicit yes.**

**Anti-slop-bot guarantees (by construction):**
- **No recursion** — a repair can't trigger another repair. One hop, then stop.
- **Gates in code, never in the vault or a prompt** — the agent can't soften its own leash.
- **Rate-limited + circuit breaker** — N attempts per window; if fixes keep failing, self-repair halts and alerts you.
- **Kill switch** — one toggle disables the whole loop. Default: **OFF**.
- **Everything git-tracked + revertible** — no change is unauditable or permanent.
- **Bounded scope** — small pages, bounded diffs, allowlisted paths only.

The result: Atlan can *surface* "here's what broke, here's a tested fix, approve?" — which is genuinely useful — while being structurally incapable of quietly evolving itself. It's the hierarchy's human-gate + checker philosophy pointed at Atlan's own code.

---

## How it reuses what's already built
- **Checkers** (M5d) → validate proposals + fix diffs.
- **Hierarchy human-gate** pattern → the approval UX.
- **Worktree isolation** → the verify-in-isolation step (also the Bash-sandbox alternative we discussed).
- **Fleet profiles** → a read-only "librarian" agent proposes pages; a scoped "medic" proposes fixes.
- **Persona+** → a persona *is* a seed vault page (your unification insight); personas can live in / link to the vault.

## Build order
1. **Stage 1 vault** — pages, `vault_search`/`vault_read` tools, proposals queue + checker gate + human approval, Vault UI. Measure the token win with `token-bench`.
2. Prove it, use it, let the knowledge base grow (curated).
3. **Stage 2 self-repair** — only after Stage 1 is solid; off by default; built gate-first (worktree verify + human approval before the loop is ever armed).

## Open questions for you
1. **Vault scope** — one global vault, or one per project? (I lean per-project, with an optional shared/global vault for cross-project knowledge.)
2. **Who proposes pages in Stage 1** — only you/agents on demand, or does a "librarian" auto-propose from fleet runs (still gated)? (I lean: on-demand first, auto-propose later.)
3. **Stage 2 appetite** — build the self-repair loop after Stage 1, or is Stage 1 (the token + knowledge win) enough for now and self-repair waits until you've lived with the vault?
4. **Where the Vault UI lives** — its own tab, or a sub-pane under Fleet next to Hierarchy?
