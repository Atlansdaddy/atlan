# Panel calibration — seeded-fault run, 2026-08

**Status:** measured 2026-08-06. Numbers below are computed, not estimated.
**Corpus:** `atlan-seeded-faults` v1, `/root/atlan-seeds/manifest.json` (19 seeds, 9 classes).
**Reviewed tree:** `/root/atlan-cal` @ `761d395` (branch `agent/live-self-edits-2026-08-04`), seeds applied **all at once**.
**Panel:** 9 roles, 42 findings total, `ranCommands` = **9 / 9**.
**Stats script:** `/root/calib.mjs` (WSL2 Ubuntu). Seed-presence check: `/root/checkseeds.sh`.

---

## 0. Ground truth: 18 seeds in the tree, not 19

The manifest says seeds are applied **one at a time**. This run applied them together, which
changes the denominator. Verified by `git apply -R --check` per patch against `/root/atlan-cal`:

| result | count | ids |
|---|---|---|
| PRESENT | 18 | all except below |
| **ABSENT** | **1** | **`l03-diff-add-and-delete-colours-swapped`** |

`l03` and `l02` mutate the *same expression* in `web/public/lib/text.js`. `l02` landed
(`'+++'` → `'++++'`); `l03`'s swap of `diff-add`/`diff-del` did not. The `+` branch in the
reviewed tree still yields `diff-add`. **`l03` was never in front of the panel and is excluded
from every recall number below.** Scoring it as a miss would manufacture a blind spot that
was not tested.

> Corpus note: composing seeds is outside the manifest's stated design ("They are not designed
> to compose"). One of 19 silently cancelled. Any future all-at-once run must re-verify presence
> per seed before scoring.

**Denominator: n = 18 seeds × k = 9 roles = 162 cells. 38 filled (23.5% density).**

---

## 1. d_c per class — fraction of each class's seeds flagged by ≥1 reviewer

| class | d_c | seeds (detections each) |
|---|---|---|
| boundary | **1.000** (2/2) | b01:1, b02:2 |
| destructive | **1.000** (2/2) | d01:2, d02:3 |
| silent | **1.000** (2/2) | s01:3, s02:1 |
| phoneagnostic | **1.000** (2/2) | p01:2, p02:5 |
| logic | **1.000** (2/2 present) | l01:2, l02:2 — *l03 not in tree* |
| lifecycle | **1.000** (2/2) | lc01:2, lc02:4 |
| **overclaim** | **0.500** (1/2) | **o01:0**, o02:4 |
| testvalidity | **1.000** (2/2) | t01:1, t02:1 |
| docdrift | **1.000** (2/2) | dd01:1, dd02:2 |

**d_c is a coarse instrument here — two seeds per class.** A class score of 1.000 rests on
two observations and cannot distinguish "reliably visible" from "got lucky twice." The
per-seed *redundancy* column below is the load-bearing number.

---

## 2. beta-hat — seeds flagged by nobody

**β̂ = 1 / 18 = 0.0556 (5.6%)**

The single miss: **`o01-burn-line-claims-money-charged`** — `web/public/lib/burn.js` relabels
the SDK's modelled public-API-rate estimate from `≈$X API-equiv` to `$X charged`, presenting a
model output as money that left the account on a subscription where it did not.

Against the 19-seed manifest denominator it is 2/19 = 0.105, but that counts `l03`, which was
absent. **0.0556 is the real number.**

### The miss is a lane gap, not a perception failure

`o01` was *observed* during the run. The test-validity role's own held-list contains:

> "burn.js API-equiv label changed to 'charged' — caught by test/weblib.mjs"

That role's mandate was gate-**blind** defects, so a gate-caught one was correctly out of scope
for it. Verified live on the seeded tree:

```
$ node test/weblib.mjs
  ✗ burnLine labels the dollar figure API-equiv, never as a charge — must not read as money leaving the account
58 passed, 2 failed
```

So `o01` escaped the panel's **reporting surface**, not its **observation surface**. No role
whose mandate was "report defects" had *UI cost/spend labelling honesty* in its lane. The
OVERCLAIMING role — whose brief is literally "comparing every comment/doc/UI claim … against
what the code actually enforces" — is the seat that should have owned it, and did not look
at any UI surface.

### Panel and gate are complementary, not redundant

| | gate-caught seeds (15) | gate-blind seeds (3 in tree: o02, t01, t02) |
|---|---|---|
| panel found | 14 / 15 | **3 / 3** |
| panel missed | 1 (o01) | 0 |

