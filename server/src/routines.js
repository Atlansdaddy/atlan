import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { atomicWrite, readJsonState } from './fsutil.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnRun, isActive, FLEET_ENGINES } from './fleet.js';
import { DEFAULT_ENGINE, defaultModel } from './enginePolicy.js';
import { listPersonas, compilePersona } from './personas.js';
import { PROJECTS_DIR } from './config.js';
import { resolveInProjects } from './guards.js';

// Routines = scheduled, budgeted, reported fleet runs. Same three fleet
// guarantees apply; a routine is just a spawnRun on a clock. Missed fires are
// FLAGGED, never auto-run late — a dead server must not wake up and spend.
const __dirname = dirname(fileURLToPath(import.meta.url));
import { FLEET_DIR } from './config.js';
mkdirSync(FLEET_DIR, { recursive: true });
const FILE = join(FLEET_DIR, 'routines.json');

// A CORRUPT store must not read as an EMPTY store. `catch { return {routines:[]} }`
// meant a truncated routines.json silently dropped every scheduled routine —
// no notify, no broadcast, no log line — and the next state change persisted the
// empty list straight over it, making the loss permanent. The user found out
// when a nightly audit they relied on had quietly stopped firing. readJsonState
// moves the bad file aside instead of overwriting it, and `loadError` carries
// the quarantine path into listRoutines() so the surface can say so.
// (Cross-vendor adversarial review, 2026-08-06.)
const loaded = readJsonState(FILE, { routines: [], paused: false });
let state = loaded.value;
const loadError = loaded.corrupt;
const persist = () => atomicWrite(FILE, JSON.stringify(state, null, 1));

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
  return {
    routines: state.routines.map((r) => ({ ...r, nextDueAt: state.paused || !r.enabled ? null : dueAt(r) })),
    paused: state.paused,
    loadError: loadError || null,
  };
}

export function upsertRoutine(r) {
  const out = {
    id: r.id && state.routines.some((x) => x.id === r.id) ? r.id : randomUUID().slice(0, 8),
    name: S(r.name, 80) || 'unnamed routine',
    cadence: sanitizeCadence(r.cadence),
    prompt: S(r.prompt, 8000),
    personaId: listPersonas().some((p) => p.id === r.personaId) ? r.personaId : null,
    profile: ['scout', 'builder', 'verifier'].includes(r.profile) ? r.profile : 'scout',
    // Bound at SAVE time, with the same guard spawnRun uses. A routine is the
    // one path that spends unattended on a timer, so a cwd it will refuse at
    // 3am should be refused now, while a human is looking at the form.
    cwd: resolveInProjects(S(r.cwd, 300) || PROJECTS_DIR, { mustExist: true }),
    // A routine has no engine field, so it has always been implicitly the
    // default engine's — worth naming rather than leaving as a literal that
    // reads like a choice. Giving routines their own engine is a separate job.
    engine: FLEET_ENGINES.includes(r.engine) ? r.engine : DEFAULT_ENGINE,
    model: S(r.model, 80) || defaultModel(FLEET_ENGINES.includes(r.engine) ? r.engine : DEFAULT_ENGINE, 'fleet'),
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
  // daily: today's HH:MM if that slot is still open, else tomorrow's.
  //
  // "Still open" is measured from the last fire OR, for a routine that has
  // never fired, from when it was CREATED. It used to fall back to 0, so a
  // brand-new daily routine always saw today's slot as unconsumed — set up a
  // "09:00 daily" at 2pm and `dueAt` came back five hours in the PAST, which
  // tick() reads as due and fires within 30 seconds. A real budgeted agent run,
  // unconfirmed, against the user's project, when every cron-like scheduler
  // (and this file's own header: "a dead server must not wake up and spend")
  // says it waits until tomorrow.
  // (Cross-vendor adversarial review, 2026-08-06.)
  const [h, m] = r.cadence.at.split(':').map(Number);
  const today = new Date(); today.setHours(h, m, 0, 0);
  const t = today.getTime();
  const consumedSince = r.lastFireAt ?? r.createdAt ?? 0;
  if (consumedSince < t) return t;                  // today's slot still open
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
  // engine travels with the run. It was omitted, so spawnRun fell back to its
  // own default and a routine's engine field would have been decorative.
  const run = spawnRun({ prompt, profile: r.profile, cwd: r.cwd, engine: r.engine, model: r.model, budget: r.budget, source: `routine:${r.name}` });
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
    const due = dueAt(r);
    if (now < due) continue;
    // THE GRACE WINDOW APPLIES HERE TOO. It only ever existed in the boot sweep,
    // so a slot missed while the process was alive but not ticking — a laptop
    // asleep, a phone in doze, a long stop-the-world — fired late and silently
    // instead of being flagged. "Missed fires are FLAGGED, never auto-run late"
    // has to hold in both places or it is not the rule.
    if (now > due + graceMs(r)) {
      r.missed = true;
      r.lastFireAt = now;   // consume the slot so this doesn't loop
      persist();
      broadcast({ t: 'routines.changed' });
      notify('⏰ Routine slot missed', `${r.name} came due while Atlan wasn't ticking — open Fleet → Routines to run it late.`).catch(() => {});
      continue;
    }
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
