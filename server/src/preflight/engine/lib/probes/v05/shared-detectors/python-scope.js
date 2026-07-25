// src/lib/probes/v05/shared-detectors/python-scope.js
//
// Shared scope helper for Python adapters. Per the composition decision in
// v05-architecture.md, families own no execution logic; cross-cutting helpers
// like this live here and are imported explicitly by the adapters that need
// them. No inheritance, no base classes.
//
// Reuses the v0.4 file-filter predicates so v0.5 adapters skip the same
// test/self-source files the v0.4 probes do.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Python files an adapter should scan.
 * Drops: non-.py, test files, scanner self-source, and the v0.5 fixture
 * tree (fixtures are scanned only by the dedicated dogfood harness, never
 * by a live adapter run — otherwise every positive fixture self-reports).
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function pythonFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.py$/i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/**
 * True if a source line is a comment-only line (after leading whitespace it
 * starts with `#`). Used by adapters to skip patterns that appear inside
 * "never do `pickle.load(request.data)`" style teaching comments.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isPythonCommentLine(line) {
  return /^\s*#/.test(line || '');
}
