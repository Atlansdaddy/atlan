// src/lib/snippet.js
// Build and render the ±ctx-line code snapshot that accompanies each finding. Pure
// functions so the same code runs in probes, in formatters, and in tests.

// Capture ±ctx lines around the finding line. lineNum is 1-based.
export function buildSnippet(content, lineNum, ctx = 5) {
  if (!content || !lineNum) return null;
  const lines = content.split('\n');
  if (lines.length === 0) return null;
  // Clamp into file range — a probe that miscomputes lineNum past EOF still produces a useful snippet
  // anchored at the last real line, rather than an empty / inverted range.
  const clampedHit = Math.min(Math.max(1, lineNum), lines.length);
  const start = Math.max(1, clampedHit - ctx);
  const end = Math.min(lines.length, clampedHit + ctx);
  const out = [];
  for (let i = start; i <= end; i++) {
    out.push({ n: i, text: lines[i - 1] ?? '', isHit: i === clampedHit });
  }
  return { startLine: start, endLine: end, lines: out };
}

export function snippetToText(snippet) {
  if (!snippet) return '';
  return snippet.lines
    .map((l) => `${String(l.n).padStart(4)}${l.isHit ? '> ' : ': '}${l.text}`)
    .join('\n');
}
