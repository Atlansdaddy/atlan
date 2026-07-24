import { execFile } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { getStoredKey } from './keys.js';

// Voice output (TTS) — a wide, honest, BYO-key provider spread. The browser's
// built-in voice is the free zero-install default (client-side). Everything
// below is optional and only offered when its key(s) are actually present, so
// the picker never lies about what's usable. STT ("hearing you") is the
// browser Web Speech API, client-side — see the roadmap note at the bottom for
// server-side STT (Deepgram/Whisper) which is not wired yet.
//
// Design rule (from the peer review): NEVER claim a capability that isn't there.
// Each provider carries honest `caps` — cost, latency, whether it does real
// SSML — so the UI can tell people exactly what they're getting.

function key(env) { return process.env[env] || getStoredKey(env); }

let piperReady = null;
async function hasPiper() {
  if (piperReady !== null) return piperReady;
  piperReady = await new Promise((res) => {
    execFile('piper', ['--version'], { timeout: 2000 }, (err) => res(!err));
  }).catch(() => false);
  return piperReady;
}
function piperModel() { return process.env.PIPER_MODEL || getStoredKey('PIPER_MODEL'); }

// ── provider catalog: metadata + readiness, single source of truth ──────────
// tier: 'free' | 'byok'   ssml: real SSML honored   note: what to know / how to enable
const CATALOG = [
  { id: 'browser', label: 'Browser voice', tier: 'free', cost: 'free', latency: 'instant', ssml: false,
    note: 'runs in your browser, no key, works offline — quality varies by device', ready: async () => true },
  { id: 'piper', label: 'Piper (local)', tier: 'free', cost: 'free', latency: 'fast (on-device)', ssml: true,
    note: 'prebuilt piper binary on PATH + set PIPER_MODEL to a .onnx voice (pip install piper-tts only builds on Python ≤3.12) — private, offline, real SSML',
    ready: async () => (await hasPiper()) && !!piperModel() },
  { id: 'elevenlabs', label: 'ElevenLabs', tier: 'byok', cost: '$$$ (~$100/M chars, HD)', latency: '~75ms', ssml: false,
    note: 'best-in-class natural voices + cloning; set ELEVENLABS_API_KEY', ready: async () => !!key('ELEVENLABS_API_KEY') },
  { id: 'cartesia', label: 'Cartesia Sonic', tier: 'byok', cost: '$$ (per char)', latency: '~90ms', ssml: false,
    note: 'real-time, emotive/laughter; set CARTESIA_API_KEY (voice via CARTESIA_VOICE id)', ready: async () => !!key('CARTESIA_API_KEY') },
  { id: 'deepgram', label: 'Deepgram Aura-2', tier: 'byok', cost: '$$ (per char)', latency: '~90ms', ssml: false,
    note: 'built for voice agents, very low latency; set DEEPGRAM_API_KEY', ready: async () => !!key('DEEPGRAM_API_KEY') },
  { id: 'openai', label: 'OpenAI TTS', tier: 'byok', cost: '$$ (per char)', latency: 'medium', ssml: false,
    note: 'gpt-4o-mini-tts with steerable tone (no SSML); set OPENAI_API_KEY', ready: async () => !!key('OPENAI_API_KEY') },
  { id: 'google', label: 'Google Cloud TTS', tier: 'byok', cost: '$ (~$4–16/M chars)', latency: 'medium', ssml: true,
    note: 'huge voice/language range, real SSML; set GOOGLE_TTS_API_KEY (API-key enabled)', ready: async () => !!key('GOOGLE_TTS_API_KEY') },
  { id: 'azure', label: 'Azure Speech', tier: 'byok', cost: '$ (~$15/M neural)', latency: 'medium', ssml: true,
    note: 'neural voices + full SSML; set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION',
    ready: async () => !!key('AZURE_SPEECH_KEY') && !!key('AZURE_SPEECH_REGION') },
  { id: 'polly', label: 'Amazon Polly', tier: 'byok', cost: '$ (cheapest, ~$4–16/M)', latency: 'medium', ssml: true,
    note: 'budget neural TTS; needs AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (+AWS_REGION) — SigV4 signed',
    ready: async () => !!key('AWS_ACCESS_KEY_ID') && !!key('AWS_SECRET_ACCESS_KEY') },
  // Roadmap — an honest placeholder so people can see it's coming, not pretend it works.
  { id: 'openai-realtime', label: 'OpenAI Realtime (voice-to-voice)', tier: 'byok', cost: '$$$', latency: 'conversational', ssml: false,
    note: 'ROADMAP — full-duplex streaming voice chat over WebSocket, a different pipe than one-shot TTS; not wired yet',
    ready: async () => false },
];

