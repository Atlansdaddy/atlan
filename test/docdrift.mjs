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
import { STATEMENT, NO_FS_ON_THIS_DEVICE, TIERS } from '../server/src/sandbox/tiers.js';

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

// ── the confinement statements ──────────────────────────────────────────────
// An honest sentence about a security boundary has to have exactly ONE home and
// a test that fails the commit which changes it. server/src/sandbox/tiers.js is
// that home; docs/SECURITY.md quotes it; these assert the quote byte-for-byte.
// This repo has a documented two-week drift recurrence and a recorded case where
// two docs diverged from each other on the same finding — that is what this is
// for, and it is why the check is `includes`, not a fuzzy match.

test('SECURITY.md quotes every tier statement VERBATIM from tiers.js', () => {
  const doc = read('../docs/SECURITY.md');
  for (const t of TIERS) {
    assert.ok(doc.includes(STATEMENT[t]),
      `docs/SECURITY.md does not contain the ${t} statement byte-for-byte — edit server/src/sandbox/tiers.js and re-paste, never the other way round`);
  }
  assert.ok(doc.includes(NO_FS_ON_THIS_DEVICE), 'SECURITY.md is missing the no-Landlock-on-this-device sentence');
});

test('the phone tier never claims a sandbox (the one regression that discredits everything else)', () => {
  const hits = [...STATEMENT.T1.matchAll(/sandbox/gi)];
  assert.strictEqual(hits.length, 1, `the T1 statement says "sandbox" ${hits.length} times; the only permitted use is "is not a sandbox"`);
  assert.match(STATEMENT.T1, /It is not a sandbox\./);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
