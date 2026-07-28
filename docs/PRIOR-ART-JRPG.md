# PRIOR ART — the NES/SNES JRPG, decomposed

**For CHARIOTS OF ATLANTIS.** Written 2026-07-28, before the walls are built, on
the principle that you cannot write pass/fail criteria for a form you have only
characterised from memory.

This is a study of *how these games actually work* — mechanically, numerically,
architecturally, and organisationally — and what of it transfers. It is
deliberately long. §13 is the extraction; everything before it is the evidence
that makes §13 defensible rather than asserted.

---

## 0. How to read this

The genre was not designed. It was **assembled from two Western PC games by two
people who wanted their friends to be able to play them**, then refined under
brutal hardware limits by teams smaller than most modern indie studios.

That origin explains nearly every design decision in it. When we get to the
walls, the useful question is rarely "what did FF1 do" — it's "what problem was
FF1 solving, and does that problem still exist for us?" Some do. Some were
hardware artefacts that we would be foolish to reproduce.

Three claims this document will support:

1. **The systems are small; the design is in the numbers.** A faithful FF1-class
   engine is a few thousand lines. The game is in the tables and the curves.
2. **Constraint produced the quality.** Density, readability and pacing were
   *forced*. Remove the constraint and you must re-impose it deliberately.
3. **The teams were tiny and role-shaped in a way that maps almost directly onto
   a model fleet** — which is why this is worth studying rather than just
   playing.

---

## 1. Lineage — where the form came from

The JRPG is a **deliberate hybridisation of two specific American computer
games**, made for a console audience that had played neither.

**Wizardry** (September 1981) contributed: a **party** of adventurers, per-member
**classes**, **detailed character creation**, **first-person dungeon combat**,
**random battles**, and **permadeath**. It is a dungeon-and-combat game.

**Ultima** contributed: the **overhead tile map**, the **overworld**, towns,
NPCs — a *world* rather than a dungeon.

**Koichi Nakamura and Yuji Horii played both while at Chunsoft** and built
Dragon Quest by taking Ultima's overhead map and combining it with Wizardry's
first-person combat and random battles, wrapped in a console-accessible
interface. That combination *is* the genre. Nearly everything after is
refinement of it.

**Why it matters to us:** the form was born as an *integration*, not an
invention. The two halves — world traversal and encounter resolution — remain
architecturally separable, and separating them cleanly is the single most
useful structural decision available to us.

## 2. The canon, and what each one actually contributed

| game | year | the contribution that mattered |
|---|---|---|
| **Wizardry** | 1981 | party, classes, permadeath, first-person dungeon |
| **Ultima** | 1981 | overhead world, towns, NPCs |
| **Dragon Quest** | 1986 | the fusion; console-accessible UI; the *introductory* RPG |
| **Dragon Quest III** | 1988 | **class change** (Dharma Temple) — build-crafting as a system |
| **Final Fantasy** | 1987 | party *composition* chosen up front; multi-target battle framing |
| **Final Fantasy IV** | 1991 | **ATB** — real time enters the turn |
| **Final Fantasy V** | 1992 | **job system + ABP** — abilities decoupled from class |
| **Final Fantasy VI** | 1994 | ensemble cast, set-piece narrative at scale |
| **Chrono Trigger** | 1995 | the "Dream Project"; on-map encounters, tech combos, NG+ |

**Dragon Quest III's class change is the sharpest single mechanic in the era**
and worth understanding precisely: change class and you **lose all accumulated
experience and half your stats — but keep every ability the previous class
learned.** That is a deliberate, punishing, *legible* trade. It creates
build-crafting out of three numbers and one rule. Note how little machinery it
requires.

## 3. The people, and what they believed

**Yuji Horii (Dragon Quest).** Wanted **an introductory RPG for a wide
audience** — storytelling and emotional involvement, with the interface
*simplified* to bring a mostly-Western PC genre to a Japanese console market.
Asked decades later why the series endures, he answered: **"warmth" and
"accessibility."** He was a scenario writer, not a programmer.

**Koichi Nakamura (Chunsoft).** Lead programmer. The working relationship is
documented and is directly relevant to us: **Horii would say "I have this image
in my head, and I want to do this," and Nakamura would find a refined,
sophisticated way to translate it into the game.** That is a designer/implementer
pair with a clean interface between intent and mechanism.

