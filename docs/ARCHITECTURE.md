# Atlan — Architecture

> **Living document.** This is the backbone the whole cockpit hangs off. Every
> future capability slots into the contracts described here instead of sprawling
> into a junk drawer. The *Purpose* section is John's to own and redline — the
> rest is the technical spine.

---

## Purpose

Atlan exists because building a real thing — a game, an app, a dream you were
inspired to make — means juggling a dozen disconnected tools: one window for the
coding agent, another for chat, a browser tab for image generation, something
else for audio, a terminal, an editor, a preview. You spend more effort moving
context between them than building. Atlan is the answer to *"I wish I could just
do all of it in one place, simply, from wherever I am."*

**It is for building whatever you're inspired to build, whenever and wherever the
inspiration strikes.** Phone-first, because inspiration doesn't wait for you to
get to a desk.

**What Atlan is _not_:** it is not a SaaS. There is no multi-tenant server, no
account you rent, no telemetry, no paywall between a person and the thing they
want to make. It is *your* cockpit, running on *your* hardware, driving *your*
subscriptions, under your own auth and within every provider's terms of service.
It is a personal creative environment, not a product that monetizes you.

---

## The shape of it

Atlan is a Node server you drive from a browser — one page, seven-plus tabs, a
phone as the primary surface and a PC/home node as the power tier behind it. It
does not wrap a single LLM; it **orchestrates many capabilities behind one
coherent surface**, each with deterministic walls you can see.

The organizing principle is a **spine** every capability plugs into, and a
**surface contract** that keeps "does everything" from becoming "does everything
badly."

---

## The spine

Four load-bearing systems. Everything else is a *surface* that plugs into these.

### 1. Engine & auth registry

One authoritative place that answers: *who am I logged into, and what can each
one do?* Engines declare their id, class, model tiers, readiness, and what they
need to become ready. Every surface reads from this registry rather than
hardcoding providers.

- Auth is **the user's own** — subscription OAuth where the provider offers it
  (Claude, Codex/ChatGPT, Antigravity/Gemini, Grok/xAI all do), API keys only
  where a key is genuinely required, always on the user's own tier and within
  ToS. No borrowed access, no limit circumvention, no loopholes.
- Readiness is **honest**: an engine that isn't logged in says exactly what it
  needs; the UI never offers a capability the user can't actually use.

### 2. The review canvas (Editor + Preview)

The universal surface where anything non-agentic lands **before it is real**.

- Chat-class builders and studio modalities **deposit into the editor**, not
  onto your disk. You review every line, run it in the **Preview** tab, and only
  then make it real. This is the trust model: *the machine proposes into a
  canvas you drive; nothing writes to your tree until you say so.*
- Preview closes the loop — console errors and 📸 visual snapshots flow back into
  the next turn automatically, so "the button overlaps the header" becomes
  verifiable, not copy-pasted.

The autonomous coding agents (below) *act* directly under permission cards; the
chat and studio classes *propose* into this canvas. Two trust models, one review
surface.

### 3. Deterministic walls

Probabilistic workers inside walls that are **code, not models**. Applied
uniformly to every surface, never re-invented per feature:

- **Permission cards** — risky agent actions get Allow/Deny; deny is always safe.
- **Hard budgets that HALT** — token ceilings checked between steps; a run stops
  at the cap, and the ledger always reports the true number.
- **Deterministic checkers** — outputs are graded by code, never by a model
  grading itself. Tier-1 format failures die at constrained decoding; tier-2
  referential/arithmetic failures die at the checkers; tier-3 (semantic-but-
  valid) is surfaced to a human, never silently passed.
- **Honest labels** — every capability is marked for what it actually is;
  roadmap items are labeled roadmap, not faked.

### 4. The phone-first shell

One surface at a time, done fully — the tab/subnav model — because an everything-
app on a 390px screen dies the moment it becomes a cluttered dashboard. The
discipline of "one good surface visible at a time" is what lets the ecosystem
grow to N capabilities without sucking on a phone.

---

## The three engine classes

Capabilities that involve a model fall into three distinct classes. They are
**separate entities with separate abilities and building styles** — not tiers of
one thing.

### Class 1 — Autonomous coding agents (hands)

The full agentic coding CLIs, run under the user's subscription, with real hands
(read/edit files, run tools, build): **Claude Code, Codex, Antigravity, Grok
Build**. Gated per their own model — Claude per-tool via permission cards, the
others via their native sandbox/approval modes. These *act*.

### Class 2 — Chat-driven pseudo-assistant