**The panel's entire value-add over free CI is the gate-blind column, and it scored 3/3 there.**
Its one miss was in the column CI already covers. Union of panel + repo gate = 18/18.

---

## 3. phi-bar and Kish n_eff

Detection matrix: 9 role vectors × 18 binary seed outcomes. 36 pairs.

| statistic | value |
|---|---|
| **φ̄ (mean pairwise correlation)** | **0.0142** |
| mean pairwise Jaccard | 0.1366 |
| mean pairwise raw agreement | 0.6389 |
| **Kish n_eff = k / (1 + (k−1)·φ̄)** | **8.08** (of a 9.00 ceiling) |
| n_eff using Jaccard as the overlap term | 4.30 |
| literal Kish on per-role yield (3,6,8,4,5,4,1,4,3) | 7.52 — *effort concentration, not overlap* |

Published reference: 9 judges / 7 model families → n_eff ≈ 2.18, which implies φ̄ ≈ 0.391.
The brief predicted this panel would come in **lower** (three weight sets, not seven families).
**It came in far higher: 8.08 vs 2.18.** That result is real, and it is also a warning about
the metric.

### Why n_eff = 8.08 must not be read as "eight independent judges"

φ̄ ≈ 0 here because **the roles were partitioned by mandate before they looked**, not because
nine minds independently converged. The published 2.18 measures judges scoring the *same*
items; this panel ran nine *different questions* over one tree. Near-orthogonal coverage is the
designed input, so recovering it as an output is close to tautological.

The honest reading: **nine narrow searches over nearly disjoint regions, not nine opinions on
one call.** That buys breadth and costs cross-checking. Concretely:

- **Mean detections per seed = 2.11 of 9.**
- **6 of 18 seeds (33%) had redundancy ≤ 1** — o01 (0), b01, s02, t01, t02, dd01 (1 each).
  For a third of the corpus, deleting one specific reviewer deletes the finding.
- 14 of 36 role pairs have **zero** Jaccard overlap — they never touched the same seed.

A high n_eff on this metric therefore signals **fragility as much as breadth**. Independence
that comes from partition means no seat can catch another seat's miss.

---

## 4. Diagonal recall — did each role find its *own* class?

This is the sharpest result in the run.

| role | own class | own-class recall | total recall (of 18) |
|---|---|---|---|
| R1 SECURITY BOUNDARIES | boundary | **0 / 2** † | 3 (0.167) |
| R2 destructive/data-loss | destructive | 2 / 2 | 6 (0.333) |
| R3 silent-failure | silent | 2 / 2 | **8 (0.444)** — best |
| R4 phone-first | phoneagnostic | 2 / 2 | 4 (0.222) |
| R5 correctness/logic | logic | 2 / 2 (+ both boundary) | 5 (0.278) |
| R6 state-lifecycle | lifecycle | 2 / 2 | 4 (0.222) |
| **R7 OVERCLAIMING** | **overclaim** | **0 / 2** | **1 (0.056)** — worst |
| R8 test-validity | testvalidity | 2 / 2 | 4 (0.222) |
| R9 doc-vs-code | docdrift | 2 / 2 | 3 (0.167) |

† **R1's 0/2 is a taxonomy collision, not a blind spot.** The manifest's `boundary` class means
*numeric limit edges* (b01 image-size `>=`, b02 budget-reserve `>`). R1's brief is *security*
boundaries — path/host allow-deny. Those seeds belong to R5's mandate, and R5 found both. R1's
actual lane maps to `d02` and `p02`; it found both, plus `o02`. R1 is fine.

**R7's 0/2 is a real blind spot.** `o02` is textbook for its brief — "capability checks that
read a flag instead of attempting the operation" describes `sandboxCapableHost()` inferring
from `process.platform` verbatim. Three other roles found it. R7 did not.

### R7 also issued a false clearance

R7's held-list states:

> "guardPath() symlink/realpath escape guard and blockAppRoot logic (guards.js) … Re-tested
> directly against the reviewed copy … both git/status and ai-edit correctly refuse APP_ROOT
> with 400. Not reported as a finding."

