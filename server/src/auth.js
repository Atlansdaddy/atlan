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

// Brute-force throttle. The token is 256 bits — unbruteforceable at any rate —
// so this is a log/CPU guard, NOT the security boundary. It must never lock out
// the legitimate user: (1) the threshold is generous, and (2) any VALID token
// clears the fail window (a caller who proves themselves isn't the attacker).
// Learned live 2026-07-20: a low global threshold let the security test-suite —
// and, worse, a user fat-fingering the token a few times — 429 everything,
// including correct tokens.
const THROTTLE_MAX = 100;
let fails = [];
function throttled() {
  const now = Date.now();
  fails = fails.filter((t) => now - t < 60_000);
  return fails.length >= THROTTLE_MAX;
}
function pass() { fails = []; return true; }      // valid token → clear suspicion
function record() { fails.push(Date.now()); }

export function authMiddleware(req, res, next) {
  const candidate = req.get('x-atlan-token') ?? req.query.token;
  if (tokenOk(candidate)) { pass(); return next(); }
  if (throttled()) return res.status(429).json({ error: 'too many bad tokens — wait a minute' });
  record();
  res.status(401).json({ error: 'auth required — open the URL printed in the server startup banner, or use the token from the Doctor tab' });
}

// Browsers can't set headers on a WebSocket, so the token rides the query
// string. Loopback-only today; if this ever tunnels, the tunnel is TLS.
export function wsAuthed(req) {
  try {
    const u = new URL(req.url, 'http://x');
    if (tokenOk(u.searchParams.get('token'))) return pass();
  } catch { /* fall through */ }
  if (throttled()) return false;
  record();
  return false;
}

export function authToken() { return token; }

export const _testInternals = { tokenOk, TOKEN_FILE, THROTTLE_MAX };
