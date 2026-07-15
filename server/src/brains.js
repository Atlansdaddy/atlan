import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// "Brains" = chat-only engines (no tools, no files) behind ONE OpenAI-compat
// adapter — base-URL swap per provider. Claude Code stays the only agent
// with hands until M4 wires Codex/Gemini CLIs.
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
};

// Keys: env wins, /root/atlan/keys.json (gitignored) as fallback.
function getKey(keyEnv) {
  if (!keyEnv) return null;
  if (process.env[keyEnv]) return process.env[keyEnv];
  try {
    const keys = JSON.parse(readFileSync(join(__dirname, '../../keys.json'), 'utf8'));
    return keys[keyEnv] ?? null;
  } catch { return null; }
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
    return send({ t: 'chat.err', msg: `${p.label} needs ${p.keyEnv} — add it to /root/atlan/keys.json or the environment.` });
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
