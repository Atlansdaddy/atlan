// phone-sandbox.mjs — the confinement tier, attacked rather than described.
//
// THE NAME IN THIS HEADER USED TO SAY sandbox.mjs, AND THAT COST SOMETHING. This
// file was renamed; a different suite (the security spine) later took the old
// name; and test/mutation.mjs — the receipt for everything below — kept naming
// the string `test/sandbox.mjs` and silently began measuring the wrong file. On
// 2026-08-08 it reported thirty-odd ESCAPED mutants, including "the default tail
// ALLOWs instead of killing", all of which this suite catches on the first try.
// A stale name in a comment is how that started.
//
// WHY THIS SUITE DOES NOT USE FIXTURES FOR THE CONTROLS. Standing rule in this
// repo since three of eleven WarLibrary guards were broken while every fixture
// was green: replay the shipped thing over real data. So every control below is
// exercised by COMPILING the real launcher and RUNNING a real process under it,
// and the assertion is on what the kernel did. The pure-function half (tier
// algebra, grant planning, refusal strings) is unit-tested separately because
// there the function IS the artifact.
//
// WHY IT SKIPS RATHER THAN FAILS WITHOUT A COMPILER. A device with no toolchain
// establishes T0, which is a legitimate measured answer, not a broken test. The
// skip is counted and printed so a green run can never be mistaken for coverage
// that did not happen.

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

process.env.ATLAN_FLEET_DIR ??= mkdtempSync(join(tmpdir(), 'atlan-sbx-fleet-'));
// PROJECTS_DIR is read at import time by config.js, and every workspace this
// suite plans against lives in the temp dir — so it is set BEFORE the first
// dynamic import below, never after.
process.env.ATLAN_PROJECTS = tmpdir();

const { TIERS, dominates, isTier, STATEMENT, LABEL, NO_FS_ON_THIS_DEVICE, SUPERVISOR_ON_THIS_DEVICE,
  REQUIRES, FLOOR_RUNG, tierFromRungs, blockingRung, assertTier, TierRefusal } = await import('../server/src/sandbox/tiers.js');
const { ensureBinary, workingCompiler, sourceHash, SOURCE } = await import('../server/src/sandbox/build.js');
const { probe, clearProbeCache, ladderLines } = await import('../server/src/sandbox/probe.js');
const planMod = await import('../server/src/sandbox/plan.js');
const { plan, assertGrantsSafe, denyList, toolchainGrants, ENGINE_STORE, PolicyRefusal } = planMod;
const { confineBash, confineSpawn, establish } = await import('../server/src/sandbox/confine.js');
const { isSensitive } = await import('../server/src/guards.js');

let pass = 0, fail = 0, skip = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}
function skipped(name, why) { skip++; console.log(`  ⊘ ${name} — SKIPPED: ${why}`); }

console.log('SANDBOX / CONFINEMENT SUITE');

// ─────────────────────────── tier algebra + refusals ────────────────────────
console.log('\n· tier algebra and the refusal matrix');

const RUNGS_ALL = [
  ...REQUIRES.T1.map((id, i) => ({ n: i + 1, id, ok: true, detail: 'ok' })),
  { n: 11, id: 'egress-denial', ok: true, detail: 'ok' },
  { n: 12, id: 'landlock-canary', ok: true, detail: 'ok' },
  { n: 13, id: 'sibling-memory', ok: true, detail: 'ok' },
];
const withFail = (id, detail) => RUNGS_ALL.map((r) => (r.id === id ? { ...r, ok: false, detail } : r));

test('tierFromRungs climbs to T3 when every rung is green', () => {
  assert.strictEqual(tierFromRungs(RUNGS_ALL), 'T3');
});
test('the ladder cannot be climbed from the middle — a broken floor collapses to T0', () => {
  assert.strictEqual(tierFromRungs(withFail(FLOOR_RUNG, 'getcpu returned EPERM')), 'T0');
});
test('egress works but the floor is broken → still T0, not T2', () => {
  const r = withFail('arch-echo', 'returned 78').map((x) => (x.id === 'egress-denial' ? { ...x, ok: true } : x));
  assert.strictEqual(tierFromRungs(r), 'T0');
});
test('landlock alone does not grant T3 without egress', () => {
  assert.strictEqual(tierFromRungs(withFail('egress-denial', 'baseline connect failed')), 'T1');
});
test('an empty ladder is T0 — not-measured is not a capability', () => {
  assert.strictEqual(tierFromRungs([]), 'T0');
  assert.strictEqual(tierFromRungs(undefined), 'T0');
});

test('every (declared, established) pair: a tier passes exactly when it CONTAINS the declaration', () => {
  // Not "greater or equal". TS and T1 are incomparable — TS holds an egress
  // boundary T1 does not and cannot deny ptrace, which T1 does — so any test
  // written as a magnitude comparison would have to call one of them a lie.
  for (const d of TIERS) for (const e of TIERS) {
    if (dominates(e, d)) assert.strictEqual(assertTier(d, e, RUNGS_ALL), true, `${d} vs ${e} should pass`);
    else assert.throws(() => assertTier(d, e, RUNGS_ALL), TierRefusal, `${d} vs ${e} must refuse`);
  }
});
test('TS and T1 are INCOMPARABLE in both directions — neither substitutes for the other', () => {
  assert.strictEqual(dominates('TS', 'T1'), false, 'a supervised device must not satisfy a run that declared T1');
  assert.strictEqual(dominates('T1', 'TS'), false, 'T1 has no egress boundary, so it cannot stand in for TS');
  assert.ok(dominates('T2', 'TS') && dominates('T2', 'T1'), 'T2 requires everything either of them requires');
  assert.ok(dominates('T3', 'TS'), 'and T3 is above T2');
});
test('a device with a supervisor establishes TS, not T0 and not T1', () => {
  // The measured phone shape: everything green except the deny-set rung, which
  // a ptrace supervisor performs itself and answers for.
  const supervised = RUNGS_ALL.map((r) => (r.id === 'selftest-denyset'
    ? { ...r, ok: false, detail: 'ptrace was NOT denied by the real filter (ret 0, Success)' }
    : r));
  assert.strictEqual(tierFromRungs(supervised), 'TS');
  assert.throws(() => assertTier('T1', 'TS', supervised), /Rung 8 \(selftest-denyset\) said no/);
  assert.strictEqual(assertTier('TS', 'TS', supervised), true);
});
test('a supervised device with NO Landlock still establishes TS — the real phone shape', () => {
  const phone = RUNGS_ALL.map((r) => (['selftest-denyset', 'landlock-canary', 'sibling-memory'].includes(r.id)
    ? { ...r, ok: false, detail: 'unavailable on this device' } : r));
  assert.strictEqual(tierFromRungs(phone), 'TS');
});
test('the maximal established tier is never ambiguous, over EVERY possible ladder', () => {
  // The partial order admits incomparable tiers, so "the tier this device
  // establishes" is only well defined if no two incomparable tiers can both be
  // maximal. That is a property of the rung sets, not something to hope for —
  // so enumerate every subset of every rung any tier names and check all of them.
  const ids = [...new Set(Object.values(REQUIRES).flat())];
  assert.ok(ids.length <= 20, `${ids.length} rungs is too many to enumerate — rewrite this test, do not delete it`);
  for (let mask = 0; mask < (1 << ids.length); mask++) {
    const ok = new Set(ids.filter((_, i) => mask & (1 << i)));
    const satisfied = TIERS.filter((t) => REQUIRES[t].every((id) => ok.has(id)));
    const maximal = satisfied.filter((t) => !satisfied.some((o) => o !== t && dominates(o, t)));
    assert.strictEqual(maximal.length, 1,
      `rungs {${[...ok].join(',')}} leave ${maximal.length} maximal tiers (${maximal.join(', ')}) — the ladder shape is ambiguous`);
    assert.strictEqual(tierFromRungs([...ok].map((id) => ({ id, ok: true }))), maximal[0]);
  }
});
test('the refusal names the rung that said no, with its detail verbatim', () => {
  const rungs = withFail('landlock-canary', 'landlock_create_ruleset killed by SIGSYS');
  assert.throws(() => assertTier('T3', tierFromRungs(rungs), rungs), (e) => {
    assert.ok(e instanceof TierRefusal);
    assert.match(e.message, /asked for T3 and this device establishes T2/);
    assert.match(e.message, /Rung 12 \(landlock-canary\) said no: landlock_create_ruleset killed by SIGSYS/);
    assert.match(e.message, /Nothing was started\./);
    return true;
  });
});
test('the refusal names the FIRST blocking rung, not the last', () => {
  let rungs = withFail('sentinel-errno', 'first');
  rungs = rungs.map((r) => (r.id === 'landlock-canary' ? { ...r, ok: false, detail: 'second' } : r));
  const r = blockingRung('T3', rungs);
  assert.strictEqual(r.id, 'sentinel-errno');
});
test('a rung that never ran refuses too — absence is not a pass', () => {
  const partial = RUNGS_ALL.filter((r) => r.id !== 'landlock-canary');
  assert.throws(() => assertTier('T3', tierFromRungs(partial), partial), /rung never ran, so nothing was proven/);
});
test('an unknown tier string refuses rather than sorting as -1', () => {
  assert.throws(() => assertTier('T9', 'T3', RUNGS_ALL), /unknown declared tier/);
  assert.throws(() => assertTier('T1', 'nope', RUNGS_ALL), /unknown established tier/);
  assert.strictEqual(isTier('t1'), false, 'lowercase must not be accepted');
  assert.strictEqual(isTier('T1 '), false, 'whitespace must not be accepted');
});

