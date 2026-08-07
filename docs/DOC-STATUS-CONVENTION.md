# Doc status convention — so a doc cannot silently rot

**Written 2026-08-02, after a full sweep of all 42 docs found drift in both
directions in three separate places.** This is the root-cause fix, not a
cleanup.

---

## What actually went wrong

The sweep did not find sloppy writing. It found **careful documents that had
quietly stopped matching the code**, and — worse — **two documents describing
one codebase that disagreed with each other**:

| doc | said | truth |
|---|---|---|
| `SECURITY.md` | preview proxy is unauthenticated loopback | gated 8 days earlier (`7caee01`) |
| `SECURITY.md` | regex checkers can ReDoS | **closed at authoring** via `unsafeRegex`, with tests |
| `REVIEW-FINDINGS.md` | ReDoS fixed | correct — so the two docs had diverged **in opposite directions** |
| `REVIEW-FINDINGS.md` | `app.js` ~1300 lines | 1,583 at review, 2,012 now |
| `ARCHITECTURE.md` | seven tabs, five engines, two templates | nine, six, three |
| `VAULT-DESIGN.md` | nothing is built yet | `vault/` shipped 2026-07-22 |
| `LANDING-MAP.md` #7 | OPEN | applied the same day it was written |

Drift ran **both ways**. Work was done and the doc never closed it; and work was
planned and the doc claimed it done. A reader cannot tell which half of a
document is trustworthy, which is how a stale line gets acted on at 1am.

## The three rules

### 1. Every claim-bearing doc carries a verification stamp

At the top, in the doc's own voice:

```
**Status: VERIFIED against code 2026-08-02.** <what was checked, and what moved.>
```

Not "updated" — **verified**. A date alone says someone edited the file. A
verification stamp says someone *checked the claims against the code*, which is
the thing that had stopped happening.

### 2. Gap entries carry a status, and CLOSED entries stay

`OPEN` · `PLANNED` · `PARTIAL` · `CLOSED`, plus the date and the evidence.

**`PARTIAL` is the one that was missing and it matters most.** "Preview proxy is
unauthenticated" and "preview proxy is fine" were both wrong: the
browser-reachable vector was closed and a native-app vector remains. Forcing a
binary on a non-binary reality is what produced the divergence — the doc had to
pick a side and picked the stale one.

**Never delete a closed entry.** Strike it, date it, say what closed it. A
register that only shows open items cannot be audited, and the same gap gets
re-litigated by whoever arrives next.

### 3. Point-in-time records are annotated, never rewritten

`DEP-AUDIT-*`, `DOGFOOD-FINDINGS-*`, `SESSION-RECAP-*`, `MORNING-REPORT`,
`RECEIPTS*`, `DECISIONS.md`, the contributor reviews — these are **evidence**.
Rewriting them to match today destroys the receipt.

Add a status header at the top saying what has since changed, and annotate
inline. `DECISIONS.md` already did this correctly with its superseded auth
entry — that is the model.

## Where a claim goes

| kind of claim | home | rot risk |
|---|---|---|
| counts (tabs, engines, providers, LOC, tests) | `ARCHITECTURE.md` "What exists today" | **highest** — update in the same commit that changes the count |
| security posture | `SECURITY.md` | high — re-verify on every security-relevant change |
| what a review found and its status | `REVIEW-FINDINGS.md` | high |
| a decision and its reasoning | `DECISIONS.md` (append-only log) | low |
| a dated observation | `*-YYYY-MM-DD.md` | none — it is history |
| **machine-readable state** | **JSON, not prose** | none |

## The strongest version of this rule

`gates.rung1.json` is the pattern worth copying: the rung-1 gate chain lives as
**data with an explicit status field per entry**, because a scorer that
reimplements the chain from a document will drift from it.

> **Anything a program needs to agree with a document about should be the same
> file.**

The counts in `ARCHITECTURE.md` are the obvious next candidate — a test that
reads the tab list from `index.html` and the engine list from `agents.js` and
fails when the doc disagrees would have caught all three of that document's
errors on the commit that introduced them, instead of a fortnight later.

## The one-line test

> **If this document is wrong, what breaks, and who finds out?**

If the answer is "nothing, and nobody" — it is prose, and it should stop making
factual claims. If the answer is "an agent picks up a stale gap at 1am and
rebuilds something that already works" — it needs a stamp and a status field.
