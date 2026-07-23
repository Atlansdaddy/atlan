---
title: dont-grep-command-output-for-presence
scope: atlan/robustness
tags: [doctor, detection, brittle, false-positive, exit-code, ssml]
confidence: verified
source: John's brittleness hunch → self-audit 2026-07-22 (voice turn)
updated: 2026-07-22
---
**Anti-pattern:** deciding "is X installed / working?" by grepping a tool's stdout/stderr for a **word** (its own name, a version-ish token). Shell error messages *contain the tool's name* — `piper: not found`, `aapt2: error`, `sh: 1: tmux: not found` — so a presence-by-word test reports the tool present **because it failed**. This is a false-GREEN, the most dangerous kind: it hides a broken dependency behind a passing check.

**Three real hits in `server/src/doctor.js` (all fixed):**
- `piper` — `/piper/i.test(out)` matched the error `piper: not found` → falsely "installed". Fixed: `command -v piper` (resolves the binary or prints nothing).
- `aapt2` — `|| /aapt2/i.test(stdout)` matched error text → falsely "installed". Fixed: require the real banner `Android Asset Packaging Tool` or an `aapt2 <version>` line; no `|| true`, so a broken qemu shim rejects and reports the real failure.
- `bash-sandbox` (**security-critical**) — masked the exit with `|| true`, then reported the sandbox "available" unless the error text matched `namespace|not permitted|failed`. An *unrecognized* failure slipped through → **falsely claimed an OS sandbox that isn't there**, the exact thing the threat model forbids. Fixed: trust bwrap's **exit code** (0 only if it truly created the namespaces); any failure → not available.

**Rules (apply everywhere a check reads a subprocess):**
1. **Presence → use `command -v` / exit code**, never a word-in-output grep.
2. **Working → require a positive signal** (a real version banner, an expected value), not the mere absence of known error words.
3. **Never mask the exit** with `|| true` when the exit code *is* the signal.
4. **Security checks fail closed:** if you can't positively prove the boundary is up, report it down.

**Sibling escape hatch, same turn:** SSML built from model/user text must be **XML-escaped** (`& < > "`) before wrapping — otherwise `</speak><evil>` in a reply breaks or injects the envelope. Fixed in `voice.js` (`xmlEscape` in `ssmlWrap` + the Azure body). See [[voice-provider-registry-honesty]].

**Three MORE of the same class, caught by the adversarial tester pass** (same day) and fixed:
- `preflight.js` **tunnel gate (security, fail-open)** — `pgrep … || true` + `catch{}` reported "no tunnels" (GREEN, safe-to-expose) whenever pgrep couldn't run, and only matched `ngrok tunnel` so a normal `ngrok http 4589` slipped through. Now trusts pgrep's exit code (1 = truly no match; anything else = "couldn't verify" blocker) and matches process names alone. **Fails closed.**
- `doctor.js` **JDK** — `/21\./` matched JDK 11's build `11.0.21.1`. Now parses the major from `version "(\d+)"` and compares `=== '21'`.
- `doctor.js` **tmux** — `startsWith('tmux')` passed a broken-but-present tmux whose error is `tmux: error while loading…`. Now requires `/^tmux \d/`.
- `doctor.js` **claude** — moved to `command -v` exit code; version is detail only.

**Acceptable heuristics (left as-is):** `agents.js` matching `401 Unauthorized|not logged in` in stderr to *relabel* an auth failure — a false match mislabels an already-failed run, it can't fake success. Failure-detection heuristics are fine; **presence/working detection is not.**
