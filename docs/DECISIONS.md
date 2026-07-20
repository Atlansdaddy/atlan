# Decisions log — gaps closed on John's behalf

John's overnight brief said: *"if I didn't say a testing type or specify something here, either ask or close the gaps."* He was asleep, so I closed them with defaults that match his standing preferences (honesty over polish, deterministic walls, don't oversell). Each is reversible — flagged if you'd want to revisit.

## Testing types — what I added beyond what he named
He named: e2e, unit, function, ui/ux, connection, db, security, edge, adversarial, penetration, contextless-agent. All built. Gaps I filled:
- **"db"** — Atlan has no SQL database; state is JSON files (`.fleet/*.json`, `history.jsonl`, encrypted keys). I interpreted "db" as **data-store durability** and tested corruption/truncation/tamper resilience (they fail soft to empty, never crash). *Revisit if he actually wants a real DB — none is needed at this scale.*
- **Performance/load** — not named, not added as a suite. Rationale: single-user loopback app on one phone; throughput isn't a risk, runaway *cost* is — and that's covered by the budget-halt tests. *Flag: say the word for a load suite.*
- **Accessibility** — not named; deferred. The tour/UI suites assert visibility and interaction, not WCAG. *Backlog.*

## Product decisions where the brief was silent
- **Auth mechanism** — chose a single bearer token (file `.auth-token`, 0600) over multi-user accounts. It's a personal single-user tool; a password system would be theater. Timing-safe compare + brute throttle included.
- **Routine "missed run" behavior** — chose **flag-and-wait** (never auto-fire late). A phone that was off all night must not wake and spend a night's worth of token budget at once. He can tap "run late" per routine.
- **Persona+ builder scope** — built persona + structured-command + checker + harness + escalation, wired into fleet and routines. **Not** wired into Chat yet (a persona as a chat system-prompt) — logged in SPEC backlog. The harness escalation uses the `scout` profile by default (read-only is the safe default for an auto-escalation).
- **Checker `arith`** — implemented a hand-written safe expression parser (no `eval`, no `Function`) so a formula from the UI can never execute code. Verified by injection tests.
- **Tutorial format** — chose an in-app spotlight tour (27 steps, every control) + a searchable handbook + a markdown handoff, over a video or external doc. Everything stays on the phone, offline, reopenable via `?`.
- **Night dimming hours** — 22:00–06:30, matching the Habitat day/night pattern he liked. Cosmetic; easy to change.

## Adversarial pass — what the contextless agents found (and what I did)
John pushed back that tests passing first-try meant I hadn't pushed outside the shape of what I built. He was right. Four black-box agents (no source access) attacked the live app. Real findings, all now FIXED + regression-tested:
- **Silent checker-dropping (fixed).** An invalid checker (typo'd field, bad regex, unknown kind, unparseable formula) was silently removed, leaving the harness green with no tier-2 checks — the exact opposite of the product's promise. Now a hard 400 naming the bad checker.
- **Infinity arithmetic passing vacuously (fixed).** `qty/0` → Infinity made any answer pass that check. Now non-finite expected values fail.
- **Routine concurrency (fixed).** Firing one routine N× concurrently spawned N parallel runs. Now one-routine-one-live-run, race-free.
- **enum values invisible to the model (fixed).** Checker constraints now appear in the compiled prompt.
- **Verbose stack traces / token-path in error strings (accepted, low).** Loopback-only + proot-sandboxed FS makes these low-severity info disclosure; noted, not urgent.
- **Auth throttle self-DoS (fixed).** The security suite (and a user's typos) could trip the 20/min global throttle and lock out valid tokens. Raised to 100/min and a valid token now clears the window. The token is 256-bit, so the throttle was never the real security boundary.
- **Budget overshoot (documented, not a bug).** A budget:1000 run burned ~7k tokens before halting — inherent to turn-based budgets (a step can't be interrupted mid-flight; turn 1 alone is ~35k). The ledger reports the true number; the budget is an honest halt-after-the-step, not a mid-step guillotine. Documented in-app.

## Login & cost fixes (John hit these live)
- **Locked out of his own app.** The auth token lived at `/root/atlan/.auth-token` — inside proot, invisible to the Termux Files app. Fixed: the server prints a one-tap login URL (token in query) in its startup banner; the app reads `?token=` and remembers it; the Doctor tab reveals the token + copies the login URL. No more file hunting.
- **"$0.36 today" with no API key.** On his Pro 20x subscription there's no per-token dollar charge; the SDK's `total_cost_usd` is an estimate at API list prices — a work gauge, not a bill. Relabeled everywhere as "≈$ API-equiv" with an in-app note. Tokens are the truly-metered currency and what budgets protect.

## What still needs John (can't be done autonomously)
- **Tap "enable push"** once in the Fleet tab from his actual browser — Web Push subscription requires a real user gesture + his device. Server side is tested; the browser handshake isn't.
- **Try a real routine overnight** to confirm the scheduler fires on his device (tested via manual fire + boot-sweep logic; a real wall-clock daily fire wasn't waited out).
- **Decide on exposure** — preflight is green, but tunneling is his call (Cloudflare Tunnel + Access per SECURITY.md).
- **The model auto-switch** — mid-session, the safeguard layer flagged the security-test writing as sensitive and switched Fable 5 → Opus 4.8. This is a known false-positive on legitimate defensive security work; `/feedback` is where to report it, `/config` where to steer model behavior. Work was unaffected.
