# Roadmap — everything started and not finished

**Written 2026-08-05.** Status of every open thread, ordered by what it costs to
leave undone. Nothing here is speculative: each item is either a tested finding,
an explicit decision that was deferred, or a stated goal that has no code yet.

The organising judgement: **the constraint is not capability, it is
convergence.** The cockpit does more than the competition in several places and
is less trustworthy than it in three specific ones. Everything below is ordered
against that.

---

## 0. Now — the security spine (new, blocking)

Nothing else on this list ships to a second user before this does.

### 0.1 Fail-closed OS sandbox: filesystem, credentials, network
**Status: not started. Own branch, own agent.**

Today the containment story is honest and thin, and `containment.js` says so
itself: *"containment against ERROR, not against ATTACK, and it must never be
described as a sandbox."* On proot/Termux there is no kernel isolation
available at all. The gaps, precisely:

| Control | Today | Needed |
|---|---|---|
| Filesystem | tool-profile + `isUnder()` write fence | kernel-enforced, fail-closed |
| Credentials | `scrubbedEnv` strips the child env | agent never sees a secret, by construction |
| Network | **nothing** | egress gated, default-deny |

Network is the leg that turns a manipulated turn into an actual loss, and it
has no gate of any kind right now.

**Fail-closed is the requirement, not a preference.** If the sandbox cannot be
established, the run must not start — never silently degrade to "unsandboxed but
running", which is what a flag-file check would do. Detection must be
**behavioural** (probe the kernel by attempting the thing) rather than reading a
capability flag: `/sys/kernel/security/lsm` reads `n/a` on a host where Landlock
is enforcing.

### 0.2 Credential blindness
**Status: not started. Same branch.**

The dogfood session on 2026-08-04 showed an agent reading `.auth-token` and
driving the cockpit's own control plane with it. That was lateral movement
inside a privilege set it already held — not escalation — but it demonstrates
the shape. The goal is stronger than "don't leak": **an agent must not be able
to observe a credential at all**, including through the filesystem, the
environment, process listings, the CLI vendors' own on-disk auth stores, and
anything it can reach over the network.

Requirements as stated: every vector researched and covered, multiple test
shapes per vector, a battery of edge cases per shape, and a written report of
what was tried and what happened. Verified by three independent layers of
contextless adversarial review. Minimal code, no hardcoded paths, no
regex-dependent detection.

### 0.3 Provenance for self-modification
**Status: mechanism proven, not automated.**

Atlan edited its own source on the live box on 2026-08-04. The edits were
competent and the diagnosis was correct — and they lived on exactly one machine,
on no branch, invisible to every checkout, where any later `git add -A` would
have swallowed them into an unrelated commit. They also broke the gate (459/0 →
457/2) and re-opened a closed security hole.

Two deterministic rails caught it within seconds with no AI in the path: the
`app.js` line ratchet and a pinned assertion. **That is the guarddog thesis
working, and it should be generalised rather than reinvented:** hash the wall
files and policy tables, halt on any diff, show the diff on the review canvas.
Self-edits should auto-commit to a branch so self-modification becomes
reviewable instead of ambient.

### 0.4 Taint / provenance-based permission levels
**Status: designed, not built. Fixes a UX problem and a security problem at once.**

There are no permission levels. `claudeEngine.js` sets `settingSources: []` — a
deliberate boundary, documented 2026-07-22, because the SDK would otherwise load
accumulated "always allow" rules that bypass `canUseTool` entirely. The
consequence is ~25 permission cards in one session. Meanwhile the four CLI
engines spawn with `--dangerously-bypass-approvals-and-sandbox` and ask nothing.
Same cockpit, opposite postures.

The fix that does not reopen what that boundary closed: an allowlist **owned by
Atlan**, in memory, session-scoped, consulted inside `canUseTool`, never written
to `~/.claude`. Tag each turn as tainted when it ingests anything not typed by
the user — file reads, web fetches, scan output, tool results, attachment
bodies. The allowlist is void for a tainted turn.

