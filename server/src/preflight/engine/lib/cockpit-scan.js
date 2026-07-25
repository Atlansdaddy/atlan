// src/lib/cockpit-scan.js
//
// The STABLE embedding seam for host apps (e.g. the Atlan cockpit's Scan
// surface). One function: scan(files) -> { findings, score, ... }. Everything a
// host needs, nothing of the React UI.
//
// FIDELITY CONTRACT: this reproduces the EXACT scan sequence App.jsx runs for a
// dropped-in/GitHub project — not the dogfood test (which uses a different file
// selection and is only a noise-floor tracker). If you change the real scan in
// App.jsx, mirror it here, and the parity test (src/test/cockpit-parity.test.js)
// will fail loudly if the two drift. That is the whole point: a host must see
// what the browser sees.
//
// files: [{ path: string, content: string }]  (host collects them; probes are
//         pure synchronous functions over this array)
//
// Returns:
//   findings   — severity-sorted, each with .snippet (±5 lines), .stableId, and
//                probe meta attached (identical objects to what the app renders)
//   score      — computeScore(findings)
//   suppressions — repo-local .preflight.yml/json suppressions (host may apply)
//   probeFailures — [{ probe, error }] for any probe that threw (scan never aborts)
//   filesScanned — files.length

import { PROBES, attachStableIds, attachProbeMeta } from './probes.js';
import { SEV_ORDER, computeScore } from './scoring.js';
import { buildSnippet } from './snippet.js';
import {
  findPreflightConfigFile,
  parsePreflightConfig,
  configToSuppressions,
} from './preflight-config.js';

export function scan(files, opts = {}) {
  if (!Array.isArray(files)) {
    throw new TypeError('scan(files): files must be an array of { path, content }');
  }

  // 1) run every probe (pure, synchronous) — one bad probe never aborts the scan
  const findings = [];
  const probeFailures = [];
  for (const probe of PROBES) {
    try {
      const found = probe.fn(files);
      if (!Array.isArray(found)) throw new Error(`probe returned non-array: ${typeof found}`);
      findings.push(...found);
    } catch (err) {
      probeFailures.push({ probe: probe.name, error: err?.message || String(err) });
      if (typeof opts.onProbeError === 'function') opts.onProbeError(probe.name, err);
    }
  }

  // 2) severity sort (App.jsx order)
  findings.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));

  // 3) ±5-line code snapshot per finding (reports + agent prompts want context)
  const fileMap = new Map(files.map((f) => [f.path, f.content]));
  for (const f of findings) {
    try {
      const content = fileMap.get(f.file);
      if (content && f.line) f.snippet = buildSnippet(content, f.line, 5);
    } catch {
      /* snippet is best-effort, never fatal */
    }
  }

  // 4) stable ids (NOTE: 2-arg — hashes probe+file+context from the FILES) + probe meta.
  //    Both MUTATE `findings` in place (they return nothing) — mirror App.jsx exactly.
  attachStableIds(findings, files);
  attachProbeMeta(findings);

  // 5) repo-local .preflight.yml/json suppressions (host applies over its own prefs)
  let suppressions = {};
  const configFile = findPreflightConfigFile(files);
  if (configFile) {
    const cfg = parsePreflightConfig(configFile.path, configFile.content);
    if (!cfg.error) suppressions = configToSuppressions(cfg, findings);
  }

  // 6) score
  const score = computeScore(findings);

  return { findings, score, suppressions, probeFailures, filesScanned: files.length };
}

// Host-friendly engine metadata without importing the React tree.
export function engineInfo() {
  return { probeCount: PROBES.length, probes: PROBES.map((p) => p.name) };
}

export { PROBES } from './probes.js';
