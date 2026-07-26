// src/lib/probes/v05/shared-detectors/scala-scope.js
//
// Shared scope helper for Scala adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Scala files an adapter should scan. Drops
 * non-.scala/.sc, the *Test/*Spec/*Suite convention, test dirs, scanner
 * self-source, and the v0.5 fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function scalaFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.(?:scala|sc)$/i.test(f.path)) return false;
    if (/(?:Test|Spec|Suite)\.scala$/.test(f.path)) return false;
    if (/(^|\/)src\/test\//i.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/** True if a Scala source line is a line/block-comment-only line. */
export function isScalaCommentLine(line) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line || '');
}
