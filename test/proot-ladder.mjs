// The ladder measured through a ptrace supervisor — the context Atlan actually
// runs in on a phone.
//
// This exists because on 2026-08-07 the default tier was raised to T1 on the
// strength of a bare-kernel measurement (15/15 on WSL2, 14/15 on a real Android
// 15 kernel). Both were true and neither was the environment: Atlan runs inside
// proot on Termux, and under proot the same binary scores 11/15 — including two
// T1 rungs. A T1 default would have refused every agent run on the primary
// platform. The fail-closed design would have worked and the product would not.
//
// So the rule this file pins: A TIER MEASURED WITHOUT THE SUPERVISOR IS NOT A
// MEASUREMENT OF THIS PRODUCT. If proot is available here, the ladder is
// measured through it and the difference is asserted to be visible — because the
// day it stops being visible is the day someone raises the default again on
// numbers from the wrong context.
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { ensureBinary } from '../server/src/sandbox/build.js';
import { REQUIRES, tierFromRungs, dominates } from '../server/src/sandbox/tiers.js';

let pass = 0, fail = 0, skip = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) {
    if (e && e.__skip) { skip++; console.log(`  ⊘ ${name} — SKIPPED: ${e.message}`); return; }
    fail++; console.log(`  ✗ ${name} — ${e.message}`);
  }
};
const skipIf = (why) => { const e = new Error(why); e.__skip = true; throw e; };

console.log('PROOT LADDER SUITE');

const haveProot = spawnSync('proot', ['--version'], { encoding: 'utf8' }).status === 0;
let bin = null;
try { bin = ensureBinary().bin; } catch { /* no toolchain */ }

const ladder = (argv) => {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 60000 });
  if (!r.stdout || !r.stdout.trim()) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
};
const green = (v) => new Set(v.rungs.filter((r) => r.ok).map((r) => r.id));

test('the launcher builds on this host', () => {
  if (!bin) skipIf('no working compiler here — build.js found none that compiles AND runs');
  assert.ok(bin, 'ensureBinary must return a path');
});

test('bare-kernel ladder is measurable (the control)', () => {
  if (!bin) skipIf('no launcher');
  const v = ladder([bin, '--probe']);
  assert.ok(v, '--probe produced no parseable output');
  assert.ok(v.rungs.length >= 10, `expected the full ladder, got ${v.rungs.length} rungs`);
});

test('a ptrace supervisor is DETECTED, never silently tolerated', () => {
  if (!bin) skipIf('no launcher');
  if (!haveProot) skipIf('proot not installed on this host');
  const v = ladder(['proot', '-0', bin, '--probe']);
  assert.ok(v, 'the probe produced nothing under proot');
  const arb = v.rungs.find((r) => r.id === 'ptrace-arbitration');
  assert.ok(arb, 'the ptrace-arbitration rung must exist');
  assert.equal(arb.ok, false,
    'under proot this rung MUST fail — it is the only thing that notices something is between us and the kernel');
});

test('the supervisor measurably costs tiers, and the loss is visible', () => {
  if (!bin) skipIf('no launcher');
  if (!haveProot) skipIf('proot not installed on this host');
  const bare = ladder([bin, '--probe']);
  const under = ladder(['proot', '-0', bin, '--probe']);
  assert.ok(bare && under, 'both measurements must parse');
  const lost = [...green(bare)].filter((id) => !green(under).has(id));
  assert.ok(lost.length > 0,
    'proot cost nothing here — if that is genuinely true the T1 default can be revisited, but verify it rather than assuming the suite is stale');
  console.log(`      rungs lost under proot: ${lost.join(', ')}`);
});

test('T1 is NOT establishable under proot on this host (why the default is T0)', () => {
  if (!bin) skipIf('no launcher');
  if (!haveProot) skipIf('proot not installed on this host');
  const under = ladder(['proot', '-0', bin, '--probe']);
  const have = green(under);
  const missing = REQUIRES.T1.filter((id) => !have.has(id));
  assert.ok(missing.length > 0,
    'T1 now holds under proot — that is good news and the default should be re-examined DELIBERATELY, with a phone transcript, not by deleting this test');
  console.log(`      T1 rungs missing under proot: ${missing.join(', ')}`);
});

test('but the supervised tier IS established under proot — the phone is not T0', () => {
  // The other half, and the reason TS exists. "T1 is not establishable here" was
  // true and was read as "nothing is establishable here", which cost the primary
  // platform its egress boundary. A device with a supervisor still holds every
  // rung the supervisor does not arbitrate, and TS is exactly that set.
  if (!bin) skipIf('no launcher');
  if (!haveProot) skipIf('proot not installed on this host');
  const under = ladder(['proot', '-0', bin, '--probe']);
  const tier = tierFromRungs(under.rungs);
  assert.strictEqual(tier, 'TS',
    `under proot this device establishes ${tier} — if that is genuinely right, the ladder changed and this needs re-deciding with a device transcript`);
  assert.strictEqual(dominates(tier, 'T1'), false, 'TS must never satisfy a run that declared T1');
  const missing = REQUIRES.TS.filter((id) => !green(under).has(id));
  assert.deepStrictEqual(missing, [], `TS rungs missing under proot: ${missing.join(', ')}`);
});

test('the egress boundary — the one real kernel wall on a phone — survives the supervisor', () => {
  if (!bin) skipIf('no launcher');
  if (!haveProot) skipIf('proot not installed on this host');
  const under = ladder(['proot', '-0', bin, '--probe']);
  const e = under.rungs.find((r) => r.id === 'egress-denial');
  assert.ok(e?.ok, `egress denial does not hold under proot: ${e?.detail} — TS promises it, so TS would have to be withdrawn`);
  assert.match(e.detail, /BASELINE|baseline/i, 'without the baseline leg, airplane mode and egress denial are indistinguishable');
});

test('PROOT_NO_SECCOMP does not rescue it (so it is the stacking, not the acceleration)', () => {
  if (!bin) skipIf('no launcher');
  if (!haveProot) skipIf('proot not installed on this host');
  const r = spawnSync('proot', ['-0', bin, '--probe'], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, PROOT_NO_SECCOMP: '1' },
  });
  let v = null;
  try { v = JSON.parse(r.stdout); } catch { /* handled below */ }
  assert.ok(v, 'no parseable ladder with PROOT_NO_SECCOMP=1');
  const missing = REQUIRES.T1.filter((id) => !green(v).has(id));
  assert.ok(missing.length > 0,
    'disabling proot seccomp restored T1 — then the fix is to detect and adapt, and this test should become that assertion');
});

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
process.exit(fail ? 1 : 0);
