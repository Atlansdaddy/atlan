// src/lib/probes/v05/shared-detectors/swift-scope.js
//
// Shared scope helper for Swift adapters. Mirrors the other *-scope.js.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

/**
 * Filter a file list to the Swift files an adapter should scan. Drops
 * non-.swift, the *Tests.swift convention, src/test dirs, scanner
 * self-source, and the v0.5 fixture tree.
 *
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, content: string}>}
 */
export function swiftFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => {
    if (!f || typeof f.path !== 'string') return false;
    if (!/\.swift$/i.test(f.path)) return false;
    if (/(?:Tests?|Spec)\.swift$/.test(f.path)) return false;
    if (isTestFile(f.path)) return false;
    if (isScannerSelfSource(f.path)) return false;
    if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
    return true;
  });
}

/** True if a Swift source line is a line/block-comment-only line. */
export function isSwiftCommentLine(line) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line || '');
}
