# Tutorial — bug + overhaul (bug FIXED 2026-08-04; overhaul parked)

Raised 2026-07-26 while dogfooding over the tailnet.

> **§1 and §1b are fixed (2026-08-04).** Tour state now lives server-side in
> `/api/prefs` (whitelisted keys, `FLEET_DIR/prefs.json`) so it survives the
> loopback↔tailnet origin split; every exit from the bar writes the flag
> (`'1'` = completed, `'dismissed'` = declined/started), and localStorage
> remains as a same-origin fast path that syncs forward. Covered by
> `test/tour.spec.mjs` (including an empty-localStorage reload) and three
> adversarial probes on the endpoint. §2 (content overhaul) is still parked.

---

## 1. Bug: the first-run bar returns on every reload

**Symptom:** reloading the cockpit re-shows the "👋 First dive?" bar as if it
were the first login, every time.

**Cause — found, single line.** `web/public/guide.js`:

```js
bar.querySelector('#frNo').addEventListener('click', () => bar.remove());
```

`later` removes the bar from the DOM and nothing else. The `atlanTourDone` flag
is written in exactly one place — `end()` — which only runs when you reach the
final step and press "✓ Finish". So every path except completing the whole tour
leaves the flag unset:

| User does | Flag written? | Bar returns on reload |
|---|---|---|
| Completes tour → ✓ Finish | yes | no |
| Taps `later` | **no** | **yes, forever** |
| Starts tour, abandons midway | **no** | **yes, forever** |

**Fix (one line):** write the flag on dismiss too. Consider a distinct value
(`'dismissed'` vs `'1'`) so a later "you skipped the tour, want it now?" nudge is
still possible without nagging.

### 1b. Second cause to check: localStorage is per-origin

The cockpit is reachable on at least two origins — `http://127.0.0.1:4589`
(loopback) and `https://johnpc.tail7538c0.ts.net` (tailnet). `localStorage` is
scoped per origin, so completing the tour on loopback does **not** mark it done
over the tailnet, and vice versa. Even after the one-line fix, the tour will
reappear once per origin.

If that's unwanted, tour state has to move server-side (it's per-user state on a
single-user cockpit, so a tiny store entry is enough) rather than living in the
browser.

---

## 2. Overhaul: content is behind the product

The tour predates most of what Atlan does now. It should walk someone through
**everything they can actually do, with worked examples**, not a spotlight tour
of controls.

Known gaps as of 2026-07-26:

- **Engines** — copy described two agent CLIs ("Codex/Gemini"). There are five:
  Claude Code plus Codex, Antigravity, Grok Build, Copilot. Names fixed in
  `f90f92f`; the *teaching* is still absent.
- **Permission model** — the tour implies Claude is gated and the others are
  loose. Truth: nothing gates the other four today, and per-engine levels
  (full auto / gated / plan-only) are planned for the chat bar. Tour must teach
  whatever ships, not the current accident.
- **Studio / generation** — brand new (`feb09d1`), completely untaught. Image
  generation on the ChatGPT subscription, chroma-key → transparent sprites, the
  game-asset workflow. This is a headline capability with zero onboarding.
- **Multimodal input** — images to vision, audio/video auto-described. Untaught,
  and the old `.attachments` fixtures show it was never really exercised.
- **Scan / PreFlight** — the vendored SAST surface in the Doctor tab. Untaught.
- **Hierarchy, routines, Persona+ builder** — real subsystems, no tour coverage.
- **Fleet** — profiles (scout/builder/verifier), budgets that halt, top-up.
  Mentioned at best; the *why* (deterministic walls) is the interesting part.
- **Preview pane feedback loop** — console errors and snapshots auto-attaching
  to the next turn is one of the best things in the product and is easy to miss.

### Shape worth considering

Spotlight-tour-of-controls is the wrong format for this much surface. Better:
short **task-based walkthroughs** with a real example each — "generate a sprite
and use it", "run a fleet job with a budget", "scan this project", "attach a
screenshot and ask about it" — reachable forever from `?`, each independently
runnable rather than one linear 39-step march.

Related: `web/public/index.html` handbook `<details>` blocks carry the same
staleness and should be revised in the same pass.