That single rule gives global permissions *and* makes injection expensive, since
ingesting the injection is what revokes the allowlist. **The two features are one
feature.**

Residual to document on day one: provenance stops injection from *acting*; it
does not stop an agent being steered into a subtly wrong diff that passes
review. Same category as the ladder's documented inability to catch a
confidently wrong answer.

---

## 1. Next — convergence

### 1.1 Git is five-way divergent
| Branch | vs main | files | note |
|---|---|---|---|
| `refactor/modularize-and-test` | +16 | 57 | app.js refactor, UI specs, fleet + editor fixes |
| `feat/user-agnostic-uiux` | +15 | 73 | de-hardcoding, light/dark, DISTRIBUTION.md |
| `agent/live-self-edits-2026-08-04` | +2 | 13 | Atlan's own edits + the preview fix |
| `helis/feature/inline-ai-git-ui-debugger` | +4 / −73 | 219 | 10 days stale; carries the HELD `debugger.js` (CDP = RCE) |
| `helis/main` | +3 / −73 | 218 | 10 days stale |

Three of these touch `app.js`. Merge order should be self-edits → user-agnostic
→ refactor → main, because each is progressively larger. The helis pair needs a
decision, not a merge — **no branch gets deleted without discussing it first.**

### 1.2 No CI at the repo boundary
There is no `.github/` directory at all. A 469-assertion gate that only runs
where someone remembers to run it is an honour system, and there is already an
outside contributor branch on the remote. One workflow file.

### 1.3 README is stale enough to undercut the project's own claim
Line 7 advertises *"173 automated tests green across 11 suites"* (actual: 469
across 21) and line 34 says *"The seven tabs"* (there are 8). For a project whose
positioning is honest capability labelling, the front door is the worst place to
be out of date.

---

## 2. Then — the 22 open UI defects

Full ledger in `docs/UI-AUDIT.md`. 39 found, 13 fixed, 5 were bad tests.
Fleet reached zero and is in the gate; the other four specs join as they clear.

| Surface | Open | Worst one |
|---|---|---|
| Doctor | 8 | a **failed** preflight leaves the previous green "safe to consider exposure" verdict on screen |
| Chat | 7 | an engine error leaves the composer and working line lying |
| Tutorial | 4 | the spotlight ring misses its target by ~799px on the last three steps |
| Editor | 3 | `☰` is a dead button on some paths, and says why on a screen you are not on |

### 2.1 Session state does not outlive the socket
Tested, architectural. `index.js` declares `claude`, `brainHistory`,
`agentState` and `pending` **inside** `wss.on('connection')`, so the client's
CONTEXT dies with the WebSocket. `claudeEngine.js`'s crash-recovery `resume` can
therefore only fire within one socket lifetime. Any drop is total amnesia —
exactly the 2026-08-04 transcript, where a fresh session ran
`find /root -mmin -180` to reconstruct what it had been doing 40 seconds earlier.

**Correction, 2026-08-06: the state died but the PROCESS did not.** Going out of
scope is not teardown. `claude` held a warm `ClaudeSession` whose `_input()`
generator loops until `dispose()` flips `_closed`, and `dispose()` was reachable
from exactly one place — a cwd change. There was no `ws.on('close')` handler at
all, so every dropped socket left a live `claude` CLI (~258 MB) running forever,
unreachable, holding `pendingPerms` promises that could never resolve; `app.js`
reconnects 1.5s after every close, so a flaky phone link minted a fresh one per
turn. The chat-path agent CLIs were worse: registered nowhere, so they survived
the socket, survived KILL ALL (`killed: 0`), and survived SIGKILL of the cockpit
itself. Both are now torn down on close, and KILL ALL reaches both.
Pinned by `test/walls.mjs`.

There is also no inbound replay: `pendingOut` queues messages going out, nothing
queues what comes back, and there is no server-side transcript to re-fetch. A
turn that completes during a drop is gone permanently. **Resume and replay are
one fix: conversation state must outlive the socket.**

---