The providers' **chat** models — logged in on the user's own subscription — turned
into a Cursor-style builder by piping their output into the **review canvas**
(§spine.2). A different building style: lighter, review-first, and the home of
**multimodal** work (e.g. a chat model's image generation) that the coding agents
don't surface. These *propose into the canvas*.

> A subscription's chat access and its coding-agent access are **separate
> scopes** — logging into a provider's chat does not grant its coding agent and
> vice-versa. Atlan treats them as the distinct products they are.

### Class 3 — Studio capabilities beyond code

Each provider's *other* powers as first-class cockpit surfaces on the user's own
subscription: **image generation** from any image-capable model the user picks,
**music / audio studio** tooling, and other creative modalities as they're built.
Different modalities, different use cases, same cockpit — because the vision is
*all* the AI things in one place, not just the coding ones.

**Capability honesty (the one rule that keeps this real):** Atlan builds a
surface for each capability a provider actually *exposes* to the user's
authenticated session or API within ToS. Where a capability is only reachable
inside the provider's own app (not programmatically), Atlan says so plainly
rather than fake a button.

---

## The surface contract

A new capability becomes a **surface** by implementing one contract, so growth is
plug-in, not bespoke:

1. **Declares its engine(s)** through the registry (§spine.1) — never hardcodes a
   provider.
2. **Routes output through the review canvas** (§spine.2) if it produces
   artifacts (code, images, audio) — the user reviews before it's real.
3. **Obeys the walls** (§spine.3) — budgets, permission model, honest readiness
   labels — inherited, not re-implemented.
4. **Lives in the phone-first shell** (§spine.4) — one tab/subnav surface, fully
   realized.
5. **Is themeable** — reads the template variable system so any visual template
   (Classic, MidAtlantic, and others) skins it for free.

Meeting this contract is what makes a capability *part of the ecosystem* instead
of a feature bolted to the side.

---

## MCP — safe tool integration for building anything

Model Context Protocol is the universal tool surface that reaches **all** of
Atlan's coding agents at once (Claude, Codex, Antigravity, Grok all speak MCP),
and it is how the cockpit extends into *building apps and games specifically* —
game-engine bridges, asset pipelines, build tooling, project scaffolds.

MCP is powerful, which means it must be **strong and safe** by construction:

- **Curated registry, not open season.** A vetted set of MCP servers the user
  enables deliberately; each declares what it can touch.
- **Per-profile allowlisting** — MCP tools are gated by the same fleet-profile
  double-belt as everything else (`disallowedTools` + `canUseTool` +
  `settingSources: []`). An MCP tool is a tool; it lives behind the same walls.
- **The execution-boundary reality is stated honestly** — an MCP server that runs
  commands is only as sandboxed as the host (real kernel namespaces on a Linux/
  WSL node; app-sandbox-only on proot). The Doctor shows which boundary is
  actually in force.
- **No secret leakage** — credentials reach the specific child that needs them,
  never a shared shell or a command line.

MCP is the plug that lets "build whatever you're inspired to build" include
toolchains Atlan doesn't ship itself — safely, on the user's terms.

---

## Security & trust posture

- **Loopback by design.** The server binds `127.0.0.1`; nothing leaves the
  machine unless the user deliberately builds a tunnel (e.g. Tailscale serve,
  origin-guarded).
- **Auth:** password + long-lived httpOnly session for humans; a header bearer
  for automation. Never a secret in a URL.
- **Origin guard** on every state-changing request and every WebSocket upgrade.
- **The sandbox truth, stated:** agent Bash is OS-sandboxed only where the host
  provides real namespaces (native Linux, or WSL2 on Windows). On phone/proot it
  is confined to the app sandbox but not OS-isolated within the machine — the
  Doctor reports which you have, and untrusted autonomous work belongs on a real
  sandboxed host. (See the WSL-invisible / native-split roadmap for making the
  strong boundary the default without babysitting.)
- **ToS is a first-class constraint,** not an afterthought: every capability runs
  on the user's own subscription tier, within the provider's terms — no
  circumvention of limits, no loopholes, no shared or borrowed access.

---

## State & data

- Local-first. Cockpit state (personas, commands, hierarchy jobs, budgets,
  sessions, keys) lives in `.fleet/` on the user's machine. Nothing is phoned
  home; there is no telemetry.
- Keys are encrypted at rest and never rendered back to the DOM.

---

## What exists today vs. planned (honest)

**Load-bearing today:** the seven tabs (Chat · Preview · Editor · Term · Fleet ·
Build · Doctor); the engine registry with five agent/local engines (Claude Code,
Codex, Antigravity, Grok Build, local `llama-server`) plus per-engine model
tiers; BYO-key chat brains (OpenAI-compat, 11 providers); the worker hierarchy
with deterministic checkers and the local→cheap-cloud→frontier ladder; permission
cards; budgets that halt; the editor + preview review loop; voice I/O; the
visual-template system (Classic + MidAtlantic).

**Planned (this architecture's forward edge):** brains-as-subscription-chat
(Class 2 on the user's own login, not just BYO-key); chat/studio output wired into
the review canvas as the pseudo-assistant; studio surfaces (image gen first, then
music/audio); the curated safe MCP registry; the Advisor pattern (executor
consults a stronger model mid-run); one-command setup + self-healing Doctor; the
Windows native-split so the strong sandbox is the default with no babysitting.

Everything in the second list slots into the spine and the surface contract
above. That's the point of writing this down first.
