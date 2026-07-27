# Session recap — 2026-07-25 evening → 2026-07-27

Phone-side session. Started with the cockpit dead after an overnight reboot,
ended with multimodal generation working on-device and four of five CLI engines
authed. Seven commits, `23e4955 → 0bb5150`, all pushed. Working tree clean.

---

## 1. The cockpit was down, and the safety nets had never been armed

**Symptom:** phone rebooted overnight; `http://127.0.0.1:4589` dead in the morning.

**What we found.** Two nets had been built the night before and neither had ever
fired:

- `~/.atlan/watchdog.stamp` was frozen at `2026-07-24 20:26:51` — the moment it
  was copied there. The watchdog stamps that file on **every** run, so a frozen
  stamp meant zero runs, ever.
- `termux-job-scheduler` **was not installed at all** (`termux-api` package
  missing — only `termux-wake-lock` exists, which ships with termux-tools). So
  the JobScheduler registration in the script's header could never have been run.
- `~/.termux/boot/atlan-boot.sh` was correctly in place, but `.atlan-server.log`
  had no entry after the reboot — Termux:Boot never fired it.

**Root cause of the *class* of problem:** the failure was silent. Nothing in the
product reported that the recovery mechanism was dead.

**Fixed — `5fd52c4`.** A Doctor check that reports the watchdog's real state from
its heartbeat stamp: not installed / installed-but-never-fired / stale (>20 min)
/ armed with age. Non-Termux hosts get `N/A` rather than a false alarm. HANDOFF
rewritten to say plainly that the in-proot supervisor dies with the tree and to
name thermal shed alongside the phantom killer.

**Still open:** the watchdog is committed but **not armed**. Registering it needs
`pkg install termux-api` + the two F-Droid addon APKs + the
`termux-job-scheduler` command, all in native Termux.

---

## 2. A stale-ref read cost us the real picture

I reported "small, clean working set" from a `git status` without fetching.
`origin/main` had **34 commits, 168 files, +25,958/−116** waiting — a full day of
PC-side work (2026-07-25, 10:03 → 23:27) that wasn't in view.

That day's work, summarised: the **PreFlight SAST engine vendored into Atlan**
(~24,700 lines, via a re-runnable `scripts/sync-preflight.mjs` pinned by
`preflight.lock`), a **Scan surface** in the Doctor tab, an **8-commit dogfood
loop** where Atlan scanned itself and shipped the findings, three **new engines**
(Grok Build, Antigravity replacing Gemini CLI, GitHub Copilot), **chat-to-editor**
review canvas, the **MidAtlantic visual template**, editor-API **token-store
hardening**, and **`docs/ARCHITECTURE.md`** (237 lines).

Merged clean as `2c073ce`, `npm install` for 13 new packages, server restarted on
merged code.

**Lesson recorded:** never report sync state without fetching first.

---

## 3. The scanner's own test corpus poisoned the host's supply chain

**Found by John**, not by me: `jsonwebtoken` in `package.json`, used by nothing.

**Trace.** `sync-preflight.mjs` regex-traces every non-relative import in the
vendored engine into `installDeps`. That walk includes
`lib/probes/v05/fixtures/`, whose files are **scan inputs** — deliberately
vulnerable samples that exist so a probe can prove its rule fires.
`JS-AUTH-001/positive.js` imports `jsonwebtoken` *as bait*. The `surprises` check
did flag it — as a `log()` NOTE reading "install step will add them", **not a
gate** — and it was installed anyway, landing in both `package.json` and
`preflight.lock`.

So on the day the supply-chain scanner shipped, the scanner's vulnerable-code
corpus was contaminating the host project's dependency tree.

**Fixed — `775703c`.** `DEP_EXEMPT_RE = /(^|[\\/])fixtures[\\/]/` plus a
`continue` before dep collection. Fixtures still vendored (the smoke test scans
one); their imports no longer count as dependencies.

