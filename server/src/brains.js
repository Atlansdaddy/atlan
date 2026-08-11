import { getStoredKey } from './keys.js';
import { attachImagesToHistory, buildImageParts, providerDoesVision, VISION_PROVIDERS } from './vision.js';
import { LOCAL_LLM_BASE } from './config.js';

// "Brains" = chat-only engines (no tools, no files) behind ONE OpenAI-compat
// adapter — base-URL swap per provider. Claude Code stays the only agent
// with hands are the CLI engines: Claude Code (Agent SDK, per-tool cards) plus
// Codex, Antigravity, Grok Build and Copilot (exec CLIs, full-auto).
// Every provider here speaks the OpenAI /chat/completions shape, so one adapter
// covers them all — new provider = one base-URL row. defaultModel is just a
// sensible starting point; users can type any model the provider offers in the
// model box. These are BRAINS (chat only, no tools/files) — the agent engines
// with hands (Claude Code / Codex / Gemini CLI) live elsewhere.
const PROVIDERS = {
  local: {
    label: 'llama-server (local, free)',
    base: `${LOCAL_LLM_BASE}/v1`,
    keyEnv: null,
    defaultModel: 'local',
  },
  gemini: {
    label: 'Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.6-flash',
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
    defaultModel: 'deepseek-v4-flash', // deepseek-chat/reasoner aliases retired 2026-07-24
  },
  kimi: {
    label: 'Kimi (Moonshot)',
    base: 'https://api.moonshot.ai/v1',
    keyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'kimi-k2.6',
  },
  grok: {
    label: 'xAI Grok',
    base: 'https://api.x.ai/v1',
    keyEnv: 'XAI_API_KEY',
    defaultModel: 'grok-4.5',
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
    defaultModel: 'command-a-03-2025',
  },
};

// Keys: env wins, encrypted store (Settings screen) as fallback.
function getKey(keyEnv) {
  if (!keyEnv) return null;
  return process.env[keyEnv] || getStoredKey(keyEnv);
}

// The OpenAI-compatible connection for a provider, so the tool-agent loop can
// drive ANY of them, not just the local server. base already ends in the right
// path; apiKey is null for the keyless local server. This is what makes a
// "chat" brain a coding assistant with hands — same adapter, plus tools.
export function providerConn(id) {
  const p = PROVIDERS[id];
  if (!p) return null;
  return { base: p.base, apiKey: getKey(p.keyEnv), model: p.defaultModel, label: p.label, keyEnv: p.keyEnv };
}

// Single source of truth for the natively-multimodal describe model.
// attachments.js imports this instead of hardcoding its own copy — the copy it
// used to keep (gemini-2.5-flash) was retired and missed by the stale-model
// sweep, which silently killed every audio/video attachment.
export const MULTIMODAL_MODEL = PROVIDERS.gemini.defaultModel;

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
    // The hint must name the port we actually PROBE. It read ':8080' while the
    // probe used LOCAL_LLM_BASE, so with ATLAN_LOCAL_LLM_BASE set the cockpit
    // told the operator to start a server on a port it was not looking at —
    // Doctor said :9099 and this said :8080, in the same session.
    roster.push({ id, label: p.label, model: p.defaultModel, ready, needs: id === 'local' ? `start llama-server on ${LOCAL_LLM_BASE}` : p.keyEnv });
  }
  return roster;
}

// ONE resolver for "the user picked an engine in the UI — which brain do I
// actually call?", shared by editorAi and gitAiCommitMsg. Both arrived with
// their own copy of this mapping, and a mapping that lives in two places is the
// same drift that let the editor's guard lose `.fleet` (see guards.js).
//
// The distinction that matters: #modelSel lists AGENTS (claude/codex/copilot —
// they have hands and run as CLIs) alongside BRAINS (PROVIDERS ids — chat-only,
// no filesystem). Only brains can answer a /chat/completions call, so an agent
// id must fall back to a ready brain rather than being passed to brainChat,
// which would reject it as `unknown engine: claude` — a silent no-op the user
// experiences as "the button does nothing".
//
// `fellBack` is returned rather than swallowed so callers can tell the user
// which brain actually ran; picking a model and silently getting a different
// one is exactly the kind of quiet lie the honest-readiness rule forbids.
export async function resolveBrain(engine, model, roster) {
  roster = roster || await engineRoster();
  const hit = engine ? roster.find((r) => r.id === engine) : null; // roster ids ARE PROVIDERS ids
  if (hit) return { provider: hit.id, model: model || hit.model, chosen: hit.label, fellBack: false };
  const ready = roster.find((r) => r.ready);
  if (!ready) throw new Error('No configured brain key found. Add a brain key (Gemini, OpenAI, …) in Doctor.');
  return { provider: ready.id, model: ready.model, chosen: ready.label, fellBack: true };
}

export async function brainChat({ provider, model, history, send, images = [] }) {
  const p = PROVIDERS[provider];
  if (!p) return send({ t: 'chat.err', msg: `unknown engine: ${provider}` });
  const key = getKey(p.keyEnv);
  if (p.keyEnv && !key) {
    return send({ t: 'chat.err', msg: `${p.label} needs a key — drop it in Doctor → Engine keys.` });
  }

  // ── multimodal ──────────────────────────────────────────────────────────
  // A brain has no filesystem, so an image has to travel as BYTES or not at
  // all. Before 2026-08-02 it travelled as a path the model could not open and
  // the turn silently proceeded text-only; the model then guessed at the
  // picture. Refusing loudly is the honest behaviour and the recoverable one.
  let messages = history;
  if (images.length) {
    if (!providerDoesVision(provider)) {
      const able = [...VISION_PROVIDERS].join(', ');
      return send({
        t: 'chat.err',
        msg: `${p.label} cannot receive images — it is a text-only brain here. Switch to one of: ${able}, or use an agent engine (it has a Read tool and can open the file).`,
      });
    }
    const { images: parts, errors } = buildImageParts(images.map((i) => i.path ?? i));
    if (errors.length) send({ t: 'chat.err', msg: `image(s) not attached — ${errors.join('; ')}` });
    if (!parts.length) {
      return send({ t: 'chat.err', msg: 'no attachable images — the turn was not sent (sending it text-only would hide the failure)' });
    }
    messages = attachImagesToHistory(history, parts);
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
        messages,
        stream: false,
        // qwen3.5/3.6 templates ignore llama-server's --reasoning-budget 0 and
        // will happily burn the whole token budget "thinking"; this kwarg is
        // the real off-switch. llama.cpp-only field — cloud providers reject
        // unknown params, so local only. Templates without the flag ignore it.
        ...(provider === 'local' ? { chat_template_kwargs: { enable_thinking: false } } : {}),
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
