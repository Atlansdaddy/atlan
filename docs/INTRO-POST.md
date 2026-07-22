# Atlan — intro post for the vibe-coding group

*(Draft — tweak to your voice. Casual, honest, no overselling. Repo link at the bottom.)*

---

Been heads-down on something and I gotta show you all. 🧇

I built **Atlan** — a full AI dev cockpit that runs **entirely on my phone.** Not "an app that calls an API" — the whole thing: the server, the agents, the builds, all of it, running in Termux/proot on my S24. No laptop. I've literally been building apps *from my phone, with my phone.*

What it actually does, one screen:
- **Chat with any model** — Claude Code (that actually edits files and runs stuff), plus Codex, Gemini, and free on-phone local models. Watch it *think* live.
- **Send agents off to work on their own** — give one a job, it works alone on a hard token budget and reports back. I pointed one at Atlan's own code and it *found a real security bug.* Fixed it same day.
- **A worker hierarchy** — cheap local models do the grunt work, and it only escalates to the expensive frontier models for the hard 5%. Keeps it basically free.
- **See what you're building** — live preview, errors pipe straight back to the AI, snapshot the screen and the model literally *looks* at it.
- **A real code editor + terminal + one-button APK builds** — I build the installable Android app from the same phone it runs on.
- **Atlan himself** — the little guy's alive: glows calm when idle, lights up when agents are running, greets you by time of day. (And yes, type "waffles" 🧇)

It's honest about what it is — every dangerous thing has a wall you can see, budgets actually stop, and it tells you the truth about cost and limits instead of hyping.

**It's open source (Apache-2.0) and free.** Clone it, run it, fork it, break it. Only ask is you keep the credit. Built by me, John / Mid-Atlantic AI.

👉 **https://github.com/Atlansdaddy/atlan**

If you run it and something breaks, tell me — that's how it gets better. If you build something cool with it, show me. Let's go. 🌊

---

*P.S. — it's designed for phone (Termux/proot) but runs on any Linux/Mac too. Setup guide's in the repo (docs/SETUP.md).*