**Also produced `docs/DEP-AUDIT-2026-07-26.md`**, recording:
- the 9 deps genuinely imported
- **4 more declared but dead** — `@xterm/xterm`, `@xterm/addon-fit` (the browser
  loads committed `web/public/vendor/` copies; **no copy step from node_modules
  exists**), `html2canvas`, `node-fetch` — **left in place pending your call**
- all 4 npm audit findings are transitive from the pinned Agent SDK
  (`@modelcontextprotocol/sdk` → `@hono/node-server` / `fast-uri`), so pruning
  won't clear them, and `audit fix --force` would fight the deliberate `0.3.210`
  pin. The `@hono/node-server` path traversal is **Windows-only** — not reachable
  on Android/Linux.

---

## 4. Dogfooding with real ground truth — audio/video was completely dead

Built `test/dogfood.mjs` plus `test/fixtures/` with **known ground truth**,
because the existing `.attachments` fixtures were **1×1 gray PNGs and 9-byte
mp3s** — nothing multimodal had ever actually been verified.

New fixtures: `mm-quadrants.png` (512×512, TL=red TR=green BL=blue BR=yellow,
exactly 7 white circles) and `mm-tone-440.wav` (3 s, 440 Hz sine).

**First run: 4/8.** The failures were real, not flaky.

**Bug found — audio/video understanding was 100% broken and lying about why.**
Every audio attachment returned *"needs a Gemini or OpenAI key"* **with a valid
`GEMINI_API_KEY` stored**. Two bugs stacked:

1. `attachments.js` kept its own hardcoded `gemini-2.5-flash`. Direct probe:
   **404, "no longer available to new users."** `gemini-3.6-flash` returns 200.
   Commit `34550ec` ("refresh stale/dead brain model defaults") swept `brains.js`
   and never saw this second copy.
2. `saveUpload`'s `catch` collapsed **every** failure into the missing-key
   message — so a dead model ID surfaced as "add a key you already have," the
   exact opposite of the honest-readiness rule in ARCHITECTURE.md.

**Fixed — `1f88758`.** `brains.js` now exports `MULTIMODAL_MODEL` as one source
of truth; `attachments.js` imports it. The catch distinguishes no-key from
call-failed. **Verified: `note="[high-pitched beep]"` for the 440 Hz sine.**

**Second run: 6/8.** Remaining two, both recorded in
`docs/DOGFOOD-FINDINGS-2026-07-26.md`:

- **Brains cannot receive images at all** (open, architectural). Agents get
  `• image at /path — Read it to SEE it` and open it with a Read tool; brains get
  *the same text pointer* but are chat-only with no filesystem. Gemini correctly
  reported it couldn't see the file; Claude got 4/4 colours and 7 circles. Fix
  direction: `brainChat` should build OpenAI-compat `image_url` content blocks.
  Three decisions needed first — which of 12 providers do vision, base64 size
  cap, and what a non-vision brain does when handed an image.
- **`saveRef` misclassifies images** (open). Returns `kind:'file'` for any
  non-directory, so an image attached **by path** never triggers the image
  branch. Same file, two attach routes, different behaviour.
- Noted, not bugs: Qwen3-1.7B answered `3×4×5` as **120** twice (reproducible
  capability ceiling); Claude agent timed out once at 240 s then passed in 8 s
  (not reproduced, coincided with llama-server cold start).

---

## 5. Cross-device reach solved

Both PC nodes showed green in Tailscale but nothing answered. Diagnosis chain:

- bare-IP HTTPS → `TLS alert internal error` = **SNI rejection** (`tailscale
  serve` has a cert for the MagicDNS name, not the IP)
- MagicDNS name doesn't resolve **inside proot**
- `john-pc:8080` turned out to be EnterpriseDB/Apache, unrelated

**Working recipe:**

```bash
curl --resolve johnpc.tail7538c0.ts.net:443:100.123.5.77 \
     https://johnpc.tail7538c0.ts.net/
```

PC node confirmed running Atlan and **properly auth-gated** — 401 on
`/api/engines`, `/api/keys`, `/api/doctor`. Querying it needs its own
`.auth-token`.

