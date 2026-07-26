// src/lib/ai.js
import { log } from './logger.js';
// Bring-Your-Own-Key (BYOK) AI integration for the "Explain & Verify" per-finding action.
//
// Privacy contract:
// - The user's API key is read from localStorage and sent ONLY to the provider's endpoint.
// - The audit-app origin never sees the key. There is no proxy. There is no server in the loop.
// - No telemetry / analytics call records the key or the response body.
// - Per-finding responses are cached in-memory for the session (not persisted) so re-clicking
//   doesn't re-spend tokens.
//
// Supported providers as of 2026-05-12 (model lists per each provider's official docs):
//   openai      — native Chat Completions, GPT-5.5 family + earlier
//   anthropic   — native Messages API, Claude 4 family
//   xai         — OpenAI-compatible, Grok 4 family
//   mistral     — OpenAI-compatible, Mistral Large / Codestral / Pixtral
//   deepseek    — OpenAI-compatible, deepseek-chat (V3+) / deepseek-reasoner (R1+)
//   groq        — OpenAI-compatible, fast inference for Llama / Qwen / Mixtral / DeepSeek
//   openrouter  — OpenAI-compatible aggregator, 300+ models across providers
//   cohere      — OpenAI-compatible shim at /compatibility/v1, Command R family
//   google      — OpenAI-compatible shim, Gemini 3 family (known CORS issues from browser)
//
// CORS-from-browser availability per provider:
//   - openai, anthropic (with header), xai, mistral, deepseek, groq, openrouter, cohere: works direct
//   - google: known CORS issues with direct-browser calls per Google's own forum threads
//
// Dispatch model: AI_PROVIDERS[name].format selects which call function handles the request.
// 'anthropic' uses callAnthropic (native shape). 'openai-compat' uses callOpenAICompat (shared
// across all OpenAI-compatible providers — same /v1/chat/completions body shape, same SSE stream
// shape, only the endpoint URL and auth header pattern differ).

const STORAGE_KEY = 'audit-app:ai-config:v1';

