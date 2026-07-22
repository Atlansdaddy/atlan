import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve, extname } from 'node:path';
import { APP_ROOT, PROJECTS_DIR } from './config.js';
import { getStoredKey } from './keys.js';

// Attachments — images/audio/video/files/folders on a chat message. The routing
// IS the delegation thesis: images → the agent Reads them (vision); files/
// folders → path references it Reads in place; audio/video → delegated to a
// natively-multimodal model (Gemini free tier, or OpenAI) that turns them into
// text the current engine can use. Kept deliberately simple.
const DIR = join(APP_ROOT, '.attachments');
mkdirSync(DIR, { recursive: true });

const MAX_BYTES = 20 * 1024 * 1024; // 20MB — Gemini inline-data ceiling; simple cap

function kindOf(mime, name) {
  if (mime?.startsWith('image/')) return 'image';
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime?.startsWith('video/')) return 'video';
  const ext = extname(name || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.m4a', '.ogg', '.flac'].includes(ext)) return 'audio';
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'video';
  return 'file';
}

// Upload: base64 → saved file. Audio/video get transcribed/described on the way in.
export async function saveUpload({ name, mime, data }) {
  const b64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('empty attachment');
  if (buf.length > MAX_BYTES) throw new Error(`attachment too big (max ${MAX_BYTES / 1024 / 1024}MB)`);
  const kind = kindOf(mime, name);
  const id = randomUUID().slice(0, 8);
  const safe = (name || 'file').replace(/[^\w.\-]/g, '_').slice(-60);
  const path = join(DIR, `${id}-${safe}`);
  writeFileSync(path, buf);
  const out = { id, kind, name: name || safe, path, note: null };
  if (kind === 'audio' || kind === 'video') {
    try { out.note = await describeMedia(path, mime, kind); }
    catch (err) { out.note = `(needs a Gemini or OpenAI key to understand ${kind} — add one in Doctor: ${err.message})`; }
  }
  return out;
}

// Reference an EXISTING file or folder in the project — no copy, the agent
// Reads it in place. Must live under PROJECTS_DIR (no traversal to /etc etc.).
// Don't let an attachment reference trivially slurp credentials into a chat,
// even within the project root (agent could Read them anyway, but not one-tap).
const SENSITIVE = /(^|\/)\.(ssh|aws|gnupg|gcloud|docker|kube)(\/|$)|(^|\/)(\.auth-token|\.keys\.enc|\.keysecret|\.fleet|\.env|id_rsa|id_ed25519)(\/|$)/;
export function saveRef({ path }) {
  const p = resolve(String(path || ''));
  const root = PROJECTS_DIR.endsWith('/') ? PROJECTS_DIR : PROJECTS_DIR + '/';
  if (p !== PROJECTS_DIR && !p.startsWith(root)) throw new Error(`references must live under ${PROJECTS_DIR}`);
  if (SENSITIVE.test(p)) throw new Error('that path looks like credentials/secrets — not attachable');
  if (!existsSync(p)) throw new Error('no such path');
  // Symlink guard (fleet scout audit 2026-07-22): a link under the project
  // pointing outside it, or at a secret, must not be attachable.
  const real = realpathSync(p);
  if (real !== PROJECTS_DIR && !real.startsWith(root)) throw new Error('symlink escapes the project root — refused');
  if (SENSITIVE.test(real)) throw new Error('resolves to a credentials/secrets path — refused');
  const isDir = statSync(p).isDirectory();
  return { id: randomUUID().slice(0, 8), kind: isDir ? 'folder' : 'file', name: basename(p), path: p, note: null };
}

// Turn context: how each attachment reaches the model. Appended to the chat turn.
export function turnContext(attachments = []) {
  if (!attachments.length) return '';
  const lines = ['\n\n[Atlan attachments for this turn:]'];
  for (const a of attachments) {
    if (a.kind === 'image') lines.push(`• image "${a.name}" at ${a.path} — Read/view that file to SEE it.`);
    else if (a.kind === 'folder') lines.push(`• folder "${a.name}" at ${a.path} — inspect it (LS/Grep/Read) as needed.`);
    else if (a.kind === 'audio' || a.kind === 'video') lines.push(`• ${a.kind} "${a.name}" — understood via a multimodal model:\n${a.note ?? '(no transcript)'}`);
    else lines.push(`• file "${a.name}" at ${a.path} — Read it as needed.`);
  }
  return lines.join('\n');
}

// ── audio/video → text, via a natively-multimodal model ──
export async function describeMedia(path, mime, kind) {
  const geminiKey = process.env.GEMINI_API_KEY || getStoredKey('GEMINI_API_KEY');
  if (geminiKey) return geminiDescribe(path, mime, kind, geminiKey);
  const openaiKey = process.env.OPENAI_API_KEY || getStoredKey('OPENAI_API_KEY');
  if (openaiKey && kind === 'audio') return openaiTranscribe(path, openaiKey);
  throw new Error('no multimodal key');
}

async function geminiDescribe(path, mime, kind, key) {
  const data = readFileSync(path).toString('base64');
  const prompt = kind === 'audio'
    ? 'Transcribe this audio verbatim. If there is non-speech content, briefly note it.'
    : 'Describe this video for another AI to act on: what happens, any on-screen text, and transcribe any speech.';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime || 'application/octet-stream', data } }] }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const j = await res.json();
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('\n') || '(empty)';
}

async function openaiTranscribe(path, key) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(path)]), basename(path));
  form.append('model', 'whisper-1');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  return (await res.json()).text || '(empty)';
}
