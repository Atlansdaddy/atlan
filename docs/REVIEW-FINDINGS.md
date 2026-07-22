# Adversarial peer-review findings — status

*Four frontier models (ChatGPT, Claude, Gemini, Grok) reviewed Atlan on 2026-07-22 via `docs/REVIEW-FOR-AI.md`. Several found the SAME concrete bugs independently — that cross-validation is why they're treated as real. This tracks every finding and its status.*

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

## 🗺️ Roadmapped (real, bigger than a patch — acknowledged, not hidden)
| Finding | Who | Plan |
|---|---|---|
| Bash not OS-sandboxed on proot = builder/verifier are full host execution | all | Now labeled honestly. Real fix = native sandboxed worker (worktree ≠ sandbox); the Bash-sandbox-alternative work (worktree isolation + native host). |
| Preview proxy (:4590) unauthenticated loopback | all | Add auth to the proxy, or gate it; on Android any app reaches it. |
| Budgets are post-step, not stream-level (single turn can overshoot) | all | Reserve budget before each model call based on max-output; the aggregate cap now backstops the account. |
| regex checkers can ReDoS | ChatGPT, Claude, Grok | Move to RE2 / pattern timeout. |
| TOCTOU on path guards | Claude, ChatGPT | Low severity single-user; real fix needs openat2/dir-fd confinement. |
| First-run `/api/auth/setup` race | ChatGPT, Grok | Narrow window; origin guard now blocks cross-origin claim. Consider a first-run local-only token. |
| **Self-repair gates insufficient as specified** — worktree isn't an execution sandbox; gate code must be immutable *relative to what it gates*; human rubber-stamp under fatigue | all | Folded into `VAULT-DESIGN.md`: Stage 2 stays "AI-assisted patch proposal" (not autonomous) until it runs in a real sandbox with an external immutable test oracle + gate code the loop can't touch. Off by default. |
| Vault dedup ≠ knowledge lifecycle (contradiction/supersession/decay) | ChatGPT | Design SQLite-canonical store + entity IDs + valid_from/until + supersedes edges (beyond ADD/UPDATE/MERGE). |
| Front-end monolith (`app.js` ~1300 lines, one scope) is the real scaling wall | Claude, Grok, Gemini, ChatGPT | Split into ES modules + a central state store (no bundler needed). The "no-build" call was right for proot fragility, wrong as a *scaling* argument. |
| Single Node process owns control plane + execution | ChatGPT | Split execution workers from the control plane before more features. |
| Synchronous FS writes without atomic rename/locking (sessions, personas, ledger) | ChatGPT, Grok | Atomic writes + move state to SQLite. |
| ToS: Agent-SDK-on-subscription is unsupported-risk, not "advisory" | all | Reframed honestly: official CLI = supported; SDK-on-subscription = may break/enforce; API-key = the supported path. |

## Convergent verdict (all four, paraphrased)
> Atlan is a **genuinely engineered personal, loopback-only AI control plane for *trusted* projects**, with real observability and application-level guardrails — but **not** a safe sandbox for untrusted autonomous shell agents, not remotely-exposable on its password alone, and its builder/verifier profiles are **not** hard security walls. The strongest move is to **stop adding agent abstractions and make the execution boundary real.** The scaling risk is the monolithic front-end, not proot. The parts most worried about (the safe evaluator, cost framing) hold up.

## What they'd cut / defer (for John's consideration)
Most-repeated: **one-button APK build** (highest accidental complexity via the qemu-aapt2 shim, lowest daily value, rented from 3 upstreams). Then: autonomous routines, full-auto multi-provider CLIs, and self-repair-on-the-phone. Keep: the core coding session, editor, terminal, preview, Doctor, manual fleet, transparent accounting.
