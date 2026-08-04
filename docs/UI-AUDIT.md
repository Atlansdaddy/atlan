# UI/UX audit — every surface, driven at 412×900

**Status:** ACTIVE ledger. **22 open findings**, 5 spec files, 121 assertions
(99 passing). Opened at 39 failures; 13 fixed, 5 were bad tests. All four P0s closed.
**Method:** one Playwright spec per surface, driving the real cockpit against a
throwaway server on free ports. No mocks, no fixtures — the specs click what a
phone user clicks.

## How to read this file

These specs are **not in `test/run-all.mjs` yet**, and that is deliberate. They
still fail 22 times, and every one of those failures is a real defect in the
cockpit, not a bad assertion. Registering them today would turn the gate red and
the only way back to green would be to weaken assertions — which is how a suite
starts lying. Instead they run on demand, and **each spec joins the gate the day
its surface reaches zero failures** — Fleet is the first, and is now in
`run-all.mjs`. That is the same ratchet the `app.js` line
ceiling uses: the number only moves one direction.

```sh
bash test/ui-specs.sh              # all five
bash test/ui-specs.sh ui-editor    # one surface
```

## Provenance warning (read before trusting the prose)

The audit phase that produced these specs ran 12 agents. **At least one of them
read the wrong repository** — the stale Windows clone at `C:\Users\jviru\atlan`
(~25 commits behind) instead of `/root/atlan` — and reported findings that were
true there and false here ("four optgroups not five", "no Git surface", "no
ladder"). Those are discarded.

Everything in the table below survived re-verification **against this tree**,
either by the spec failing live or by direct source read. Two findings were
killed by that re-verification and are recorded at the bottom, because a ledger
that only lists confirmations hides its own error rate.

## The findings

Ranked by what they cost the user, not by how hard they are to fix.

### P0 — destroys work or spends money

| # | Surface | Finding |
|---|---------|---------|
| ~~1~~ | Editor | ~~**Save silently overwrites a different existing file.**~~ **FIXED** — see below. |
| ~~2~~ | Editor | ~~Opening another file discards the unsaved buffer.~~ **FIXED** |
| ~~3~~ | Doctor/Scan | ~~Tapping a scan finding discards unsaved editor work.~~ **FIXED** |
| ~~4~~ | Fleet | ~~**Top-up can be fired twice on one halted run.**~~ **FIXED** — server and client. All four P0s are closed. |

### P1 — the surface lies

The cockpit's whole claim is that it reports honestly. Each of these is a place
where it does not.

| # | Surface | Finding |
|---|---------|---------|
| ~~5~~ | Fleet | ~~KILL ALL fails silently.~~ **FIXED** — and the per-run kill, which had the same bug and was never reported. |
| ~~6~~ | Fleet | ~~Header burn meter is frozen during a live run.~~ **FIXED** |
| 7 | Doctor | A **failed** preflight re-run leaves the previous green verdict on screen ("safe to consider exposure") with zero check rows. A security gate showing a stale pass. |
| 8 | Doctor | Preview URL bar misreports what the server stored (`…/dashboard?tab=1` shown, `…:5173` served). |
| 9 | Doctor | Preview target does not survive a reload — bar and stored target disagree. |
| 10 | Chat | An engine error leaves the composer and working line in a lying state. |
| ~~11~~ | Editor | ~~A REJECTED save is reported only in the chat log.~~ **FIXED** |
| ~~12~~ | Editor | ~~After saving as `.py`, `#edLang` still read JavaScript.~~ **FIXED** |
| ~~13~~ | Doctor/Scan | ~~A finding that cannot be opened explains itself on a screen the user is not on.~~ **FIXED** |
| 14 | Chat | A rejected upload leaves a ghost chip claiming a file is attached that will never be sent. |

### P1 — dead controls

| # | Surface | Finding |
|---|---------|---------|
| 15 | Editor | ☰ on `/root/atlan` is a dead button: `loadTree` returns before un-hiding `#edTreeBox`, and the reason goes to the chat log. |
| 16 | Doctor/Scan | `#scanProjSel` renders blank (`selectedIndex -1`) — the hardcoded `/root` option at `index.html:64` is never in the list `app.js:1462` assigns from. |
| 17 | Doctor/Scan | Run scan from a cold load issues **zero** `/api/scan` requests. Silent no-op. |
| 18 | Doctor | Local-brain card is all-or-nothing: `supported:false` still renders an unlabeled empty select plus a Swap button that no-ops. |
| 19 | Fleet | A new job's first link row shows a blank command picker even with commands loaded, so saving is rejected for having no link. |
| 20 | Doctor | Snapshot button sticks at "📸 …" forever with nothing loaded. |
| 21 | Chat | Enter/Go in `#attachRefPath` does nothing — a dead key on the phone keyboard. |

### P2 — phone ergonomics

This cockpit is phone-first, so these are defects, not polish.

| # | Surface | Finding |
|---|---------|---------|
| 22 | Chat | `#themeBtn` renders 21×19 — under the WCAG 2.5.8 AA 24px target floor. |
| 23 | Chat | `#micBtn` / `#attachBtn` render 44×38 against the 44px `--tap` **the stylesheet itself declares for them**. |
| 24 | Editor | `#edOpen` renders 44×38 against the same declared 44px. |
| ~~25~~ | Fleet | ~~Builder row fields are 59–69px wide at 412px.~~ **FIXED** |

### P2 — the tour and handbook contradict themselves

| # | Finding |
|---|---------|
| 26 | Spotlight ring is misaligned by ~799px at steps 26, 27 and 28 — it rings empty space at the end of the tour. |
| 27 | `guide.js` claims it walks "EVERY control in the cockpit"; **Scan gets zero steps** (1 of 8 tabs). |
| 28 | Fleet's **Hierarchy** sub-pane gets zero tour steps. |
| 29 | Handbook has no section for **Editor** or **Scan**, though it is meant to be the tour's knowledge in reference shape. |
| 30 | `guide.js` step 5 says permission cards appear "every time" — false for the four CLI engines, which `agents.js:117,122,127,132` spawns with approvals stripped. |
| 31 | Attachments and voice have no tour steps at all. |
| 32 | 15 of 21 chat controls have zero test coverage. |

## Fixed in this pass

| Finding | Fix |
|---------|-----|
| **#1 Save destroyed a file you never opened** (P0) | The path box is also the navigate box, so typing the next file you meant to OPEN and tapping Save aimed the current buffer at it — and `files.js writeFile` has no existence check. `lib/editorguard.js saveTo()` now confirms before writing onto a **different** file that already exists. It stays silent when the target is the file you have open, or does not exist yet: a dialog on every save is one people learn to dismiss unread. |
| **#2 / #3 unsaved work destroyed on open** (P0) | `openFile` and `openScanFinding` both called `cmEditor.setValue()` straight over the buffer. Both now route through `lib/editorguard.js openInto()`, which confirms when `#edDirty` says unsaved. |
| **#11 / #13 refusals landed only in chat** | Opening and saving now report through one `edUI.fail`, which writes to `#edDirty` **and** the chat log — a refusal that only reaches chat is invisible to someone standing on the Editor tab, which is where they just tapped. |
| **#12 language label contradicted the file** | `edUI.saved()` calls `edMode(f.name)`, so the label describes the file actually written. |
| `/api/prefs` 401 read as "never onboarded" | The session cookie is per-origin — **the same limitation that moved tour state off localStorage in the first place** — so on a second origin the prefs read 401s, `guide.js` found no `.tour` on the error body, and hung the first-run banner over the login screen. §1b was only half fixed. `guide.js` now treats unauthorized as *unknown* and stays quiet. |
| Handbook filter survived close/reopen | Reopening `?` showed 1 of 13 sections with the old needle still in the box. `closeGuide()` now clears the filter. |

## Corrected during triage

Recorded so the error rate is visible:

- **"No first-run banner for a fresh browser"** and four cascading failures were
  **bad tests, not bugs.** The spec's `freshBrowser()` cleared only
  `localStorage`, but `/api/prefs` is the source of truth and localStorage is
  its per-origin cache. The banner was correctly staying hidden. Fixed by
  clearing both homes.
- **"BUG §1b: tour state has to move server-side"** — it already had. The test
  was named for a bug that was fixed; it is now a regression guard. The
  underlying failure was real but had a different cause (the 401 above).
- **Six editor failures were the harness, not the cockpit.** Adding the discard
  guard broke the editor spec 7 → 13, because Playwright auto-*dismisses*
  dialogs — a user clicking Cancel — so one dirty buffer blocked every open
  after it. Both guard tests assert only that the cockpit **asked**, never what
  was answered, so the handlers now `accept()`. The assertions are untouched.

## The refactor is what unblocks the rest

The client half of the top-up fix is three lines. `app.js` was 2030 lines
against a 2030 ceiling, so it did not fit — and that is not special to top-up.
Nearly every open finding above lands in `app.js`, which has no room by design.

So the order is: **extract the section, then fix inside it.** Both times now,
the extraction has *paid for itself* — the module comes out, `app.js` shrinks,
the ratchet comes down, and the fix lands with unit tests that need no browser.

| Extraction | `app.js` | Ratchet | Fixed | New tests |
|---|---|---|---|---|
| `lib/editorguard.js` | 2031 → 2030 | ↓ | #1 #2 #3 #11 #12 #13 | 14 |
| `lib/fleetactions.js` | 2030 → 2019 | ↓ | #4 #5 | 13 |
| burn-gauge hoist | 2019 → 2016 | ↓ | #6 | 2 |
| `lib/joblink.js` | 2016 → 2009 | ↓ | #19 #25 | 3 |

Refactoring a 2,000-line IIFE is only safe because the specs exist first: 425
gate assertions plus 121 UI-spec ones are the net that catches a bad move. The
order was not optional.

## What the guards cost

`lib/editorguard.js` is 90 lines and `test/editorguard.mjs` is 14 unit tests
that need no browser. `app.js` **shrank** — three copies of the same
load-into-buffer sequence collapsed into one — so the structural ratchet in
`docdrift.mjs` came down 2031 → 2030 rather than up. Half those tests assert the
guards stay *quiet*: an ordinary save and a save-as to a fresh path must not
prompt, or the prompt stops being read.
