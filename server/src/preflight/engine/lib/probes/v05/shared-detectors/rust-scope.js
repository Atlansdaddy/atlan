// src/lib/probes/v05/shared-detectors/rust-scope.js
//
// Shared scope helper for Rust adapters. Mirrors python-scope.js /
// javascript-scope.js. Families own no execution logic; cross-cutting
// helpers like this live here and are imported explicitly.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Rust files an adapter should scan.
 * Drops: non-.rs, test files, scanner self-source, and the v0.5 fixture
 * tree (fixtures are scanned only by the dedicated harness).
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function rustFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.rs$/i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    // Rust unit tests live in-file behind #[cfg(test)] / #[test]; those
    // modules intentionally contain the vulnerable call. Whole-file skip is
    // too blunt, so adapters additionally skip lines inside a #[cfg(test)]
    // module via isRustTestContext if they need to. Path-level we still
    // drop the conventional tests/ integration dir (handled by isTestFile).
    return true;
  });
}

/**
 * True if a Rust source line is a line-comment-only line (after leading
 * whitespace it starts with `//`). Block comments are not tracked here;
 * adapters that need block-comment awareness handle it explicitly.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isRustCommentLine(line) {
  return /^\s*\/\//.test(line || '');
}
