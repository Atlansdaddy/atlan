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

## Voice + provider spread (2026-07-22)
Building voice I/O, John asked for a wide, honest spread of providers — "cheap expensive free whatever, all that make sense, code situated for it with honesty about what they can and can't do" — for both voices and AI models.

- **Voice input (STT)** — chose the browser Web Speech API (free, on-device, push-to-talk). Transcript drops in the box to review before sending, never auto-fires. Server-side STT (Deepgram/Whisper) left as a documented, un-built gap rather than half-shipped.
- **Voice output (TTS) — a 9-provider registry + 1 roadmap.** `voice.js` is a single dispatch with per-provider honest `caps` (cost, latency, SSML). browser + Piper (free), then ElevenLabs / Cartesia / Deepgram / OpenAI / Google / Azure / Polly (BYOK). Each greys out until its key is set — **the picker never claims a voice you can't use.**
  - **Amazon Polly needed a real SigV4 signer** — AWS has no simple API key for Polly. Implemented a minimal SigV4 (POST+JSON) in `voice.js` rather than drop the cheapest provider or fake it.
  - **OpenAI Realtime is a WebSocket voice-to-voice pipe, not one-shot TTS.** Rather than pretend, it's listed as `ready:false` with a "ROADMAP" note — visible, honest, not wired.
  - Mood → light prosody (real SSML where honored, tone-instruction where not). SSML is XML-escaped to prevent broken/injected markup.
- **AI models — widened brains.js from 4 to 12 providers.** Added Kimi, Grok, Mistral, Groq, Together, OpenRouter, Fireworks, Cohere alongside local/Gemini/OpenAI/DeepSeek. All OpenAI-compatible, so it was one base-URL row each; they flow into the switcher automatically, disabled until keyed. `defaultModel` is a starting point; any model name is typeable.
- **"How to get ↗" links** — every key row in Settings links to that provider's key page with a one-line honest tip (the thing that trips people up). John's idea: optional setup tutorials, on demand, not forced.
- **Doctor Piper check bug (found + fixed same turn).** First version matched `/piper/i` against `piper --version` output — which caught the *error string* "piper: not found" and reported Piper installed when it wasn't. Switched to `command -v piper`, which resolves the binary or prints nothing.
- **Docs discipline (John's standing ask):** every turn of new stuff updates README + project docs. This turn added `docs/VOICE-AND-MODELS.md` (the full provider matrix + how to add more) and these decision notes.

### Reverted earlier: token-in-URL login
The "Locked out of his own app" fix above (token in the startup-banner login URL) was **reverted** at John's call — he flagged a token in the URL as a security risk. Auth is now **password (scrypt) + httpOnly SameSite=Strict session cookie**; automation uses an `x-atlan-token` header, never a URL. Kept here so the history is honest.

## Brittleness hunt — the Piper bug wasn't alone (2026-07-22)
John's hunch after the Piper fix: "if that was brittle, we may have other stuff too." Right. Self-audited every check that reads a subprocess's output. Found two more of the same class in `doctor.js`, both fixed by trusting exit codes / positive banners instead of word-in-output greps:
- **aapt2** — `|| /aapt2/i.test(stdout)` matched the tool name inside error text → falsely "installed." Now requires the real banner or an `aapt2 <version>` line; no `|| true` masking.
- **bash-sandbox (security-critical)** — reported the OS sandbox "available" unless known error words appeared, so an *unrecognized* failure would falsely claim a sandbox that isn't there. Now trusts bwrap's exit code; fails closed.
- Captured the rule as a vault micro-page: `vault/atlan/dont-grep-command-output-for-presence.md` (presence → `command -v`/exit code; working → positive signal; security → fail closed). Plus SSML XML-escaping in `voice.js`.
- **Reusable testers, not one-offs:** `docs/FLEET-TESTERS.md` seeds 3 launchable adversarial agents (brittle-detection hunter, injection prober, boundary-honesty auditor) — read-only, report-don't-edit, fired on demand so they don't burn tokens unasked. Good findings get promoted to `vault/` pages (verified only after a second pass).
- Started `vault/` as the file-backed pre-L3 knowledge store (schema matches `docs/VAULT-DESIGN.md`, so L3 ingests it directly later).

## Adversarial tester pass — 5 real bugs, all fixed (2026-07-22)
Ran the 3 `docs/FLEET-TESTERS.md` agents as read-only subagents (no fleet spend, John's on micro). They found 5 confirmed bugs first-try — validation that adversarial passes catch what green first-try tests miss:
1. **RCE (build.js)** — client build path interpolated into `bash -c` (`cd ${projPath}`). Fixed: realpath+PROJECTS_DIR guard + pass as spawn `cwd`, never shell text. Unit regression added.
2. **Preflight tunnel gate fail-open** — reported "safe to expose" when pgrep couldn't run / missed normal `ngrok http`. Fixed: exit-code logic, fails closed.
3. **Chat permission-card bypass** — `claudeEngine.js` lacked `settingSources: []` (fleet had it), so accumulated allow-rules ran tools with no card. Fixed: added it.
4. **Azure SSML injection** — `voice` field interpolated into `name="…"` unescaped. Fixed: `xmlEscape(name)`.
5. **JDK-11-as-21 + broken-tmux-green** (doctor.js) — same brittle-detection class as the Piper bug. Fixed via version-field parse / `^tmux \d`.
Plus doc honesty fixes (README test count → 11 suites; Preview "loopback" not just "127.0.0.1"). Findings captured in `vault/atlan/adversarial-tester-pass-2026-07-22.md`. Suite 173/0. **These fixes are in source but NOT yet live on John's running instance — they apply on next server restart (deferred so as not to interrupt his live exploration).**
