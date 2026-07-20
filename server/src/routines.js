import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnRun, isActive } from './fleet.js';
import { listPersonas, compilePersona } from './personas.js';

// Routines = scheduled, budgeted, reported fleet runs. Same three fleet
// guarantees apply; a routine is just a spawnRun on a clock. Missed fires are
// FLAGGED, never auto-run late — a dead server must not wake up and spend.
const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_DIR = join(__dirname, '../../.fleet');
mkdirSync(FLEET_DIR, { recursive: true });
const FILE = join(FLEET_DIR, 'routines.json');

let state = (() => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return { routines: [], paused: false }; } })();
const persist = () => writeFileSync(FILE, JSON.stringify(state, null, 1));

let broadcast = () => {};
let notify = async () => {};

const S = (v, max = 4000) => String(v ?? '').slice(0, max).trim();

function sanitizeCadence(c) {
  if (c?.kind === 'daily') {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(S(c.at, 5));
    if (!m) throw new Error('daily cadence needs at: "HH:MM" (24h)');
    return { kind: 'daily', at: `${m[1].padStart(2, '0')}:${m[2]}` };
  }
  const minutes = Math.round(Number(c?.minutes));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 7 * 24 * 60) {
    throw new Error('cadence: every 5 minutes … 7 days');
  }
  return { kind: 'every', minutes };
}

export function listRoutines() {
  return { routines: state.routines.map((r) => ({ ...r, nextDueAt: state.paused || !r.enabled ? null : dueAt(r) })), paused: state.paused };
}

export function upsertRoutine(r) {
  const out = {
    id: r.id && state.routines.some((x) => x.id === r.id) ? r.id : randomUUID().slice(0, 8),
    name: S(r.name, 80) || 'unnamed routine',
    cadence: sanitizeCadence(r.cadence),
    prompt: S(r.prompt, 8000),
    personaId: listPersonas().some((p) => p.id === r.personaId) ? r.personaId : null,
    profile: ['scout', 'builder', 'verifier'].includes(r.profile) ? r.profile : 'scout',
    cwd: S(r.cwd, 300) || '/root',
    model: S(r.model, 80) || 'claude-haiku-4-5-20251001',
    budget: Math.min(2_000_000, Math.max(1000, Number(r.budget) || 50000)),
    enabled: r.enabled !== false,
    lastFireAt: state.routines.find((x) => x.id === r.id)?.lastFireAt ?? null,
    lastRunId: state.routines.find((x) => x.id === r.id)?.lastRunId ?? null,
    missed: false,
    createdAt: state.routines.find((x) => x.id === r.id)?.createdAt ?? Date.now(),
  };
  if (!out.prompt) throw new Error('routine needs a prompt');
  state.routines = [out, ...state.routines.filter((x) => x.id !== out.id)].slice(0, 100);
  persist();
  broadcast({ t: 'routines.changed' });
  return out;
}

export function deleteRoutine(id) {
  const before = state.routines.length;
  state.routines = state.routines.filter((x) => x.id !== id);
  persist();
  broadcast({ t: 'routines.changed' });
  return state.routines.length < before;
}

export function setPaused(paused) {
  state.paused = !!paused;
  persist();
  broadcast({ t: 'routines.changed' });
  return state.paused;
}

// When is this routine next due? (ms epoch)
function dueAt(r) {
  if (r.cadence.kind === 'every') {
    return (r.lastFireAt ?? r.createdAt) + r.cadence.minutes * 60_000;
  }
  // daily: today's HH:MM if not fired since then, else tomorrow's
  const [h, m] = r.cadence.at.split(':').map(Number);
  const today = new Date(); today.setHours(h, m, 0, 0);
  const t = today.getTime();
  if ((r.lastFireAt ?? 0) < t) return t;            // today's slot still open
  return t + 24 * 3600_000;
}

// Fire = a normal budgeted fleet run, persona compiled in, source-labeled so
// the inbox says which routine sent it.
export function fireRoutine(id, { late = false } = {}) {
  const r = state.routines.find((x) => x.id === id);
  if (!r) throw new Error('no such routine');
  // In-flight guard: one routine, one live run. Without this, rapid/duplicate
  // fires (fat-finger, retry, or scheduler tick racing a manual fire) spawn N
  // parallel runs each burning its own budget — caught live by an adversarial
  // agent 2026-07-20. spawnRun registers the run synchronously, so checking the
  // last run's active state here is race-free under Node's single thread.
  if (r.lastRunId && isActive(r.lastRunId)) {
    throw new Error(`routine "${r.name}" already has a run in flight (${r.lastRunId}) — let it finish or kill it first`);
  }
  const persona = listPersonas().find((p) => p.id === r.personaId);
  const prompt = (persona ? compilePersona(persona) + '\n\n' : '')
    + `[Atlan routine "${r.name}"${late ? ' — LATE RUN, fired manually after a missed slot' : ''}. Scheduled, budgeted, reported: do the task, end with a compact report.]\n\n${r.prompt}`;
  const run = spawnRun({ prompt, profile: r.profile, cwd: r.cwd, model: r.model, budget: r.budget, source: `routine:${r.name}` });
  r.lastFireAt = Date.now();
  r.lastRunId = run.id;
  r.missed = false;
  persist();
  broadcast({ t: 'routines.changed' });
  return run;
}

// Grace before a due-but-unfired routine counts as MISSED (server was down or
// paused past its slot): every-N → half an interval, daily → 2h.
function graceMs(r) { return r.cadence.kind === 'every' ? r.cadence.minutes * 30_000 : 2 * 3600_000; }

let timer = null;
export function startScheduler(broadcastFn, notifyFn) {
  broadcast = broadcastFn ?? broadcast;
  notify = notifyFn ?? notify;
  // Boot sweep: anything already past due+grace is a missed slot — flag it,
  // tell John, wait for his "run late". Never spend on a surprise.
  const now = Date.now();
  let missedNames = [];
  for (const r of state.routines) {
    if (r.enabled && !state.paused && now > dueAt(r) + graceMs(r)) {
      // Mark the slot consumed so the ticker doesn't auto-fire it either.
      r.missed = true;
      r.lastFireAt = now;
      missedNames.push(r.name);
    }
  }
  if (missedNames.length) {
    persist();
    notify('⏰ Routines missed while Atlan was down', `${missedNames.join(', ')} — open Fleet → Routines to run late.`).catch(() => {});
  }
  if (timer) clearInterval(timer);
  timer = setInterval(tick, 30_000);
  return missedNames;
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }

function tick() {
  if (state.paused) return;
  const now = Date.now();
  for (const r of state.routines) {
    if (!r.enabled || r.missed) continue;
    if (now < dueAt(r)) continue;
    try {
      fireRoutine(r.id);
    } catch (err) {
      // e.g. spawn failure — flag as missed so it surfaces instead of looping
      r.missed = true;
      persist();
      notify('⏰ Routine failed to fire', `${r.name}: ${String(err.message).slice(0, 120)}`).catch(() => {});
    }
  }
}

export const _testInternals = { dueAt, graceMs, tick, state };
