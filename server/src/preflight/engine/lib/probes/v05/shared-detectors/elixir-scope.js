// src/lib/probes/v05/shared-detectors/elixir-scope.js
//
// Shared scope helper for Elixir adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Elixir files an adapter should scan. Drops
 * non-.ex/.exs, the _test.exs convention, test/ dirs, scanner
 * self-source, and the v0.5 fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function elixirFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.exs?$/i.test(f.path)) return false;
    if (/_test\.exs?$/i.test(f.path)) return false;
    if (/(^|\/)test\//i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/** True if an Elixir source line is a comment-only line. */
export function isElixirCommentLine(line) {
  return /^\s*#/.test(line || '');
}
