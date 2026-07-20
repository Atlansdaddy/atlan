import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Auth layer — the preflight blocker, closed. One bearer token, generated on
// first boot, 0600 on disk, never logged. Everything that can act or read
// state (/api/*, /apk, the WS) requires it; the static shell stays open so the
// login screen can load at all. Loopback binding remains the outer wall —
// this is the inner one, and the precondition for ever tunneling.
const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, '../../.auth-token');

let token = process.env.ATLAN_TOKEN || null;
if (!token) {
  if (existsSync(TOKEN_FILE)) {
    token = readFileSync(TOKEN_FILE, 'utf8').trim();
  } else {
    token = randomBytes(32).toString('hex');
    writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  }
  chmodSync(TOKEN_FILE, 0o600);
}
const tokenBuf = Buffer.from(token);

function tokenOk(candidate) {
  if (typeof candidate !== 'string' || !candidate) return false;
  const c = Buffer.from(candidate.trim());
  return c.length === tokenBuf.length && timingSafeEqual(c, tokenBuf);
}

// Brute-force throttle: after 20 bad tokens in a minute, everything gets 429
// until the window rolls. In-memory is enough — a restart also rotates nothing.
let fails = [];
function throttled() {
  const now = Date.now();
  fails = fails.filter((t) => now - t < 60_000);
  return fails.length >= 20;
}

export function authMiddleware(req, res, next) {
  if (throttled()) return res.status(429).json({ error: 'too many bad tokens — wait a minute' });
  const candidate = req.get('x-atlan-token') ?? req.query.token;
  if (tokenOk(candidate)) return next();
  fails.push(Date.now());
  res.status(401).json({ error: 'auth required — paste the token from /root/atlan/.auth-token' });
}

// Browsers can't set headers on a WebSocket, so the token rides the query
// string. Loopback-only today; if this ever tunnels, the tunnel is TLS.
export function wsAuthed(req) {
  if (throttled()) return false;
  try {
    const u = new URL(req.url, 'http://x');
    if (tokenOk(u.searchParams.get('token'))) return true;
  } catch { /* fall through */ }
  fails.push(Date.now());
  return false;
}

export const _testInternals = { tokenOk, TOKEN_FILE };
