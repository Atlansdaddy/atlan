// Voice + provider-spread suite. Proves the roster is honest (readiness tracks
// keys, never claims a voice/model you can't use), the TTS endpoint validates
// input and degrades cleanly, and the SSML/SigV4 internals are correct.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { voiceRoster, synthesize, _testInternals } from '../server/src/voice.js';
import { engineRoster } from '../server/src/brains.js';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const api = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('VOICE SUITE');

// ── roster is honest ──
await test('voiceRoster → every provider carries id/label/tier/ssml/ready/note', async () => {
  const list = await voiceRoster();
  assert.ok(list.length >= 9, `too few voices: ${list.length}`);
  for (const v of list) for (const k of ['id', 'label', 'tier', 'ssml', 'ready', 'note', 'cost', 'latency'])
    assert.ok(k in v, `voice ${v.id} missing ${k}`);
});
await test('browser voice is always ready and free', async () => {
  const b = (await voiceRoster()).find((v) => v.id === 'browser');
  assert.equal(b.ready, true); assert.equal(b.tier, 'free');
});
await test('every not-ready voice refuses with a helpful key error (never a silent fail)', async () => {
  // Robust to whatever keys happen to be set: the honesty guarantee is that a
  // voice marked not-ready won't half-work — it rejects, naming what it needs.
  const list = await voiceRoster();
  for (const v of list) {
    if (v.ready || v.id === 'browser' || v.id === 'openai-realtime') continue;
    await assert.rejects(() => synthesize({ text: 'test', provider: v.id }),
      /key|PIPER_MODEL|not installed|needs/i, `${v.id} did not refuse cleanly`);
  }
});
await test('OpenAI Realtime is present but honestly roadmap (never ready)', async () => {
  const rt = (await voiceRoster()).find((v) => v.id === 'openai-realtime');
  assert.ok(rt && rt.ready === false && /roadmap/i.test(rt.note));
});
await test('GET /api/voice/roster → same honest shape over HTTP', async () => {
  const { status, body } = await j(await api('/api/voice/roster'));
  assert.equal(status, 200);
  assert.ok(Array.isArray(body) && body.some((v) => v.id === 'browser' && v.ready));
});
await test('/api/voice/roster requires auth', async () => {
  const r = await fetch(BASE + '/api/voice/roster');
  assert.equal(r.status, 401);
});

// ── synthesize validates + degrades ──
await test('synthesize with empty text throws clearly', async () => {
  await assert.rejects(() => synthesize({ text: '   ', provider: 'browser' }), /nothing to speak/);
});
await test('unknown provider throws, never crashes', async () => {
  await assert.rejects(() => synthesize({ text: 'hi', provider: 'nope' }), /unknown or unavailable/);
});
await test('server voice provider without key → clean error, not 500 body', async () => {
  const { status, body } = await j(await api('/api/voice/tts', { method: 'POST', body: JSON.stringify({ text: 'hello', provider: 'elevenlabs' }) }));
  // endpoint returns a JSON error object with a helpful message
  assert.ok(body && typeof body.error === 'string' && /ELEVENLABS/i.test(body.error), `got status ${status} body ${JSON.stringify(body)}`);
});
await test('piper without a model errors helpfully (or is genuinely ready)', async () => {
  const p = (await voiceRoster()).find((v) => v.id === 'piper');
  if (!p.ready) await assert.rejects(() => synthesize({ text: 'hi', provider: 'piper' }), /piper/i);
});

// ── SSML safety: injected markup can't break the envelope ──
await test('ssmlWrap XML-escapes hostile input (no SSML injection)', async () => {
  const ssml = _testInternals.ssmlWrap('close </speak><evil>tag & "quote"', 'calm');
  assert.ok(!/<evil>/.test(ssml), 'raw <evil> leaked into SSML');
  assert.ok(ssml.includes('&lt;evil&gt;') && ssml.includes('&amp;'), 'entities not escaped');
  // the only real tags are our own envelope
  assert.ok(ssml.startsWith('<speak>') && ssml.trim().endsWith('</speak>'));
});
await test('ssmlWrap applies mood prosody', async () => {
  const alarmed = _testInternals.ssmlWrap('Go.', 'alarmed');
  assert.ok(/rate="105%"/.test(alarmed) && /pitch="\+2st"/.test(alarmed));
});

// ── SigV4 signer produces a well-formed Authorization (Polly) ──
await test('sigv4 emits a canonical AWS4-HMAC-SHA256 auth header', async () => {
  const h = _testInternals.sigv4('AKIDEXAMPLE', 'SECRET', 'us-east-1', 'polly', 'polly.us-east-1.amazonaws.com', 'POST', '/v1/speech', '{"x":1}', { 'content-type': 'application/json' });
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/polly\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.match(h['x-amz-date'], /^\d{8}T\d{6}Z$/);
});

// ── AI-model spread is wide + honest ──
await test('engineRoster → ≥10 brains incl. Kimi/Grok/Groq/OpenRouter', async () => {
  const r = await engineRoster();
  const ids = r.map((e) => e.id);
  for (const want of ['local', 'gemini', 'openai', 'deepseek', 'kimi', 'grok', 'mistral', 'groq', 'together', 'openrouter', 'fireworks', 'cohere'])
    assert.ok(ids.includes(want), `missing brain ${want}`);
});
await test('brains with no key report ready:false + what they need', async () => {
  const r = await engineRoster();
  const kimi = r.find((e) => e.id === 'kimi');
  assert.equal(kimi.ready, false);
  assert.equal(kimi.needs, 'MOONSHOT_API_KEY');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
