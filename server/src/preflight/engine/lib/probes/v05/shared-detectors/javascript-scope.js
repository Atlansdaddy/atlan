// src/lib/probes/v05/shared-detectors/javascript-scope.js
//
// Shared scope helper for JavaScript / TypeScript adapters. Mirrors
// python-scope.js. Families own no execution logic; cross-cutting helpers
// like this live here and are imported explicitly by the adapters that need
// them. No inheritance, no base classes.
//
// Phase 2 migration adapters re-express v0.4 probes. To keep stableId
// continuity (legacy_finding_id_seed), an adapter's per-line view of a file
// must match what the v0.4 probe saw. stripJsLineComments is a byte-faithful
// copy of the v0.4 stripLineComments in src/lib/probes.js — the v05-phase2
// parity test fails if the two ever diverge.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

const JS_EXT_RE = /\.[jt]sx?$|\.mjs$|\.cjs$/i;

/**
 * Filter a file list to the JS/TS files an adapter should scan.
 * Drops: non-JS/TS, test files, scanner self-source, and the v0.5 fixture
 * tree (fixtures are scanned only by the dedicated dogfood harness, never
 * by a live adapter run — otherwise every positive fixture self-reports).
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function javascriptFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!JS_EXT_RE.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/**
 * Strip comments from a single JS/TS line so a pattern inside a teaching
 * comment ("never do `eval(x)`") does not fire. Byte-faithful copy of the
 * v0.4 stripLineComments. Removes block comments, then chops at the first
 * unquoted `//`. Quote/backtick state tracking matches v0.4 exactly.
 *
 * @param {string} line
 * @returns {string}
 */
export function stripJsLineComments(line) {
  let s = String(line ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  let inSingle = false,
    inDouble = false,
    inBack = false;
  for (let j = 0; j < s.length; j++) {
    const c = s[j];
    const prev = j > 0 ? s[j - 1] : '';
    if (c === "'" && prev !== '\\' && !inDouble && !inBack) inSingle = !inSingle;
    else if (c === '"' && prev !== '\\' && !inSingle && !inBack) inDouble = !inDouble;
    else if (c === '`' && prev !== '\\' && !inSingle && !inDouble) inBack = !inBack;
    else if (c === '/' && s[j + 1] === '/' && !inSingle && !inDouble && !inBack) {
      return s.slice(0, j);
    }
  }
  return s;
}