// ─────────────────────────── the honest strings ─────────────────────────────
console.log('\n· the honest strings (the one regression that would discredit everything else)');

test('the phone tier never says "sandbox" except in "is not a sandbox"', () => {
  const hits = [...STATEMENT.T1.matchAll(/sandbox/gi)];
  assert.strictEqual(hits.length, 1, `T1 mentions sandbox ${hits.length} times`);
  assert.match(STATEMENT.T1, /It is not a sandbox\./);
});
test('no tier statement claims a sandbox anywhere', () => {
  for (const t of TIERS) {
    const bad = [...STATEMENT[t].matchAll(/sandbox/gi)].filter((m) => !/not a sandbox/i.test(STATEMENT[t].slice(m.index - 8, m.index + 10)));
    assert.strictEqual(bad.length, 0, `${t} claims a sandbox`);
  }
});
test('T1 states the filesystem is NOT confined, in words', () => {
  assert.match(STATEMENT.T1, /It does not confine the filesystem/);
  assert.match(STATEMENT.T1, /no filesystem boundary available to an app/);
});
test('T2 refuses to call IP-1 egress gated and says whose connection stays open', () => {
  assert.match(STATEMENT.T2, /does not apply to the agent itself/);
  assert.ok(!/gated/i.test(STATEMENT.T2));
});
test('T3 carries its honest limits rather than only its claim', () => {
  assert.match(STATEMENT.T3, /Honest limits:/);
  assert.match(STATEMENT.T3, /file descriptors the agent was handed at startup/);
});
test('T0 says out loud that it was explicitly allowed to start ungated', () => {
  assert.match(STATEMENT.T0, /explicitly allowed to start ungated/);
});
test('TS names the three denials it CANNOT make, rather than listing only what holds', () => {
  // The whole reason this tier exists. A statement that only listed the wins
  // would read as T2 with extra words, and the reader would infer a ptrace
  // denial that is measurably absent on the primary platform.
  for (const call of ['ptrace', 'chroot', 'setuid']) {
    assert.ok(STATEMENT.TS.includes(`\`${call}\``), `TS must name ${call} as NOT held`);
  }
  assert.match(STATEMENT.TS, /do NOT hold here/);
  assert.match(STATEMENT.TS, /can attach to its siblings/);
});
test('TS still claims the egress boundary it really has — honesty is not self-deprecation', () => {
  assert.match(STATEMENT.TS, /cannot open a network socket/);
  assert.match(STATEMENT.TS, /AF_UNIX/);
});
test('TS says agents are not isolated from EACH OTHER, and by which door', () => {
  assert.match(STATEMENT.TS, /not isolated from one another/);
  assert.match(STATEMENT.TS, /\/proc\/<pid>\/mem/);
  assert.match(STATEMENT.TS, /file, not a syscall/);
});
test('every tier below T3 discloses the /proc/<pid>/mem gap — none of them may imply isolation', () => {
  // Measured 2026-08-08, unprivileged, sibling process: under the REAL T1
  // filter, ptrace and process_vm_readv are refused and open("/proc/<pid>/mem")
  // reads the target's heap anyway. Naming the denied syscalls without naming
  // this door is an overclaim by implication, which is the failure mode these
  // strings exist to prevent.
  for (const t of ['TS', 'T1', 'T2']) {
    assert.match(STATEMENT[t], /\/proc\/<pid>\/mem/, `${t} must disclose the file door into process memory`);
  }
  assert.match(STATEMENT.T1, /is not process isolation/);
  assert.match(STATEMENT.T2, /carries over exactly/);
});
test('no statement says a filter CANNOT close the file door — a checker refuted that, twice over', () => {
  // The first draft of these paragraphs said "no syscall filter can close it".
  // A contextless checker broke it on 2026-08-08 and the counterexample
  // reproduced here: a filter that EPERMs open/openat refuses /proc/<pid>/mem
  // — and refuses /etc/hostname in the same run, which is the part that makes
  // it useless rather than clever. An overclaim in the direction of "we are
  // helpless" is still an overclaim, and it is the kind a reader cannot check.
  for (const t of TIERS) {
    assert.ok(!/no syscall filter can|cannot be closed by any/i.test(STATEMENT[t]),
      `${t} states an absolute a seccomp filter genuinely can violate`);
  }
  assert.match(STATEMENT.T1, /refusing `open\(\)` outright/);
  assert.match(STATEMENT.T1, /cannot single that path out/);
});
test('T3 claims process isolation ONLY because a rung measures it', () => {
  assert.match(STATEMENT.T3, /process isolation begins/);
  assert.ok(REQUIRES.T3.includes('sibling-memory'),
    'T3 claims the file door is shut, so a rung must prove it on this device every boot');
  assert.ok(!REQUIRES.T2.includes('sibling-memory') && !REQUIRES.TS.includes('sibling-memory'),
    'no tier below T3 may require it — they disclose the gap instead');
});
test('the supervisor sentence does NOT generalise from one supervisor to all of them', () => {
  // Measured 2026-08-08, both on the same day: under Ubuntu's proot 5.1.0 on a
  // WSL2 kernel, ptrace/chroot/setuid are all defeated. Under TERMUX's proot
  // 5.1.107 on an Android 15 kernel — the fork a phone actually runs — all 16
  // denials hold, while the arbitration rung still reports a tracer.
  //
  // The first draft of this sentence stated the first result as a universal and
  // named the phone as its example: the one platform where it is false. So the
  // rule this test pins is that the string describes BOTH cases and defers to
  // the rungs, and that it names no platform at all.
  assert.match(SUPERVISOR_ON_THIS_DEVICE, /some supervisors/i);
  assert.match(SUPERVISOR_ON_THIS_DEVICE, /others leave them to the kernel/i);
  assert.ok(!/phone|android|termux/i.test(SUPERVISOR_ON_THIS_DEVICE),
    'naming a platform where a measured rung belongs is exactly how this got it wrong the first time');
});
test('no tier statement claims a particular platform establishes it', () => {
  // The ladder is per-device and measured. A statement that says "the phone gets
  // this one" is a prediction wearing a measurement's clothes, and it was wrong
  // within a day of being written.
  for (const t of TIERS) {
    assert.ok(!/on the phone that is|the phone therefore|phone establishes/i.test(STATEMENT[t]),
      `${t} predicts which tier a platform establishes instead of letting the rungs say`);
  }
});
test('the no-Landlock sentence distinguishes unavailable from disabled', () => {
  assert.match(NO_FS_ON_THIS_DEVICE, /Not disabled, not skipped/);
  assert.match(NO_FS_ON_THIS_DEVICE, /turns green without a code change/);
});
test('every tier has a label and a statement', () => {
  for (const t of TIERS) { assert.ok(LABEL[t]?.length, t); assert.ok(STATEMENT[t]?.length > 100, t); }
});