export async function voiceRoster() {
  return Promise.all(CATALOG.map(async (p) => ({
    id: p.id, label: p.label, tier: p.tier, cost: p.cost, latency: p.latency,
    ssml: p.ssml, note: p.note, ready: await p.ready(),
  })));
}

// Mood → light prosody so Atlan sounds like the orb looks. Real SSML for engines
// that honor it; a plain-text "instructions" tone for those that don't.
const TONE = {
  calm: { rate: '95%', pitch: '-1st', instr: 'calm, easy, unhurried' },
  proud: { rate: '100%', pitch: '+1st', instr: 'warm, a little pleased' },
  alarmed: { rate: '105%', pitch: '+2st', instr: 'alert, focused, a touch urgent' },
  building: { rate: '100%', pitch: '0st', instr: 'steady, working' },
};
function ssmlWrap(text, mood) {
  const t = TONE[mood] ?? TONE.calm;
  const body = xmlEscape(String(text)).replace(/([.!?])\s+/g, '$1<break time="220ms"/> ');
  return `<speak><prosody rate="${t.rate}" pitch="${t.pitch}">${body}</prosody></speak>`;
}
function xmlEscape(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

export async function synthesize({ text, provider = 'piper', voice, mood = 'calm' }) {
  const clean = String(text ?? '').slice(0, 4000).trim();
  if (!clean) throw new Error('nothing to speak');
  const fn = SYNTH[provider];
  if (!fn) throw new Error(`unknown or unavailable voice provider: ${provider}`);
  return fn(clean, mood, voice);
}

const SYNTH = {
  piper, openai, elevenlabs, google, azure, deepgram, cartesia, polly,
  browser() { throw new Error('browser voice plays client-side; no server call needed'); },
  'openai-realtime'() { throw new Error('OpenAI Realtime is roadmap — not wired yet; use openai (one-shot TTS) or another provider'); },
};

// ── Piper: local binary, SSML in → raw PCM/wav out (stdin/stdout) ──
async function piper(text, mood) {
  if (!(await hasPiper())) throw new Error('piper not installed (prebuilt piper binary on PATH + a .onnx voice model)');
  const model = piperModel();
  if (!model) throw new Error('set PIPER_MODEL to a .onnx voice path (Doctor → Keys)');
  const ssml = ssmlWrap(text, mood);
  const buf = await new Promise((resolve, reject) => {
    const p = execFile('piper', ['--model', model, '--output_raw'], { maxBuffer: 32 * 1024 * 1024, encoding: 'buffer' },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
    p.stdin.end(ssml);
  });
  return { mime: 'audio/wav', data: buf.toString('base64') };
}

// ── OpenAI TTS: plain text + steerable tone instructions ──
async function openai(text, mood, voice) {
  const k = key('OPENAI_API_KEY');
  if (!k) throw new Error('OpenAI TTS needs OPENAI_API_KEY (Doctor → Keys)');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voice || 'alloy', input: text, instructions: `Speak ${TONE[mood]?.instr ?? 'naturally'}.`, response_format: 'mp3' }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { mime: 'audio/mpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

// ── ElevenLabs: model handles prosody; plain text ──
async function elevenlabs(text, mood, voice) {
  const k = key('ELEVENLABS_API_KEY');
  if (!k) throw new Error('ElevenLabs needs ELEVENLABS_API_KEY (Doctor → Keys)');
  const voiceId = voice || process.env.ELEVENLABS_VOICE || '21m00Tcm4TlvDq8ikWAM';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST', headers: { 'xi-api-key': k, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5' }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { mime: 'audio/mpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

// ── Google Cloud TTS: API-key query param, real SSML, base64 audioContent ──
async function google(text, mood, voice) {
  const k = key('GOOGLE_TTS_API_KEY');
  if (!k) throw new Error('Google TTS needs GOOGLE_TTS_API_KEY (an API-key-enabled key; Doctor → Keys)');
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(k)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: { ssml: ssmlWrap(text, mood) },
      voice: { languageCode: 'en-US', ...(voice ? { name: voice } : {}) },
      audioConfig: { audioEncoding: 'MP3' },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  if (!j.audioContent) throw new Error('Google TTS returned no audio');
  return { mime: 'audio/mpeg', data: j.audioContent };
}

// ── Azure Speech: subscription-key header, full SSML body ──
async function azure(text, mood, voice) {
  const k = key('AZURE_SPEECH_KEY');
  const region = key('AZURE_SPEECH_REGION');
  if (!k || !region) throw new Error('Azure TTS needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION (Doctor → Keys)');
  const t = TONE[mood] ?? TONE.calm;
  // xmlEscape the voice name too — it comes from the request body and would
  // otherwise break out of the name="…" attribute and inject SSML (the one
  // input that bypassed text-body escaping; injection tester 2026-07-22).
  const name = xmlEscape(voice || process.env.AZURE_VOICE || 'en-US-JennyNeural');
  const body = xmlEscape(text).replace(/([.!?])\s+/g, '$1<break time="220ms"/> ');
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">`
    + `<voice name="${name}"><prosody rate="${t.rate}" pitch="${t.pitch}">${body}</prosody></voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': k, 'content-type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' },
    body: ssml, signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { mime: 'audio/mpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

// ── Deepgram Aura-2: Token auth, plain text, very low latency ──
async function deepgram(text, mood, voice) {
  const k = key('DEEPGRAM_API_KEY');
  if (!k) throw new Error('Deepgram needs DEEPGRAM_API_KEY (Doctor → Keys)');
  const model = voice || process.env.DEEPGRAM_VOICE || 'aura-2-thalia-en';
  const res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`, {
    method: 'POST', headers: { authorization: `Token ${k}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Deepgram TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { mime: 'audio/mpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

// ── Cartesia Sonic: Bearer + version header, plain transcript ──
async function cartesia(text, mood, voice) {
  const k = key('CARTESIA_API_KEY');
  if (!k) throw new Error('Cartesia needs CARTESIA_API_KEY (Doctor → Keys)');
  const voiceId = voice || process.env.CARTESIA_VOICE || '694f9389-aac1-45b6-b726-9d9369183238';
  const res = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: { authorization: `Bearer ${k}`, 'Cartesia-Version': process.env.CARTESIA_VERSION || '2024-11-13', 'content-type': 'application/json' },
    body: JSON.stringify({
      model_id: process.env.CARTESIA_MODEL || 'sonic-2',
      transcript: text,
      voice: { mode: 'id', id: voiceId },
      output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Cartesia TTS ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { mime: 'audio/wav', data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

// ── Amazon Polly: no simple API key — AWS SigV4-signed request ──
async function polly(text, mood, voice) {
  const accessKey = key('AWS_ACCESS_KEY_ID');
  const secretKey = key('AWS_SECRET_ACCESS_KEY');
  if (!accessKey || !secretKey) throw new Error('Amazon Polly needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (Doctor → Keys)');
  const region = key('AWS_REGION') || 'us-east-1';
  const host = `polly.${region}.amazonaws.com`;
  const path = '/v1/speech';
  const body = JSON.stringify({
    Text: ssmlWrap(text, mood), TextType: 'ssml', OutputFormat: 'mp3',
    VoiceId: voice || process.env.AWS_VOICE || 'Joanna', Engine: 'neural',
  });
  const headers = sigv4(accessKey, secretKey, region, 'polly', host, 'POST', path, body,
    { 'content-type': 'application/json' });
  const res = await fetch(`https://${host}${path}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Amazon Polly ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return { mime: 'audio/mpeg', data: Buffer.from(await res.arrayBuffer()).toString('base64') };
}

// Exposed for the voice test suite: SSML escaping + the SigV4 signer, so their
// correctness is asserted directly rather than only through a network call.
export const _testInternals = { ssmlWrap, xmlEscape, sigv4 };

// Minimal AWS Signature V4 (POST, JSON body) — enough for Polly SynthesizeSpeech.
function sigv4(accessKey, secretKey, region, service, host, method, path, body, extraHeaders = {}) {
  const sha256 = (s) => createHash('sha256').update(s).digest('hex');
  const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const lowerExtra = Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v]));
  const signHeaders = { host, 'x-amz-date': amzDate, ...lowerExtra };
  const signedHeaders = Object.keys(signHeaders).sort().join(';');
  const canonicalHeaders = Object.keys(signHeaders).sort().map((h) => `${h}:${String(signHeaders[h]).trim()}\n`).join('');
  const payloadHash = sha256(body);
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    ...extraHeaders,
    host, 'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