---

## 6. Multimodal generation — the headline

**Constraint set by you:** subscription only, no API-key billing, phone-first.

**Why the Gemini API path is closed.** Probed every image model on the key:
`limit: 0` with quotaId `GenerateRequestsPerDayPerProjectPerModel-FreeTier`.
Not exhausted usage — **a zero allocation**. Text works fine on the same key at
the same moment (`gemini-3.6-flash` → 200), so it's a per-model allocation, not
a balance or a billing state.

**The answer, found by research and then proven.** Codex CLI ships a built-in
`image_gen` tool. Its own `SKILL.md` states it **"Does not require
`OPENAI_API_KEY`"** — it runs on the ChatGPT Plus/Pro login the codex engine is
already authed with. Its `scripts/image_gen.py` fallback *does* need a key and
bills per image.

**The blocker, and why it's now a non-event.** Codex copies its output through
bubblewrap, and `bwrap` cannot create user namespaces under proot — so every
agent-side `cp` failed *even though the image generated fine*. Atlan's Node is
not sandboxed, so `studio.js` reads the artifact straight out of
`$CODEX_HOME/generated_images/<thread_id>/` and refiles it through `saveUpload`
as a normal `kind:'image'` attachment.

> This is also the real reason `agents.js` passes `--dangerously-bypass-*`: on
> proot **no** sandbox mode can initialize. The sandbox axis is PC-only.

**Shipped — `feb09d1`.** `server/src/studio.js`, `GET /api/studio/roster`,
`POST /api/studio/image`. Roster names **video and music as unavailable rather
than hiding them** — research found no sanctioned subscription-programmatic path
(Veo 3.1 / Lyria 3 are Google Vids/Flow web apps; their APIs are key-billed;
Codex ships no video skill, confirmed against the installed skill dir).

**Verified end to end:** a red waffle (1254×1254), then a game sprite through
Atlan's own endpoint in **72 s**, then chroma-keyed to real RGBA via the skill's
`remove_chroma_key.py` — 1,203,826 of 1,572,516 pixels cut, 2,347 soft edge
pixels. Full sprite pipeline, on the phone, on your subscription.

**Second path found, not yet wired:** Nano Banana Pro (Gemini 3 Pro Image) runs
on **Antigravity's own OAuth credentials, no API key** — same
subscription-not-billing pattern, available now that `agy` is authed.

---

## 7. Docs and copy caught up to the code

**Three drifts fixed — `f90f92f`:**

1. **Gemini CLI is gone.** Google retired its Sign-in-with-Google backend
   2026-06-18; Antigravity (`agy`) replaced it (already done in `b5b370e`). Docs
   and UI still described a two-engine world ("Codex/Gemini") when there are
   five: Claude Code plus Codex, Antigravity, Grok Build, Copilot.
2. **ARCHITECTURE.md claimed a boundary that doesn't exist.** It said the
   non-Claude CLIs were *"gated via their native sandbox/approval modes."* They
   are not — Atlan launches all four with approvals bypassed
   (`--dangerously-bypass-approvals-and-sandbox`, `--dangerously-skip-permissions`,
   `--always-approve`, `--allow-all`) and **`canUseTool` exists only on the
   Claude/Agent-SDK path**, so the cockpit never sees their individual tool calls.
   Nothing gates them at either end. That's the one rule `FLEET-TESTERS.md` says
   never to break. Now states the truth and names the planned fix.
3. **HANDOFF.md had the PC/phone relationship inverted** — described the PC as
   the "easier" host with "phones as clients." Now: the phone is the host and
   gets the full toolset; the PC is **additive**.

**Permission design agreed (not built):** three levels — **full auto / gated /
plan-only** — set **per engine, in the chat interface**, switchable mid-chat, with
gates rendering as **one uniform card surface** rather than five different CLI
prompts. Research finding that constrains it: `codex exec` **rejects `-a`**
(`--ask-for-approval` is interactive-mode only), so headless Codex has *no*
approval mechanism, only a sandbox axis — which itself can't initialize under
proot. Whether Antigravity/Grok/Copilot can surface approvals headlessly is
**unresearched** and is the load-bearing unknown before the card surface is
possible.

