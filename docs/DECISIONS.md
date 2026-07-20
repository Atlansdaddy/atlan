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

## What still needs John (can't be done autonomously)
- **Tap "enable push"** once in the Fleet tab from his actual browser — Web Push subscription requires a real user gesture + his device. Server side is tested; the browser handshake isn't.
- **Try a real routine overnight** to confirm the scheduler fires on his device (tested via manual fire + boot-sweep logic; a real wall-clock daily fire wasn't waited out).
- **Decide on exposure** — preflight is green, but tunneling is his call (Cloudflare Tunnel + Access per SECURITY.md).
- **The model auto-switch** — mid-session, the safeguard layer flagged the security-test writing as sensitive and switched Fable 5 → Opus 4.8. This is a known false-positive on legitimate defensive security work; `/feedback` is where to report it, `/config` where to steer model behavior. Work was unaffected.
