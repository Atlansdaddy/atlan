# Dogfood findings — 2026-07-26

> **POINT-IN-TIME RECORD.** Findings as observed on 2026-07-26 — kept as
> evidence, not rewritten. **Later status is annotated inline; the original
> wording stays.**
>
> **Resolved since:** the §"OPEN — brains cannot receive images at all" finding
> was **fixed 2026-08-02** (`server/src/vision.js`, `test/vision.mjs`, 26
> assertions). Images now travel as OpenAI-compat `image_url` bytes and a
> text-only provider refuses the turn rather than silently dropping the image.
> **Still open:** `saveRef` misclassifying images attached by path.

First dogfood run using fixtures with **known ground truth** rather than
eyeballed output. Harness: `test/dogfood.mjs` (`RUN_DOGFOOD=1`). Raw table:
`docs/RECEIPTS-DOGFOOD.md` (regenerated each run — this file is the durable part).

Engines live at run time: Claude (Agent SDK), Codex (GPT-5.6), Gemini,
llama-server Qwen3-1.7B-Q4_K_M. **4 of 17 configured.**

Score: **4/8 → 6/8** after the two fixes below.

---

## Why the old fixtures proved nothing

`.attachments/` was full of `dot.png` files that are **1×1 gray pixels** and
`clip.mp3` files that are **9 bytes**. No model could have read anything from
them — every prior "multimodal test" verified plumbing, never comprehension.

Replaced with `test/fixtures/` (regenerable, ground truth in the header):

- `mm-quadrants.png` — 512×512, TL=red TR=green BL=blue BR=yellow, exactly 7 white circles
- `mm-tone-440.wav` — 3 s mono 16 kHz, 440 Hz sine (A4)

---

## FIXED — audio/video understanding was completely dead

**Symptom:** every audio attachment came back
`(needs a Gemini or OpenAI key to understand audio — add one in Doctor)`
**with a valid `GEMINI_API_KEY` already stored.**

**Root cause, two bugs stacked:**

1. `attachments.js` hardcoded `gemini-2.5-flash` in its own copy of the model ID.
   That model is **retired** — direct probe returns `404 "no longer available to
   new users"`. `gemini-3.6-flash` returns `200`. Commit `34550ec`
   ("refresh stale/dead brain model defaults to current IDs") swept `brains.js`
   but never saw this second copy.
2. The `catch` in `saveUpload` collapsed **every** failure into the missing-key
   message. So a dead model ID was reported to the user as "add a key you
   already have" — the opposite of the honest-readiness rule in `ARCHITECTURE.md`.

**Fix:** `brains.js` now exports `MULTIMODAL_MODEL` (derived from
`PROVIDERS.gemini.defaultModel`) as the single source of truth; `attachments.js`
imports it. The catch now distinguishes *no key* from *call failed* and reports
the real error.

**Verified:** `note="[high-pitched beep]"` for the 440 Hz sine. PASS.

---

## OPEN — brains cannot receive images at all

**Symptom:** Gemini on the quadrant image: *"I don't have tools or file access to
view or open attached images."* 0/4 colours, circle count missed. Claude on the
same image: **4/4 colours, 7 circles, correct.**

**Root cause — architectural, not a typo.** Two different delivery paths:

| Engine class | How an image reaches it | Works? |
|---|---|---|
| Agents (Claude, Codex) | `turnContext()` emits `• image "x" at /path — Read/view that file to SEE it`; the agent has a Read tool and opens it | ✅ |
| Brains (Gemini, OpenAI, …) | same text pointer — but a brain is chat-only, **no tools, no filesystem** | ❌ |

`brains.js` posts `messages: history` as plain text to `/chat/completions`. The
image bytes are never transmitted; only a filesystem path the model cannot open.
It then correctly reports it cannot see the file, which reads as a model failure
but is ours.

**Fix direction:** the OpenAI-compat shape already supports vision —
`content: [{type:'text',...},{type:'image_url',image_url:{url:'data:image/png;base64,…'}}]`
— and Gemini's OpenAI-compat endpoint accepts it. `brainChat` should build
content blocks for `kind === 'image'` attachments instead of relying on
`turnContext`.

**Decisions needed before implementing:**
1. Which providers get image blocks? (Not all 12 are vision-capable — sending
   blocks to a text-only model is an error, not a graceful degrade.)
2. Size cap — inlining base64 into every turn inflates context and cost fast.
3. What a non-vision brain should say when handed an image: refuse up front in
   the UI, or delegate to `describeMedia` and pass text down (consistent with
   how audio/video already work — probably the right answer).

---

## OPEN — `saveRef` misclassifies images attached by path

`saveRef()` returns `kind: isDir ? 'folder' : 'file'` — it never calls
`kindOf()`. So an image attached **by path reference** gets `kind:'file'`, and
`turnContext()`'s `if (a.kind === 'image')` branch never fires — the agent is
never told it's an image or to view it.

Only `/api/attach` (base64 upload) classifies correctly. Same file, two attach
routes, different behaviour. Low effort to fix: call `kindOf(null, p)` for
non-directories.

*Not covered by the current harness — found by reading, confirmed in code, not
yet reproduced end to end. Worth a test when fixed.*

---

## NOTED — Qwen3-1.7B fails unscoped arithmetic (capability, not bug)

Prompt: *3 boxes × 4 bags × 5 marbles = ?* Ground truth **60**.
Qwen3-1.7B-Q4_K_M answered **120** on both runs — reproducible, not a flake.
Gemini answered 60 in ~1.6 s.

Consistent with the existing scoped-1.7B benchmark result: the small local model
holds up when the task is scoped and the prompt does the work, and falls over on
open multi-step reasoning. Not something to fix in Atlan — but it argues for the
model picker surfacing *what a given local model is good for*, not just its name.

---

## NOTED — Claude agent timed out once, then passed

First run: `TIMEOUT` at 240 s on "count the deps in root package.json."
Second run: `PASS` in 8.0 s, correct answer (3).

Not reproduced. The first run coincided with llama-server cold-starting and RAM
dropping to ~1.9 GB available. Plausible contention rather than a code fault —
but if it recurs, the 240 s cap in the harness is hiding *why*, and the agent
path deserves a timeout that reports what stage it died in.

---

## Environment notes

- **RAM is the live constraint.** 2.9 GB available before llama-server, 1.9 GB
  after. `HANDOFF.md` wants ~2.5 GB for APK builds — so **no APK builds while the
  local model is loaded**. Swap already 7.2/12.3 GB.
- **PC node (`100.123.5.77`) was unreachable** for the whole run — every port
  returned `000` (no route, not refused). Tailscale looked disconnected on the
  phone side; couldn't confirm from proot (no `tailscale` CLI, `/system/bin`
  exec blocked). Cross-device dogfooding is still untested.
- **13 of 17 engines remain unconfigured** — 3 agent CLIs need install + OAuth,
  10 cloud brains need API keys. `OPENROUTER_API_KEY` is the highest-leverage
  single key (many frontier models behind one credential); `OPENAI_API_KEY`
  additionally unlocks the Whisper transcription path as an audio fallback.