## 3. Reduce surface before adding any

Stated direction: reduce cognitive load, stop building features, increase
usability, cut confusability.

- **8 bottom-nav destinations** at 412px, labels down to 8–9.5px. Fleet alone
  holds Runs, Routines, Builder and Hierarchy.
- **A 28-step tour** that is documentation playback, not onboarding, and which
  claims it walks "EVERY control" while Scan and Hierarchy get zero steps.
- The fix is probably **not** a navigation restructure — nesting Editor two taps
  deep on a phone is a real cost. It is a default journey: *choose project → ask
  → review → preview → accept*, with advanced surfaces taught on entry.
- Handbook has no section for Editor or Scan.

---

## 4. Distribution — "one click to start using"

`docs/DISTRIBUTION.md` (on `feat/user-agnostic-uiux`) has the analysis. The
blocker is not the download, it is **state location**: credentials live inside
the repo checkout, so the app folder cannot be disposable.

1. Move state to `~/.atlan` with auto-migration
2. `npx atlan-cockpit` as the front door — nearly free; `node-pty` must degrade
   honestly on Termux rather than crash
3. `curl | sh` bootstrap for the phone/systemd wiring npm cannot do
4. Docker last — the phone-first audience cannot run it

Open question flagged by the other agent and **not yet decided**: auto-update
posture. The argument on record is notify-only in Doctor, because a
self-rewriting app fights the security story. That decision is John's.

---

## 5. Competitive position (researched 2026-08-05)

**Omnigent** — open-source meta-harness over Claude Code, Codex, Cursor, Pi;
Apache-2.0; ~8.2k stars; contributors from Databricks and Neon; alpha.

Where they are genuinely ahead, and it maps exactly onto §0 and §1 above:

- **`curl | sh` one-line install.** We have git clone and manual steps.
- **Layered policy model** — server admin → per-agent → per-session, with
  approval gates, token-call limits and spend caps. This is §0.4, shipped.
- **Mandatory OS sandbox** — bubblewrap on Linux, seatbelt on macOS. This is
  §0.1, shipped.
- **One session follows you** terminal → browser → phone, in sync. This is §2.1,
  which is our worst architectural bug.

Where the position is genuinely ours, and worth not trading away:

- **The phone IS the computer.** Their mobile story is a mobile-friendly web UI
  pointing at a server on real hardware; Termux/Android is not documented.
  Atlan runs *on the phone*. For someone with no laptop that is a different
  product, not a worse one.
- **Dependency weight.** They need Python 3.12 + Node 22 + tmux + bubblewrap.
  On Termux that difference decides it.
- **Telemetry.** Theirs is anonymous-but-default-on. Atlan collects nothing.
  That is a positioning win we should never spend.
- **Honesty at the point of use.** Their sandbox support is a table in the docs.
  Atlan tells you in the UI, at the moment it matters, what it cannot do.
- **The review canvas.** Propose → review → preview → verify in one surface.
  Orchestration breadth is not the same thing.

**Strategy: do not fight them on orchestration breadth.** They have more hands
and a head start there. Win on the phone being the whole machine, on nothing
phoning home, and on the walls being real — which is why §0 comes first.

---

## 6. Parked / undecided

- **Modes 1, 3, 4 from `MULTI-MODEL.md`** — route/MoE, Self-MoA, council. Mode 2
  (escalation ladder) shipped.
- **Framework features not built**: tool search, programmatic tool calling,
  context editing, advisor tool, `max_tokens: 0` cache pre-warm.
- **Git tab and a DB/State tab** — asked for, never built.
- **Chariots of Atlantis** gap register: METHOD #1/#2/#3, GROUNDING #2, and
  BUILD-SHEET #1/#2/#3/#4/#10/#11/#12 are all OPEN. Those are John's decisions,
  not a bug list.
- **`debugger.js`** stays HELD — CDP is RCE.
- **Whether to delete `server/preview-shim.mjs`.** Superseded and neutered as of
  2026-08-05; it refuses to start. Removal is John's call.
