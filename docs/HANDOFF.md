# ATLAN — Onboarding & Handoff

*Written for the owner, John, and for any future maintainer (human or AI) who picks this up cold. Everything here is verified against the running app — nothing aspirational.*

## What you have

A personal build cockpit that runs entirely on the phone (Samsung S24 Ultra, Ubuntu proot under Termux). One PWA at `http://127.0.0.1:4589` gives you: Claude Code with permission cards, Codex/Gemini agent CLIs, free on-phone models, cloud brains, a live preview pane that snitches errors to the AI, a real tmux terminal, an autonomous agent fleet with hard token budgets, scheduled routines, a Persona+ builder with deterministic checkers, one-button APK builds, health/security dashboards, and Atlan himself — alive in the header.

## Day-1 onboarding (do this once)

1. **Start the server** (if not running): `cd /root/atlan && nohup node server/src/index.js > .server.log 2>&1 &`
2. **Open** `http://127.0.0.1:4589` in Chrome/Kiwi on the phone.
3. **Unlock**: paste the token from `cat /root/atlan/.auth-token`. Stored in that browser forever after.
4. **Take the tour**: tap the banner (or ? → "Guided tour"). 27 steps, every control explained. The ? button also opens the searchable handbook — same knowledge, reference-shaped.
5. **Enable push**: Fleet tab → 🔔. Reports now reach you with the app closed.
6. **Add to Home Screen** in the browser menu — it runs full-screen like an app.

## The moving parts (and where their state lives)

| Piece | Runs as | State on disk |
|---|---|---|
| Cockpit server | `node server/src/index.js` (port 4589, loopback) | — |
| Preview proxy | started by the server (port 4590) | — |
| Auth token | generated first boot | `.auth-token` (0600, gitignored) |
| Engine keys | AES-256-GCM | `.keys.enc` + `.keysecret` (0600) |
| Fleet inbox | append-only | `.fleet/history.jsonl` |
| Burn ledger | per-day totals | `.fleet/burn.json` |
| Routines | scheduler config | `.fleet/routines.json` |
| Personas / commands | Persona+ store | `.fleet/personas.json`, `.fleet/commands.json` |
| Push | VAPID keys + subscriptions | `.fleet/vapid.json`, `.fleet/push-subs.json` |
| APKs | served at `/apk/` (token-gated) | `.apk/` with `.builds.json` counter |
| Snapshots | preview 📸 PNGs | `.snapshots/` |

Kill/restart the server freely: **everything of record survives** (inbox, burn, routines, personas, keys, token). Live runs die with the server — their partial state is already in the inbox as `error`.

## Recovery playbook

- **Locked out** → `cat /root/atlan/.auth-token`. Rotate by deleting that file + restarting (re-paste in browser).
- **Server won't start** → `node server/src/index.js` in foreground, read the error. Usual suspects: port 4589 busy (`pkill -f "server/src/index"` — but never in the same command that restarts it, proot self-match gotcha) or a corrupted JSON store (they all fail soft to empty — move the bad file aside).
- **Signal-9 overnight death** → Android phantom-process killer. Known, documented in memory; wake-lock mitigates; stores make it lossless.
- **APK build dies** → check free RAM (`free -m`, wants ~2.5GB) — stop llama-server; Doctor tab names anything else (JDK/SDK/aapt2).
- **Termux update broke something** → Doctor tab. Every proot-boundary hack has a check; whatever's red is what broke.

## Security posture (honest)

- Loopback-only. Nothing listens beyond the phone.
- All API/WS/APK surfaces token-gated (timing-safe, brute-throttled). Static shell is open by design (the login screen).
- Preflight (Doctor tab) is **all green** as of 2026-07-20 — the gate to ever exposing this is passed, but exposure remains a deliberate act: Cloudflare Tunnel + Access only, never a bare port. See `docs/SECURITY.md`.
- Known accepted gaps: preview proxy (4590) is unauthenticated loopback; builder/verifier Bash is unscoped inside the project (documented in-app); brains providers see your prompts (their ToS applies).

## For a future AI picking this up

Read `docs/SPEC.md`, then `README.md`, then this file. Run `npm test` (all suites must be green before and after your change). The durability rule: anything Termux/proot-fragile goes behind the adapter layer + a Doctor check. The product rule: honest framing always — budgets halt, scouts provably can't write, brains have no hands, missed routines never auto-fire. Never weaken those to "improve UX".
