// src/lib/sandbox/runner.js
//
// Pure scan runner for the sandbox surface. Takes a string of code, returns
// an array of findings shaped like every other probe's output so the existing
// FindingsPanel and (eventually) the live-probe UI can render them without a
// new contract.
//
// This first cut runs three of the v0.4 probes that are deterministic, fast,
// and likely to fire on vibe-coded React: code-quality (console.log left in,
// async without try), AI-code-smells (empty catch, heavy `any`), and
// auth-weakness (eval, dangerouslySetInnerHTML, algorithm: none). All three
// already exist in src/lib/probes.js, run synchronously, and are tested. They
// are wired here unmodified.
//
// The 156 v2 probes from preflight-v2-spec.md are NOT plugged in here yet.
// They will run through the same `runSandboxScan` entry point when they ship,
// likely on a Web Worker so the main thread stays responsive on large files.
// This file's contract (string in, findings array out) does not change when
// that move happens.

import { probeCodeQuality, probeAICodeSmells, probeAuthWeakness } from '../probes.js';

// Virtual filename presented to the probes. Some probes scope by extension
// (`.jsx` enables JSX-aware regex paths), so the .jsx extension matters here.
const SANDBOX_FILENAME = 'sandbox.jsx';

export function runSandboxScan(code) {
  if (typeof code !== 'string' || code.length === 0) return [];
  const files = [{ path: SANDBOX_FILENAME, content: code }];
  // Each probe is a pure function over `files`. Order does not matter; the
  // panel sorts visually.
  const findings = [
    ...probeCodeQuality(files),
    ...probeAICodeSmells(files),
    ...probeAuthWeakness(files),
  ];
  // Stable React keys for the panel. The probe-emitted `id` is preferred when
  // present; otherwise we derive one from the position in the merged array.
  return findings.map((f, i) => ({
    ...f,
    id: f.id || `sb-${i}-${f.probe || 'unknown'}`,
  }));
}
