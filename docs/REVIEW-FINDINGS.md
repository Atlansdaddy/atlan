# Adversarial peer-review findings — status

*Four frontier models (ChatGPT, Claude, Gemini, Grok) reviewed Atlan on 2026-07-22 via `docs/REVIEW-FOR-AI.md`. Several found the SAME concrete bugs independently — that cross-validation is why they're treated as real. This tracks every finding and its status.*

*Re-audited against live source 2026-07-24: all 8 code-level "Fixed" rows re-verified present (no regressions); 3 roadmapped items advanced by the durability batch (ReDoS, atomic writes, sandbox opt-in) and moved below; front-end monolith line count corrected (grew, not shrank).*

**Re-audited again 2026-08-02.** Three rows in the roadmap table were stale — the preview proxy had been gated eight days earlier, the atomic-writes row duplicated a row already in "Fixed", and the `app.js` line count was still the pre-correction number despite the 2026-07-24 note above saying it had been corrected. All three fixed below. `SECURITY.md` was re-verified the same day and had **diverged from this file** in both directions: it understated ReDoS (recorded here as fixed, there as open) and it overstated the preview proxy. Two documents describing one codebase must be reconciled against the code, not against each other.

## ✅ Fixed (confirmed by ≥2 models, code-level, regression-tested)
| Finding | Who | Fix |
|---|---|---|
| No `Origin` check on WS + mutating API (rebinding / cross-site-WS) | ChatGPT, Claude, Grok | Origin guard on WS upgrade + non-GET `/api`; no-Origin automation still bearer-gated |
| Preview→agent unpinned prompt-injection channel | ChatGPT, Claude | Cockpit validates `e.origin`===preview-frame + `e.source`; outbound targets origin not `*` |
| New-file write escapes via **symlinked parent** dir | ChatGPT, Claude | realpath-check nearest existing ancestor (not just existing files) |
| `subset-of-var` uses substring not membership ("concatenate"⊃"cat") | ChatGPT, Claude, Grok | exact-set membership |
| No global/daily budget cap; concurrency multiplies spend | ChatGPT, Claude, Grok | `DAILY_TOKEN_CAP` + `MAX_CONCURRENT_RUNS` in spawnRun |
| Sessions stored as plaintext replayable tokens | ChatGPT, Grok | sha256-hashed at rest |
| Password change doesn't revoke sessions | ChatGPT | `revokeAllSessions()` on change |
| No `Secure` cookie flag (for tunneled use) | ChatGPT, Grok | via `ATLAN_SECURE_COOKIE` |
| Doc/code drift: SECURITY.md said "auth doesn't exist"; "writes scoped to project" false for Bash; "no service worker" false | all | SECURITY.md rewritten honestly; profiles relabeled (only Scout is a wall); SW claim corrected |

## ✅ Fixed since — durability batch (2026-07-24)
| Finding | Who | Fix |
|---|---|---|
| regex checkers can ReDoS | ChatGPT, Claude, Grok | Rejected at **authoring** — `unsafeRegex` (`personas.js`) flags nested-quantifier / catastrophic-backtracking shapes so they can never be saved; `upsertCommand` throws. Runtime keeps a 10k input cap as a backstop. Unit regression added. RE2/engine-level timeout remains the ideal, but the ReDoS door is shut. |
| Synchronous FS writes without atomic rename (sessions, personas, ledger) | ChatGPT, Grok | `atomicWrite` (temp sibling + `rename(2)`, preserves `0600`) across all 7 JSON stores (`fsutil.js`) — a crash/kill mid-write can no longer brick a store. SQLite migration still deferred (separate item below). |
| Bash not OS-sandboxed (opt-in mechanism) | all | **Partial.** `ATLAN_SANDBOX=1` wires the SDK OS-confinement (bubblewrap + seccomp) into autonomous fleet Bash; Doctor surfaces whether it's ENFORCED / available-but-off / unavailable. Real confinement only on a native/WSL2 host — proot has no user namespaces, so on-phone it stays unconfined (and says so). The mechanism shipped; the environment is the remaining gap. |

