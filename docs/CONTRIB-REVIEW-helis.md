# Contribution Review — helis-d: Inline AI + Git + Debugger + UI

**Status:** UNMERGED · advisory record · action items flagged for John
**Remote:** `helis` → `https://github.com/helis-d/atlan.git`
**Branch:** `feature/inline-ai-git-ui-debugger`
**Reviewed against:** `main` @ `80f0e0f`
**Diff size:** +1001 / −94 across 10 files (3 net-new server modules + colliding frontend)
**Reconstructed:** 2026-07-26 (the original review was never written down; this is the durable record)

> This document reconstructs a review that happened but was never captured. Every
> behavior below was re-verified against the fetched `helis` branch and our current
> `main`, not taken on faith from the earlier analyses. Where reading the real
> `server/src/index.js` **resolved** a question the earlier passes had to leave open
> (they didn't have it), that is called out inline as **[RESOLVED]**.

---

## 1. Context

### 1.1 The contribution
helis-d's branch adds four things, three of which are *features* and one of which is a *skin* — bundled into one patch:

| Area | Files | Net |
|---|---|---|
| Inline AI Edit (Tier-2 write path) | `server/src/editorAi.js` (new), `app.js`/`index.html`/`index.js` hooks | instruction → in-place code edit in the editor buffer |
| Git Manager | `server/src/git.js` (new), `s-git` tab, `/api/git/*` | status/diff/stage/unstage/commit/push/pull + AI commit message |
| Visual Debugger | `server/src/debugger.js` (new), `s-debug` tab, `debug.*` WS | node `--inspect` / CDP bridge with stepping + variable inspector |
| Skin + chrome | `style.css`, `app.js`, `index.html` | light/dark `data-theme` axis, glassmorphism, animations, swipe-nav, markdown/code chat rendering |

Confirmed diffstat: `debugger.js +113`, `editorAi.js +58`, `git.js +176`, `index.js +27`, `pty.js +51`, `app.js +297`, `index.html +83`, `style.css +134`, `config.js ±1`.

### 1.2 The plan (John's call)
- **Keep the mechanical / backend spine.** The three net-new server modules ride our existing hardened primitives (`guardPath`, `brainChat`, `engineRoster`, `PROJECTS_DIR`) and compile against our tree as-is.
- **His UI becomes one of three templates behind a switcher** — *his UI / John's Classic / brand-kitted MidAtlantic* — all over the shared mechanical spine. We already have the `[data-template]` seed (`index.html:25`) and a live `#templateSel` (`""`=Classic, `midatlantic`).
- **`editorAi.js` is the Tier-2 mechanism our chat brains feed** — the editor-native write path, not a fourth agent.
- **Reconcile his credential handling against our secret guards.** (Verdict: he adds no new credential path; the real seams are `git.js` / `debugger.js` reaching *past* the guard, covered in §5.)

### 1.3 The thesis this serves
Atlan is a phone-first AI build cockpit — one PWA, one spine, three AI tiers each reachable by subscription **or** API: **Tier-1** CLI agents (terminal-native, autonomous, output reviewed in Preview), **Tier-2** chat brains (editor-native, write into the editor, terminal only via a gated CLI-escalation), **Tier-3** open chat + multimodal (chat/gen-native, other surfaces gated). The gating gradient: *native reach is inverse to required human-gating.* helis's work slots into that gradient cleanly **if** each piece is placed at its correct tier — which is exactly what the mechanical table below does.

---

## 2. Mechanical layer

One row per module. Tier = where it sits in the gradient. Verdict = **KEEP** (take as-is) / **ADAPT** (take the mechanism, change specifics) / **HOLD** (take only behind a named control) / **DROP**.

| Module | What it is | Tier | Surfaces | Gating | Collision | Security seam | Verdict + reasoning |
|---|---|---|---|---|---|---|---|
| **`editorAi.js`** `handleInlineAiEdit` | POST `{path,content,selection,instruction}` → `guardPath(path,{blockAppRoot:true})` → `engineRoster().find(r=>r.ready)` → `brainChat` (mockSend capture) → strip fences → `{ok,content}`. **Does not write disk**; client applies to the CodeMirror buffer, Save goes through the existing guarded `/api/file`. | **2** | editor, chat | Human-gated by design: result lands as `edDirty` unsaved buffer; disk write is a conscious Save behind `/api/file` guards. **No terminal reach.** | Backend: **soft** (new file, clean reuse). Frontend: **HARD** inside app.js +297 — his `addMsg` swaps our `renderRichMessage` branch. | None new: never touches keys (delegates to `brainChat`); `guardPath{blockAppRoot:true}` already blocks credential-shaped targets even though it doesn't write. | **ADAPT** — keep the backend mechanism; it *is* the Tier-2 pipe and complements (does not duplicate) our pseudo-assistant. Rewire engine selection to the user's chosen brain (see §4); take only the Inline-AI frontend block, drop his chat-render edits. |
| **`debugger.js`** CDP bridge | `spawn('node','--inspect-brk=127.0.0.1:0', script, ...args)` in a `guardPath`'d cwd, scrapes the inspector URL from stderr, opens a WS to V8, enables Debugger+Runtime, pipes every inspector msg to the client. `handleDbgCommand` forwards **raw client `m.cmd`** to the inspector **unfiltered**. `cleanupSession` closes WS + SIGKILLs child. | **plumbing** (terminal-class reach) | terminal, editor, preview | **Terminal-class.** START = OS process spawn = a MAIN step. Raw CDP = arbitrary-code. See §5-A. | Soft (net-new, no `debug.*` router exists). **[RESOLVED]** wiring adds server-side `clientId` + `ws.on('close')` cleanup. | **HIGH** — `Runtime.evaluate`/`evaluateOnCallFrame` in a child spawned with `env:{...process.env}` = RCE + a clean bypass of `guards.js`. `guardPath` called **without** `blockAppRoot`. | **HOLD** — mechanism is clean and worth keeping (loopback ephemeral port, array args, no shell, `--inspect-brk`). Ship **only** behind a server-side CDP allowlist + minimal-env spawn + `blockAppRoot:true` + a terminal-style gate on START. |
| **`git.js`** Git Manager | 7 handlers + `gitAiCommitMsg`, all via `runGit(cwd,args)=execFile('git',argv)` (no shell). `--` end-of-options on every pathspec. cwd via `guardPath`. push/pull take **no** user args (default remote/branch → no user-controlled ref). | **plumbing** | editor, chat, git | Mutating ops are POST; push/pull are network-irreversible MAIN steps. | No file collision (`git.js` is new; imports resolve, signatures match). One **HARD security collision** with our hardening (see seam). | **HIGH** — `getGitDiff` untracked/tracked fallback reads sensitive file content **past `SENSITIVE`**; every `guardPath` omits `blockAppRoot`; `gitAiCommitMsg` egresses up to 10k of raw diff. Command-injection is **NOT** the exposure — `execFile`+`--` are correct. | **ADAPT** — keep the `execFile`+`--` spine (preserve it exactly); **must** patch the `readFileSync`/`git show` SENSITIVE bypass, add `blockAppRoot:true`, gate the diff-egress, before mounting. |
| **`pty.js`** (spawn hardening) | `ptyEnv()` **unchanged** (identical to ours; keys already flow into the shell by design). `openPty` adds: win32 shell (COMSPEC/powershell), cwd defaulting, and a try/catch that reports spawn failure to the ws instead of throwing. | **plumbing** | terminal | Unchanged — PTY is already card-gated for agents / ungated for a human opening a terminal (same as today). | Soft — his `openPty` is a strict superset of ours; take-his is a clean merge. | None new — `ptyEnv` untouched; a PTY is a full terminal that legitimately carries keys; `guards.js` is deliberately not in this path. | **KEEP** — real robustness win (graceful spawn-failure) + Windows portability. No credential regression. |
| **`config.js` / `index.js`** wiring | `config.js`: on win32, `PROJECTS_DIR` default becomes `process.cwd()` (Linux unchanged → **no-op on the prod home node**). `index.js`: additive route registration + WS `debug.*` cases + per-connection `clientId` + close-cleanup. | **plumbing** | all | REST routes inherit the global chain; WS handlers inherit upgrade-time gate. | Additive, no hard collision in these files (the +297 hard collision is `app.js`, not here). | **[RESOLVED]** REST routes land **after** `app.use('/api', authMiddleware)` (`index.js:111`) and the origin-pin (`index.js:56`); WS cases sit inside the `originOk`+`wsAuthed` gated closure (`index.js:368-369`). `clientId` is **server-side** `Math.random()`, never from the message. | **KEEP/ADAPT** — keep the wiring; the win32 `PROJECTS_DIR` change **requires** the `guards.js` separator fix land in the same commit (see §5-E). |

---

## 3. UI as three templates

The plan only works if we **first separate his three change-kinds**, because in our seed a "template" is defined narrowly: a CSS variable-override set keyed on `[data-template]` (exactly how `midatlantic` already composes). Split into three layers:

### 3.1 SPINE — one copy, template-agnostic
All mechanical JS (editorAi POST, `git/*` fetches, `debug.*` WS protocol, the merged message renderer, swipe-nav, theme-toggle logic) **plus** the DOM hooks it binds to (`#edInlineAi`, `#aiModal`, `#gitFilesList`, `#dbgEditor`, the `s-git` / `s-debug` sections, the Git/Debug nav buttons). These live in `index.html` as **permanent structure available under every skin** — a Git tab is a cockpit feature, not a look.
- If John wants Classic to *hide* Git/Debug, feature-flag via a nav/body class — **never** via the skin value. A skin must never add or remove functional DOM.

### 3.2 THREE SKINS — CSS-only, mutually exclusive via `[data-template]`
| Skin | `[data-template]` value | Source | Rule |
|---|---|---|---|
| **Classic (John)** | `""` (default, no attr) | current `style.css` base | **Left byte-for-byte.** His `style.css` edits rewrite *shared base rules* (`body`, `.phone`, `header`, `nav`, `.msg.claude`, `.btn`) un-scoped — as written they change John's look for everyone. That is the direct violation of "without overwriting John's." |
| **MidAtlantic** | `midatlantic` | existing `midatlantic.css` | unchanged; the model for how a skin drops in |
| **His** | `his` (new) | **new `his.css`** | Every glass var + `backdrop-filter` rule + animation re-scoped from a bare selector to `:root[data-template="his"]` / `[data-template="his"] <sel>`. |

Wiring is a single line: add `<option value="his">His</option>` to `#templateSel` — mirroring how MidAtlantic already composes.

### 3.3 `data-theme` is a SEPARATE global axis — do not fold it into the template value
His patch introduces a light/dark toggle on a new `data-theme` axis (`applyTheme`, `#themeBtn`, `localStorage 'theme'`). Keep `#themeBtn` + `applyTheme` on the **spine**; let each template optionally define its own `[data-template="X"][data-theme="light"]` block. His light palette moves there. His diff currently makes light **global**, which changes John's Classic look — that's an open decision (§7).

### 3.4 The "mood engine" is not his
The mood-engine + halo canvas appear in his diff only as **unchanged context** — they already exist in both trees. He does not add them; don't attribute or re-merge them.

---

## 4. Editor ⇄ pseudo-assistant reconcile

### 4.1 Two modalities of the same "brain writes to editor" spine — wire both, dedupe neither out
Our tree already has a pseudo-assistant: `addMsg` branches `if (role==='brain') renderRichMessage(...)` (`app.js:355`), and `buildCodeBlock` gives each fenced block a **→ Editor** button routed to `sendToEditor` (`app.js:384,691`). These are **complementary**, not duplicates:

| | our `sendToEditor` | his `editorAi` |
|---|---|---|
| Trigger | a **chat code card** (fenced block from a brain reply) | an **instruction** on the currently-open file |
| Scope | whole-file **proposal** | selection-in-place (`replaceSelection`) or whole file |
| Path | **clears** `edCurrentPath` → Save is a conscious destination (`app.js:696`) | **keeps** `edCurrentPath` → "edit THIS file" |
| Meaning | "here's a file from our conversation" | "apply this change to what I'm looking at" |

Both are Tier-2 (editor-native, disk write behind the guarded Save). **Wire both.**

### 4.2 Keep ONE spine renderer — drop his `formatMarkdown` edits
**HARD collision:** his `app.js:482` `div.append(formatMarkdown(text))` replaces our brain-branch, and his `formatMarkdown` is a *less-capable* competing renderer (Copy-only, applied to **all** roles, **no → Editor button**). His `endWorking` re-render (`app.js:397` `streamBubble.lastChild.replaceWith(formatMarkdown(turnText))`) has no counterpart in our streaming path.
- **Keep** `renderRichMessage` (XSS-safe `createElement`/`textContent` **and** the → Editor bridge). **Drop** his `addMsg`/`endWorking` edits — force-porting either kills the pseudo-assistant or double-renders.
- Let `buildCodeBlock` (already XSS-safe, already has Copy) absorb his prose/fence-split if we want richer markdown; route his turn-end re-render through that single renderer.
- **Do not redeclare `escapeHtml`** — his new git/debug render code *depends* on our existing `escapeHtml` (`app.js:442`); just don't let him add a second definition.

### 4.3 Engine selection — the load-bearing adaptation
His `editorAi.js` auto-picks `engineRoster().find(r=>r.ready)` (first ready brain). For a real Tier-2 pipe it should be fed by the **brain the user is talking to**. Critically, **do not forward `#modelSel` blindly**: `modelSel` emits `id|model` for *both* namespaces, and `brains.js PROVIDERS` contains **no agents** — `claude`/`codex`/`copilot` are agents; passing `claude` into `brainChat` returns `chat.err "unknown engine: claude"` (`brains.js:111`) and the edit silently no-ops for the most common cockpit state.
- **His own `gitAiCommitMsg` already solves this** (`git.js`): it reads `engine|model`, maps `engine==='claude'` (or any non-brain) to a first-ready **brain** fallback. **Reuse that exact mapping in `editorAi`:** take `engine`/`model` from the request; if it resolves to a real `PROVIDERS` brain, use it; otherwise fall back to `roster.find(r=>r.ready)`. Surface which brain actually ran.
- Note the `grok`/`gemini` id ambiguity: both exist as an agent CLI **and** a brain provider — the same id means different tiers by entry point. The brain-first mapping above resolves it for the ai-edit / ai-commit paths.

### 4.4 Whole-file mode is a data-loss footgun — gate it
Unlike `sendToEditor` (which clears the path so it's a proposal), `editorAi`'s no-selection path does `cmEditor.setValue(content)` over the live buffer and **keeps** `edCurrentPath`. With unsaved manual edits open, a reflexive Save writes AI output straight over the real file — no diff, no confirm, no undo grouping. **Gate the no-selection path behind a diff/confirm**, or route it through `sendToEditor` semantics (clear the path), and use a single replace transaction to preserve undo.

### 4.5 Tier-2 vs Tier-3 boundary is implicit
Nothing in code distinguishes a Tier-3 open-chat brain from a Tier-2 brain on the editor-write path — a Tier-3 provider's replies reach `addMsg` with `role==='brain'` and get the same → Editor button and the same single Save gate. **Decide (§7):** is the manual Save the intended Tier-3 gate (then document it), or do we tag `chat.send`/`ai-edit` with a tier and require an extra confirm for Tier-3 editor pushes? Today the boundary is unrepresentable.

---

## 5. Auth-matrix + guards security reconcile

**Framing (per memory):** open-source repo, single-user home node, user's own keys — these are *organizational / hardening* seams, not "leaks." The credential-injection-vs-guards seam is the one thing John explicitly asked to reconcile, so it's spelled out first.

### The seam, stated plainly
`guards.js` `SENSITIVE` (`guards.js:23`) + `guardPath` exist to keep the **editor/scanner file API** from reading credential stores (`.claude/.codex/.grok/.gemini/.copilot`, `.config/gh`, `.auth-token`, `.fleet`, `.env`, ssh keys). helis adds **no new credential-injection path** — `editorAi` and `git.js` both delegate model auth to `brainChat` (Bearer-from-env/encrypted-store, `brains.js:87-90`), and `ptyEnv` is untouched. The exposure is the opposite direction: **two of his new surfaces reach files/processes *past* the guard.** Fold-in of the adversarial findings with mitigations:

### 5-A · Debugger CDP passthrough = RCE + total guard bypass — **CRITICAL**
`handleDbgCommand` forwards any client `m.cmd` to V8 unfiltered. `Runtime.evaluate` / `Debugger.evaluateOnCallFrame` run arbitrary JS inside a child spawned with `env:{...process.env}` — which can `fs.readFileSync('/root/.claude/.credentials.json' | '/root/.auth-token' | '/root/.fleet/auth.json')` and stream it back over `debug.event`. That reads the exact files `SENSITIVE` was written to block, plus the automation bearer and the scrypt password hash.
- **A naive "allow stepping + setBreakpoint" allowlist is still RCE:** `Debugger.evaluateOnCallFrame` **and conditional breakpoints** (`setBreakpointByUrl`/`setBreakpoint` carrying a `condition`) also evaluate arbitrary JS.
- **Env-stripping alone is insufficient** — the child has `fs` access as the server user (root) regardless of env — but it's still necessary (closes the direct `process.env` → bearer route).
- **Mitigation (all of):** server-side CDP **allowlist** (`Debugger.resume/stepInto/stepOver/stepOut`, `setBreakpoint` by `scriptId` **without** `condition`, `getScriptSource`, `Runtime.getProperties` on existing scopes); **deny** `Runtime.evaluate`/`callFunctionOn`/`compileScript`/`addBinding`, `Debugger.setScriptSource`, `Debugger.evaluateOnCallFrame`, and any `condition`-bearing breakpoint. Spawn with **minimal env** (drop `ATLAN_TOKEN` + provider keys). Add `blockAppRoot:true` to **both** `guardPath` calls. Gate `debug.start` (a MAIN step). Tier-2/3 reach only via a gated CLI-escalation.

### 5-B · `git.js getGitDiff` reads sensitive content past `SENSITIVE` — **HIGH**
Three working vectors (`..` traversal is separately blocked by git's own pathspec check, so it is *not* one):
1. **Untracked:** `?? id_rsa` → `git show :id_rsa` fails (not in index) → catch → `readFileSync(path.join(cwd,file))` returns the key as `+`-diff. **No `guardPath`, no `SENSITIVE`, no realpath.**
2. **In-repo symlink:** untracked `notes -> /root/.claude/.credentials.json` → `readFileSync` follows the link (the realpath guard never runs) → token returned.
3. **Tracked-but-modified:** `git diff HEAD -- .env` surfaces secret content of a tracked `.env` that `/api/file` would refuse — same bypass via the tracked branch, no untracked/symlink needed.
- **Mitigation:** route the untracked read through `guardPath({blockAppRoot:true})` (so `SENSITIVE`+symlink+root apply) or drop the `fs` fallback entirely and render `untracked blob (not shown)`; for the tracked branch, refuse to diff a path that fails `guardPath`.

### 5-C · Every `git.js` `guardPath` omits `blockAppRoot` — **HIGH**
`status/diff/stage/commit/push/pull/ai-commit-msg` accept `cwd = APP_ROOT` (the cockpit's own repo). `files.js` sets `blockAppRoot` precisely to keep tooling out of the cockpit's source/state; `git.js` reopens that door and adds network-irreversible push/pull. Worst case: `git pull` over a tampered remote onto `server/src/auth.js`, executed on the next supervisor respawn.
- **Mitigation:** `{blockAppRoot:true}` on every `guardPath` in `git.js`; scope the panel to real project subdirs (never `PROJECTS_DIR` root or `APP_ROOT`); explicit human gating on push/pull.

### 5-D · `gitAiCommitMsg` diff egress — **MEDIUM**
Ships up to 10k chars of raw staged/unstaged diff to a third-party brain provider with no secret pre-scan — a one-click off-box egress of any staged secret (against the "don't propagate secrets off the box" posture; user's own key, but should be conscious).
- **Mitigation:** secret-scan the diff before send; warn/gate when staged paths look credential-shaped; make egress an explicit per-invocation confirm that shows what leaves the box.

### 5-E · Windows `SENSITIVE` fails open — **MEDIUM** (dormant on prod)
`SENSITIVE` (`guards.js:23`) is forward-slash-only; on win32 `resolve()` yields backslash paths. Verified: `SENSITIVE.test('/root/.claude/x') === true` but `SENSITIVE.test('C:\\Users\\jviru\\.claude\\x') === false`. His `config.js` win32 `PROJECTS_DIR = process.cwd()` (at/above the user profile) then makes `.claude/.codex/.gemini/.config/gh` readable through **`/api/file`, `/api/git/diff`, AND the debugger's source fetch** — every `guardPath` consumer, not one route. No-op on the Linux home node (prod unaffected), but the merge ships the footgun.
- **Mitigation:** make `SENSITIVE` separator-agnostic (normalize `\` → `/` before `.test`, or add `\\` to each separator class) **in the same commit** as the win32 `PROJECTS_DIR` default, so the guard can't diverge by platform.

### 5-F · Auth / origin wiring — **[RESOLVED, was MEDIUM/unconfirmed]**
Reading the real `index.js` closes the earlier "unconfirmed mount order" and "client-supplied clientId" concerns:
- REST routes (`/api/git/*`, `/api/editor/ai-edit`) are registered **after** `app.use('/api', authMiddleware)` (`index.js:111`) and after the origin-pin that rejects non-GET/HEAD cross-origin (`index.js:56`) → they inherit password/session-cookie + bearer auth **and** CSRF/origin protection.
- WS `debug.start`/`debug.cmd` sit inside the `wss.on('connection')` closure gated at upgrade by `originOk` (`index.js:368`) + `wsAuthed` (`index.js:369`).
- `clientId` is **server-side** `Math.random().toString(36)` per connection — **not** read from the message, so no cross-session hijack; and `ws.on('close') → cleanupSession(clientId)` **is present**, so dropped clients don't orphan the node child.
- **Residual:** transport auth is **not** a substitute for the §5-A CDP allowlist / §5-B–C guard fixes / the human permission card on `debug.start`. Add a concurrent-debug-session cap (resource/DoS).

### 5-G · Disproven — preserve these safe patterns on any refactor (**INFO**)
- **`git.js` command/argument injection: does NOT materialize.** `runGit` uses `execFile('git', argv)` (no shell) and `--` on every pathspec; `git show :${file}` is a single git revision-spec; push/pull take no user args. A commit message like `; curl evil | sh` is inert literal argv. **Never switch to `exec`/`shell:true`; never drop the `--` separators.**
- **`pty.js` credential injection: none.** `ptyEnv()` is byte-identical to ours and above his hunk. **Keep `ptyEnv` unchanged.**
- **Debugger transport: no unauthenticated remote reach** (origin-pinned + `wsAuthed`), and the inspector binds `127.0.0.1:0` (loopback, ephemeral).

---

## 6. Cross-diff checklist — ordered integration steps

**Do these in order. Do not `git merge` his branch wholesale — the +297 `app.js` lands in a file our hardening rewrote.**

1. **Land the guard fix first, standalone:** make `SENSITIVE` separator-agnostic (§5-E) and land it in the **same commit** as adopting his win32 `PROJECTS_DIR` default. Verify: `.claude`/`.config/gh` backslash paths now match.
2. **Take `pty.js` as a take-his** (strict superset). Confirm `ptyEnv` is unchanged in the merged result. Note the win32 branch spawns COMSPEC/powershell with no tmux — our `pty.exit` copy says "tmux session ended"; fix that copy for the Windows path (cosmetic, dead on prod).
3. **Add `editorAi.js`** as-is, then **adapt**: (a) accept `engine`/`model` from the request and apply the `gitAiCommitMsg` brain-mapping (brain if it's a real `PROVIDERS` id, else first-ready fallback — §4.3); (b) keep `guardPath{blockAppRoot:true}`.
4. **Add `git.js`, then patch before mounting:** (a) route the untracked read through `guardPath({blockAppRoot:true})` or drop the `fs` fallback (§5-B); refuse tracked-sensitive diffs; (b) add `{blockAppRoot:true}` to **every** `guardPath` (§5-C); (c) add the diff-egress secret-scan/confirm to `gitAiCommitMsg` (§5-D).
5. **Add `debugger.js`, then HOLD behind controls:** (a) server-side CDP allowlist (§5-A); (b) minimal-env spawn dropping `ATLAN_TOKEN`+keys; (c) `blockAppRoot:true` on both `guardPath` calls; (d) a terminal-style gate on `debug.start`; (e) concurrent-session cap. **Confirm the debug source pane fetches through `/api/file`→`guardPath`** (it does client-side; the fetch will 400 on node-core/`node_modules`/out-of-root frames — expected; render "source unavailable" rather than blank).
6. **Wire `index.js`** exactly as his diff does — confirm the routes land after `app.use('/api', authMiddleware)` (they do at the `/api/tree` insertion point) and the `debug.*` cases stay inside the gated WS closure with the **server-side** `clientId` and the `ws.on('close')` cleanup.
7. **`index.html` — 3-way merge, not additive.** Cherry-pick only his new node subtrees (`#aiModal`, `s-git`, `s-debug`, `#themeBtn`, Git/Debug nav). **Preserve our six newer surfaces his branch predates:** Persona+ builder (`cPersona`/`pProfile`), worker Hierarchy (`hEngine`/`jobGate`), Routines (`routKind`), the Scan card, the `templateSel` options + `data-template` seed, and the local-model picker (`lmSel`). Add `<option value="his">` to `#templateSel`.
8. **`app.js` — surgical, never take-his.** Port his new functions and the `s-git`/`s-debug`/inline-AI handlers. **Keep our `addMsg`/`renderRichMessage`/`buildCodeBlock`/`sendToEditor` and the WS `switch`**; drop his `formatMarkdown` `addMsg`/`endWorking` edits (§4.2). Do not redeclare `escapeHtml`. Confirm his debug pane uses the **CM5** API (`setValue`/`setCursor`/`addLineClass`/`removeLineClass`/`lineCount`) — it does, matching our `vendor/cm/codemirror.js` bundle, so no CM6 port is needed. Add the no-selection inline-AI confirm/diff (§4.4).
9. **`style.css` → new `his.css`.** Move every glass var + `backdrop-filter` + animation, re-scoped under `:root[data-template="his"]` / `[data-template="his"] <sel>`. Leave Classic base byte-for-byte. Move his light palette to `[data-template="his"][data-theme="light"]` unless John wants global light (§7).
10. **Register the new surfaces in self-awareness:** add `s-git`/`s-debug` (and the already-missing `s-scan`) to `TAB_NAMES` (`index.js:325`) so `cockpitContext` doesn't misreport the tab as "Chat." Decide nav placement — the phone-first bottom nav is 7 buttons today; Git+Debug as top-level makes 9 and overflows a narrow phone. Either nest them (like Scan-in-Doctor) or design the overflow first.
11. **Run the full local gate** (test/lint/build/self-audit/format) and an **adversarial contextless pass** (independent agents attack the merged debug/git endpoints) before John names a push state. `npm run format` before commit — CI gates on `format:check`.

---

## 7. Open decisions for John

1. **Debugger — ship, or hold entirely?** Even fully mitigated (§5-A), it's a terminal-class RCE primitive. Confirm: ship behind the CDP allowlist + minimal-env + START gate, or park `debugger.js` until the gated CLI-escalation plumbing exists for Tier-2/3? (Note: Atlan's permission cards today gate **agent** tool calls only — a human opening a terminal is ungated. A "permission card like the terminal" for `debug.start` is *new plumbing*, not an existing control.)
2. **Git panel scope on `APP_ROOT`.** Hard-block the cockpit's own repo like the editor does (recommended), or allow the Git panel to operate on it deliberately?
3. **`gitAiCommitMsg` egress.** Acceptable on the user's own key with a warning, or opt-in per-invocation with a secret-scan pre-check?
4. **Do Git + Debug tabs appear under all three skins, or only his?** Recommendation: all three (they're spine features); confirm shared-nav vs feature-flagged-off for Classic.
5. **Does Classic get a light mode?** His diff makes `data-theme="light"` global — that changes John's look. Scope light per-template, or adopt it globally?
6. **`#themeBtn` and swipe-to-change-tabs on all skins?** Both are global-axis/spine behaviors that touch John's header/gestures. Shared is cleaner; confirm.
7. **Tier-2 vs Tier-3 editor gate (§4.5).** Is the manual Save the intended Tier-3 gate (document it), or add a tier marker + extra confirm for Tier-3 editor pushes?
8. **Nav real estate.** Nest Git/Debug (Scan-in-Doctor pattern) or redesign the bottom nav for 9 buttons on a phone before shipping top-level tabs?
9. **Attribution.** helis-d is an external contributor whose mechanical spine we're keeping and whose UI becomes template #1. Confirm how his contribution is credited (NOTICE / commit trailer / template label).
