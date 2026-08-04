// docdrift.mjs — claims about the code, asserted against the code.
// (The refactor/modularize-and-test branch carries the full docs-vs-code
// sweep; this file starts on main with the structural ratchet so the two
// merge into one suite.)
//
// ── the app.js ratchet ──────────────────────────────────────────────────────
// Rule adopted 2026-08-04: web/public/app.js does not grow again. Every past
// surface landed there because it was the path of least resistance, and four
// reviewers independently named the result. New surfaces go straight to
// web/public/lib/ modules (the pattern the refactor branch proves out). This
// test makes the debt visible on the commit that adds it, not in a survey
// months later. If you SHRANK app.js, ratchet CEILING down to the new count —
// it only ever moves down.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`);
  } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('DOC DRIFT SUITE');

test('web/public/app.js has not grown (ceiling ratchet)', () => {
  const CEILING = 2024; // measured 2026-08-04 (wc -l) — lower it when you shrink app.js, never raise it
  const lines = (read('../web/public/app.js').match(/\n/g) || []).length;
  assert.ok(lines <= CEILING,
    `app.js is ${lines} lines, ceiling ${CEILING} — new code goes in web/public/lib/ modules, not here`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
