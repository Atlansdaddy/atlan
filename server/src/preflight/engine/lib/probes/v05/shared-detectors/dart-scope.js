// src/lib/probes/v05/shared-detectors/dart-scope.js
//
// Shared scope helper for Dart adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Dart files an adapter should scan. Drops
 * non-.dart, the _test.dart convention, test/ dirs, scanner
 * self-source, and the v0.5 fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function dartFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.dart$/i.test(f.path)) return false;
    if (/_test\.dart$/i.test(f.path)) return false;
    if (/(^|\/)test\//i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/** True if a Dart source line is a line/block-comment-only line. */
export function isDartCommentLine(line) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line || '');
}
