// src/lib/probes/v05/shared-detectors/c-family-scope.js
//
// Shared scope helpers for the C and C++ adapters. C and C++ share comment
// syntax and most detection surfaces (libcurl / OpenSSL / sqlite); the file
// extension is the only thing that splits them.

import { isTestFile, isScannerSelfSource } from '../../../file-filter.js';

const C_EXT_RE = /\.(?:c|h)$/i;
const CPP_EXT_RE = /\.(?:cpp|cc|cxx|c\+\+|hpp|hh|hxx)$/i;
const C_TEST_RE = /_(?:test|unittest|spec)\.(?:c|h|cpp|cc|cxx|hpp|hh|hxx)$/i;

function common(f) {
  if (!f || typeof f.path !== 'string') return false;
  if (C_TEST_RE.test(f.path)) return false;
  if (isTestFile(f.path)) return false;
  if (isScannerSelfSource(f.path)) return false;
  if (/(^|\/)src\/lib\/probes\/v05\/fixtures\//i.test(f.path)) return false;
  return true;
}

/** C translation units / headers. */
export function cFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => common(f) && C_EXT_RE.test(f.path));
}

/** C++ translation units / headers. */
export function cppFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((f) => common(f) && CPP_EXT_RE.test(f.path));
}

/** True if a C/C++ source line is a line/block-comment-only line. */
export function isCFamilyCommentLine(line) {
  return /^\s*(?:\/\/|\*|\/\*)/.test(line || '');
}
