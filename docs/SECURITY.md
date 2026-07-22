# Atlan security posture (honest)

*Updated 2026-07-22 after a four-model adversarial review (ChatGPT, Claude, Gemini, Grok). This doc is kept truthful on purpose — earlier versions drifted from the code, which reviewers rightly flagged.*

**Atlan is loopback-only.** Cockpit :4589, preview proxy :4590, llama-server :8080 bind 127.0.0.1. Nothing is reachable from the internet. The in-app **Preflight** (Doctor tab) gates any exposure.

## The honest threat model (read this first)
The realistic risk is **not** "someone on the internet connects to port 4589." It's **local**:
- **On Android, loopback is not a boundary between apps.** Any installed app with INTERNET permission can reach `127.0.0.1:<port>`. proot doesn't change that — Termux shares the device network stack. So the password gate is what actually protects the authenticated surface, and **unauthenticated loopback surfaces (the preview proxy) are reachable by any app on the phone.**
- **Inside proot, an agent with Bash is effectively root of the Termux user.** There's no OS sandbox (bubblewrap/Landlock don't run in proot — tested). Prompt-injected or malicious code an agent runs can read the (decryptable-by-design) key store, alter files, or stage exfiltration through allowed provider traffic. proot confines this to the Termux app sandbox (it can't touch other Android apps), but **everything Atlan can reach — your repos, its own state, provider creds in proot — is in blast radius.**
- **"Run untrusted work on a native host" is honest only stated bluntly:** phone mode is for *trusted* personal projects. Untrusted autonomous shell work needs a real sandboxed host — and even there, Atlan must actually enable FS/network isolation and keep secrets out of the worker. It is not a cop-out only if we say exactly this.

## What exists today (matches the code)
- **Auth:** password (scrypt, per-instance) + httpOnly `SameSite=Strict` session cookie surviving restarts; **session tokens hashed at rest** (sha256 in `sessions.json` — reading the file can't replay); **password change revokes all sessions**; failed-login throttle; automation bearer via header (never a URL). `Secure` cookie flag when `ATLAN_SECURE_COOKIE` is set (behind TLS).
- **Origin pinning:** every mutating `/api` request and the WS upgrade reject a cross-origin `Origin` (DNS-rebinding / cross-site-WS defense); no-Origin automation is bearer-gated.
- **Preview→agent channel pinned:** the cockpit only accepts `postMessage` from the actual preview frame origin (was an unpinned prompt-injection path). Content from preview is still treated as adversarial.
- **Path guards:** reads/writes/attach confined under the project root, credential-name denylist, and **realpath checks of the nearest existing ancestor** (blocks symlink escape, incl. new files under a symlinked parent).
- **Fleet:** Scout tools stripped at the SDK level (`disallowedTools` + `settingSources:[]`); per-run hard budget; **global daily token cap + concurrency cap** so concurrent runs can't multiply past the wall.
- **Keys:** AES-256-GCM at rest, 0600 secret, last-4 only. Honest limit: decryptable by design (the app must send keys to providers).
- **Deterministic checkers:** exact membership (not substring), safe arithmetic (no `eval`), constrained decoding.

## Known, still-open gaps (from the review — not hidden)
- **Bash is NOT OS-sandboxed on proot.** Builder/verifier Bash is host execution as the Termux user — gated by tool *profile*, not the OS. The "writes scoped to project" claim is true only for the SDK Write/Edit tools, **not** Bash. Honest labels: Scout = SDK-read-only; Builder/Verifier = full host execution.
- **Preview proxy (:4590) is unauthenticated loopback** — any app on the phone can reach it; treat any local service it can proxy as exposed.
- **Budgets are post-step, not stream-level** — a single in-flight turn can overshoot its cap before the halt; the aggregate caps bound the account, not one runaway step.
- **regex checkers can ReDoS** (user-authored patterns on model output) — self-inflicted, single-user, but an unbounded-time op. RE2/timeout is the fix.
- **TOCTOU** on path guards (check-then-use) — low severity single-user.
- **Self-repair (designed, not built):** a git worktree is source-tree hygiene, not an execution sandbox — verifying a malicious patch runs its code. Stage 2 must run in a real sandbox with an *immutable, external* test oracle and gate/checker code the loop can never touch. Until then it's **AI-assisted patch proposal**, not autonomous self-repair. Off by default.

## Exposure plan (only after Preflight green)
- Workers/Pages **cannot** host the server (needs real Linux: tmux, node-pty, Claude Code). Only the static shell is Wrangler-deployable.
- Remote access = **cloudflared tunnel** → hostname, gated by **Cloudflare Access** (IdP/OTP), pointing at 127.0.0.1:4589. Set `ATLAN_SECURE_COOKIE=1` and `ATLAN_ORIGIN=<tunnel origin>` when tunneling. Phone stays the compute.
- Even then: keep untrusted/autonomous shell work off the phone.
