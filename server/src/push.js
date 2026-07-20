import webpush from 'web-push';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real Web Push (survives the app being closed) for fleet events. Pairs with
// web/public/sw.js — a push-ONLY service worker with no fetch handler, so the
// stale-SW landmine stays structurally impossible (doctor asserts it).
const __dirname = dirname(fileURLToPath(import.meta.url));
import { FLEET_DIR, BRAND } from './config.js';
mkdirSync(FLEET_DIR, { recursive: true });
const VAPID_FILE = join(FLEET_DIR, 'vapid.json');
const SUBS_FILE = join(FLEET_DIR, 'push-subs.json');

function loadJson(p, fallback) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } }

let vapid = loadJson(VAPID_FILE, null);
if (!vapid) {
  vapid = webpush.generateVAPIDKeys();
  writeFileSync(VAPID_FILE, JSON.stringify(vapid), { mode: 0o600 });
}
webpush.setVapidDetails(`mailto:${BRAND.contactEmail}`, vapid.publicKey, vapid.privateKey);

let subs = loadJson(SUBS_FILE, []);
const saveSubs = () => writeFileSync(SUBS_FILE, JSON.stringify(subs), { mode: 0o600 });

export function pushPublicKey() { return vapid.publicKey; }

export function addSub(sub) {
  if (!sub?.endpoint) throw new Error('not a push subscription');
  if (!subs.some((s) => s.endpoint === sub.endpoint)) {
    subs.push(sub);
    saveSubs();
  }
  return subs.length;
}

export function subCount() { return subs.length; }

// Fire-and-forget: push failures must never affect a run. Dead subscriptions
// (404/410 = browser dropped it) are pruned.
export async function notifyAll(title, body, tag = 'atlan-fleet') {
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s, JSON.stringify({ title, body, tag }), { TTL: 3600 });
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) dead.push(s.endpoint);
    }
  }));
  if (dead.length) {
    subs = subs.filter((s) => !dead.includes(s.endpoint));
    saveSubs();
  }
}
