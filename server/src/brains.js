import { getStoredKey } from './keys.js';

// "Brains" = chat-only engines (no tools, no files) behind ONE OpenAI-compat
// adapter — base-URL swap per provider. Claude Code stays the only agent
// with hands until M4 wires Codex/Gemini CLIs.
// Every provider here speaks the OpenAI /chat/completions shape, so one adapter
// covers them all — new provider = one base-URL row. defaultModel is just a
// sensible starting point; users can type any model the provider offers in the
// model box. These are BRAINS (chat only, no tools/files) — the agent engines
// with hands (Claude Code / Codex / Gemini CLI) live elsewhere.
const PROVIDERS = {
  local: {
    label: 'llama-server (on-phone, free)',
    base: 'http://127.0.0.1:8080/v1',
    keyEnv: null,
    defaultModel: 'local',
  },
  gemini: {
    label: 'Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3-flash-preview',
  },
  openai: {
    label: 'OpenAI',
    base: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.6-luna',
  },
  deepseek: {
    label: 'DeepSeek',
    base: 'https://api.deepseek.com/v1',
    keyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
  },
  kimi: {
    label: 'Kimi (Moonshot)',
    base: 'https://api.moonshot.ai/v1',
    keyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'kimi-k2-0711-preview',
  },
  grok: {
    label: 'xAI Grok',
    base: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    defaultModel: 'grok-4',
  },
  mistral: {
    label: 'Mistral',
    base: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
  },
  groq: {
    label: 'Groq (fast inference)',
    base: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  together: {
    label: 'Together AI',
    base: 'https://api.together.xyz/v1',
    keyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  },
  openrouter: {
    label: 'OpenRouter (many models, 1 key)',
    base: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'openrouter/auto',
  },
  fireworks: {
    label: 'Fireworks AI',
    base: 'https://api.fireworks.ai/inference/v1',
    keyEnv: 'FIREWORKS_API_KEY',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
  },
  cohere: {
    label: 'Cohere',
    base: 'https://api.cohere.ai/compatibility/v1',
    keyEnv: 'COHERE_API_KEY',
    defaultModel: 'command-r-plus',
  },
};

// Keys: env wins, encrypted store (Settings screen) as fallback.
function getKey(keyEnv) {
  if (!keyEnv) return null;
  return process.env[keyEnv] || getStoredKey(keyEnv);
}

export async function engineRoster() {
  const roster = [];
  for (const [id, p] of Object.entries(PROVIDERS)) {
    let ready;
    if (id === 'local') {
      try {
        const r = await fetch(p.base.replace('/v1', '/health'), { signal: AbortSignal.timeout(1200) });
        ready = r.ok;
      } catch { ready = false; }
    } else {
      ready = !!getKey(p.keyEnv);
    }
    roster.push({ id, label: p.label, model: p.defaultModel, ready, needs: id === 'local' ? 'start llama-server :8080' : p.keyEnv });
  }
  return roster;
}

export async function brainChat({ provider, model, history, send }) {
  const p = PROVIDERS[provider];
  if (!p) return send({ t: 'chat.err', msg: `unknown engine: ${provider}` });
  const key = getKey(p.keyEnv);
  if (p.keyEnv && !key) {
    return send({ t: 'chat.err', msg: `${p.label} needs a key — drop it in Doctor → Engine keys.` });
  }
  try {
    const res = await fetch(`${p.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: model || p.defaultModel,
        messages: history,
        stream: false,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return send({ t: 'chat.err', msg: `${p.label} ${res.status}: ${body}` });
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content ?? '(empty reply)';
    const usage = json.usage ?? {};
    send({ t: 'chat.msg', role: 'brain', engine: p.label, text });
    send({ t: 'chat.result', subtype: 'success', cost: null, brain: provider, tokens: usage.total_tokens ?? null });
    return text;
  } catch (err) {
    send({ t: 'chat.err', msg: `${p.label}: ${String(err?.message ?? err)}` });
  }
}
