# Atlan security posture & hardening backlog

Current stance (per John's blueprint principle: local dev frictionless first, harden before exposure):
**Atlan is loopback-only.** Cockpit :4589, preview proxy :4590, llama-server :8080 — all bind 127.0.0.1. Nothing is reachable off-device. The in-app **Preflight** (Doctor tab, `/api/preflight`) is the gate: every blocker green before ANY tunnel, deploy, or LAN bind.

## What exists today
- Keys: AES-256-GCM at rest (`.keys.enc`), per-device secret `.keysecret` (0600), never echoed to the client (last-4 only), env vars take precedence. Honest limit: an attacker with full proot access can decrypt — the app must be able to. (Hashing is impossible for API keys: they must be sent to providers.)
- Claude sessions run permission-mode `default` — dangerous tools require a tap.
- Preview proxy targets restricted to 127.0.0.1/localhost.
- Secrets git-ignored; nothing sensitive committable.

## Blockers before exposure (preflight enforces)
1. **Auth layer** — token/passkey on cockpit HTTP+WS (`ATLAN_TOKEN` minimum; better: Cloudflare Access in front). TOP PRIORITY, does not exist yet.
2. WS origin checks + CSRF on POST endpoints.
3. Rate limiting on /api/keys.
4. Permission-mode lockdown flag for remote use (no bypassPermissions ever remotely).

## Cloudflare plan (John: "wrangler login to deploy")
- **Workers/Pages CANNOT host the server** — it needs real Linux (tmux, node-pty, Claude Code processes). Wrangler-deployable: only the static shell.
- Realistic remote-access shape: **cloudflared tunnel** from proot → hostname, gated by **Cloudflare Access** (email OTP / IdP), pointing at 127.0.0.1:4589. Phone stays the compute.
- iOS/anyone-else access = this same tunnel (webapp). On-device iOS port is architecturally impossible (no proot equivalent).
- Sequence: harden (backlog #1–4) → preflight green → `cloudflared tunnel` + Access → test from a second device → only then share.

## Deferred (pre-productization)
- Per-project sandbox profiles for brains vs agent.
- Audit log of permission grants + builds.
- Key rotation UX; wipe-keys button.