---

## 8. Model routing researched and the escalation ladder repaired

**`docs/MODEL-ROUTING.md` + `0bb5150`.**

The ladder was `local → cloud-sm → frontier`, where **`cloud-sm` was DeepSeek
behind an unconfigured `DEEPSEEK_API_KEY`** — every escalation threw
`cloud-sm needs DEEPSEEK_API_KEY`. It was also the ladder's **only metered rung**,
sitting between two that cost nothing (on-device, and subscription via
`frontierExecute` → Agent SDK).

**Now:**

| rung | model | class |
|---|---|---|
| `local` | on-phone Qwen3-1.7B | constrained JSON |
| `cloud-sm` | **Gemini 3.6 Flash** | constrained JSON |
| `frontier` | **Claude Opus 5** (was `claude-fable-5`) | free-form, has hands |

Probed the whole Gemini family first — **3.6-flash is the only text model this
key reaches**; 3.1-flash, 3.1-pro, 3-pro, 3.6-pro all 404. So the ladder is
honestly three rungs, not four. Verified the OpenAI-compat endpoint accepts
`callTier`'s strict `json_schema` `response_format` and returns schema-locked
output (`{"answer":60}`). Frontier moved to Opus 5 because it leads SWE-bench
Verified (~80.8%) for the code-shaped work this rung catches and Fable's thinking
can't be disabled; overridable via `ATLAN_TIER_FRONTIER_MODEL`.

**The routing principle:** the benchmark split is real — **Claude leads SWE-bench
code editing, GPT-5.6 leads Terminal-Bench agentic shell (78.2% vs 74.6%)** — so
*job shape*, not a single "best model", decides the route. GPT-5.6 ships as three
(Sol / Terra / Luna).