**Hironobu Sakaguchi (Final Fantasy).** Joined Square in 1983 as a part-timer
after dropping out of university. Producer/originator rather than systems
designer.

**Hiroyuki Ito (Final Fantasy IV/V/VI/IX/XII).** The systems mind of the era.
Invented **ATB for FF4 after watching Formula One** — the idea that characters
have *speed attributes that affect their turns*. For FF5 he added the ATB gauge,
the **ABP** system, and the customisable **Job System**.

**Ito's balance method is the most directly transferable thing in this entire
document.** On FF5: every class must have value and be mixable; he ran
**extensive playthroughs to find unintended combinations** — mixes that rendered
a party effectively invincible — while **verifying that diverse compositions,
including an all-Monk party, could still reach and beat the final boss.**

That is a **two-sided balance invariant**, stated as a property:
- no composition is degenerate (nothing trivialises the game), and
- no *reasonable* composition is soft-locked out of finishing.

He established it by brute-force play. **We can establish it by bot.** This is
the single strongest argument that the play-bot is not a nice-to-have.

**Koichi Sugiyama (Dragon Quest music).** Classically trained conductor. Wrote
**sheet music** and sent it to Enix/Chunsoft, where it was arranged onto the
2A03 in assembly. For DQ1 he wrote **eight themes**: title, castle, town, field,
dungeon, battle, final battle, ending. That list is essentially a spec for the
minimum viable emotional palette of the genre.

**Nobuo Uematsu (Final Fantasy music).** Came to game scoring from **1970s
progressive rock**, with a wider sample palette even by FF4.

**Akira Toriyama (art, DQ + Chrono Trigger).** A manga artist, not a game artist
— which is why the character read is so strong at low resolution.

## 4. Team structure and production method

This section matters more than it looks, because it is the closest real-world
analogue to what we are trying to build with a fleet.

- **FF6 (1994): roughly one year, 50–60 people**, of which the core creative team
  was around **30**. Director Kitase notes that 30 "seems incredibly small
  today," but that **30 was considered quite big at the time**, and that other
  genres ran on teams of **4–5**.
- **Chrono Trigger (1995)** was structured as a **"Dream Project"**: supervisors
  Sakaguchi and Horii, character design Toriyama, produced by Kazuhiko Aoki,
  **directed by three people** (Matsui, Kitase, Tokita). **Horii wrote the story
  outline** — he was a time-travel fan, and drew on *The Time Tunnel* — which was
  then **finalised by a dedicated story planner/scriptwriter, Masato Kato.**

Read that last one carefully, because it is a delegation pattern:

> **a supervisor supplies the premise and shape → a specialist finalises it →
> multiple directors own separate execution tracks.**

Nobody "wrote Chrono Trigger." One person set the frame, one person made it
coherent, several people executed in parallel, and the frame is what kept them
consistent. That is exactly the shape we need, and it was arrived at by people
who had no choice but to make it work.

**Two lessons for our roster:**

1. **The intent-holder and the implementer are different roles with a clean
   interface** (Horii→Nakamura). Don't collapse them.
2. **Consistency came from a compiled frame, not from communication bandwidth.**
   Thirty people did not stay consistent by talking constantly. They stayed
   consistent because the outline, the art bible and the world were fixed first.

## 5. Systems anatomy

### 5.1 Battle

The invariant core across the whole era:

