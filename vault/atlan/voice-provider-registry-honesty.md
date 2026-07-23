---
title: voice-provider-registry-honesty
scope: atlan/voice
tags: [voice, tts, providers, byok, honesty, sigv4, ssml]
confidence: verified
source: voice turn 2026-07-22 (John: "wide spread… honesty about what they can and can't do")
updated: 2026-07-22
---
**Pattern that worked:** one TTS registry (`server/src/voice.js`) where every provider carries honest `caps` — `{tier, cost, latency, ssml, note, ready}` — and `ready` is computed live from key presence (or a real probe for local/piper). The picker **greys out anything not usable** and never claims a voice you can't run. Same shape for AI models in `brains.js` (`ready` + `needs`).

**Providers (9 TTS + 1 roadmap):** browser + Piper (free) · ElevenLabs, Cartesia, Deepgram, OpenAI, Google, Azure, Amazon Polly (BYOK) · OpenAI-Realtime = **roadmap, `ready:false`** (full-duplex WebSocket ≠ one-shot TTS — labeled, not faked). AI brains widened 4→12 (added Kimi, Grok, Mistral, Groq, Together, OpenRouter, Fireworks, Cohere — all OpenAI-compat, one base-URL row each).

**Two gotchas worth remembering:**
- **Amazon Polly has no simple API key** — requests need **AWS SigV4** signing (access key + secret). Implemented a minimal SigV4 (POST+JSON) rather than drop the cheapest provider or fake a key field.
- **SSML must be XML-escaped** before wrapping, or reply text can break/inject the envelope. See [[dont-grep-command-output-for-presence]] (same turn's escape-hatch note).

**Result:** 15-test voice suite (`test/voice.mjs`) green; full suite 171/0 across 11 suites. "How to get ↗" setup links per key row. Adding a provider = one registry/PROVIDERS row + a `KEY_WHITELIST` entry + optional label/help link.

**Honest gaps (documented, not shipped):** server-side STT (Deepgram/Whisper) — key slots exist, upload path doesn't. "Hey Atlan" wake-word deferred (push-to-talk shipped).