`d02` had deleted the realpath re-check. The re-test covered **blockAppRoot only**; the
clearance sentence covers **blockAppRoot *and* the symlink guard**. Evidence for one control
was written up as clearance for two. Fair to R7: it correctly root-caused a genuine harness
artifact (the suite hitting a live server on :4589 with a different APP_ROOT), and blockAppRoot
really is intact. But the scope of the clearance exceeded the scope of the evidence — which is
precisely the failure mode the OVERCLAIMING seat exists to catch, committed by that seat. Two
other roles caught `d02`, so nothing was lost this run.

**R7 is the panel's weakest seat: 1 finding, 1/18 recall, 0/2 on its own class, 1 over-broad
clearance.** Its single finding (`p02`) duplicated four other roles.

---

## 5. Per-role precision

An unmatched finding is **not** automatically a false positive — it may be a genuine
pre-existing bug. All five unmatched findings were verified against the **pristine** `/root/atlan`
tree (`/root/verify_unmatched.sh`).

| role | findings | matched a seed | unmatched | precision |
|---|---|---|---|---|
| R1 SECURITY BOUNDARIES | 4 | 3 | 1 | 0.750 |
| R2 destructive | 5 | 5 | 0 | **1.000** |
| R3 silent-failure | 8 | 8 | 0 | **1.000** |
| R4 phone-first | 6 | 4 primary + 1 consequential | 1 | 0.667 / 0.833 |
| R5 correctness | 5 | 5 | 0 | **1.000** |
| R6 state-lifecycle | 6 | 4 | 2 | 0.667 |
| R7 overclaiming | 1 | 1 | 0 | **1.000** |
| R8 test-validity | 4 | 3 | 1 | 0.750 |
| R9 doc-vs-code | 3 | 3 | 0 | **1.000** |
| **panel** | **42** | **37** | **5** | **0.881** |

Duplication: 42 findings → 22 distinct issues (17 seeds + 5 pre-existing). Factor **1.91×**.

### The five unmatched findings — all five verified REAL, zero spurious

| finding | role | verdict | evidence in the pristine tree |
|---|---|---|---|
| `fleet-cwd-unvalidated-boundary` | R1 | **unmatched, looks real** | `grep` over `fleet.js`/`agentExec.js`/`enginePolicy.js`/`claudeEngine.js`: the only containment is `isUnder(p, cwd)` at `fleet.js:129` — no `guardPath`/`isSensitive`/`blockAppRoot` anywhere in the exec chain. `fleet.js:109` says so itself: *"v1 honesty: where Bash IS allowed (builder/verifier) it's unscoped."* Known design gap, correctly re-surfaced with a working PoC. |
| `ws-drop-orphans-warm-claude-session` | R6 | **unmatched, looks real** | `wss.on('connection')` at `index.js:463`; the only `claude?.dispose()` is at `:508`, on cwd change. **No `ws.on('close')` handler exists.** Demonstrated live with two orphaned PIDs. |
| `chat-agent-turn-orphan-unkillable` | R6 | **unmatched, looks real** | `grep 'agentExec\|killTree\|active\.' server/src/agents.js` → **zero matches**. The chat-path child is registered nowhere, so no kill API can reach it. Demonstrated: `POST /api/fleet/kill {id:'all'}` → `{"killed":0}`, child still alive. |
| `session-token-hash-untested` | R8 | **unmatched, looks real** | `grep -rn 'sessions.json\|sessionsFile\|sha256' test/` → **no matches**, while `auth.js:72` is the sha256 and SECURITY.md cites that exact line as verified. Demonstrated with a mutant escaping the full 21-suite gate byte-identically. |
| `themebtn-below-24px-wcag-floor` | R4 | **unmatched, looks real** | `index.html:59` — `#themeBtn` carries **no class**; the tap-target rule is `.iconbtn,.send{min-width:var(--tap)}` (`style.css:448`), so it never matches. Measured 21×19px. |

**Spurious findings: 0 of 42.** Precision against *real defects* is **1.000**; the 0.881 figure
is precision against *the seed set only*, and every point of the gap is a genuine bug the corpus
did not seed.

### One judged downgrade worth flagging

R2 reproduced `lc01` (topUp arms after the reply) in full, then declined to report it:
*"UI-honesty regression, not an exploitable money-loss bug, so not reported as a full finding."*
The reasoning is sound and independently verified (`consumeHalt()` runs synchronously before
`spawnRun`). But it means a seeded regression was **detected and editorially suppressed**. R3
and R6 reported it anyway. With redundancy 2, one downgrade was survivable; on a seed with
redundancy 1 the same judgment call is a silent miss.

