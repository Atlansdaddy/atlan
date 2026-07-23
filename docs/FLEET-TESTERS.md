# Fleet edge-case testers — ready to launch, not auto-run

Reusable adversarial agents you fire from the **Fleet** tab when you want a robustness pass. They're **saved here, not locked to one use** — paste the prompt, pick the profile/budget, launch. Findings go to the run's report; promote the good ones into `vault/atlan/` as micro pages (the pattern in [`vault/atlan/dont-grep-command-output-for-presence.md`](../vault/atlan/dont-grep-command-output-for-presence.md)).

**Why not auto-run them?** Each is a real Claude fleet run = real tokens. You decide when to spend. All use read-only or read-and-run profiles — none edit code; they *report*, you fix.

---

## 1 · Brittle-detection hunter  ·  profile: `scout`  ·  budget: 120k
> Audit this codebase for the "false-GREEN" anti-pattern: any check that decides a dependency/tool/boundary is present-or-working by grepping a subprocess's stdout/stderr for a word (often the tool's own name or a version-ish token), instead of using `command -v`/exit codes or requiring a positive banner. Shell errors contain the tool name (`piper: not found`), so these falsely report success on failure. Also flag any `|| true` that masks an exit code the check depends on, and any security check that "fails open" (reports a boundary present unless specific error words appear). List each: file:line, why it's brittle, a concrete failing input, and the minimal fix. Do not edit — report only.

## 2 · Injection & escaping prober  ·  profile: `scout`  ·  budget: 120k
> Find every place user/model text is interpolated into a structured sink without escaping: SSML/XML envelopes, shell command strings, HTML/DOM `innerHTML`, JSON built by concatenation, file paths, SQL-like queries. For each, give the exact hostile input that breaks or injects the sink (e.g. `</speak><evil>` into SSML, `$(...)` into a shell string, `<img onerror>` into innerHTML) and the escape/parameterization that fixes it. Rank by blast radius. Report only.

## 3 · Boundary-honesty auditor  ·  profile: `verifier`  ·  budget: 150k
> Cross-check every capability/security claim in README.md, docs/SECURITY.md, and the Doctor/Preflight checks against what the code actually enforces. Find anywhere the app *claims* a boundary, sandbox, or guarantee that the code doesn't truly provide (or provides more weakly than stated) — the "never claim a boundary that isn't there" rule. Run the checks where you can and compare their verdict to reality. List: claim, where it's made, what the code actually does, and whether it's honest / overstated / understated. Report only.

---

### Running a panel (multiple at once)
Launch 1–3 as separate fleet runs with a hard budget each; they don't touch each other. When several agree a spot is fragile, that's a strong signal — promote it to a `vault/atlan/` page with `confidence: verified` and cite the run ids in `source:`. A single-agent finding stays `confidence: unverified` until a second pass (or you) confirms it.

*These are the seed set. Add more as new bug classes surface — that's the "few more ready testers" growing over time.*