export const AI_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    format: 'openai-compat',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    // Per https://developers.openai.com/api/docs/models — GPT-5.5 is the flagship as of
    // April 2026; GPT-5.5 Pro for hardest reasoning; gpt-5.4-mini/nano for cost.
    models: [
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.2',
      'gpt-5',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4o',
      'gpt-4o-mini',
    ],
    defaultModel: 'gpt-5.4-mini',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-... or sk-proj-...',
    // Accept classic sk- and modern sk-proj-; reject sk-ant- (Anthropic) and sk-or- (OpenRouter).
    keyPattern: /^sk-(?:proj-)?(?!ant-|or-)[A-Za-z0-9_\-]{20,}$/,
    cors: true,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    format: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    defaultModel: 'claude-haiku-4-5',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    keyPattern: /^sk-ant-[A-Za-z0-9_\-]{20,}$/,
    cors: 'with-header',
  },
  xai: {
    label: 'xAI (Grok)',
    format: 'openai-compat',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    // Per https://docs.x.ai/developers/models — Grok 4.3 is the current recommendation.
    // Older models (grok-4, grok-4-fast, grok-4-1-fast, grok-code-fast-1) retire May 15, 2026.
    models: ['grok-4-3', 'grok-4-2', 'grok-code-4-3'],
    defaultModel: 'grok-4-3',
    docsUrl: 'https://console.x.ai/',
    keyPlaceholder: 'xai-...',
    keyPattern: /^xai-[A-Za-z0-9_\-]{20,}$/,
    cors: true,
  },
  mistral: {
    label: 'Mistral',
    format: 'openai-compat',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: [
      'mistral-large-latest',
      'mistral-medium-latest',
      'mistral-small-latest',
      'codestral-latest',
      'pixtral-large-latest',
      'ministral-8b-latest',
    ],
    defaultModel: 'mistral-large-latest',
    docsUrl: 'https://console.mistral.ai/',
    keyPlaceholder: '32+ alphanumeric chars',
    keyPattern: /^[A-Za-z0-9_\-]{20,}$/,
    cors: true,
  },
  deepseek: {
    label: 'DeepSeek',
    format: 'openai-compat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    // deepseek-chat = V3+ (general), deepseek-reasoner = R1+ (chain-of-thought).
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-...',
    keyPattern: /^sk-[A-Za-z0-9]{20,}$/,
    cors: true,
  },
  groq: {
    label: 'Groq',
    format: 'openai-compat',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    // Groq hosts open-weight models with sub-second TTFT.
    // See https://console.groq.com/docs/models for the live list.
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'deepseek-r1-distill-llama-70b',
      'qwen-2.5-72b',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_...',
    keyPattern: /^gsk_[A-Za-z0-9]{20,}$/,
    cors: true,
  },
  openrouter: {
    label: 'OpenRouter',
    format: 'openai-compat',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    // OpenRouter is an aggregator; model identifiers carry the provider prefix
    // (provider/model-name). Defaults to a Claude-family model since that's what most users
    // come to OpenRouter to access without an Anthropic account.
    models: [
      'anthropic/claude-opus-4',
      'anthropic/claude-sonnet-4',
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
      'google/gemini-3-pro-preview',
      'meta-llama/llama-3.3-70b-instruct',
      'mistralai/mistral-large-latest',
      'x-ai/grok-4-3',
      'deepseek/deepseek-chat',
    ],
    defaultModel: 'anthropic/claude-sonnet-4',
    docsUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-...',
    keyPattern: /^sk-or-[A-Za-z0-9_\-]{20,}$/,
    cors: true,
  },
  cohere: {
    label: 'Cohere',
    format: 'openai-compat',
    // Cohere ships an OpenAI-compatible shim at /compatibility/v1.
    endpoint: 'https://api.cohere.ai/compatibility/v1/chat/completions',
    models: ['command-a-2025', 'command-r-plus-2024', 'command-r-2024', 'command-r7b-2024'],
    defaultModel: 'command-a-2025',
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    keyPlaceholder: '40+ alphanumeric chars',
    keyPattern: /^[A-Za-z0-9_\-]{30,}$/,
    cors: true,
  },
  google: {
    label: 'Google (Gemini)',
    format: 'openai-compat',
    // Google ships an OpenAI-compatible shim at /v1beta/openai. Note the known CORS
    // issues with direct browser calls (the docs themselves acknowledge this) — keys
    // may work intermittently or require a proxy depending on the user's environment.
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    // Per https://ai.google.dev/gemini-api/docs/models — Gemini 3.1 Pro Preview replaced
    // Gemini 3 Pro after the latter's March 9, 2026 shutdown. Gemini 2.0 Flash retires June 1.
    models: ['gemini-3.1-pro-preview', 'gemini-3.1-flash', 'gemini-3.1-flash-lite', 'gemini-3-pro'],
    defaultModel: 'gemini-3.1-flash-lite',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    keyPlaceholder: 'AIza...',
    keyPattern: /^AIza[A-Za-z0-9_\-]{30,}$/,
    cors: 'known-issues',
    corsNote:
      'Google docs acknowledge CORS issues with direct browser calls to the Gemini API. The key may work or may fail depending on your network and the specific endpoint behavior of the day.',
  },
};

export function loadAIConfig() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.provider || !parsed.apiKey) return null;
    if (!AI_PROVIDERS[parsed.provider]) return null;
    return {
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      model: parsed.model || AI_PROVIDERS[parsed.provider].defaultModel,
    };
  } catch {
    return null;
  }
}

export function saveAIConfig({ provider, apiKey, model }) {
  if (!AI_PROVIDERS[provider]) throw new Error(`Unknown AI provider: ${provider}`);
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('API key is empty.');
  const cfg = {
    provider,
    apiKey: apiKey.trim(),
    model: model || AI_PROVIDERS[provider].defaultModel,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    throw new Error('Could not save AI config (localStorage may be disabled).');
  }
  return cfg;
}

export function clearAIConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    log.debug('ai: clearAIConfig localStorage.removeItem failed', { error: e?.message });
  }
}

export function hasAIConfig() {
  return loadAIConfig() !== null;
}

// Quick smoke-test: was the key shaped right?
export function validateKeyShape(provider, key) {
  const p = AI_PROVIDERS[provider];
  if (!p) return false;
  return p.keyPattern.test((key || '').trim());
}