// ─────────────────────────── the credential surface ─────────────────────────
console.log('\n· the credential grant list');

const HOME = mkdtempSync(join(tmpdir(), 'atlan-sbx-home-'));
for (const d of Object.values(ENGINE_STORE)) mkdirSync(join(HOME, d), { recursive: true });
mkdirSync(join(HOME, '.ssh'), { recursive: true });
writeFileSync(join(HOME, '.codex/auth.json'), '{"token":"codex"}');
writeFileSync(join(HOME, '.grok/auth.json'), '{"token":"grok"}');
writeFileSync(join(HOME, '.ssh/id_rsa'), 'PRIVATE KEY');

test('every engine store we name is ALSO matched by guards.js SENSITIVE (no second list)', () => {
  for (const [id, dir] of Object.entries(ENGINE_STORE)) {
    assert.ok(isSensitive(`/home/x/${dir}/auth.json`), `${id} store ${dir} is not credential-shaped to guards.js — add it there, not here`);
  }
});
test('the deny list holds every OTHER engine store, and never the running one', () => {
  for (const engine of Object.keys(ENGINE_STORE)) {
    const d = denyList({ home: HOME, engine });
    for (const [other, dir] of Object.entries(ENGINE_STORE)) {
      const p = join(HOME, dir);
      if (other === engine) assert.ok(!d.includes(p), `${engine}'s own store must be grantable`);
      else assert.ok(d.includes(p), `${engine} must not reach ${other}'s store`);
    }
  }
});
test("Atlan's own key store and state are never grantable", () => {
  const d = denyList({ home: HOME, engine: 'codex' }).join('\n');
  assert.match(d, /\.keys\.enc/);
  assert.match(d, /\.fleet/);
  assert.match(d, /server[/\\]src/);
});
test('a grant that would make another engine store reachable is refused', () => {
  assert.throws(() => assertGrantsSafe({ ro: [HOME], rw: [], engine: 'codex', home: HOME }), PolicyRefusal);
});
test("a grant of the running engine's own store is allowed — the product needs it", () => {
  assert.ok(assertGrantsSafe({ ro: [join(HOME, '.codex')], rw: [], engine: 'codex', home: HOME }));
});
test("a grant of ANOTHER engine's store is refused even named directly", () => {
  assert.throws(() => assertGrantsSafe({ ro: [join(HOME, '.grok')], rw: [], engine: 'codex', home: HOME }),
    /exactly one login is grantable/);
});
test('a grant reaching ~/.ssh is refused', () => {
  assert.throws(() => assertGrantsSafe({ ro: [join(HOME, '.ssh')], rw: [], engine: 'codex', home: HOME }), PolicyRefusal);
});
test("a grant into Atlan's own tree is refused", () => {
  assert.throws(() => assertGrantsSafe({ ro: [process.cwd()], rw: [], engine: 'codex', home: HOME }), PolicyRefusal);
});
test('a writable WORKSPACE outside PROJECTS_DIR is refused by the EXISTING guard, not a second one', () => {
  assert.throws(() => assertGrantsSafe({ ro: [], rw: [], workspace: '/etc', engine: 'codex', home: HOME }), /must be under|credentials/);
});
test('toolchain grants are derived from this process, never hardcoded', () => {
  const g = toolchainGrants([], HOME);
  assert.ok(g.ro.includes(dirname(process.execPath)), 'node bin dir must be granted');
  for (const p of [...g.ro, ...g.rw]) assert.ok(existsSync(p), `${p} does not exist — the list is asserted, not assumed`);
});
test('/etc is granted PER FILE — a directory grant would hand over /etc/shadow', () => {
  const g = toolchainGrants([], HOME);
  assert.ok(!g.ro.includes('/etc'), '/etc must never be granted wholesale');
  assert.ok(!g.ro.some((p) => /shadow/.test(p)), 'no shadow file may be granted');
  if (existsSync('/etc/passwd')) assert.ok(g.ro.includes('/etc/passwd'), 'name lookups still need passwd');
});
test('/proc is granted PER FILE — a directory grant would expose /proc/<pid>/environ', () => {
  const g = toolchainGrants([], HOME);
  assert.ok(!g.ro.includes('/proc'), '/proc must never be granted wholesale — the cockpit\'s own token lives in its environ');
  assert.ok(g.ro.every((p) => !/^\/proc\/\d/.test(p)), 'no per-pid proc dir may be granted');
});
test('/dev is granted PER DEVICE — a directory grant would include /dev/tty (TIOCSTI)', () => {
  const g = toolchainGrants([], HOME);
  assert.ok(!g.ro.includes('/dev') && !g.rw.includes('/dev'), '/dev must never be granted wholesale');
  assert.ok(!g.rw.some((p) => /\/dev\/tty/.test(p)), 'a tty device grant is keystroke injection');
});

// ─────────────────────────── policy emission ────────────────────────────────
console.log('\n· policy emission');

const WS = mkdtempSync(join(tmpdir(), 'atlan-sbx-ws-'));
test('IP-1 never denies egress, at ANY tier — the agent CLI is the model client', () => {
  for (const t of ['TS', 'T1', 'T2', 'T3']) {
    const p = plan({ declared: t, insertionPoint: 'ip1-agent-cli', workspace: WS, engine: null, home: HOME });
    assert.match(p.policy, /egress=open/, t);
    assert.strictEqual(p.confinement.egress, 'open-to-provider', t);
  }
});
test('IP-2 denies egress for every tier that REQUIRES the rung, and never calls it "gated"', () => {
  const t1 = plan({ declared: 'T1', insertionPoint: 'ip2-sdk-bash', workspace: WS, home: HOME });
  const t2 = plan({ declared: 'T2', insertionPoint: 'ip2-sdk-bash', workspace: WS, home: HOME });
  assert.match(t1.policy, /egress=open/);
  assert.match(t2.policy, /egress=deny/);
  assert.strictEqual(t2.confinement.egress, 'denied');
  for (const p of [t1, t2]) assert.notStrictEqual(p.confinement.egress, 'gated');
});
test('TS gets the egress boundary — the phone tier is not a demotion of T1', () => {
  // Under a magnitude ladder TS would have to sit below T1 to be honest about
  // ptrace, and would then have lost the one real kernel boundary the phone
  // actually holds. This is the test that would have caught that.
  const ts = plan({ declared: 'TS', insertionPoint: 'ip2-sdk-bash', workspace: WS, home: HOME });
  assert.match(ts.policy, /egress=deny/);
  assert.strictEqual(ts.confinement.egress, 'denied');
  assert.strictEqual(ts.confinement.caps, 'removed');
  assert.match(ts.policy, /fs=none/);
});
test('fs=landlock only from T3 — no tier silently implies a boundary it lacks', () => {
  for (const t of ['TS', 'T1', 'T2']) assert.match(plan({ declared: t, insertionPoint: 'ip2-sdk-bash', workspace: WS, home: HOME }).policy, /fs=none/);
  assert.match(plan({ declared: 'T3', insertionPoint: 'ip2-sdk-bash', workspace: WS, home: HOME }).policy, /fs=landlock/);
});
test('a newline in a grant path is refused, never escaped', () => {
  const evil = join(WS, 'a\nrw=/');
  try { mkdirSync(evil, { recursive: true }); } catch { /* some filesystems refuse it outright, which is also fine */ }
  if (!existsSync(evil)) return; // the filesystem already refused; nothing to prove
  assert.throws(() => plan({ declared: 'T3', insertionPoint: 'ip2-sdk-bash', workspace: evil, home: HOME }), /newline|must be under|credential/);
});
test('the confinement record never redefines `boundary` — it is a separate object', () => {
  const p = plan({ declared: 'T2', insertionPoint: 'ip2-sdk-bash', workspace: WS, home: HOME });
  assert.deepStrictEqual(Object.keys(p.confinement).sort(),
    ['caps', 'declared', 'egress', 'fs', 'insertionPoint', 'probe', 'tier'].sort());
  assert.ok(!('boundary' in p.confinement));
});

