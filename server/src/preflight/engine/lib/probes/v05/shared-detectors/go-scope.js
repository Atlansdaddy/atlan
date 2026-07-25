// src/lib/probes/v05/shared-detectors/go-scope.js
//
// Shared scope helper for Go adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Go files an adapter should scan. Drops
 * non-.go, Go's _test.go convention, scanner self-source, and the v0.5
 * fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function goFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.go$/i.test(f.path)) return false;
    if (/_test\.go$/i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/**
 * True if a Go source line is a line-comment-only line.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isGoCommentLine(line) {
  return /^\s*\/\//.test(line || '');
}
