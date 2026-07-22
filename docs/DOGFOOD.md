# Atlan dogfood — incrementals

*Feed these to Atlan in order. Each exercises a feature and will surface gaps — when something breaks or annoys you, that's the next fix. When something works well, save it (it becomes a reusable use-case for the vault). Start read-only/cheap, build up to the powerful stuff.*

## Round 1 — Chat (warm-up: streaming, thinking, models, attachments)
- [ ] Pick one of your repos in the project dropdown; ask "explain what `<some file>` does and how it fits the app." → watch the **thinking panel** stream.
- [ ] Screenshot an error or a UI glitch on your phone, **paste it** into chat, ask "what's wrong here?" → tests **image attachment → vision**.
- [ ] Ask the same question on **fable-5**, then **haiku-4.5**, then a **local model** (if llama-server's up). Compare speed/quality → tests the **switcher** + honest engine labels.
- [ ] Ask a question, then a follow-up → confirm the session **resumes** (cheap warm turn) and the session-id copy line works.

## Round 2 — Editor (write/review by hand)
- [ ] Open a real file via **☰ browse** or a path, make a small edit, **Save**. Reopen — confirm it saved.
- [ ] Write a tiny new utility file from scratch, Save to a new path.
- [ ] Open a file you're unsure about → **"Send to Claude for review"** → read its feedback.

## Round 3 — Fleet Scout (read-only, safe, cheap — the proven one)
- [ ] Scout: *"Audit `<repo>` for the top 3 risks, most severe first, one line each."* (This found a real bug in Atlan.)
- [ ] Scout: *"List every TODO/FIXME/HACK in this repo, grouped by file."*
- [ ] Scout: *"Summarize what the last 10 commits changed, in 5 bullets."*
- [ ] Watch the **budget halt** + **top-up resume** if one runs long (like the demo).

## Round 4 — Fleet Builder (writes — scoped to the project)
- [ ] Builder: *"Add a missing test for `<function>` and run it."*
- [ ] Builder: *"Fix the lint/type errors in `<file>`."*
- [ ] Confirm writes stay **inside the project** (try asking it to touch something outside — it should refuse).

## Round 5 — Routines (scheduled, budgeted)
- [ ] Create a daily routine: *"Scan `<repo>` for new issues since yesterday and report."* Set it, let it fire (or **▶ run now**), check the **inbox**.
- [ ] Turn on **🔔 push**, spawn a run, close the app → confirm the notification arrives.

## Round 6 — Persona+ builder + harness (reusable skills)
- [ ] Build a persona (e.g. **"Release-Notes Writer"**) + a structured command with a couple of checkers.
- [ ] Run it through the **test harness** on a sample input → see the checkers pass/fail.
- [ ] This is your first **saved, reusable use-case** — the seed of the vault.

## Round 7 — Hierarchy (the worker ladder)
- [ ] Build a small **job**: 2 links (e.g. *extract fields* → *format output*) on a real input.
- [ ] Watch it run **cheapest-tier-first**, escalate if a checker fails, and pause at the **human gate**.

## Round 8 — Build an APK
- [ ] Point Build at a Capacitor project (D2D, wAIver-mobile) → **◉ Build APK** → install the result.
- [ ] Stop llama-server first if RAM's tight (Doctor tells you).

## Round 9 — Real-world use cases (once adapters exist)
- [ ] Email (Zoho): *"summarize my unread and draft replies to the two that need one."*
- [ ] Social: *"draft 3 posts about `<thing>` in my voice."*
- [ ] The ones that work → **save as jobs** → your use-case library.

---
**How to feed back:** when something breaks, tell me the round + what happened and I'll screenshot-diagnose + fix it the same way we've been doing. When something works, we save it. This list *is* the path from "toy" to "I use this daily" to "it earns self-hosting."
