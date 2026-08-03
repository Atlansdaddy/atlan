# Dogfood receipts — 2026-07-26T13:08:01.350Z

> **POINT-IN-TIME RECORD — raw dogfood table, regenerated per run.** Kept as evidence and annotated, never
> rewritten (see `DOC-STATUS-CONVENTION.md`). For current state read
> `ARCHITECTURE.md` and `SECURITY.md`.

Run: `RUN_DOGFOOD=1 node test/dogfood.mjs` against `http://127.0.0.1:4589`, cwd `/root/atlan`.
Engines ready at run time: codex, local, gemini, claude.

**Fixtures carry known ground truth** (`test/fixtures/`, regenerable):
- `mm-quadrants.png` — 512×512, TL=red TR=green BL=blue BR=yellow, exactly 7 white circles
- `mm-tone-440.wav` — 3 s mono 16 kHz, 440 Hz sine (A4)

**6 PASS of 8 checks.**

| Group | Check | Verdict | ms | Detail |
|---|---|---|--:|---|
| multi-model | llama-server (on-phone, free) | **WRONG** | 1448 | 120 |
| multi-model | Gemini | **PASS** | 1990 | 60 |
| multimodal | upload classified as image | **PASS** |  | kind=image |
| multimodal | image read · gemini | **FAIL** | 1902 | 0/4 colours, circles ✗ — I don't have tools or file access to view or open attached images. |
| multimodal | image read · claude | **PASS** | 13660 | 4/4 colours, circles ✓ — Top-left: red, top-right: green, bottom-left: blue, bottom-right: yell |
| multimodal | audio auto-described | **PASS** | 2649 | kind=audio note="[high-pitched beep]" |
| agent | repo read · claude | **PASS** | 8009 | 3 |
| agent | repo read · codex | **PASS** | 13793 | 3 |