---

## 6. What the panel is BLIND to

> Where d_c is low, a zero-finding report from that role carries **no information**, and no
> number of extra rounds fixes it. Adding rounds re-samples the same lane.

### Confirmed blind — d_c = 0.50

**Overclaim, specifically UI/cost/spend-labelling honesty.** `o01` — a spend figure relabelled
from "API-equiv" to "charged" — was found by nobody. The OVERCLAIMING seat found 0/2 of its own
class and read no UI surface at all. **A clean bill of health from the overclaiming role on
anything user-facing is currently uninformative.** Free CI covers this specific defect; the
panel does not.

### Structurally blind — d_c is undefined, not high

Six classes have **no seat that owns them** and no seed that tested them:

- **Concurrency and process lifecycle beyond the fleet map.** R6 found both real orphan bugs
  on its own initiative, but the corpus seeded nothing here, so d_c is unmeasured, not 1.0.
- **Authn/authz coverage gaps.** R8 found `session-token-hash-untested` unseeded. Unmeasured.
- **Everything with 0 seeds:** performance/resource exhaustion, dependency and supply chain,
  i18n/encoding, error-message information disclosure, migration and upgrade paths.
  **A zero-finding report in any of these carries no information today** — not because the
  panel is weak there, but because nothing has ever tested whether it can see there.

### Fragile, not blind — redundancy ≤ 1

**6 of 18 seeds (33%) rest on a single reviewer.** `b01` (R5 only), `s02` (R3 only),
`t01`/`t02` (R8 only), `dd01` (R9 only) — plus `o01` at zero. `t01`, `t02` and `dd01` are
also **single-seat *and* class-defining**: test-validity and doc-drift each have exactly one
seat, so losing R8 or R9 zeroes an entire class. These are not blind spots today; they are
**single points of failure**, and φ̄ ≈ 0 guarantees no other seat will cover the gap.

---

## 7. What to change before the next round

1. **Re-verify seed presence per patch before scoring any composed run.** One of 19 cancelled
   silently. `git apply -R --check` per patch, every time.
2. **Give the OVERCLAIMING seat a UI/cost/labelling surface, or move that surface to a seat
   that will read it.** It is currently the only seat with a measured own-class miss.
3. **Require clearances to be scoped to their evidence.** "Control A and control B hold" needs
   a test per control. R7's over-broad clearance was caught only by redundancy.
4. **Seed the unmeasured classes** — concurrency/lifecycle, auth coverage, resource exhaustion,
   supply chain. Until then, silence from those lanes means nothing.
5. **More rounds will not help the overclaim gap.** Re-running the same nine mandates re-samples
   the same lanes. Fix the mandate, not the round count.
6. **Do not chase φ̄ down.** At φ̄ = 0.014 the panel already has near-maximal spread; the
   scarce resource is *redundancy on the 33% of defects only one seat can see*.

---

## Appendix — detection matrix (18 seeds × 9 roles, 38/162 cells)

| seed | class | n | roles |
|---|---|---|---|
| b01 | boundary | 1 | R5 |
| b02 | boundary | 2 | R5 R6 |
| d01 | destructive | 2 | R2 R8 |
| d02 | destructive | 3 | R1 R2 R9 |
| s01 | silent | 3 | R2 R3 R6 |
| s02 | silent | 1 | R3 |
| p01 | phoneagnostic | 2 | R3 R4 |
| p02 | phoneagnostic | **5** | R1 R2 R3 R4 R7 |
| l01 | logic | 2 | R3 R5 |
| l02 | logic | 2 | R3 R5 |
| l03 | logic | — | *not applied to the tree* |
| lc01 | lifecycle | 2 | R3 R6 |
| lc02 | lifecycle | 4 | R2 R3 R5 R6 |
| **o01** | **overclaim** | **0** | **—** |
| o02 | overclaim | 4 | R1 R2 R4 R8 |
| t01 | testvalidity | 1 | R8 |
| t02 | testvalidity | 1 | R8 |
| dd01 | docdrift | 1 | R9 |
| dd02 | docdrift | 2 | R4 R9 |

`p02` (win32 credential guard fails open) drew 5 of 9 roles — more than a quarter of all
role-seed detections went to two seeds (`p02`, `lc02`). The panel over-invests where lanes
happen to intersect and under-invests everywhere else; that is the same partition effect that
produced φ̄ ≈ 0.