- a **party** (typically 3–4 acting members, Wizardry's 6 trimmed for consoles)
- **turn order** determined by a speed/agility stat
- per-turn **action selection** from a small verb set: Attack / Magic / Item /
  Defend / Flee (plus a class-specific verb in later entries)
- **targeting** — single or group, with enemies arranged in ranks/rows
- **damage resolution** — a hit check, then a damage roll, then mitigation
- **status effects** as a parallel state layer (poison, sleep, silence, stone…)
- **victory → XP + gold + drops**

FF4's ATB replaced discrete rounds with per-character **timers** — the same
decision structure, with real time as a pressure axis. FF5's ATB gauge made that
timer legible.

**The verb set is tiny and never grows much.** Depth comes from the interaction
of *status × element × target-count × resource*, not from more verbs.

### 5.2 Progression, stats, jobs

**Stats** are a small fixed vector — typically Strength, Agility, Intelligence,
Vitality, Luck, plus HP/MP. **Growth is per-class**, table-driven, and modest per
level.

Concretely, in FF1 **Hit% grows by class**: Fighter and Black Belt **+3 per
level**, White Mage and Black Mage **+1**, Thief and Red Mage **+2** — and every
**32 points of Hit% grants an extra attack per round.** That single coupling is
the entire reason Fighters out-scale mages physically; it is one table and one
division.

**Job/class systems** come in two flavours:
- **DQ3**: change class at a fixed location, pay a hard price (all XP, half
  stats), keep learned abilities.
- **FF5**: jobs are equipment for the *character*; **ABP** buys abilities, which
  then travel independently of the job.

FF5's is more expressive and more dangerous — which is why Ito had to hunt
invincible combos by playing.

### 5.3 Magic

- spells organised into **tiers/levels**, learned by class and level (or bought)
- **charge-based** (FF1: N casts per spell level) or **MP-based** (most others)
- categories: damage (elemental), healing, buff, debuff, status, utility
  (escape/teleport/light), and a small set of *rule-breakers*
- **elements** form a rock-paper-scissors layer against monster resistances

Magic is where the **exception content** lives — the spells that break a rule are
the memorable ones.

### 5.4 Items, equipment, economy

- weapons/armour with **class restrictions** and a small stat delta
- **consumables** as a portable, purchasable version of magic
- **key items** gating world progress
- shops stocking by **region tier**, prices tracking power
- gold as the throttle: encounters pay, shops absorb

**Almost all of this is derivable.** Price from power, shop stock from
progression stage, drops from monster tier. The authored part is the exceptions.

### 5.5 World, map, traversal

Three nested scales: **overworld → town/dungeon interior → battle screen**, each
its own view with its own rules. Traversal expands in *gated tiers* — walk, then
a vehicle that crosses one terrain type, then one that ignores terrain, then one
that reaches the endgame region.

**This is the chariot slot**, and it is why the mechanic maps so cleanly onto
our rungs: FF1's ship/canoe/airship ladder *is* a progression spine expressed as
map access.

### 5.6 Encounters and pacing

- **random encounters** on a step counter, rate per zone
- **encounter tables** per zone, weighted, sometimes with a rare/ambush slot
- safe zones (towns) punctuating hostile zones

The design literature on this is blunt, and the failure mode is well documented:
**the fatal flaw of many '90s JRPGs and retro-styled indies is lazy map design
combined with a high encounter rate.** High rates create a sense of interruption;
combined with difficult fights they turn a dungeon into a slog where intense
focus yields minimal progress. The stated corrective: **encounters should be set
to roughly the minimum needed to reach the next XP threshold or boss**, and maps
must make the *sequence* of encounters vary or the same fights become tedious.

**XP curves** are typically **exponential**: a steep curve makes each level feel
momentous and slows pacing; a shallow one accelerates it. The curve *is* the
pacing dial.

### 5.7 Story delivery

Story is delivered almost entirely through **NPC dialogue, a small number of
scripted set-pieces, and item/location flavour**. There is no cinematics budget.
DQ3's structure — a stated goal, a world, and a late reframing — carries an
entire game on very little text.

## 6. The math, concretely

Real FF1 (NES) numbers, because the shape matters more than the specific
constants:

**Damage.** Each hit deals a **random value between 1× and 2× the attacker's
Damage score**, minus the target's **Absorb**, with a **minimum of 1**.

**Critical hits** add the attacker's *original* damage as bonus, and **that bonus
ignores Absorb**.

**Accuracy.** Base Chance to Hit = **168**, modified **−40 if the attacker is
blind, +40 if the target is blind**. Chance to Hit = **(BC + H) − E**. The roll is
**0–200**; the hit lands if the roll is **≤** Chance to Hit.

**Critical rate.** Standard crit rate = the **weapon's index number**. Unarmed
Black Belt/Master = **Level × 2**. Unarmed anyone else = **0**. A hit roll of
**0 is always a critical**, and because three entries in the RNG table produce 0,
the floor is **≥3/256**.

**Evasion** = **48 + Agility − armour weight.**

**Extra attacks** = one per **32 points of Hit%**.

**A famous bug worth internalising:** the NES version **clamps Base Chance to Hit
and Hit% at 255 *before* Evasion is subtracted** — so past a threshold, stacking
accuracy stops working, silently. Nobody noticed for years.

**Four things to take from this section:**

1. Every formula is **two or three terms**. There is no simulation.
2. **Randomness is bounded and legible** — a 1×–2× damage roll is transparent to
   a player in a way a normal distribution is not.
3. **A minimum of 1** damage is a deliberate anti-softlock guarantee.
4. **The overflow bug is exactly the class of defect a checker catches and
   playtesting does not.** An invariant like "accuracy is monotonic in Hit%
   across the full stat range" would have caught it in one pass.

## 7. Content architecture — how the data was really laid out

Everything is **tables**. Monsters, items, spells, shops, encounters, growth,
maps — rows of fixed-width fields, indexed by ID, referenced by index from
everywhere else.

Two consequences worth stealing:

- **Content is addressed by integer ID, not by name.** Renaming is free;
  reordering is catastrophic. (Our version: **IDs allocated by code**.)
- **Cross-references are indices into sibling tables.** A monster's drop is an
  item index; a shop's stock is a list of item indices. **A dangling index is a
  crash, so the format itself demanded referential integrity.** We get that only
  if we build the link-checker.

## 8. Constraints, and what they taught

**NES.** The best licensed mappers topped out around **1MB of code/data, 1MB of
graphics tiles, 64KB extra RAM**. Notably, **RPGs frequently used tile *RAM*
rather than tile ROM** — specifically because it gave them **freedom over which
enemies could appear together in a battle**. A full upper- and lower-case letter
set plus menu borders already consumes **96 tiles**.

**SNES.** **32 sprites per scanline**, and only **34 8×8 tiles' worth** per
scanline regardless of sprite size. **16 colours per sprite**, **8 palette
slots**. **64KB of VRAM** for all tiles, maps and sprite tables. Every VRAM write
costs CPU cycles and **must happen during vertical blank**. FF6 used **dynamic
tile loading** to fake landscapes larger than memory.

**What the constraints produced** — and this is the part that transfers:

> Severe technical limits **forced developers to focus on what mattered and
> create dense, meaningful experiences rather than filling games with
> unnecessary content.**

We have no such limits. **Therefore we must impose the discipline deliberately**,
because the thing that made these games good was not the hardware — it was that
the hardware made padding impossible. An AI fleet's natural failure mode is
*exactly* padding: more monsters, more items, more rooms, none of it denser.

**A budget is a design tool, not an apology.** We should adopt one.

## 9. Audio

**NES 2A03**: about **three melodic channels plus a noise channel**. Melody had
to carry everything; memorability was not a stylistic choice.

**SNES SPC700**: **sampled instruments, stereo, more channels** — the leap that
made Uematsu's and Sugiyama's later work possible.

**Sugiyama's DQ1 set is a usable spec for the minimum emotional palette:** title,
castle, town, field/overworld, dungeon, battle, final battle, ending. **Eight
cues covers an entire world.** That is a far smaller ask than "sound design for
an RPG" implies, and it is a natural fit for a generator with a small authored
exception list.

## 10. Art and readability

Toriyama being a *manga* artist rather than a game artist is why DQ's characters
read at 16×16. The constraint set — **16 colours per sprite, 8 palettes, a
scanline budget** — forces silhouette-first design: a monster must be
identifiable by shape before colour.

**Readability is the actual art requirement**, and it is checkable: distinct
silhouette, distinct palette slot, legible at native size. Not a matter of taste.

## 11. Etymology and naming

**Final Fantasy.** The persistent myth is that it was Square's last game before
bankruptcy. **Sakaguchi has said this is not the origin.** The real inspirations
were **Dragon Quest** — specifically its abbreviation-friendly name — and the
**Fighting Fantasy** gamebooks. The team wanted a title that shortened cleanly in
the Roman alphabet to two letters. **"FF" came first; "Final Fantasy" was chosen
to fit it**, after "Fighting Fantasy" proved unusable on trademark grounds.

**The transferable point is real:** *the abbreviation was a design constraint on
the name.* "Chariots of Atlantis" → **CoA**. Worth deciding deliberately whether
that's the shorthand, because it will end up in file names, IDs, prefixes and
the vocabulary lock either way.

**Dragon Quest** was named to sound like an adventure a Japanese console audience
would recognise as approachable — consistent with Horii's entire "accessibility"
thesis.

## 12. What actually made them good

Stripped of nostalgia, six properties do the work:

1. **Legibility.** Every number a player needs is small and visible. Damage is
   1×–2×. You can *feel* the arithmetic.
2. **Density under constraint.** Nothing is filler because filler was
   unaffordable.
3. **A small verb set with deep interaction.** Five actions; enormous state space
   via status × element × targeting × resource.
4. **Costly, legible choices.** DQ3's class change is one rule and three numbers,
   and it defines a whole metagame.
5. **Gated traversal as pacing.** The world opens in tiers; each vehicle is a
   chapter break.
6. **A compiled frame.** Story outline, art bible and world fixed *first*, so
   thirty people executing in parallel stayed coherent.

And two failure modes the era documents clearly:

- **Lazy maps + high encounter rate = the genre's signature slog.**
- **Silent numeric overflow** (FF1's accuracy clamp) — invisible to playtesting,
  trivial for an invariant.

## 13. EXTRACTION — what this means for Chariots of Atlantis

This is the part that feeds the walls.

**13.1 The systems are small. Budget them like it.**
A faithful FF1-class engine is a few thousand lines. If our systems code sprawls
past that, we have misidentified content as code. **Adopt an explicit budget** —
a NES-style constraint, self-imposed, because the constraint is what produced the
quality.

**13.2 The design lives in tables and curves — which is why generation should be
minimal and code maximal.** Growth tables, damage terms, XP curve, price curve,
encounter weights. All computed from a compact spec. Models supply *intent and
names*; code supplies the corpus.

**13.3 Ito's two-sided balance invariant is our headline wall.**
He found it by playing. We check it by bot:
- **no composition is degenerate** (nothing trivialises the game), and
- **every reasonable composition can finish** (the all-Monk test).
This is *exactly* what "endless battles" as rung 1 is for. It is not a demo —
it's the rig that proves the invariant.

**13.4 Anti-softlock guarantees are explicit, not emergent.**
FF1's "minimum 1 damage" is a hard floor deliberately placed. Ours: every fight
winnable by an on-level party, every dungeon reachable-and-exitable, no resource
state that can't recover. Deterministic, all of them.

**13.5 Monotonicity invariants catch the bugs playtesting can't.**
The FF1 accuracy clamp is the canonical example. Assert: accuracy monotonic in
Hit% across the full range; damage monotonic in Attack; XP thresholds strictly
increasing; no stat overflow at max level. These are cheap and catch the exact
defect class that survived for decades in a shipped classic.

**13.6 Referential integrity is a hard gate.**
The ROM format enforced it by crashing. JSON won't. Every drop, shop entry,
spell list, map exit and key-item gate must resolve. That's the link-checker.

**13.7 Encounter rate is a tuned number, not a constant.**
Target: roughly the minimum encounters needed to reach the next XP threshold or
boss. Make it a **derived value with a checker**, not a magic constant a model
picks.

**13.8 The audio ask is eight cues.**
Title, castle/keep, town, field, dungeon, battle, final battle, ending. That is a
tractable multimodal task, not an open-ended one.

**13.9 Art requirement is readability, and it's checkable.**
Distinct silhouette, distinct palette, legible at native size. Not taste.

**13.10 The org chart is already documented — copy it.**
`intent-holder → specialist finaliser → parallel execution tracks`, with a
**compiled frame** (world bible, art bible, schemas) fixed *before* parallel work
begins. Horii→Nakamura is our Fable→Opus interface. Chrono Trigger's
outline→Kato→three directors is our production graph. **Consistency came from
the frame, not from bandwidth** — which is a useful corrective to my own instinct
that the missing comms layer is the top priority. It's important, but the frame
matters more.

**13.11 Decide the abbreviation now.** `CoA` will end up in IDs, file prefixes,
and the vocabulary lock whether we choose it or not. FF's team chose the
abbreviation *first*.

---

## Sources

- [Final Fantasy — Game Mechanics Guide (AstralEsper, GameFAQs)](https://gamefaqs.gamespot.com/nes/522595-final-fantasy/faqs/57009)
- [Game Systems — Final Fantasy (NES), gamercorner guides](https://guides.gamercorner.net/ff/walkthrough/game-systems)
- [Critical hit — Final Fantasy Wiki](https://finalfantasy.fandom.com/wiki/Critical_hit)
- [Game Resources / NES / Final Fantasy 1 — TASVideos](https://tasvideos.org/GameResources/NES/FinalFantasy1)
- [Dragon Quest (video game) — Wikipedia](https://en.wikipedia.org/wiki/Dragon_Quest_(video_game))
- [Dragon Quest III — Wikipedia](https://en.wikipedia.org/wiki/Dragon_Quest_III)
- [Dragon Quest III — 1989 Developer Interview (shmuplations)](https://shmuplations.com/dragonquestiii/)
- [Koichi Nakamura — Wikipedia](https://en.wikipedia.org/wiki/Koichi_Nakamura)
- [Horii on "warmth" and "accessibility" — GamesRadar+](https://www.gamesradar.com/games/jrpg/bless-him-dragon-quest-creator-yuji-horii-says-warmth-and-accessibility-are-key-to-the-almost-40-year-old-jrpg-series-enduring-success/)
- [The History of Dragon Quest III — JRPG.ca](https://jrpg.ca/history/the-history-of-dragon-quest-iii/)
- [Hironobu Sakaguchi — Wikipedia](https://en.wikipedia.org/wiki/Hironobu_Sakaguchi)
- [Final Fantasy name origins — Den of Geek](https://www.denofgeek.com/games/final-fantasy-name-origins-urban-legen-explained/)
- [Final Fantasy creator busts the name myth — GamesRadar+](https://www.gamesradar.com/final-fantasy-creator-myth-busts-the-origin-of-the-series-name/)
- [Hiroyuki Ito — Wikipedia](https://en.wikipedia.org/wiki/Hiroyuki_Ito)
- [Hiroyuki Ito — Final Fantasy Wiki](https://finalfantasy.fandom.com/wiki/Hiroyuki_Ito)
- [Active Time Battle — Final Fantasy Wiki](https://finalfantasy.fandom.com/wiki/Active_Time_Battle)
- [Chrono Trigger — Wikipedia](https://en.wikipedia.org/wiki/Chrono_Trigger)
- [Chrono Trigger — 1995 Developer Interviews (shmuplations)](https://shmuplations.com/chronotrigger2/)
- [Final Fantasy VI — 1994 Developer Interview (shmuplations)](https://shmuplations.com/ff6/)
- [Final Fantasy VI — Wikipedia](https://en.wikipedia.org/wiki/Final_Fantasy_VI)
- [Wizardry (Series Introduction) — Hardcore Gaming 101](https://www.hardcoregaming101.net/wizardry-series-introduction/)
- [The Unlikely Origin Story of JRPGs — Game Developer](https://www.gamedeveloper.com/design/the-unlikely-origin-story-of-jrpgs)
- [Limitations — NESdev Wiki](https://www.nesdev.org/wiki/Limitations)
- [Sprites — SNESdev Wiki](https://snes.nesdev.org/wiki/Sprites)
- [SNES Sprite Engine Design Guidelines — Mega Cat Studios](https://megacatstudios.com/blogs/retro-development/snes-sprite-engine-design-guidelines)
- [Advanced SNES Programming Techniques — Revolution Arena](https://revolutionarena.com/english/advanced-super-nintendo-snes-programming-techniques-how-developers-overcame-hardware-limitations/)
- [Map Design and Random Encounters in Retro RPGs — Pixel Bubble](https://pixelbubbleblog.wordpress.com/2013/01/21/map-design-and-random-encounters-in-retro-rpgs/)
- [Pacing and Level Design in JRPGs — Aevee Bee](https://medium.com/@MammonMachine/nobody-cares-about-it-but-it-s-the-only-thing-that-matters-pacing-and-level-design-3ed043dc3309)
- [RPG System Design: Experience, Levels & Stat Curves — Grasp](https://paths.grasp.study/public-courses/cbd93ffc-1946-433a-bd46-0d9489cdaa7c/modules/edf7d6da-d14c-48bc-9f76-ba97e6a2d654/lessons/b92d0265-1035-4015-b800-421826f8ca4e)
- [Random encounters, less is more — Matthew Marchitto](https://matthewmarchitto.substack.com/p/random-encounters-less-is-more)
- [Koichi Sugiyama — Video Game Music Preservation Foundation](https://www.vgmpf.com/Wiki/index.php/Koichi_Sugiyama)
- [Nobuo Uematsu — Wikipedia](https://en.wikipedia.org/wiki/Nobuo_Uematsu)
- [The Evolution of 8-Bit to Orchestral Game Music — Film Music Theory](https://filmmusictheory.com/article/the-evolution-of-8-bit-to-orchestral-game-music/)