## 🗺️ Roadmapped (real, bigger than a patch — acknowledged, not hidden)
| Finding | Who | Plan |
|---|---|---|
| Bash native OS-sandbox on proot (real confinement, not opt-in) | all | Opt-in mechanism now shipped (see 2026-07-24 above); the *remaining* gap is proot itself having no user namespaces. Real fix = run the server on a native/WSL2 host, or a native sandboxed worker (worktree ≠ sandbox). |
| Preview proxy (:4590) unauthenticated loopback | all | **Mitigated 2026-07-24 (`7caee01`), row was stale until 2026-08-02.** `previewOriginOk()` (`preview.js`) rejects non-loopback `Host` (DNS-rebinding) and cross-site `Origin` (cross-site fetch/WS) — the browser-reachable vectors are shut. **Residual, and it is the mobile-primary one:** a NATIVE local app can forge `Host` and omit `Origin`; on Android any installed app with INTERNET permission reaches loopback. Only a URL secret closes that, deliberately avoided. Same residual class as the `/api/auth/setup` row below. |
| Budgets are post-step, not stream-level (single turn can overshoot) | all | **Mitigated (2026-07-24).** `canUseTool` now reserves `TURN_RESERVE` (default 16k, capped at ½ budget) so it stops authorizing new turns *below* the raw budget — overshoot is bounded to ~one in-flight turn instead of a whole generation. Unit-tested. Further tightening available via the SDK's `taskBudget`/`maxBudgetUsd` (model self-paces) — opt-in, pending a beta-support check on the proot stack. |
| TOCTOU on path guards | Claude, ChatGPT | Low severity single-user; real fix needs openat2/dir-fd confinement. |
| First-run `/api/auth/setup` race | ChatGPT, Grok | **Mitigated (2026-07-24).** Setup now requires local ownership: an allow-listed browser Origin (frictionless first run) OR the automation bearer (`.auth-token`, 0600 — the "local-only token"). A no-Origin local process can no longer claim the instance. Unit + live 403 regression. Residual: a native app can forge Origin (same class as the preview-proxy residual); a browser-side setup-token field is the further hardening, deferred while the front-end is redesigned. |
| **Self-repair gates insufficient as specified** — worktree isn't an execution sandbox; gate code must be immutable *relative to what it gates*; human rubber-stamp under fatigue | all | Folded into `VAULT-DESIGN.md`: Stage 2 stays "AI-assisted patch proposal" (not autonomous) until it runs in a real sandbox with an external immutable test oracle + gate code the loop can't touch. Off by default. |
| Vault dedup ≠ knowledge lifecycle (contradiction/supersession/decay) | ChatGPT | Design SQLite-canonical store + entity IDs + valid_from/until + supersedes edges (beyond ADD/UPDATE/MERGE). |
| Front-end monolith (`app.js`, one scope) is the real scaling wall | Claude, Grok, Gemini, ChatGPT | **Getting worse, measured 2026-08-02: 1,583 lines at review → 2,012 now (+27%).** Split into ES modules + a central state store (no bundler needed). The "no-build" call was right for proot fragility, wrong as a *scaling* argument — and phone-first makes this sharper, not softer, since this file gets edited on a phone. Every feature added before the split makes the split harder. |
| Single Node process owns control plane + execution | ChatGPT | Split execution workers from the control plane before more features. **Ties to the phone→home-node offload path** (`SECURITY.md`): the accessory host is the natural first execution worker. |
| State should move to SQLite (sessions, personas, ledger) | ChatGPT, Grok | *Atomic writes shipped 2026-07-24 — see the Fixed table; this row previously duplicated it and is now scoped to the remaining half.* SQLite migration still deferred. |
| ToS: Agent-SDK-on-subscription is unsupported-risk, not "advisory" | all | Reframed honestly: official CLI = supported; SDK-on-subscription = may break/enforce; API-key = the supported path. |

## Convergent verdict (all four, paraphrased)
> Atlan is a **genuinely engineered personal, loopback-only AI control plane for *trusted* projects**, with real observability and application-level guardrails — but **not** a safe sandbox for untrusted autonomous shell agents, not remotely-exposable on its password alone, and its builder/verifier profiles are **not** hard security walls. The strongest move is to **stop adding agent abstractions and make the execution boundary real.** The scaling risk is the monolithic front-end, not proot. The parts most worried about (the safe evaluator, cost framing) hold up.

## What they'd cut / defer (for John's consideration)
Most-repeated: **one-button APK build** (highest accidental complexity via the qemu-aapt2 shim, lowest daily value, rented from 3 upstreams). Then: autonomous routines, full-auto multi-provider CLIs, and self-repair-on-the-phone. Keep: the core coding session, editor, terminal, preview, Doctor, manual fleet, transparent accounting.
