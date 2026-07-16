import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = join(__dirname, '../../.keysecret');
const STORE_FILE = join(__dirname, '../../.keys.enc');

// Providers we accept keys for. Anything else is rejected.
export const KEY_WHITELIST = [
  'GEMINI_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY',
  'XAI_API_KEY', 'MISTRAL_API_KEY', 'MOONSHOT_API_KEY', 'ANTHROPIC_API_KEY',
];

// At-rest encryption: AES-256-GCM keyed off a per-device secret (0600).
// Protects against repo/backup/file-browser leakage. NOT protection against
// an attacker with full proot access — the app must be able to decrypt.
function deviceSecret() {
  if (!existsSync(SECRET_FILE)) {
    writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 });
    chmodSync(SECRET_FILE, 0o600);
  }
  return readFileSync(SECRET_FILE, 'utf8').trim();
}
function aesKey() { return scryptSync(deviceSecret(), 'atlan-keys-v1', 32); }

function load() {
  if (!existsSync(STORE_FILE)) return {};
  try {
    const { iv, tag, data } = JSON.parse(readFileSync(STORE_FILE, 'utf8'));
    const d = createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
  } catch {
    return {}; // tampered or secret rotated — treat as empty rather than crash
  }
}
function save(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  writeFileSync(STORE_FILE, JSON.stringify({
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  }), { mode: 0o600 });
}

export function getStoredKey(env) {
  return load()[env] ?? null;
}

export function setStoredKey(env, value) {
  if (!KEY_WHITELIST.includes(env)) throw new Error('unknown key name');
  const keys = load();
  if (value) keys[env] = String(value).trim();
  else delete keys[env];
  save(keys);
}

// Status for the UI: never the key itself, just set-ness and last 4.
export function keyStatus() {
  const keys = load();
  return KEY_WHITELIST.map((env) => ({
    env,
    set: !!(process.env[env] || keys[env]),
    source: process.env[env] ? 'env' : keys[env] ? 'stored' : null,
    hint: keys[env] ? '…' + keys[env].slice(-4) : process.env[env] ? '…' + process.env[env].slice(-4) : '',
  }));
}