**Your delegation idea, confirmed viable:** CLI agents commanding smaller chat
models for cheap subtasks is **MCP**, and it's already §B.11 of your own research
("one local MCP server exposing checkers + budget ledger + project context to all
CLIs"). A `delegate(prompt, tier)` tool on that server would let Claude/Codex/
Antigravity push bulk work down to Qwen or Flash instead of burning frontier
tokens. **Not built.**

---

## 9. Engine auth — 4 of 5 CLIs now signed in

Installed this session: **`@github/copilot` 1.0.75**, **`@xai-official/grok`
0.2.112**, **Antigravity `agy` 1.1.7** (`/root/.local/bin/agy` — `agyBin()`
already looks there, so Atlan finds it).

All three auth flows need a TTY (piping kills them), so they were started in tmux
sessions `auth-copilot`, `auth-grok`, `auth-agy` — attachable from the Term tab.

| engine | status |
|---|---|
| Claude Code | ✅ authed (subscription) |
| Codex GPT-5.6 | ✅ authed (subscription) |
| **Grok** | ✅ **`Signed in as john@midatlantic.ai`** |
| **Copilot** | ✅ **`Signed in successfully as Atlansdaddy`**. Accepted plaintext token storage — proot has no secret service, so it's plaintext or no Copilot. Mitigated: your own guards (`57587e2`, `49135bf`) already block agent-CLI plaintext token stores from the editor file API. |
| **Antigravity** | ✅ **`jviruet83@gmail.com (Google AI Pro)`**, Gemini 3.6 Flash. Data-collection opt-in **unchecked** — the box was pre-ticked and `enter` toggles it, not `space`. Folder trust granted for `/root/atlan`. |

**All five CLI engines authed.** Roster went from 3 ready to **7** (`codex`,
`antigravity`, `grok`, `copilot`, `local`, `gemini`, plus `claude`). The Google
AI Pro line on Antigravity matters: that's the subscription that also unlocks the
Nano Banana Pro OAuth image path noted in §6.

Remaining unconfigured are the 10 keyed cloud brains (OpenAI, DeepSeek, Kimi,
xAI, Mistral, Groq, Together, OpenRouter, Fireworks, Cohere) — all API-key,
therefore all metered.

---

## 10. The game-build test — scaffolding built, not yet run

Set up in **`/root/atlantis-2d/`** (separate repo, not part of atlan):

- **`TEST-THEORY.md`** — the falsifiable claim. Not "can a model write a game"
  (settled, boring) but: *does a fleet of specialised agents inside deterministic
  walls produce in one shot what a single agent in one pass cannot, on the phone,
  through the cockpit.* Includes **four failure predictions recorded before the
  run** — p95 not p50; asset dimensions after downscale; Adreno shader precision;
  matching normal maps being the weakest art output.
- **`ASSET-SPEC.md`** — the contract art and code both build against, so a
  1254px generated sprite can't collide with code expecting 64×64. This exists
  because the classic one-shot failure isn't bad code, it's a mismatched asset.
- **`check.mjs`** — 18 deterministic checkers: structure, exact PNG dimensions +
  RGBA read from the header, `#version 300 es`, fragment precision qualifier,
  normal-map sampling, moving point light, fixed-step 1/60 accumulator, WebGL2
  required with loud failure, no per-frame allocation, `node --check` on every
  module, and a bench-harness check. **Verified it fails correctly on an empty
  project: 4/18**, the 4 being vacuous passes.

**Perf criteria you set:** 60+ FPS consistently, no spike lag. Concretely p50 ≤
16.6 ms, **p95 ≤ 16.6 ms** (the "consistently"), p99 ≤ 20 ms, max frame ≤ 33 ms,
over 600 frames after a 120-frame warmup. **Honest limit:** there's no headless
browser in proot, so `check.mjs` certifies the *instrument* exists — the number
comes from running `?bench=600` on-device, with the preview pane forwarding the
console line back to the fleet.

**Not yet run.** The builder prompt is drafted; model and budget were left for
you (fleet defaults to `claude-haiku-4-5` / 150k, which would likely fail the
shader and physics work).

---

## 11. Parked

- **`docs/TUTORIAL-OVERHAUL.md` — `58be25a`.** The first-run bar returns on every
  reload because `#frNo` ("later") **only removes the DOM node** —
  `atlanTourDone` is written solely in `end()`, which needs the full tour
  completed. Any path short of "✓ Finish" leaves it unset forever. Second cause:
  `localStorage` is per-origin, so loopback and the tailnet URL each get their own
  tour state regardless. Also catalogues how far the tour content has fallen
  behind — studio/generation, the five engines, the real permission story, Scan,
  hierarchy, routines and the preview feedback loop are all untaught.

---

## Open items, ranked

1. ~~Answer the two auth prompts~~ — **done**, all five CLI engines authed.
2. **Arm the watchdog** — `pkg install termux-api` + F-Droid addons +
   `termux-job-scheduler` registration, in native Termux.
3. **Run the game-build test** — needs a model and budget decision.
4. **Brains can't see images** — three design decisions listed in §4.
5. **Per-engine permission levels** — design agreed; blocked on researching
   whether Antigravity/Grok/Copilot can surface approvals headlessly.
6. **Four dead deps** — your call (§3).
7. **MCP `delegate` tool** — the CLI-commands-small-models idea.
8. **Tutorial overhaul** — parked.

---

## Commits this session

```
0bb5150  Fix the escalation ladder: every rung reachable, spread by model and capability
58be25a  Park the tutorial overhaul: first-run bar never persists 'later'
f90f92f  Docs and copy follow the code: Antigravity, five CLIs, phone-first, real gating
feb09d1  Studio surface: image generation on the ChatGPT subscription, no API key
1f88758  Audio/video understanding was dead: retired model ID + a lying error
775703c  Scan fixtures can't poison the host: exempt them from dep tracing
5fd52c4  Watchdog can't fail silently: Doctor check + honest recovery docs
2c073ce  Merge remote-tracking branch 'origin/main'  (34 commits from the PC)
```

All pushed to `origin/main`. Working tree clean.
