# `canUseTool` is not a security gate in the Claude Agent SDK

*A transferable finding from building Atlan (Mid-Atlantic AI). If you build agents on `@anthropic-ai/claude-agent-sdk` and treat `canUseTool` as your permission boundary, you have a hole right now. Here's the mechanism, the proof, and the fix.*

## TL;DR
`canUseTool` (the callback you pass to `query()` to approve/deny each tool call) is **not** a reliable security boundary. Two separate paths execute tools **without ever invoking your callback**:

1. **`settings.local.json` allowlists.** Any always-allow rule the user has accumulated (Atlan's author had 170+ Bash patterns) auto-approves matching tool calls *before* `canUseTool` is consulted.
2. **Sandbox-"safe" Bash auto-approval.** The CLI classifies some Bash commands as safe-to-run-sandboxed and runs them without a permission prompt — and without calling `canUseTool`.

If your security model is "the model can't do X because `canUseTool` denies X," X still happens.

## How we found it (empirically, not theorized)
Atlan's "Scout" agent profile is supposed to be provably read-only. We enforced that in `canUseTool`: deny `Bash`, deny `Write`, etc. In testing, **a scout ran `ls` two different ways** — once via a `settings.local.json` allow rule, once via the CLI's sandboxed-safe-Bash path — **neither of which called our `canUseTool`.** The callback we thought was the gate was simply skipped.

## The fix (defense in depth, both layers required)
```js
const q = query({
  prompt,
  options: {
    // 1. Do NOT inherit user/project/local settings. Otherwise accumulated
    //    always-allow rules approve tools before canUseTool runs.
    settingSources: [],

    // 2. Remove the tool entirely for this profile. A tool that isn't
    //    available can't be auto-approved by any path. "Absent" > "denied".
    disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],

    // 3. Keep canUseTool for the FINER-GRAINED checks it's still good at
    //    (e.g. path-scoping an allowed Edit) — as the second belt, not the only one.
    canUseTool: async (tool, input) => { /* ... */ },
  },
});
```

The key mental model shift: **`disallowedTools` (the tool is absent) is a stronger guarantee than `canUseTool` returning `{behavior:'deny'}` (the tool exists but you hope every path asks you).** Make the dangerous capability *not exist* for that agent, and empty `settingSources` so nothing silently re-adds it.

## Why this matters beyond Atlan
- If you're building **least-privilege agents** (a read-only reviewer, a scoped worker), `canUseTool`-only enforcement is bypassable.
- The failure is **silent** — no error, the tool just runs. You won't see it in a normal test; we only caught it because a profile that should have had *zero* Bash executed Bash.
- It's **inherited-state-dependent**: the same code is "secure" on a fresh machine and leaky on a developer's machine with accumulated allow rules. That's the worst kind of bug — environment-dependent security.

## What to verify in your own agent
1. Grep your code for `canUseTool` used as the *only* gate. Add `disallowedTools` + `settingSources: []` for any least-privilege path.
2. Write an **adversarial test**: give the agent a task that *requires* a forbidden tool, and assert the side effect never happens (not just that the callback denied it). We run black-box tests that check the filesystem, not the callback.
3. Pin your SDK version and re-check on upgrade — auto-approval behavior is an implementation detail that can shift.

---
*Found while building [Atlan](https://github.com/Atlansdaddy/atlan) — an AI-native software engineering cockpit. Apache-2.0. Corrections welcome.*
