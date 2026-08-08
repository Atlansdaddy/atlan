// docdrift.mjs — the docs' factual claims are asserted against the CODE.
//
// A full sweep of all 42 docs on 2026-08-02 found drift in both directions in
// three separate places: work done that a doc never closed, and work planned
// that a doc claimed done. Two documents describing one codebase had even
// diverged from EACH OTHER in opposite directions on the same finding.
//
// Prose cannot be made to stop rotting by asking people to be careful. The
// counts in ARCHITECTURE.md "What exists today" are the highest-rot claims in
// the repo — tabs, engines, templates were all wrong, and each had been wrong
// since the commit that changed the count. This suite makes that commit fail
// instead of the next reader.
//
// DOC-STATUS-CONVENTION.md is the written rule; this file is its enforcement.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { FLEET_ENGINES } from '../server/src/fleet.js';
import { STATEMENT, NO_FS_ON_THIS_DEVICE, SUPERVISOR_ON_THIS_DEVICE, TIERS } from '../server/src/sandbox/tiers.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('DOC DRIFT SUITE');

const ARCH = read('../docs/ARCHITECTURE.md');
const INDEX_HTML = read('../web/public/index.html');
const AGENTS = read('../server/src/agents.js');

// ── tabs ───────────────────────────────────────────────────────────────────
const tabIds = [...new Set([...INDEX_HTML.matchAll(/data-s="s-([a-z-]+)"/g)].map((m) => m[1]))];

test('the real tab count is discoverable from index.html', () => {
  // Guards the guard: if the selector ever changes, this fails LOUDLY rather
  // than letting every assertion below pass against an empty list.
  assert.ok(tabIds.length >= 5, `found only ${tabIds.length} tabs — the selector is probably wrong, not the app`);
});

test('ARCHITECTURE.md states the CORRECT number of tabs', () => {
  const words = { 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };
  const word = words[tabIds.length];
  assert.ok(word, `no word for ${tabIds.length} tabs — extend the map`);
  assert.ok(
    new RegExp(`\\*\\*${word}\\s+tabs\\*\\*|${word}\\s+tabs`, 'i').test(ARCH),
    `index.html has ${tabIds.length} tabs (${tabIds.join(', ')}) but ARCHITECTURE.md does not say "${word} tabs"`,
  );
});

test('every real tab is NAMED in ARCHITECTURE.md', () => {
  // A count can be right while the list is wrong — Scan and Git were both
  // missing while the number was merely stale.
  const missing = tabIds.filter((t) => !new RegExp(`\\b${t}\\b`, 'i').test(ARCH));
  assert.equal(missing.length, 0, `tabs present in the app but absent from the doc: ${missing.join(', ')}`);
});

// ── engines ────────────────────────────────────────────────────────────────
const cliEngines = [...new Set([...AGENTS.matchAll(/engine === '([a-z]+)'/g)].map((m) => m[1]))];

test('the real CLI engine list is discoverable from agents.js', () => {
  assert.ok(cliEngines.length >= 3, `found only ${cliEngines.length} engines — selector likely wrong`);
});

test('every CLI engine in agents.js is NAMED in ARCHITECTURE.md', () => {
  // Copilot was in the code and missing from the doc's Class 1 list, while the
  // sentence below it already assumed the higher count.
  const missing = cliEngines.filter((e) => !new RegExp(e, 'i').test(ARCH));
  assert.equal(missing.length, 0, `engines in agents.js but absent from ARCHITECTURE.md: ${missing.join(', ')}`);
});

test('every fleet engine is NAMED in ARCHITECTURE.md', () => {
  const missing = FLEET_ENGINES.filter((e) => !new RegExp(e, 'i').test(ARCH));
  assert.equal(missing.length, 0, `fleet engines undocumented: ${missing.join(', ')}`);
});

// ── templates ──────────────────────────────────────────────────────────────
const templates = [...new Set([...INDEX_HTML.matchAll(/<option value="([a-z]*)">/g)]
  .map((m) => m[1]))].filter(Boolean);

test('every visual template offered in the UI is NAMED in ARCHITECTURE.md', () => {
  // Glass shipped with the helis merge; the doc still said "Classic + MidAtlantic".
  const known = { midatlantic: 'MidAtlantic', his: 'Glass' };
  const missing = Object.entries(known)
    .filter(([id]) => templates.includes(id))
    .filter(([, label]) => !new RegExp(label, 'i').test(ARCH))
    .map(([, label]) => label);
  assert.equal(missing.length, 0, `templates in the UI but absent from the doc: ${missing.join(', ')}`);
});

