# vault/ — Atlan's knowledge pages (pre-L3)

Small, scoped, `[[wikilinked]]` markdown pages — one compiled fact each. This is the file-backed form of the **L3 knowledge vault** (see `docs/VAULT-DESIGN.md`): the agent will query these by **grep** (research says grep beats embeddings for this) and load one small relevant page instead of re-deriving what it already learned. A page grown once is queried cheaply forever — that's the token win.

Until the L3 DB + Proposals inbox ship (task #17), these pages are **hand-curated** and live here as plain files. The frontmatter already matches the vault page schema, so ingestion is a straight import when the DB lands.

## Page shape
```markdown
---
title: kebab-slug
scope: area/subarea
tags: [a, b]
confidence: verified | unverified
source: where it came from
updated: YYYY-MM-DD
---
The one fact, atomic and size-capped. Link with [[other-page]].
```

## Rules
- **Atomic + capped** — one fact per page, small.
- **Verified beats unverified** — an unverified page can't override a verified one; single-agent findings stay `unverified` until confirmed.
- **Never compact precise/numeric pages** — research: compaction loses precise numbers. Those stay verbatim.
- **Cite provenance** — `source:` names the run/person that produced it.

## Scopes so far
- `atlan/` — knowledge about building Atlan itself (robustness patterns, subsystem design). Per-project vaults come later; this is the meta/self scope.
