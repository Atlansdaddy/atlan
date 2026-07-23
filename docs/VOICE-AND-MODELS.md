# Voice & AI-model providers — the honest spread

Atlan's rule everywhere: **offer wide, never lie about what's usable.** Every provider below is optional. The app is fully functional with zero keys — keys just unlock more models and nicer voices. Each one greys out in the UI until its key(s) are present, and each carries honest metadata (cost, latency, capability) so nobody gets surprised.

All keys live in **Settings → Engine keys**, encrypted at rest (AES-256-GCM). Every row has a **"how to get ↗"** link to the provider's key page. `env` vars win over the stored key if both are set.

---

## AI models (chat "brains") — `server/src/brains.js`

One OpenAI-compatible adapter (`POST /chat/completions`) covers all of them; a new provider is a single base-URL row. These are **chat only — no tools, no file access** (the agent engines with hands are Claude Code, Codex, and Gemini CLI, wired separately). `defaultModel` is a starting point only — type any model the provider offers in the model box.

| Provider | id | Key | Default model | Notes |
|---|---|---|---|---|
| llama-server (local) | `local` | — | `local` | Free, on-device, offline. Needs `llama-server` on :8080. |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | `gemini-3-flash-preview` | Free tier. |
| OpenAI | `openai` | `OPENAI_API_KEY` | `gpt-5.6-luna` | Same key powers OpenAI TTS. |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` | Cheap. |
| Kimi (Moonshot) | `kimi` | `MOONSHOT_API_KEY` | `kimi-k2-0711-preview` | Long context. |
| xAI Grok | `grok` | `XAI_API_KEY` | `grok-4` | |
| Mistral | `mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` | |
| Groq | `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | Very fast inference; free tier. |
| Together AI | `together` | `TOGETHER_API_KEY` | `Llama-3.3-70B-Instruct-Turbo` | Many open models. |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `openrouter/auto` | One key, hundreds of models. |
| Fireworks AI | `fireworks` | `FIREWORKS_API_KEY` | `llama-v3p3-70b-instruct` | Fast open-model hosting. |
| Cohere | `cohere` | `COHERE_API_KEY` | `command-r-plus` | Via OpenAI-compat endpoint. |

Adding a provider: add a `{ label, base, keyEnv, defaultModel }` row to `PROVIDERS` in `brains.js`, add the env var to `KEY_WHITELIST` in `keys.js`, and (optionally) a label + `KEY_HELP` link in `app.js`. It then appears in the switcher automatically.

---

## Voice output (TTS) — `server/src/voice.js`

The picker in **Settings → Voice** shows each provider's **cost, latency, and SSML support**, and disables any whose key isn't set. Mood (calm / proud / alarmed / building) maps to light prosody — real SSML for engines that honor it, a plain-text tone instruction for those that don't.

| Provider | id | Tier | Key(s) | SSML | Notes |
|---|---|---|---|---|---|
| Browser voice | `browser` | free | — | no | Client-side Web Speech; offline; quality varies by device. Default. |
| Piper | `piper` | free | `PIPER_MODEL` (+ `piper` binary) | yes | Local, private, offline. `pip install piper-tts` + a `.onnx` voice. |
| ElevenLabs | `elevenlabs` | BYOK | `ELEVENLABS_API_KEY` | no | Best natural voices + cloning. `ELEVENLABS_VOICE` for a specific voice. |
| Cartesia Sonic | `cartesia` | BYOK | `CARTESIA_API_KEY` | no | Real-time, emotive. `CARTESIA_VOICE` / `CARTESIA_MODEL` / `CARTESIA_VERSION`. |
| Deepgram Aura-2 | `deepgram` | BYOK | `DEEPGRAM_API_KEY` | no | Voice-agent grade, ~90ms. `DEEPGRAM_VOICE` for a model. |
| OpenAI TTS | `openai` | BYOK | `OPENAI_API_KEY` | no | `gpt-4o-mini-tts`, steerable tone. |
| Google Cloud TTS | `google` | BYOK | `GOOGLE_TTS_API_KEY` | yes | Huge voice/language range. API-key-enabled key. |
| Azure Speech | `azure` | BYOK | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` | yes | Neural voices, full SSML. `AZURE_VOICE` to pick. |
| Amazon Polly | `polly` | BYOK | `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (+`AWS_REGION`) | yes | Cheapest neural TTS. **SigV4-signed** — no simple API key exists for Polly. `AWS_VOICE` to pick. |
| OpenAI Realtime | `openai-realtime` | roadmap | — | — | **Not wired.** Full-duplex voice-to-voice over WebSocket is a different pipe than one-shot TTS; shown as roadmap, never pretended to work. |

### Voice input (STT / "hearing you")
Currently the **browser Web Speech API** (client-side, free, push-to-talk 🎤). Server-side STT (Deepgram / OpenAI Whisper for higher accuracy and non-Chrome browsers) is a natural next add — the key slots (`DEEPGRAM_API_KEY`, `OPENAI_API_KEY`) already exist; the upload+transcribe path is not built yet. Documented here so the gap is honest.

### Why Polly needs more than a key
AWS has no "simple API key" for Polly. Requests must be signed with **AWS Signature V4** using an access-key/secret pair. `voice.js` implements a minimal SigV4 signer (POST + JSON body) for `SynthesizeSpeech`. Give the IAM user only `AmazonPollyReadOnly`.

---

## Endpoints
- `GET /api/voice/roster` → `[{id,label,tier,cost,latency,ssml,note,ready}]`
- `POST /api/voice/tts` `{text, provider, voice?, mood?}` → `{mime, data(base64)}`
- `GET /api/engines` → agent engines + all chat brains (with `ready` + `needs`)

Both rosters compute `ready` live from key presence (and, for local/piper, a real probe), so the UI is always truthful about what will actually work right now.
