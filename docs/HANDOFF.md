# ATLAN — Onboarding & Handoff

*Written for the owner, John, and for any future maintainer (human or AI) who picks this up cold. Everything here is verified against the running app — nothing aspirational.*

## What you have

A personal build cockpit that runs its own server — on a phone (Samsung S24 Ultra, Ubuntu proot under Termux) or on any PC/Linux host (easier; also the "run it as a server, connect phones as clients" path). One PWA at `http://127.0.0.1:4589` gives you: Claude Code with permission cards, Codex/Gemini agent CLIs, free on-phone models, cloud brains, a live preview pane that snitches errors to the AI, a real tmux terminal, an autonomous agent fleet with hard token budgets, scheduled routines, a Persona+ builder with deterministic checkers, one-button APK builds, health/security dashboards, and Atlan himself — alive in the header.

## Day-1 onboarding (do this once)

1. **Start the server** (if not running): `cd /root/atlan && bin/atlan-serve.sh start` — a durable detached supervisor that auto-respawns and survives a dropped session (`bin/atlan-serve.sh status|stop|restart|log` to manage). Plain `node server/src/index.js` still works for a foreground run.
2. **Open** `http://127.0.0.1:4589` in Chrome/Kiwi (on a phone) or any browser (on a PC).
3. **Unlock**: on first load you **set a password** (8+ chars); after that you just log in with it, and an httpOnly session cookie keeps you logged in on that browser across restarts. (`.auth-token` still exists but is the **automation bearer only** — a header for scripts/tests, never pasted into the login.)
4. **Take the tour**: tap the banner (or ? → "Guided tour"). 28 steps, every control explained. The ? button also opens the searchable handbook — same knowledge, reference-shaped.
5. **Enable push**: Fleet tab → 🔔. Reports now reach you with the app closed.
6. **Add to Home Screen** in the browser menu — it runs full-screen like an app.

## The moving parts (and where their state lives)

| Piece | Runs as | State on disk |
|---|---|---|
| Cockpit server | `bin/atlan-serve.sh start` → `node server/src/index.js` (port 4589, loopback) | `.atlan-supervisor.pid`, `.atlan-server.log` |
| Preview proxy | started by the server (port 4590) | — |
| Login password | scrypt hash, set first run | `.fleet/auth.json` (0600) |
| Sessions | httpOnly cookie, hashed at rest, 30-day | `.fleet/sessions.json` (0600) |
| Automation bearer | header-only (scripts/tests) | `.auth-token` (0600, gitignored) |
| Engine keys | AES-256-GCM | `.keys.enc` + `.keysecret` (0600) |
| Fleet inbox | append-only | `.fleet/history.jsonl` |
| Burn ledger | per-day totals | `.fleet/burn.json` |
| Routines | scheduler config | `.fleet/routines.json` |
| Personas / commands | Persona+ store | `.fleet/personas.json`, `.fleet/commands.json` |
| Push | VAPID keys + subscriptions | `.fleet/vapid.json`, `.fleet/push-subs.json` |
| APKs | served at `/apk/` (token-gated) | `.apk/` with `.builds.json` counter |
| Snapshots | preview 📸 PNGs | `.snapshots/` |

Kill/restart the server freely: **everything of record survives** (inbox, burn, routines, personas, keys, password, sessions). Live runs die with the server — their partial state is already in the inbox as `error`.

## Recovery playbook

- **Locked out / forgot password** → stop the server, `rm /root/atlan/.fleet/auth.json` (clears the password; also `.fleet/sessions.json` for a clean slate), restart, set a new password on first load. (`.auth-token` is the automation bearer, not the human login — deleting it won't help you log in.)
- **Server won't start** → `node server/src/index.js` in foreground, read the error. Usual suspects: port 4589 busy (`pkill -f "server/src/index"` — but never in the same command that restarts it, proot self-match gotcha) or a corrupted JSON store (they all fail soft to empty — move the bad file aside).
- **Signal-9 overnight death** → Android phantom-process killer. Known, documented in memory; wake-lock mitigates; stores make it lossless.
- **APK build dies** → check free RAM (`free -m`, wants ~2.5GB) — stop llama-server; Doctor tab names anything else (JDK/SDK/aapt2).
- **Termux update broke something** → Doctor tab. Every proot-boundary hack has a check; whatever's red is what broke.

## Security posture (honest)

- Loopback-only. Nothing listens beyond the phone.
- All API/WS/APK surfaces gated by a **password + httpOnly `SameSite=Strict` session cookie** (scrypt-hashed, brute-throttled, sessions hashed at rest and revoked on password change); automation uses a bearer header, never a URL. Static shell is open by design (the login screen).
- Preflight (Doctor tab) goes **green once a password is set** and any keys are stored encrypted — the gate to ever exposing this. Exposure remains a deliberate act: Cloudflare Tunnel + Access only, never a bare port. See `docs/SECURITY.md`.
- Known accepted gaps: preview proxy (4590) is unauthenticated loopback; builder/verifier Bash is unscoped inside the project (documented in-app); brains providers see your prompts (their ToS applies).

## For a future AI picking this up

Read `docs/SPEC.md`, then `README.md`, then this file. Run `npm test` (all suites must be green before and after your change). The durability rule: anything Termux/proot-fragile goes behind the adapter layer + a Doctor check. The product rule: honest framing always — budgets halt, scouts provably can't write, brains have no hands, missed routines never auto-fire. Never weaken those to "improve UX".