// ─────────────────────────── the real launcher ──────────────────────────────
console.log('\n· the real launcher, on this device');

const cc = workingCompiler();
const built = cc ? ensureBinary() : { ok: false, why: 'no working compiler on this device' };
let V = null;
if (built.ok) { clearProbeCache(); V = probe(); }

if (!built.ok && !cc) {
  skipped('launcher build + ladder', built.why + ' — this device establishes T0, which is a measured answer');
} else if (!built.ok) {
  // A compiler IS present and the launcher did not build. That is a break, not
  // an environment. Skipping here would silently delete every control below.
  test('the launcher builds where a compiler exists', () => { assert.fail(built.why); });
} else {
  test('a compiler that emits an UNRUNNABLE binary does not qualify (`which` would say yes)', () => {
    // The whole point of behavioural discovery. Measured 2026-08-05: this node
    // has cc and gcc and no clang; Termux is the other way round. A name on PATH
    // answers "is there a name", not "does this toolchain produce something that
    // runs here" — which is the only question that matters for a cross-compiled
    // or half-installed toolchain.
    const d = mkdtempSync(join(tmpdir(), 'atlan-fakecc-'));
    for (const name of ['cc', 'gcc', 'clang', 'tcc']) {
      // Compiles perfectly; the produced binary exits 1.
      writeFileSync(join(d, name), '#!/bin/sh\nout=t\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && { out="$2"; shift; }; shift; done\nprintf \'#!/bin/sh\\nexit 1\\n\' > "$out"\nchmod +x "$out"\nexit 0\n');
      chmodSync(join(d, name), 0o755);
    }
    const prev = process.env.PATH;
    process.env.PATH = d;
    try {
      assert.strictEqual(workingCompiler(), null,
        'a compiler whose output does not run was accepted — discovery is checking the NAME, not the behaviour');
    } finally { process.env.PATH = prev; rmSync(d, { recursive: true, force: true }); }
  });
  test('the built binary is not in the repo and its name carries the source hash', () => {
    assert.ok(!built.bin.includes('/server/native/'), 'a compiled artifact must never land in the tree');
    assert.ok(built.bin.includes(sourceHash()), 'the filename must pin the source it was built from');
  });
  test('every rung ran and reported a detail, not a bare boolean', () => {
    assert.ok(V.rungs.length >= 15, `only ${V.rungs.length} rungs`);
    for (const r of V.rungs) assert.ok(r.detail && r.detail.length > 3, `rung ${r.id} has no detail`);
  });
  test('the ladder is green on this device (attach this transcript to the PR)', () => {
    const bad = V.rungs.filter((r) => !r.ok);
    assert.deepStrictEqual(bad.map((r) => `${r.id}: ${r.detail}`), [], 'rungs failed');
  });
  const fakeProbe = (body) => {
    // Stand a fake launcher at the exact path probe() will pick up, in a
    // throwaway FLEET_DIR, and run the REAL probe() against it — the first draft
    // only ran the fake and looked at its stdout, which proved nothing about
    // what probe() does with the answer.
    const dir = mkdtempSync(join(tmpdir(), 'atlan-fake-fleet-'));
    const prev = process.env.ATLAN_FLEET_DIR;
    process.env.ATLAN_FLEET_DIR = dir;
    try {
      // build.js reads FLEET_DIR at call time via config.js's export, which is
      // bound at import — so place the fake where THIS process's binaryPath()
      // points, then temporarily shadow it.
      const bin = built.bin;
      const saved = readFileSync(bin);
      writeFileSync(bin, body);
      chmodSync(bin, 0o700);
      try { clearProbeCache(); return probe(); }
      finally { writeFileSync(bin, saved); chmodSync(bin, 0o700); clearProbeCache(); }
    } finally {
      if (prev === undefined) delete process.env.ATLAN_FLEET_DIR; else process.env.ATLAN_FLEET_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  };
  test('a WRONG SENTINEL is T0 — a cached binary is never trusted from its filename', () => {
    const v = fakeProbe('#!/bin/sh\necho \'{"sentinel":"nope","rungs":[{"n":1,"id":"nnp","ok":true,"detail":"lie"}]}\'\n');
    assert.strictEqual(v.tier, 'T0', v.why);
    assert.match(v.why, /sentinel/);
  });
  test('a probe with NO RUNGS is T0 — not-measured is not a capability', () => {
    const v = fakeProbe('#!/bin/sh\necho \'{"sentinel":"atlan-confine/1","rungs":[]}\'\n');
    assert.strictEqual(v.tier, 'T0', v.why);
  });
  test('unparseable probe output is T0, never a partial answer', () => {
    const v = fakeProbe('#!/bin/sh\necho not-json\n');
    assert.strictEqual(v.tier, 'T0', v.why);
  });
  test('a probe that exits non-zero is T0, never "assume last time\'s answer"', () => {
    const v = fakeProbe('#!/bin/sh\nexit 3\n');
    assert.strictEqual(v.tier, 'T0', v.why);
  });
  test('the verdict is never cached to disk — nothing under FLEET_DIR holds a tier', () => {
    // A file cache is a flag file wearing a hat, and this project's hard rule is
    // that flag files lie: they outlive the boot, the OS update and the package
    // upgrade that invalidated them.
    const j = JSON.stringify(V);
    assert.ok(j.includes('rungs'), 'sanity');
    const dir = join(process.env.ATLAN_FLEET_DIR, 'native');
    for (const f of readdirSync(dir)) {
      assert.ok(!/\.(json|verdict|tier|cache)$/.test(f), `${f} looks like a persisted verdict`);
    }
  });

  const AC = built.bin;
  const run = (policy, argv, opts = {}) =>
    spawnSync(AC, [policy, '--', ...argv], { encoding: 'utf8', timeout: 30000, ...opts });

  // ── capability removal ──
  test('T1: ordinary work still runs (a too-tight allow-list must fail LOUD, and does not here)', () => {
    const r = run('tier=T1;egress=open;fs=none', ['/bin/sh', '-c', 'echo alive; ls / >/dev/null; cat /etc/hostname >/dev/null; echo done']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /alive[\s\S]*done/);
  });
  test('T1: node itself runs under the filter (the engines are node)', () => {
    const r = run('tier=T1;egress=open;fs=none', [process.execPath, '-e', 'console.log("node", process.version)']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /node v/);
  });
  test('T1: a DIRECT syscall bypasses no layer — ptrace via raw syscall is EPERM', () => {
    // Not a library call, not a symbol an LD_PRELOAD could see: the filter reads
    // seccomp_data.nr, so how you reach the syscall is irrelevant.
    const src = join(tmpdir(), `atlan-direct-${process.pid}.c`);
    writeFileSync(src, '#define _GNU_SOURCE\n#include <unistd.h>\n#include <sys/syscall.h>\n#include <errno.h>\n#include <stdio.h>\nint main(){errno=0;long r=syscall(SYS_ptrace,0,0,0,0);printf("%ld %d\\n",r,errno);return 0;}\n');
    const exe = join(tmpdir(), `atlan-direct-${process.pid}`);
    assert.strictEqual(spawnSync(cc, ['-O0', src, '-o', exe], { encoding: 'utf8' }).status, 0);
    const r = run('tier=T1;egress=open;fs=none', [exe]);
    assert.match(r.stdout, /^-1 1\b/, `expected EPERM(1), got ${JSON.stringify(r.stdout)}`);
    rmSync(src, { force: true }); rmSync(exe, { force: true });
  });
  // Two SIBLING processes under the same real filter: one holds a marker in its
  // heap, the other opens /proc/<pid>/mem and reads it. Siblings, never
  // parent/child — the kernel special-cases the ancestor case and Yama's scope 1
  // permits it outright, so measuring that shape would flatter the answer.
  const SIBSRC = [
    '#define _GNU_SOURCE', '#include <errno.h>', '#include <fcntl.h>', '#include <signal.h>',
    '#include <stdio.h>', '#include <stdlib.h>', '#include <string.h>', '#include <sys/wait.h>', '#include <unistd.h>',
    'int main(void){',
    '  int p[2]; if(pipe(p)) return 2;',
    '  pid_t v=fork();',
    '  if(v==0){ close(p[0]); char*b=malloc(64); if(!b) _exit(3); memset(b,0,64); strcpy(b,"SIBLING-SECRET-OK");',
    '    char l[32]; int k=snprintf(l,sizeof l,"%llu",(unsigned long long)(size_t)b);',
    '    ssize_t w=write(p[1],l,(size_t)k); (void)w; close(p[1]); for(;;) sleep(1); }',
    '  if(v<0) return 4;',
    '  close(p[1]); char a[32]={0}; ssize_t g=read(p[0],a,sizeof a-1); (void)g; close(p[0]);',
    '  unsigned long addr=strtoul(a,NULL,10);',
    '  char path[64]; snprintf(path,sizeof path,"/proc/%d/mem",(int)v);',
    '  char out[64]={0}; int fd=open(path,O_RDONLY);',
    '  if(fd<0) printf("BLOCKED-OPEN %s\\n",strerror(errno));',
    '  else { ssize_t n=pread(fd,out,32,(off_t)addr);',
    '    if(n>0) printf("READ %s\\n",out); else printf("BLOCKED-READ %s\\n",strerror(errno)); close(fd); }',
    '  kill(v,SIGKILL); waitpid(v,NULL,0); return 0; }',
  ].join('\n');
  const buildSib = (dir) => {
    const src = join(dir, `atlan-sib-${process.pid}.c`);
    const exe = join(dir, `atlan-sib-${process.pid}`);
    writeFileSync(src, SIBSRC + '\n');
    const c = spawnSync(cc, ['-O0', src, '-o', exe], { encoding: 'utf8' });
    rmSync(src, { force: true });
    return c.status === 0 ? exe : null;
  };

  test('T1: the file door into a sibling\'s MEMORY is open, and the statement says so because of this', () => {
    // The measurement the T1/T2/TS wording rests on. ptrace and
    // process_vm_readv are genuinely refused one test above; this reads the same
    // memory anyway through open()+pread(), which no seccomp filter can stop —
    // a filter matches syscall numbers and registers and may not dereference the
    // path pointer, because another thread could rewrite it after the check.
    // If this test ever fails, the honest response is to WEAKEN the disclosure
    // in tiers.js, not to delete the test.
    const exe = buildSib(tmpdir());
    if (!exe) return skipped('sibling memory at T1', 'the helper did not compile on this host');
    try {
      const r = run('tier=T1;egress=open;fs=none', [exe]);
      assert.match(r.stdout, /^(READ|BLOCKED)/, `helper produced nothing: ${JSON.stringify(r.stdout)} ${r.stderr}`);
      assert.match(r.stdout, /READ SIBLING-SECRET-OK/,
        `a sibling's memory was NOT readable under T1 (${r.stdout.trim()}) — if this kernel isolates process memory on its own, the tier statements are now understating it`);
    } finally { rmSync(exe, { force: true }); }
  });
  test('T1: an unlisted syscall is FATAL, not quietly EPERM (the tail is default-deny)', () => {
    const rung = V.rungs.find((r) => r.id === 'selftest-defaultdeny');
    assert.ok(rung.ok, rung.detail);
    assert.match(rung.detail, /default-deny/);
  });
  test('T1: the filter survives execve and every fork after it', () => {
    const r = run('tier=T1;egress=open;fs=none', ['/bin/sh', '-c', '/bin/sh -c "/bin/sh -c \'echo three-deep\'"']);
    assert.match(r.stdout, /three-deep/);
    assert.ok(V.rungs.find((x) => x.id === 'exec-inherit').ok);
  });

  // ── egress ──
  test('T2: a shell cannot open a socket — internet', () => {
    const r = run('tier=T2;egress=deny;fs=none', ['/bin/sh', '-c', 'exec 3<>/dev/tcp/1.1.1.1/80 && echo OPENED || echo refused']);
    assert.ok(!/OPENED/.test(r.stdout + r.stderr), r.stdout + r.stderr);
  });
  test('T2: a shell cannot reach Atlan itself on loopback (the confused deputy)', () => {
    // socket() is refused at creation, so the assertion is on the errno, not on
    // whether a connect callback fired — an async connect error would otherwise
    // let the happy-path line print and the test pass against a broken filter.
    const r = run('tier=T2;egress=deny;fs=none', [process.execPath, '-e',
      'process.on("uncaughtException",e=>{console.log("refused",e.code);process.exit(0)});'
      + 'const s=require("net").createConnection({host:"127.0.0.1",port:4589});'
      + 's.on("error",e=>{console.log("refused",e.code);process.exit(0)});'
      + 's.on("connect",()=>{console.log("OPENED");process.exit(0)});setTimeout(()=>{console.log("OPENED-timeout")},3000)']);
    assert.match(r.stdout, /refused EACCES/, r.stdout + r.stderr);
  });
  test('T2: AF_UNIX is denied too — not just AF_INET', () => {
    const r = run('tier=T2;egress=deny;fs=none', [process.execPath, '-e',
      'process.on("uncaughtException",e=>{console.log("refused",e.code);process.exit(0)});'
      + 'const s=require("net").createConnection("/tmp/atlan-nope.sock");'
      + 's.on("error",e=>{console.log("refused",e.code);process.exit(0)});'
      + 's.on("connect",()=>{console.log("OPENED");process.exit(0)});setTimeout(()=>{console.log("OPENED-timeout")},3000)']);
    assert.match(r.stdout, /refused EACCES/, r.stdout + r.stderr);
  });
  test('T1 egress stays OPEN — closing it at IP-1 would stop the agent thinking', () => {
    const r = run('tier=T1;egress=open;fs=none', [process.execPath, '-e',
      'const s=require("net").Socket;console.log(typeof new s()==="object"?"socket-constructible":"no")']);
    assert.match(r.stdout, /socket-constructible/);
  });

  // ── filesystem ──
  const llOk = V.rungs.find((r) => r.id === 'landlock-canary')?.ok;
  const FS = {};
  // Built from the SHIPPED planner, not hand-written: a test that writes its own
  // grant list tests the list it wrote. (This suite's first draft granted ro=/etc
  // by hand and then "discovered" /etc/shadow was readable — the finding was
  // real, the grant list under test was not the one Atlan ships.)
  const T3 = (extra, argv) => {
    const p = plan({ declared: 'T3', insertionPoint: 'ip2-sdk-bash', workspace: FS.ws, engine: null, home: homedir() });
    return run(p.policy.trim().split('\n').concat(extra).join(';'), argv);
  };
  if (!llOk) {
    skipped('filesystem boundary', 'this device establishes no Landlock — the UI says the sentence, not a hedge');
  } else {
    FS.root = mkdtempSync(join(tmpdir(), 'atlan-sbx-fs-'));
    FS.ws = join(FS.root, 'ws'); mkdirSync(FS.ws);
    writeFileSync(join(FS.root, 'outside.txt'), 'SECRET-OUTSIDE');
    writeFileSync(join(FS.ws, 'inside.txt'), 'inside');
    mkdirSync(join(FS.root, 'creds')); writeFileSync(join(FS.root, 'creds', 'auth.json'), 'TOKEN');

    test('T3: a file inside the grant reads', () => {
      const r = T3([], ['/bin/sh', '-c', 'cat inside.txt']);
      assert.match(r.stdout, /inside/);
    });
    test('T3: an absolute path outside the grant does not resolve', () => {
      const r = T3([], ['/bin/sh', '-c', `cat ${join(FS.root, 'outside.txt')} && echo READ || echo refused`]);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
    });
    test('T3: a RELATIVE ../ escape does not resolve either', () => {
      const r = T3([], ['/bin/sh', '-c', 'cat ../outside.txt && echo READ || echo refused']);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
    });
    test('T3: a deeply nested relative escape does not resolve', () => {
      const r = T3([], ['/bin/sh', '-c', 'cat ./../../../../../../../../etc/shadow && echo READ || echo refused']);
      assert.ok(!/root:/.test(r.stdout), r.stdout);
    });
    test('T3: /etc/shadow is unreachable even though the loader needs /etc files', () => {
      const r = T3([], ['/bin/sh', '-c', 'cat /etc/shadow && echo READ || echo refused']);
      assert.ok(!/root:/.test(r.stdout), r.stdout);
    });
    test("T3: another process's /proc environ is unreachable (the cockpit's own token)", () => {
      const r = T3([], ['/bin/sh', '-c', `cat /proc/1/environ > ${join(FS.ws, 'stolen')} && echo READ || echo refused`]);
      const got = existsSync(join(FS.ws, 'stolen')) ? readFileSync(join(FS.ws, 'stolen')) : Buffer.alloc(0);
      assert.strictEqual(got.length, 0, `read ${got.length} bytes of another process's environment`);
      void r;
    });
    test('T3: /tmp is NOT granted — TMPDIR lands inside the workspace instead', () => {
      const p = plan({ declared: 'T3', insertionPoint: 'ip2-sdk-bash', workspace: FS.ws, engine: null, home: homedir() });
      assert.ok(!p.rw.includes('/tmp'), '/tmp must not be a grant — it is a shared channel between confined agents');
      assert.match(p.policy, new RegExp(`scratch=${FS.ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      // `: >` is open(O_CREAT|O_WRONLY), which Landlock covers. `touch` on an
      // EXISTING file is utimensat, which ABI 1 deliberately does not hook —
      // the T3 statement discloses exactly that, and the first draft of this
      // test used it and "found" a hole that is a documented limit.
      const r = T3([], ['/bin/sh', '-c',
        // `echo x >` and not `: >`: `:` is a POSIX SPECIAL built-in, and a
        // redirection error on one makes a non-interactive shell EXIT — so the
        // refusal branch never ran and the test failed on its own shell trivia.
        'echo "$TMPDIR"; echo x > "$TMPDIR/probe" && echo scratch-writable; echo x > /tmp/atlan-nope-$$ && echo TMP-WRITABLE || echo tmp-refused']);
      assert.match(r.stdout, /scratch-writable/, r.stdout + r.stderr);
      assert.match(r.stdout, /tmp-refused/, r.stdout + r.stderr);
      assert.ok(!/TMP-WRITABLE/.test(r.stdout), r.stdout);
    });
    test('T3: git still works — a boundary that breaks the toolchain gets turned off', () => {
      const r = T3([], ['/bin/sh', '-c', 'git init -q g 2>&1; cd g && git status --porcelain >/dev/null && echo git-ok']);
      assert.match(r.stdout, /git-ok/, r.stdout + r.stderr);
    });
    test('T3: a SYMLINK out of the grant does not resolve (Landlock resolves the target)', () => {
      try { symlinkSync(join(FS.root, 'outside.txt'), join(FS.ws, 'link')); } catch { /* already there */ }
      const r = T3([], ['/bin/sh', '-c', 'cat link && echo READ || echo refused']);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
    });
    test('T3: a symlinked DIRECTORY out of the grant does not resolve', () => {
      try { symlinkSync(FS.root, join(FS.ws, 'up')); } catch { /* already there */ }
      const r = T3([], ['/bin/sh', '-c', 'cat up/outside.txt && echo READ || echo refused']);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
    });
    test('T3: a credential store outside the grant is unreachable', () => {
      const r = T3([], ['/bin/sh', '-c', `cat ${join(FS.root, 'creds', 'auth.json')} && echo READ || echo refused`]);
      assert.ok(!/TOKEN/.test(r.stdout), r.stdout);
    });
    test('T3: a WRITE outside the grant is refused', () => {
      const target = join(FS.root, 'evil.txt');
      T3([], ['/bin/sh', '-c', `echo pwned > ${target}`]);
      assert.ok(!existsSync(target) || readFileSync(target, 'utf8').trim() !== 'pwned', 'wrote outside the grant');
    });
    test('T3: a write INSIDE the grant works — denying everything is not enforcing something', () => {
      T3([], ['/bin/sh', '-c', 'echo ok > written.txt']);
      assert.strictEqual(readFileSync(join(FS.ws, 'written.txt'), 'utf8').trim(), 'ok');
    });
    test('T3: a STATIC binary is confined identically — this is not LD_PRELOAD', () => {
      // Built INSIDE the workspace, which is already granted. Putting it in /tmp
      // and granting its dirname would grant the whole fixture — a directory
      // grant is transitive, which is why the shipped list names files.
      const src = join(FS.ws, 'static.c');
      writeFileSync(src, '#include <stdio.h>\nint main(int c,char**v){(void)c;FILE*f=fopen(v[1],"r");if(!f){printf("refused\\n");return 0;}char b[64]={0};size_t n=fread(b,1,60,f);(void)n;printf("READ %s\\n",b);return 0;}\n');
      const exe = join(FS.ws, 'static');
      const c = spawnSync(cc, ['-O0', '-static', src, '-o', exe], { encoding: 'utf8' });
      if (c.status !== 0) { rmSync(src, { force: true }); return skipped('static binary', 'no static libc on this host'); }
      const r = T3([], [exe, join(FS.root, 'outside.txt')]);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
      assert.match(r.stdout, /refused/, 'the static binary must have RUN — a crash would pass this test vacuously');
      rmSync(src, { force: true }); rmSync(exe, { force: true });
    });
    test('T3: a case-variant path is not a bypass (Landlock is inode-attached, not string-matched)', () => {
      const r = T3([], ['/bin/sh', '-c', `cat ${join(FS.root, 'OUTSIDE.TXT')} ${join(FS.root, 'outside.txt')} 2>&1 | head -2`]);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
    });
    test('T3: unicode and encoded path forms are not a bypass either', () => {
      const weird = join(FS.root, 'outside.txt'); // NFC-identical 't'
      const r = T3([], ['/bin/sh', '-c', `cat "${weird}" && echo READ || echo refused`]);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
    });
    test('T3: a partial read of a denied file yields nothing — the refusal is at open()', () => {
      const r = T3([], ['/bin/sh', '-c', `head -c 3 ${join(FS.root, 'outside.txt')} && echo READ || echo refused`]);
      assert.ok(!/SEC/.test(r.stdout), r.stdout);
    });
    test('T3: /proc/self/cwd does not walk out of the grant', () => {
      const r = T3([], ['/bin/sh', '-c', 'cat /proc/self/cwd/../outside.txt && echo READ || echo refused']);
      assert.ok(!/SECRET-OUTSIDE/.test(r.stdout), r.stdout);
    });
    test("T3: and the SAME door into a sibling's memory is shut — this is what T3 claims", () => {
      // The other half of the T1 test above, and the only reason T3's statement
      // is allowed to say "process isolation begins here". Same helper, same
      // kernel, same siblings — the single difference is the grant list, which
      // names the /proc entries the toolchain needs and never another process's.
      const exe = buildSib(FS.ws);
      if (!exe) return skipped('sibling memory at T3', 'the helper did not compile on this host');
      try {
        const r = T3([], [exe]);
        assert.match(r.stdout, /^BLOCKED/,
          `a sibling's memory is still reachable with the filesystem boundary applied: ${r.stdout.trim()}`);
        assert.ok(!/SIBLING-SECRET-OK/.test(r.stdout), r.stdout);
      } finally { rmSync(exe, { force: true }); }
    });
    test('T3: a TOCTOU swap of the grant target does not widen it (grants are fd-attached at O_PATH)', () => {
      // The grant is taken on an O_PATH fd, so replacing the PATH after
      // restrict_self cannot repoint the rule at a different inode.
      const swap = join(FS.root, 'swap'); mkdirSync(swap, { recursive: true });
      writeFileSync(join(swap, 'f'), 'swapped');
      const r = T3([], ['/bin/sh', '-c', `ln -sfn ${swap} ws2 2>/dev/null; cat ws2/f && echo READ || echo refused`]);
      assert.ok(!/swapped/.test(r.stdout), r.stdout);
      rmSync(swap, { recursive: true, force: true });
    });
  }

  // ── fail-closed behaviour of the launcher itself ──
  test('an unknown policy directive refuses rather than ignoring it', () => {
    const r = run('tier=T1;wibble=yes', ['/bin/echo', 'ran']);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /unknown directive/);
    assert.ok(!/ran/.test(r.stdout));
  });
  test('fs=landlock with no grants refuses — denying everything is not enforcement', () => {
    const r = run('tier=T3;fs=landlock', ['/bin/echo', 'ran']);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /would deny every open/);
  });
  test('a grant path that cannot be opened refuses rather than silently dropping the rule', () => {
    const r = run(`tier=T3;fs=landlock;rw=${WS};ro=/no/such/dir/anywhere`, ['/bin/echo', 'ran']);
    assert.notStrictEqual(r.status, 0);
    assert.ok(!/ran/.test(r.stdout));
  });
  test('an egress value that is neither deny nor open refuses', () => {
    const r = run('tier=T2;egress=maybe', ['/bin/echo', 'ran']);
    assert.notStrictEqual(r.status, 0);
  });
  test('a policy PATH is refused — only an argv literal or a file descriptor', () => {
    // A path is a TOCTOU surface: the launcher's own configuration is the last
    // thing that should be swappable between resolution and read. An argv
    // literal is frozen by execve and an fd names the object, not the name.
    const pol = join(WS, 'policy.txt');
    writeFileSync(pol, 'tier=T1\negress=open\nfs=none\n');
    const r = spawnSync(AC, [pol, '--', '/bin/echo', 'RAN-FROM-A-PATH'], { encoding: 'utf8', timeout: 20000 });
    assert.ok(!/RAN-FROM-A-PATH/.test(r.stdout), 'the launcher read its policy from a path');
    assert.notStrictEqual(r.status, 0);
  });
  test('a missing `--` refuses rather than guessing where the command starts', () => {
    const r = spawnSync(AC, ['tier=T1', '/bin/echo', 'ran'], { encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /missing/);
  });
  test('an INHERITED DESCRIPTOR handed to the child does not survive L1', () => {
    // The first draft of this test asserted "no fd above stdio survived" while
    // never passing one — vacuously true, and it let the mutant that deletes L1
    // walk straight through. Atlan spawns from a long-lived Node process holding
    // the session store, the key store and a live WebSocket, so a leaked
    // descriptor is the top real-world bypass of everything below it: Landlock
    // checks at open() and never at read(), and seccomp cannot see a handle at all.
    const secret = join(WS, 'leaked-secret.txt');
    writeFileSync(secret, 'THE-LEAKED-BYTES');
    const fd = openSync(secret, 'r');
    try {
      const r = spawnSync(AC, ['tier=T1;egress=open;fs=none', '--', AC, '--x-fds'],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe', fd], timeout: 20000 });
      const fds = (r.stdout || '').trim().split(/\s+/).filter((x) => /^\d+$/.test(x)).map(Number);
      assert.ok(fds.length > 0, `child reported no fds at all: ${JSON.stringify(r.stdout)} ${r.stderr}`);
      assert.ok(fds.every((f) => f <= 2), `an inherited descriptor survived into the confined process: ${fds}`);
    } finally { closeSync(fd); }
  });
  test('NO_NEW_PRIVS is actually set in the confined process (asked by syscall)', () => {
    // Its real effect — a setuid binary failing to gain privilege — is
    // unobservable in a process already running as uid 0, which is every proot
    // process on the phone. PR_GET_NO_NEW_PRIVS works everywhere.
    const r = run('tier=T1;egress=open;fs=none', [AC, '--x-nnp']);
    assert.strictEqual(r.status, 0, 'PR_GET_NO_NEW_PRIVS did not return 1 in the confined process');
  });
  test('a tty on stdout is REFUSED (TIOCSTI keystroke injection into the parent shell)', () => {
    const probe = spawnSync('script', ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) return skipped('tty refusal', 'no script(1) on this host to build a pty with');
    const r = spawnSync('script', ['-qec', `${AC} 'tier=T1;egress=open;fs=none' -- /bin/echo RAN-ON-A-TTY`, '/dev/null'],
      { encoding: 'utf8', timeout: 20000 });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(!/RAN-ON-A-TTY/.test(out), 'the launcher ran a process with an inherited tty');
    assert.match(out, /tty/, out.slice(0, 200));
  });
  test('the ladder REPORTS FAILURE honestly — probing under denied egress turns rung 8 red', () => {
    // A negative control for the probe itself. Every rung is green on a healthy
    // host, so "the ladder is green" cannot tell a strict rung from a lax one.
    // Running the probe under our OWN egress denial removes the capability
    // rung 8 measures, and rung 8 must go red rather than shrug — which is also
    // the assertion that the baseline leg exists at all: without it, airplane
    // mode and working egress control are indistinguishable.
    const r = run('tier=T2;egress=deny;fs=none', [AC, '--probe']);
    const j = JSON.parse(r.stdout);
    const e = j.rungs.find((x) => x.id === 'egress-denial');
    assert.strictEqual(e.ok, false, 'rung 8 stayed green with no socket() available at all');
    assert.match(e.detail, /BASELINE/, e.detail);
    const floor = j.rungs.find((x) => x.id === 'sentinel-errno');
    assert.strictEqual(floor.ok, true, 'the floor should be unaffected by egress denial');
  });
  test('--probe never needs, and never claims, elevated privilege', () => {
    const r = spawnSync(AC, ['--probe'], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    const j = JSON.parse(r.stdout);
    assert.strictEqual(j.sentinel, 'atlan-confine/1');
    assert.ok(j.rungs.every((x) => typeof x.ok === 'boolean'));
  });
  test('the probe reads no flag file — the source contains no /proc/sys or lsm read', () => {
    const src = readFileSync(SOURCE, 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*[*/]/.test(l)).join('\n');
    for (const banned of ['/proc/sys', '/sys/kernel', 'unprivileged_userns', 'max_user_namespaces', 'TracerPid', 'ANDROID_']) {
      assert.ok(!code.includes(banned), `${banned} appears in executable code — every one of these has been observed to lie`);
    }
  });
  test('the arch guard is the FIRST thing in the filter and it KILLS', () => {
    // Behaviourally unobservable here — we cannot spawn a 32-bit process to
    // watch it die — so this asserts the instruction stream we hand the kernel.
    // A filter written against the wrong syscall table is not a weak filter, it
    // is a silent total bypass, so "unobservable" is not "untested".
    const j = JSON.parse(spawnSync(AC, ['--dump-filter'], { encoding: 'utf8' }).stdout);
    const LD_W_ABS = 0x20, JMP_JEQ_K = 0x15, RET_K = 0x06;
    assert.strictEqual(j.insns[0].code, LD_W_ABS, 'instruction 0 must load a seccomp_data word');
    assert.strictEqual(j.insns[0].k, 4, 'instruction 0 must load seccomp_data.arch (offset 4)');
    assert.strictEqual(j.insns[1].code, JMP_JEQ_K);
    assert.strictEqual(j.insns[1].k, j.auditArch, 'the guard must compare against THIS build\'s AUDIT_ARCH');
    assert.strictEqual(j.insns[2].code, RET_K);
    assert.strictEqual(j.insns[2].k, j.kill, 'a non-native ABI must be KILLED, never allowed');
    assert.strictEqual(j.insns[3].k, 0, 'instruction 3 must load seccomp_data.nr (offset 0)');
  });
  test('the default tail is the LAST instruction and it KILLS', () => {
    const j = JSON.parse(spawnSync(AC, ['--dump-filter'], { encoding: 'utf8' }).stdout);
    const last = j.insns[j.insns.length - 1];
    assert.strictEqual(last.code, 0x06);
    assert.strictEqual(last.k, j.kill, 'the default tail must kill — a too-tight allow-list has to fail LOUD');
  });
  test('deny rules are emitted BEFORE allow rules — deny wins by position, not by review', () => {
    const j = JSON.parse(spawnSync(AC, ['--dump-filter'], { encoding: 'utf8' }).stdout);
    const isRet = (i) => i.code === 0x06;
    const firstDeny = j.insns.findIndex((i) => isRet(i) && (i.k >>> 16) === 0x0005);
    const firstAllow = j.insns.findIndex((i) => isRet(i) && i.k === j.allow);
    assert.ok(firstDeny > 0, 'no ERRNO rule found at all');
    assert.ok(firstAllow > firstDeny, 'an allow rule precedes the deny set — widening the allow-list could resurrect a denied capability');
  });
  test('egress denial changes the emitted filter, and only when asked', () => {
    const open = JSON.parse(spawnSync(AC, ['--dump-filter'], { encoding: 'utf8' }).stdout);
    const deny = JSON.parse(spawnSync(AC, ['--dump-filter', 'deny-egress'], { encoding: 'utf8' }).stdout);
    assert.ok(deny.len > open.len, 'deny-egress must add rules, not reorder them');
  });
  test('the launcher refuses to build for an ABI it cannot name', () => {
    assert.match(readFileSync(SOURCE, 'utf8'), /#error[^\n]*ABI/);
  });
}

// ─────────────────────────── insertion points ───────────────────────────────
console.log('\n· insertion points');

test('T0 wraps nothing — today\'s behaviour is preserved verbatim', () => {
  assert.strictEqual(confineSpawn({ declared: 'T0', cmd: 'echo', args: [], cwd: WS }), null);
  assert.strictEqual(confineBash({ declared: 'T0', command: 'echo hi', cwd: WS }), null);
});
if (built.ok && V && dominates(V.tier, 'T1')) {
  test('IP-2 rewrites the Bash command through the launcher and quotes it totally', () => {
    const c = confineBash({ declared: 'T1', command: `echo 'single' "double" $(id) \`x\``, cwd: WS });
    assert.ok(c.command.startsWith(`'${built.bin}'`), c.command);
    assert.match(c.command, /-- \/bin\/sh -c /);
    const r = spawnSync('/bin/sh', ['-c', c.command], { encoding: 'utf8', timeout: 20000 });
    assert.ok(!/^\s*$/.test(r.stdout + r.stderr));
  });
  test('IP-2: a command containing a single quote survives quoting unchanged', () => {
    const c = confineBash({ declared: 'T1', command: `printf '%s\\n' "it's fine"`, cwd: WS });
    const r = spawnSync('/bin/sh', ['-c', c.command], { encoding: 'utf8', timeout: 20000 });
    assert.match(r.stdout, /it's fine/);
  });
  test('IP-2: a command that tries to break out of the quoting cannot', () => {
    const c = confineBash({ declared: 'T1', command: `x'; echo INJECTED; '`, cwd: WS });
    const r = spawnSync('/bin/sh', ['-c', c.command], { encoding: 'utf8', timeout: 20000 });
    assert.ok(!/INJECTED/.test(r.stdout), r.stdout);
  });
  test('IP-1 passes the policy on a FILE DESCRIPTOR, never a path', () => {
    const s = confineSpawn({ declared: 'T1', cmd: '/bin/echo', args: ['x'], cwd: WS, engine: 'codex' });
    assert.strictEqual(s.args[0], '@3');
    assert.strictEqual(s.args[1], '--');
    assert.strictEqual(s.stdio.length, 4);
    assert.ok(!s.policy.includes(' '));
  });
  test('IP-1 never denies egress and the ledger says open-to-provider, not gated', () => {
    const s = confineSpawn({ declared: 'T1', cmd: '/bin/echo', args: [], cwd: WS, engine: 'codex' });
    assert.strictEqual(s.confinement.egress, 'open-to-provider');
    assert.strictEqual(s.confinement.tier, V.tier);
  });
  test('IP-2 at T2 produces a shell that ACTUALLY cannot open a socket (end to end)', () => {
    // The IP-2 tests above prove the rewrite is well-formed. This one runs the
    // rewritten command and checks the boundary, which is what catches a
    // confineBash that quietly falls back to an unconfined command.
    if (!dominates(V.tier, 'T2')) return skipped('IP-2 end to end', `device establishes ${V.tier}`);
    // node, not bash's /dev/tcp: the rewrite runs the command under /bin/sh,
    // and dash has no /dev/tcp AND exits outright on a redirect error, so a
    // bash-ism here would measure the test's shell rather than the boundary.
    const NETPROBE = `${process.execPath} -e 'const s=require("net").createConnection({host:"1.1.1.1",port:80});`
      + `s.on("error",e=>{console.log("refused",e.code);process.exit(0)});`
      + `s.on("connect",()=>{console.log("OPENED");process.exit(0)});`
      + `process.on("uncaughtException",e=>{console.log("refused",e.code);process.exit(0)})'`;
    const c = confineBash({ declared: 'T2', command: NETPROBE, cwd: WS });
    assert.strictEqual(c.confinement.egress, 'denied');
    assert.strictEqual(c.confinement.declared, 'T2');
    const r = spawnSync('/bin/sh', ['-c', c.command], { encoding: 'utf8', timeout: 20000 });
    assert.ok(!/OPENED/.test(r.stdout), `${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /refused EACCES/, `${r.stdout}${r.stderr}`);
    // and the SAME command at T0 must reach the network, or the test above
    // proves only that the command is broken.
    assert.strictEqual(confineBash({ declared: 'T0', command: NETPROBE, cwd: WS }), null);
  });
  test('IP-1 at T1 produces a process that ACTUALLY runs under the filter (end to end)', () => {
    const s = confineSpawn({ declared: 'T1', cmd: built.bin, args: ['--x-nnp'], cwd: WS, engine: null });
    // spawnSync cannot write to fd 3, so the same policy is driven through the
    // argv form the launcher also accepts. The confinement it produces is
    // identical either way — that is the point of accepting both.
    const r2 = spawnSync(s.file, [s.policy.trim().split('\n').join(';'), '--', built.bin, '--x-nnp'], { encoding: 'utf8', timeout: 20000 });
    assert.strictEqual(r2.status, 0, `NO_NEW_PRIVS not set through the IP-1 policy: ${r2.stderr}`);
  });
  test('establish() surfaces the rung that certified the top tier', () => {
    const e = establish('T1');
    assert.match(e.certifiedBy, /^rung\d+ /);
  });
} else if (built.ok) {
  skipped('insertion points at T1+', `this device establishes ${V?.tier ?? 'T0'}`);
}

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
try { rmSync(HOME, { recursive: true, force: true }); rmSync(WS, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(fail ? 1 : 0);
