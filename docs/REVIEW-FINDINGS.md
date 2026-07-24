# Adversarial peer-review findings — status

*Four frontier models (ChatGPT, Claude, Gemini, Grok) reviewed Atlan on 2026-07-22 via `docs/REVIEW-FOR-AI.md`. Several found the SAME concrete bugs independently — that cross-validation is why they're treated as real. This tracks every finding and its status.*

*Re-audited against live source 2026-07-24: all 8 code-level "Fixed" rows re-verified present (no regressions); 3 roadmapped items advanced by the durability batch (ReDoS, atomic writes, sandbox opt-in) and moved below; front-end monolith line count corrected (grew, not shrank).*

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
| Preview proxy (:4590) unauthenticated loopback | all | Add auth to the proxy, or gate it; on Android any app reaches it. |
| Budgets are post-step, not stream-level (single turn can overshoot) | all | Reserve budget before each model call based on max-output; the aggregate cap now backstops the account. |
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
