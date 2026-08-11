// keytest.js — prove a stored API key actually works, without spending anything.
//
// "Is my key set" (keyStatus) and "does my key WORK" are different questions,
// and only the second one saves you from discovering a typo'd or unbilled key
// the first time a real turn fails. Each provider is checked with its cheapest
// key-SCOPED GET — a models list or an account probe — so a green light means
// "this key authenticates", never "you just burned tokens". The key stays on
// the server; the client only ever names which env to test.
import { getStoredKey } from './keys.js';

const bearer = (k) => ({ Authorization: `Bearer ${k}` });

// env → (key) => { url, headers }. The request is a plain authenticated GET; a
// 200 means the key is good. Providers without a clean free probe are simply
// absent — the UI then offers no Test rather than a misleading one.
const CHECKS = {
  GEMINI_API_KEY: (k) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}` }),
  OPENAI_API_KEY: (k) => ({ url: 'https://api.openai.com/v1/models', headers: bearer(k) }),
  DEEPSEEK_API_KEY: (k) => ({ url: 'https://api.deepseek.com/models', headers: bearer(k) }),
  XAI_API_KEY: (k) => ({ url: 'https://api.x.ai/v1/models', headers: bearer(k) }),
  MISTRAL_API_KEY: (k) => ({ url: 'https://api.mistral.ai/v1/models', headers: bearer(k) }),
  MOONSHOT_API_KEY: (k) => ({ url: 'https://api.moonshot.ai/v1/models', headers: bearer(k) }),
  ANTHROPIC_API_KEY: (k) => ({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } }),
  GROQ_API_KEY: (k) => ({ url: 'https://api.groq.com/openai/v1/models', headers: bearer(k) }),
  TOGETHER_API_KEY: (k) => ({ url: 'https://api.together.xyz/v1/models', headers: bearer(k) }),
  OPENROUTER_API_KEY: (k) => ({ url: 'https://openrouter.ai/api/v1/key', headers: bearer(k) }), // /models is public; /key needs auth
  FIREWORKS_API_KEY: (k) => ({ url: 'https://api.fireworks.ai/inference/v1/models', headers: bearer(k) }),
  COHERE_API_KEY: (k) => ({ url: 'https://api.cohere.com/v1/models', headers: bearer(k) }),
  ELEVENLABS_API_KEY: (k) => ({ url: 'https://api.elevenlabs.io/v1/user', headers: { 'xi-api-key': k } }),
  DEEPGRAM_API_KEY: (k) => ({ url: 'https://api.deepgram.com/v1/projects', headers: { Authorization: `Token ${k}` } }),
};

/** True when this provider has a verifier — the UI shows Test only for these. */
export function testable(env) { return Object.prototype.hasOwnProperty.call(CHECKS, env); }

/**
 * Test one key. Returns {ok, detail}: ok:true valid, ok:false rejected/no key,
 * ok:null no verifier for this provider. Never returns or logs the key.
 */
export async function testKey(env) {
  if (!testable(env)) return { ok: null, detail: 'no automatic test for this provider' };
  const key = process.env[env] || getStoredKey(env);
  if (!key) return { ok: false, detail: 'no key set' };
  const { url, headers } = CHECKS[env](key);
  try {
    const r = await fetch(url, { headers: headers ?? {}, signal: AbortSignal.timeout(12000) });
    if (r.ok) return { ok: true, detail: 'key valid' };
    // Authenticated but throttled still proves the key works.
    if (r.status === 429) return { ok: true, detail: 'key valid (rate-limited right now)' };
    if (r.status === 401 || r.status === 403) return { ok: false, detail: `rejected (${r.status}) — key invalid or lacks access` };
    return { ok: false, detail: `unexpected ${r.status} from provider` };
  } catch (e) {
    return { ok: false, detail: `could not reach provider — ${String(e?.message ?? e).slice(0, 80)}` };
  }
}
