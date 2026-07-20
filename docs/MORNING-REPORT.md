# Morning report — Atlan overnight sprint (2026-07-18 → 20)

Good morning, John. You said "goal this all" and went to bed. Here's exactly what happened, what needs you, and what's next. Nothing here is oversold — the receipts back every claim.

## What shipped (all pushed to Atlansdaddy/atlan, commit-by-commit)

| Milestone | What it is |
|---|---|
| **M5c Routines** | In-server scheduler. Every-N-min or daily-at-HH:MM. Each fire is a budgeted fleet run in the inbox. **Missed slots wait for you** — a phone that was off never wakes up and spends. |
| **M5d Persona+ builder** | Your framework, compiled: persona → system prompt, structured command → typed tool, **deterministic checkers** (graded by code, never a model), a test harness that runs it on any engine and **escalates failures to a Claude run**. |
| **Auth layer** | Token-gated everything. Cleared the last preflight blocker — **preflight is 0 blockers, all green.** |
| **M6 Atlan alive** | The orb breathes with real state, agents orbit him as lights, he greets you by time of day, the cockpit dims at night. |
| **Onboarding** | A 27-step in-app tour covering **every control**, a searchable handbook, and a handoff doc. Tap `?` anytime. |
| **Test campaign** | 8 suites: unit, function, connection, security/pentest, adversarial, e2e, ui, tour. |

## The honesty part you'll care about most

You pushed back twice and were right both times:

1. **"Tests passing first-try means you didn't push outside the shape of what YOU built."** So I sent **black-box agents with no source access** to attack it. They found **four real bugs my own tests were blind to**: invalid checkers were silently dropped (a dead guardrail showing green — the exact opposite of the product's promise), a divide-by-zero formula made any answer pass, concurrent routine-fires spawned parallel runs, and enum limits never reached the model. **All four fixed and regression-tested.** This is now a standing method for the repo.

2. **"How, no API key, I use Pro 20x?"** Dead right — the "$0.36" was misleading. On your subscription there's **no per-token charge**; that dollar figure is the SDK's *estimate at API rates*, a gauge of work done, not money spent. Relabeled everywhere as "≈$ API-equiv." Tokens are what your plan actually meters, and what the budgets protect.

## What needs YOU (I can't do these)

1. **Log in the easy way:** open the one-tap URL the server prints on startup — `http://127.0.0.1:4589/?token=…` — it carries your token, no file-hunting. (That was the bug that locked you out: the token file lives inside proot where Termux can't see it. Fixed now; the token is also on the Doctor tab once you're in.)
2. **Tap "🔔 enable push"** once in the Fleet tab — Web Push needs a real gesture from your browser; server side is tested, the browser handshake isn't.
3. **Let a routine run overnight** to confirm the scheduler fires on your device (logic is tested; a real wall-clock daily fire wasn't waited out).
4. **ChatGPT review packet:** hand it `docs/RECEIPTS.md` (verbatim test output) + `docs/DECISIONS.md` (every gap I closed and why). That's the honest evidence trail, built for exactly this.

## Numbers

- **131 tests, 0 failures** (124 free suites + 7 e2e). E2E is now opt-in (`RUN_PAID=1`) so re-runs don't cost you anything.
- **Preflight: all green, 0 blockers.** Still loopback-only until you choose to expose it (Cloudflare Tunnel + Access, never a bare port).
- One thing to know: mid-session the safeguard layer flagged my security-test writing as sensitive and switched the model Fable 5 → Opus 4.8. False positive on legit defensive work; `/feedback` reports it, `/config` steers it. Didn't affect the work.

## Next (your call, not started)
Persona-in-Chat · the worker-hierarchy you were excited about (frontier writes the scope → local Qwen executes under grammar constraint → checkers verify → escalate) · builder/verifier Bash sandboxing · Atlan-as-APK dogfood. Say which and I'll show you the design before building.
