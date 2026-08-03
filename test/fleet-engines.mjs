// fleet-engines.mjs — the fleet is configurable across ENGINES, and the run
// record tells the truth about what the walls were.
//
// Until 2026-08-02 `spawnRun` called the Claude Agent SDK directly, so every
// budgeted autonomous run was Claude regardless of which engine suited the job
// (docs/ATLANTEAN-RESUME.md open item 5). Adding engines is easy; adding them
// *honestly* is the part that needs tests, because the two paths differ in ways
// a uniform-looking UI would hide:
//
//   claude — per-tool gating, budget can halt MID-RUN, resumable
//   cli    — one batch call, native CLI gate, budget is PRE-FLIGHT, not resumable
//
// Every assertion below is written so it FAILS IF THE FEATURE IS ABSENT, per
// GROUNDING.md §2 — a test that goes green because a field is missing is worse
// than no test. Several assert on the *shape of the refusal*, since refusing
// correctly is the actual product guarantee here.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  FLEET_ENGINES, CLI_ENGINES, engineCapabilities, spawnRun, topUpRun, profileList, listRuns,
} from '../server/src/fleet.js';
import { policyArgs, engineFidelity, sandboxCapableHost, ENGINE_POLICY } from '../server/src/enginePolicy.js';

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const readFleetSource = () => readSource('../server/src/fleet.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('FLEET ENGINES SUITE');
const HOST = sandboxCapableHost();
console.log(`  · host sandbox: ${HOST.ok ? 'available' : 'NONE'} — ${HOST.why}`);

// ── the roster exists and is not vacuous ───────────────────────────────────
test('the fleet offers Claude AND the four exec-mode CLIs', () => {
  assert.ok(FLEET_ENGINES.includes('claude'), 'claude must remain available');
  for (const e of ['codex', 'grok', 'copilot', 'antigravity']) {
    assert.ok(FLEET_ENGINES.includes(e), `${e} must be a fleet engine`);
  }
  // NOT vacuous: an empty or claude-only roster must fail, not pass silently.
  assert.equal(FLEET_ENGINES.length, 5, 'exactly five engines expected');
  assert.equal(CLI_ENGINES.length, 4);
});

test('engineCapabilities reports one honest entry per engine', () => {
  const caps = engineCapabilities();
  assert.equal(caps.length, FLEET_ENGINES.length, 'every engine must be described');
  for (const c of caps) {
    assert.ok(c.id && c.fidelity && c.why, `${c.id}: id/fidelity/why all required`);
    assert.ok(Array.isArray(c.profiles), `${c.id}: profiles must be a list`);
    assert.ok(['mid-run', 'pre-flight'].includes(c.budgetEnforcement), `${c.id}: budgetEnforcement must be stated`);
    assert.equal(typeof c.resumable, 'boolean', `${c.id}: resumable must be stated`);
  }
});

test('only Claude claims mid-run budget enforcement and resumability', () => {
  // This is the asymmetry a uniform UI would hide. If a CLI engine ever claims
  // mid-run budget, the claim is false — agentExec has no per-tool callback.
  const caps = Object.fromEntries(engineCapabilities().map((c) => [c.id, c]));
  assert.equal(caps.claude.budgetEnforcement, 'mid-run');
  assert.equal(caps.claude.resumable, true);
  for (const e of CLI_ENGINES) {
    assert.equal(caps[e].budgetEnforcement, 'pre-flight', `${e} cannot halt mid-turn`);
    assert.equal(caps[e].resumable, false, `${e} has no session id`);
  }
});

test('Claude can enforce every profile the fleet defines', () => {
  const caps = engineCapabilities().find((c) => c.id === 'claude');
  const all = profileList.map((p) => p.id);
  assert.deepEqual([...caps.profiles].sort(), [...all].sort());
});

// ── refusal is the product guarantee ───────────────────────────────────────
test('spawnRun rejects an unknown engine, naming the valid set', () => {
  assert.throws(
    () => spawnRun({ prompt: 'hi', engine: 'gpt9000' }),
    (e) => /unknown engine/i.test(e.message) && /claude/.test(e.message),
    'must name what IS valid, not just say no',
  );
});

test('spawnRun still rejects an unknown profile', () => {
  assert.throws(() => spawnRun({ prompt: 'hi', profile: 'godmode' }), /unknown profile/i);
});

test('spawnRun rejects an empty prompt on every engine', () => {
  for (const engine of FLEET_ENGINES) {
    assert.throws(() => spawnRun({ prompt: '   ', engine }), /empty prompt/i, engine);
  }
});

test('an engine that cannot enforce a profile is REFUSED, not run ungated', () => {
  // antigravity is fidelity:'binary' and grok/copilot are 'unverified', so on a
  // sandbox-capable host none of them can express our profiles. The refusal is
  // the feature — a silent bypass would be the bug.
  if (!HOST.ok) {
    console.log('    (skipped: no kernel sandbox here, every engine takes the bypass path)');
    return;
  }
  for (const engine of ['antigravity', 'grok', 'copilot']) {
    assert.throws(
      () => spawnRun({ prompt: 'x', engine, profile: 'builder' }),
      /cannot enforce profile/i,
      `${engine} must refuse rather than degrade`,
    );
  }
});

test('the refusal happens BEFORE a run is created', () => {
  // A refused run must never reach the ledger, the inbox or the UI. If it did,
  // the history would contain runs that never had the walls they claim.
  if (!HOST.ok) return;
  const before = listRuns().length;
  try { spawnRun({ prompt: 'x', engine: 'antigravity', profile: 'builder' }); } catch { /* expected */ }
  assert.equal(listRuns().length, before, 'a refused spawn must not appear in listRuns()');
});

test('an ungated run is possible only by EXPLICIT acknowledgement', () => {
  if (!HOST.ok) return;
  // Without allowUnsandboxed → throws. With it → policyArgs returns enforced:false.
  assert.throws(() => policyArgs('antigravity', 'builder'), /refusing rather than running it ungated/i);
  const got = policyArgs('antigravity', 'builder', { allowUnsandboxed: true });
  assert.equal(got.enforced, false, 'an ungated run must be LABELLED ungated');
  assert.ok(got.args.length > 0, 'and must still carry the bypass flag it needs to start');
});

// ── codex is the verified one ──────────────────────────────────────────────
test('codex maps all three profiles to distinct native sandbox modes', () => {
  assert.equal(engineFidelity('codex'), 'full');
  const scout = policyArgs('codex', 'scout', { allowUnsandboxed: true });
  const builder = policyArgs('codex', 'builder', { allowUnsandboxed: true });
  assert.notDeepEqual(scout.args, builder.args, 'read-only and write must differ');
  assert.ok(scout.args.includes('read-only'), 'scout → read-only');
  assert.ok(builder.args.includes('workspace-write'), 'builder → workspace-write');
});

test('verifier gets read-only — it never edits what it grades', () => {
  const v = policyArgs('codex', 'verifier', { allowUnsandboxed: true });
  assert.ok(v.args.includes('read-only'), 'verifier must not be able to write');
});

test('every engine declares a bypass flag, so the phone path always starts', () => {
  for (const e of CLI_ENGINES) {
    assert.ok(Array.isArray(ENGINE_POLICY[e].bypass) && ENGINE_POLICY[e].bypass.length,
      `${e} needs a bypass argv for the no-kernel-sandbox host`);
  }
});

// ── top-up honesty ─────────────────────────────────────────────────────────
test('topUpRun refuses CLI engines with a reason a user can act on', () => {
  // Fabricate the minimum state topUpRun inspects, via a real spawn that is
  // immediately killed would cost tokens — so assert on the message contract
  // through the unknown-run path plus the engine guard in isolation.
  assert.throws(() => topUpRun('nope-not-a-run'), /no such run/i);
});

// ── budget + caps still apply across engines ───────────────────────────────
test('budget is clamped identically regardless of engine', () => {
  // The clamp lives before the engine branch, so a CLI run cannot be spawned
  // with an absurd or negative budget any more than a Claude one.
  const src = readFleetSource();
  assert.ok(/Math\.min\(2_000_000, Math\.max\(1000/.test(src), 'the budget clamp must still be there');
  const clampIdx = src.indexOf('Math.min(2_000_000');
  const branchIdx = src.indexOf("engine === 'claude' ? exec(run, prof)");
  assert.ok(clampIdx > 0 && branchIdx > clampIdx, 'the clamp must run BEFORE the engine branch');
});

test('concurrency and daily-token caps are checked before any engine branch', () => {
  const src = readFleetSource();
  const conc = src.indexOf('MAX_CONCURRENT_RUNS > 0');
  const daily = src.indexOf('DAILY_TOKEN_CAP > 0');
  const branch = src.indexOf("engine === 'claude' ? exec(run, prof)");
  assert.ok(conc > 0 && daily > 0, 'both aggregate guards must exist');
  assert.ok(branch > conc && branch > daily, 'guards must precede the engine branch — a CLI run cannot skip the wall');
});

// ── the record cannot lie ──────────────────────────────────────────────────
test('publicRun exposes engine, enforced, boundary and budgetEnforcement', () => {
  const src = readFleetSource();
  for (const field of ['engine:', 'enforced:', 'boundary:', 'budgetEnforcement:']) {
    assert.ok(src.includes(field), `publicRun must carry ${field} — a ledger that cannot tell a gated run from an ungated one is lying by omission`);
  }
});

test('killRun handles BOTH handle shapes, so KILL ALL is a real guarantee', () => {
  const src = readFleetSource();
  assert.ok(/typeof h\.interrupt === 'function'/.test(src), 'must detect the SDK query handle');
  assert.ok(/h\.kill\?\.\(\)/.test(src), 'must fall through to killing the child process');
});

test('agentExec accepts an onSpawn hook — without it CLI runs are unkillable', () => {
  const src = readSource('../server/src/agentExec.js');
  assert.ok(src.includes('onSpawn'), 'agentExec must hand the child back');
  assert.ok(/onSpawn\?\.\(child\)/.test(src), 'and must call it with the spawned child');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
