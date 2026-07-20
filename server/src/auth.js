import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Auth — familiar password + stay-logged-in session (John's call 2026-07-20,
// replacing the token-in-URL footgun). Three honest properties:
//  1. Humans log in with a PASSWORD they set on first run; a long-lived
//     httpOnly session cookie keeps them in across restarts (no re-login, no
//     lockout, and no secret ever in a URL).
//  2. Automation (tests, CLI) uses a header bearer token — a header, never a
//     URL — so scripts don't need a browser session.
//  3. Forkable: each instance sets its own password; nothing personal ships.
const __dirname = dirname(fileURLToPath(import.meta.url));
import { FLEET_DIR } from './config.js';
mkdirSync(FLEET_DIR, { recursive: true });
const AUTH_FILE = join(FLEET_DIR, 'auth.json');       // { salt, hash }
const SESS_FILE = join(FLEET_DIR, 'sessions.json');   // [{ t, at }]
const TOKEN_FILE = join(__dirname, '../../.auth-token'); // bearer for automation

const loadJson = (p, f) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return f; } };

// ── automation bearer (header only) ──
let bearer = process.env.ATLAN_TOKEN || null;
if (!bearer) {
  if (existsSync(TOKEN_FILE)) bearer = readFileSync(TOKEN_FILE, 'utf8').trim();
  else { bearer = randomBytes(32).toString('hex'); writeFileSync(TOKEN_FILE, bearer + '\n', { mode: 0o600 }); }
  try { chmodSync(TOKEN_FILE, 0o600); } catch { /* best effort */ }
}
const bearerBuf = Buffer.from(bearer);
function bearerOk(v) {
  if (typeof v !== 'string' || !v) return false;
  const c = Buffer.from(v.trim());
  return c.length === bearerBuf.length && timingSafeEqual(c, bearerBuf);
}
export function authToken() { return bearer; }

// ── password ──
export function isConfigured() { return existsSync(AUTH_FILE); }
export function setPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('password must be at least 8 characters');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 64).toString('hex');
  writeFileSync(AUTH_FILE, JSON.stringify({ salt, hash }), { mode: 0o600 });
  try { chmodSync(AUTH_FILE, 0o600); } catch { /* best effort */ }
}
export function checkPassword(pw) {
  const a = loadJson(AUTH_FILE, null);
  if (!a || typeof pw !== 'string') return false;
  const got = scryptSync(pw, a.salt, 64);
  const want = Buffer.from(a.hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

// ── sessions (persisted → survive restarts, so no re-login/lockout) ──
const SESSION_TTL = 30 * 24 * 3600_000; // 30 days
let sessions = loadJson(SESS_FILE, []).filter((s) => Date.now() - s.at < SESSION_TTL);
const saveSessions = () => { try { writeFileSync(SESS_FILE, JSON.stringify(sessions), { mode: 0o600 }); } catch { /* */ } };
saveSessions();
export function newSession() {
  const t = randomBytes(32).toString('hex');
  sessions.push({ t, at: Date.now() });
  saveSessions();
  return t;
}
function sessionValid(t) {
  if (!t) return false;
  const s = sessions.find((x) => x.t === t);
  if (!s) return false;
  if (Date.now() - s.at > SESSION_TTL) { dropSession(t); return false; }
  return true;
}
export function dropSession(t) { sessions = sessions.filter((x) => x.t !== t); saveSessions(); }
export const COOKIE = 'atlan_session';
export function cookieHeader(token, { clear = false } = {}) {
  const base = `${COOKIE}=${clear ? '' : token}; HttpOnly; SameSite=Strict; Path=/`;
  return clear ? `${base}; Max-Age=0` : `${base}; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
}
function cookieToken(req) {
  const m = /(?:^|;\s*)atlan_session=([^;]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

// ── failed-login throttle (a password IS guessable, unlike the 256-bit
// bearer, so this one matters). 10 bad passwords/min → cool down. ──
let fails = [];
export function loginThrottled() {
  fails = fails.filter((t) => Date.now() - t < 60_000);
  return fails.length >= 10;
}
export function recordLoginFail() { fails.push(Date.now()); }
export function clearLoginFails() { fails = []; }

// ── the gate ──
function authed(req) {
  if (bearerOk(req.get?.('x-atlan-token') ?? req.headers?.['x-atlan-token'])) return true;
  return sessionValid(cookieToken(req));
}
export function authMiddleware(req, res, next) {
  if (authed(req)) return next();
  res.status(401).json({ error: 'auth required — log in' });
}
// Browser WS carries the session cookie on upgrade automatically; automation
// WS sends the x-atlan-token header. No token in the URL, ever.
export function wsAuthed(req) { return authed(req); }

export const _testInternals = { bearerOk, sessionValid, checkPassword, SESSION_TTL };
