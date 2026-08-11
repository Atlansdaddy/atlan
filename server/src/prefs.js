// Tiny server-side UI-prefs store (single-user cockpit, so one flat file).
// Exists because localStorage is per-origin: the cockpit is reachable on at
// least two origins (loopback and tailnet), so browser-side "tour done" state
// comes back on every other origin (docs/TUTORIAL-OVERHAUL.md §1b).
// Whitelisted keys only — same posture as the keys endpoint: an open KV store
// reachable over HTTP is an invitation, a named pref is a feature.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { FLEET_DIR } from './config.js';

mkdirSync(FLEET_DIR, { recursive: true });
const FILE = join(FLEET_DIR, 'prefs.json');
const ALLOWED = new Set(['tour', 'theme', 'template',
  // Per-provider permission-gate defaults. 'ask' is only meaningful on the
  // claude chat path (the others always run behind a profile); a profile name
  // here becomes the DEFAULT wherever that provider's work is armed or spawned.
  'gate.claude', 'gate.codex', 'gate.grok', 'gate.copilot', 'gate.antigravity']);

// A gate pref is security-adjacent: an arbitrary string stored here would read
// back as "armed with something" one refactor later. Whitelist the values the
// same way the keys themselves are whitelisted.
const GATE_VALUES = new Set(['ask', 'scout', 'verifier', 'builder']);

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; }
}

export function getPrefs() { return load(); }

// Empty value deletes the key (mirrors /api/keys). Returns null on a
// non-whitelisted key OR a gate value off the roster, so the route can 400.
export function setPref(key, value) {
  if (!ALLOWED.has(String(key))) return null;
  const p = load();
  const v = String(value ?? '').slice(0, 64);
  if (String(key).startsWith('gate.') && v && !GATE_VALUES.has(v)) return null;
  if (v) p[key] = v; else delete p[key];
  writeFileSync(FILE, JSON.stringify(p));
  return p;
}
