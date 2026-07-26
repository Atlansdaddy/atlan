// src/lib/history.js
// localStorage-backed scan history (newest-first, capped at HISTORY_MAX entries) plus
// the diff calculator that compares the current scan to the most recent prior scan of
// the same source. Pure functions; UI subscribes via state mirrors in App.jsx.

import { log } from './logger.js';

export const HISTORY_KEY = 'audit-app:history:v1';
export const HISTORY_MAX = 10;

export function loadHistory() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
    return true;
  } catch {
    // Quota exceeded — try shrinking by half and retry once.
    if (arr.length > 1) {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, Math.floor(arr.length / 2))));
        return true;
      } catch (e) {
        log.debug('history: shrink-and-retry still over quota', { error: e?.message });
      }
    }
    return false;
  }
}

export function makeHistoryEntry(results, sourceType) {
  const bySeverity = results.findings.reduce((a, f) => {
    a[f.severity] = (a[f.severity] || 0) + 1;
    return a;
  }, {});
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scannedAt:
      results.scannedAt instanceof Date ? results.scannedAt.toISOString() : results.scannedAt,
    source: results.source,
    sourceType,
    filesScanned: results.filesScanned,
    score: results.score,
    bySeverity,
    findings: results.findings,
  };
}

// Compute "what's new / fixed / changed" between the current scan and the most recent prior scan of the same source.
// Pure function; testable in isolation.
export function computeDiffAgainstPrior(currentResults, history) {
  if (!currentResults || !Array.isArray(history)) return null;
  // Find the most recent prior entry for the same source (skip the entry that represents the current scan).
  // History is newest-first; skip entries that match BOTH source AND scannedAt of the current scan.
  const currentTs =
    currentResults.scannedAt instanceof Date
      ? currentResults.scannedAt.toISOString()
      : currentResults.scannedAt;
  const prior = history.find(
    (h) => h.source === currentResults.source && h.scannedAt !== currentTs
  );
  if (!prior) return null;

  // Use the deterministic stableId where available; fall back to the legacy composite key for
  // older history entries written before stable IDs existed. New scans always carry stableId
  // because handleScan calls attachStableIds(); old entries shipped without it.
  const keyOf = (f) => f.stableId || `legacy|${f.probe}|${f.file}|${f.line}|${f.title}`;
  const currentSet = new Set(currentResults.findings.map(keyOf));
  const priorSet = new Set((prior.findings || []).map(keyOf));

  const introduced = currentResults.findings.filter((f) => !priorSet.has(keyOf(f)));
  const fixed = (prior.findings || []).filter((f) => !currentSet.has(keyOf(f)));
  const persisted = currentResults.findings.filter((f) => priorSet.has(keyOf(f)));

  const bucket = (arr) =>
    arr.reduce((a, f) => {
      a[f.severity] = (a[f.severity] || 0) + 1;
      return a;
    }, {});
  return {
    priorScannedAt: prior.scannedAt,
    priorScore: prior.score,
    deltaScore: currentResults.score - prior.score,
    introduced: { count: introduced.length, bySeverity: bucket(introduced), items: introduced },
    fixed: { count: fixed.length, bySeverity: bucket(fixed), items: fixed },
    persisted: { count: persisted.length, bySeverity: bucket(persisted) },
  };
}

export function historyEntryToResults(entry) {
  return {
    findings: entry.findings || [],
    score: entry.score,
    scannedAt: new Date(entry.scannedAt),
    filesScanned: entry.filesScanned,
    source: entry.source,
  };
}
