// src/lib/probes/v05/shared-detectors/php-scope.js
//
// Shared scope helper for PHP adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the PHP files an adapter should scan. Drops
 * non-.php, the *Test.php convention, tests/ dirs, scanner self-source,
 * and the v0.5 fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function phpFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.php$/i.test(f.path)) return false;
    if (/(?:Test|TestCase)\.php$/.test(f.path)) return false;
    if (/(^|\/)tests?\//i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/** True if a PHP source line is a comment-only line (// # * /*). */
export function isPhpCommentLine(line) {
  return /^\s*(?:\/\/|#|\*|\/\*)/.test(line || '');
}
