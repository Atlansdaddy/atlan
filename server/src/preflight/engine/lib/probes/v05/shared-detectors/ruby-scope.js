// src/lib/probes/v05/shared-detectors/ruby-scope.js
//
// Shared scope helper for Ruby adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Ruby files an adapter should scan. Drops
 * non-.rb, the _spec.rb / _test.rb conventions, spec/ test/ dirs,
 * scanner self-source, and the v0.5 fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function rubyFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.rb$/i.test(f.path)) return false;
    if (/_(?:spec|test)\.rb$/i.test(f.path)) return false;
    if (/(^|\/)(?:spec|test)\//i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/** True if a Ruby source line is a comment-only line. */
export function isRubyCommentLine(line) {
  return /^\s*#/.test(line || '');
}