// ── the convention itself ──────────────────────────────────────────────────
test('the suite count in run-all.mjs matches what REVIEW-FOR-AI.md claims', () => {
  // REVIEW-FOR-AI.md is PUBLIC copy handed to external reviewers, so a stale
  // number there is the most costly kind. It said 152 tests / 10 suites long
  // after the suite had grown past it.
  const runAll = read('./run-all.mjs');
  const declared = (runAll.match(/^\s{2}\['/gm) || []).length;
  assert.ok(declared >= 10, `only ${declared} suites parsed — selector likely wrong`);
  const claim = read('../docs/REVIEW-FOR-AI.md').match(/(\d+)\s+suites/);
  assert.ok(claim, 'REVIEW-FOR-AI.md must state a suite count');
  // run-all declares PAID conditionally, so allow the claim to be within one.
  assert.ok(Math.abs(Number(claim[1]) - declared) <= 1,
    `REVIEW-FOR-AI.md claims ${claim[1]} suites, run-all.mjs declares ${declared}`);
});

// ── the STRUCTURAL ratchet (merged from main, 2026-08-04) ──────────────────
// The docs ratchet above stops PROSE rotting. This one stops DEBT growing.
//
// Every past surface landed in app.js because it was the path of least
// resistance, and four reviewers independently named the result. New surfaces
// go straight to web/public/lib/ modules — the pattern the extraction proves
// out. This makes the debt visible on the commit that adds it rather than in a
// survey months later.
//
// The ceiling ONLY EVER MOVES DOWN. If you shrink app.js, re-measure and lower
// it; never raise it to make a commit pass.
test('web/public/app.js has not grown (ceiling ratchet)', () => {
  const CEILING = 1991; // measured 2026-08-08, after the rung chip joined lib/richmsg.js
  const lines = (read('../web/public/app.js').match(/\n/g) || []).length;
  assert.ok(lines <= CEILING,
    `app.js is ${lines} lines, ceiling ${CEILING} — new code goes in web/public/lib/ modules, not here`);
});

test('the lib/ extraction target exists and is non-trivial', () => {
  // Guards the guard: a ceiling with nowhere to put the code is just a blocker.
  // If lib/ were empty the ratchet would read as "stop working" rather than
  // "put it over there".
  assert.ok(/export function/.test(read('../web/public/lib/text.js')), 'lib/text.js must export real helpers');
  assert.ok(/export function/.test(read('../web/public/lib/ambient.js')), 'lib/ambient.js must export real helpers');
});

test('DOC-STATUS-CONVENTION.md exists and defines all four statuses', () => {
  const conv = read('../docs/DOC-STATUS-CONVENTION.md');
  for (const s of ['OPEN', 'PLANNED', 'PARTIAL', 'CLOSED']) {
    assert.ok(conv.includes(s), `the convention must define ${s}`);
  }
});

test('the docs that make security claims carry a verification stamp', () => {
  // These are the ones whose staleness has real consequences.
  for (const f of ['../docs/SECURITY.md', '../docs/ARCHITECTURE.md']) {
    assert.ok(/[Vv]erified/.test(read(f)), `${f} must carry a verification stamp, not just an edit date`);
  }
});

test('SECURITY.md distinguishes PARTIAL from OPEN', () => {
  // Forcing a binary on a non-binary reality is what produced the divergence:
  // "unauthenticated" and "fine" were both wrong about the preview proxy.
  const sec = read('../docs/SECURITY.md');
  assert.ok(/PARTIAL/.test(sec), 'a gap with one vector closed and one open must be able to say so');
  assert.ok(/OPEN/.test(sec), 'and fully-open gaps must still be marked');
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
  assert.ok(doc.includes(SUPERVISOR_ON_THIS_DEVICE), 'SECURITY.md is missing the supervisor-on-this-device sentence');
});

test('the phone tier never claims a sandbox (the one regression that discredits everything else)', () => {
  // TS is the phone tier now; T1 is what a bare kernel with no supervisor holds.
  // Both must carry the disclaimer — the tier that runs on the primary platform
  // is the one whose wording gets screenshotted.
  for (const t of ['TS', 'T1']) {
    const hits = [...STATEMENT[t].matchAll(/sandbox/gi)];
    assert.strictEqual(hits.length, 1, `the ${t} statement says "sandbox" ${hits.length} times; the only permitted use is "is not a sandbox"`);
    assert.match(STATEMENT[t], /It is not a sandbox\./);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