// Build the prompt sent for Explain & Verify.
// Constraints:
// - Send ONLY the finding metadata + ±5-line code snippet. Never the rest of the codebase.
// - Two outputs requested: (1) plain-English explanation, (2) TP/FP verdict.
// - Ask for short, structured output to keep token cost low and rendering simple.
export function buildExplainVerifyMessages(finding) {
  const snippetText = finding.snippet?.lines
    ? finding.snippet.lines
        .map((l) => `${String(l.n).padStart(4)}${l.isHit ? '> ' : ': '}${l.text}`)
        .join('\n')
    : '(no code snippet attached)';

  const system =
    `You are a senior application-security reviewer triaging a finding from a static security scanner. ` +
    `You will be given the finding details + a small code snippet (±5 lines around the offending line). ` +
    `Respond in two parts ONLY:\n\n` +
    `(1) **Explain** — 2–4 sentences explaining what the finding means, why it matters, and what a beginner needs to know to make sense of it. Plain English, no jargon without unpacking it.\n\n` +
    `(2) **Verify** — Output exactly one of: "LIKELY TRUE POSITIVE", "LIKELY FALSE POSITIVE", or "INSUFFICIENT CONTEXT". Then 1–2 sentences justifying that verdict based on the snippet alone. If the snippet doesn't show enough context to decide, say so — do not invent context.\n\n` +
    `Do not propose fixes — the scanner already provides remediation text. Do not request more code. Keep the entire response under 200 words.`;

  const user =
    `Finding from PreFlight static scanner:\n\n` +
    `- Probe: ${finding.probe}\n` +
    `- Title: ${finding.title}\n` +
    `- Severity: ${finding.severity}\n` +
    `- Category: ${finding.category}\n` +
    `- CWE: ${finding.cwe}\n` +
    `- File: ${finding.file}${finding.line ? ':' + finding.line : ''}\n\n` +
    `Code snippet (hit line marked with \`>\`):\n\`\`\`\n${snippetText}\n\`\`\`\n\n` +
    `Evidence captured by the scanner: ${finding.evidence}`;

  return { system, user };
}

// Dispatch by provider format. All OpenAI-compatible providers share callOpenAICompat.
// Anthropic uses its native messages-API call function.
// Returns a Promise that resolves to the full text on success, throws on error.
export async function callAI({ provider, apiKey, model }, messages, onChunk, signal) {
  const cfg = AI_PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown AI provider: ${provider}`);
  if (cfg.format === 'anthropic') {
    return callAnthropic({ apiKey, model }, messages, onChunk, signal);
  }
  if (cfg.format === 'openai-compat') {
    return callOpenAICompat(
      { apiKey, model, endpoint: cfg.endpoint, label: cfg.label },
      messages,
      onChunk,
      signal
    );
  }
  throw new Error(`Provider format ${cfg.format} not implemented`);
}

// Shared call function for every OpenAI-compatible endpoint. The OpenAI Chat
// Completions API has become the de facto interop format — xAI, Mistral, DeepSeek,
// Groq, OpenRouter, Cohere (via /compatibility/v1), and Google (via /v1beta/openai)
// all accept the same request body and emit the same SSE stream shape. Only the
// endpoint URL, auth scheme (always Bearer for these providers), and model list
// differ. Anthropic does not use this shape; it has its own callAnthropic.
async function callOpenAICompat(
  { apiKey, model, endpoint, label },
  { system, user },
  onChunk,
  signal
) {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 600,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${label} API ${resp.status}: ${text.slice(0, 300)}`);
  }
  return readSSE(resp, onChunk, (data) => {
    try {
      const obj = JSON.parse(data);
      return obj?.choices?.[0]?.delta?.content || '';
    } catch {
      return '';
    }
  });
}

async function callAnthropic({ apiKey, model }, { system, user }, onChunk, signal) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      temperature: 0.2,
      system,
      stream: true,
      messages: [{ role: 'user', content: user }],
    }),
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Anthropic API ${resp.status}: ${text.slice(0, 300)}`);
  }
  return readSSE(resp, onChunk, (data) => {
    try {
      const obj = JSON.parse(data);
      // Anthropic streams content_block_delta events.
      if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
        return obj.delta.text || '';
      }
    } catch (e) {
      log.debug('ai: anthropic SSE parse failed', { error: e?.message });
    }
    return '';
  });
}

// Generic SSE reader: parses `data: ...` lines, calls extractText per data block,
// invokes onChunk with each incremental chunk, and accumulates the total.
async function readSSE(resp, onChunk, extractText) {
  if (!resp.body) throw new Error('Streaming response had no body');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let total = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return total;
      const chunk = extractText(data);
      if (chunk) {
        total += chunk;
        try {
          onChunk?.(chunk, total);
        } catch (e) {
          log.debug('ai: onChunk handler threw', { error: e?.message });
        }
      }
    }
  }
  return total;
}

// Convenience wrapper: run Explain & Verify on a finding, with a callback for streamed text.
// Returns a Promise resolving to the full text. Throws on network/auth/quota error.
export async function explainAndVerify(finding, onChunk, signal) {
  const cfg = loadAIConfig();
  if (!cfg) throw new Error('No AI provider configured. Open Settings to add a key.');
  const messages = buildExplainVerifyMessages(finding);
  return callAI(cfg, messages, onChunk, signal);
}
