import { log } from './logger.js';
// Privacy-preserving counter analytics.
//
// What this records:        action counts (e.g. "scan_started"), per-probe run/fail
//                            counts, per-probe timing histograms, severity emit counts,
//                            simple session metadata (boot ts, app version).
//
// What this NEVER records:   file paths, file content, URLs, hostnames,
//                            finding details, error messages, IP addresses,
//                            user agent, screen resolution, locale, anything
//                            that could fingerprint or identify a person.
//
// Where it lives:            localStorage only. No network calls. No remote
//                            beacons. No fetch(). The whole module is offline.
//
// How to inspect:            window.__auditAnalytics() in DevTools, or the
//                            "Usage" tab in the Diagnostics drawer.

const STORAGE_KEY = 'audit-app:analytics:v1';

const SAFE_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/i;

let state = loadState();
const subscribers = new Set();

function emptyState() {
  return {
    schema: 'analytics/v1',
    bootedAt: Date.now(),
    counts: {},
    timings: {}, // name -> { count, sumMs, minMs, maxMs }
  };
}

function loadState() {
  try {
    if (typeof localStorage === 'undefined') return emptyState();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== 'analytics/v1') {
      return emptyState();
    }
    return {
      ...emptyState(),
      ...parsed,
      counts: { ...(parsed.counts || {}) },
      timings: { ...(parsed.timings || {}) },
    };
  } catch {
    return emptyState();
  }
}

function persist() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Quota or disabled storage — analytics are not critical, drop silently.
  }
}

function notify() {
  for (const fn of subscribers) {
    try {
      fn(state);
    } catch (e) {
      // Subscriber callback threw — isolate so one bad listener can't break the rest.
      log.debug('analytics: subscriber threw', { error: e?.message });
    }
  }
}

function isSafeName(name) {
  return typeof name === 'string' && SAFE_NAME.test(name);
}

export function track(eventName, increment = 1) {
  if (!isSafeName(eventName)) return;
  if (typeof increment !== 'number' || !Number.isFinite(increment) || increment < 0) return;
  state.counts[eventName] = (state.counts[eventName] || 0) + increment;
  persist();
  notify();
}

export function timing(name, ms) {
  if (!isSafeName(name)) return;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
  const t = state.timings[name] || { count: 0, sumMs: 0, minMs: Infinity, maxMs: 0 };
  t.count += 1;
  t.sumMs += ms;
  if (ms < t.minMs) t.minMs = ms;
  if (ms > t.maxMs) t.maxMs = ms;
  state.timings[name] = t;
  persist();
  notify();
}

// Convenience for "start a timer, get a stop fn".
export function startTimer(name) {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    return () => {};
  }
  const t0 = performance.now();
  return () => timing(name, performance.now() - t0);
}

export function getSnapshot() {
  return JSON.parse(JSON.stringify(state));
}

export function getCount(name) {
  return state.counts[name] || 0;
}

export function getTotalEvents() {
  let total = 0;
  for (const k in state.counts) total += state.counts[k];
  return total;
}

export function reset() {
  state = emptyState();
  persist();
  notify();
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function exportJson() {
  return JSON.stringify(state, null, 2);
}

if (typeof window !== 'undefined') {
  window.__auditAnalytics = getSnapshot;
}
