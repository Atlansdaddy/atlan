// src/lib/probes/v05/shared-detectors/java-scope.js
//
// Shared scope helper for Java adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Java files an adapter should scan. Drops
 * non-.java, the *Test.java / *Tests.java convention, src/test/ dirs,
 * scanner self-source, and the v0.5 fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function javaFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.java$/i.test(f.path)) return false;
    if (/(?:Test|Tests|IT)\.java$/.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/**
 * True if a Java source line is a line-comment-only line.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isJavaCommentLine(line) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line || '');
}
