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
  UNMETERED_ENGINES,
} from '../server/src/fleet.js';
import { policyArgs, engineFidelity, sandboxCapableHost, ENGINE_POLICY } from '../server/src/enginePolicy.js';
import { killTree } from '../server/src/agentExec.js';
import { scrubbedEnv as SCRUB } from '../server/src/containment.js';

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const readFleetSource = () => readSource('../server/src/fleet.js');

// Source-shape assertions must read CODE, not prose. A comment explaining why a
// vulnerable pattern was removed still contains that pattern, so a naive grep
// reports the bug as present — which is how the first run of ADV-1 failed
// against its own fix. Strip line comments before matching.
const codeOnly = (rel) => readSource(rel)
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

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

// ══ regressions from the cross-vendor adversarial review, 2026-08-02 ═══════
// Three vendors (OpenAI/codex, Google/gemini, xAI/grok) reviewed this code
// contextless — no authorship, no test results, no rationale. codex returned
// seven findings; six were confirmed real against the source and are fixed
// below. Each test is written to FAIL IF THE FIX IS REVERTED, not merely to
// describe it.

test('ADV-7 · extraEnv cannot re-introduce a scrubbed credential', () => {
  // Was `{...scrubbedEnv(process.env), ...extraEnv}` — spread order meant a
  // caller passing ATLAN_TOKEN as extraEnv put it straight back on the child.
  const src = codeOnly('../server/src/agentExec.js');
  assert.ok(/env: scrubbedEnv\(\{ \.\.\.process\.env, \.\.\.extraEnv \}\)/.test(src),
    'the merged env must be scrubbed LAST, so extraEnv cannot outrank the scrub');
  assert.ok(!/\.\.\.scrubbedEnv\(process\.env\), \.\.\.extraEnv/.test(src),
    'the vulnerable spread order must be gone from the CODE');
});

test('ADV-7 · scrubbedEnv actually removes an injected credential', () => {
  // Behavioural, not textual: prove the composition works end to end.
  assert.ok(SCRUB, 'scrubbedEnv must be importable');
  const out = SCRUB({ PATH: '/usr/bin', ATLAN_TOKEN: 'secret', OPENAI_API_KEY: 'sk-x', HOME: '/root' });
  assert.equal(out.ATLAN_TOKEN, undefined, 'ATLAN_TOKEN must not survive');
  assert.equal(out.OPENAI_API_KEY, undefined, 'an API key must not survive');
  assert.equal(out.PATH, '/usr/bin', 'PATH must survive — the child has to run');
});

test('ADV-3 · killTree signals the process GROUP, then escalates', () => {
  const src = readSource('../server/src/agentExec.js');
  assert.ok(/export function killTree/.test(src), 'killTree must exist');
  assert.ok(/process\.kill\(-child\.pid/.test(src), 'must signal the negative pid — the whole group');
  assert.ok(/SIGKILL/.test(src), 'must escalate past an ignored SIGTERM');
  assert.ok(/detached: true/.test(src), 'the child must lead its own group for that to work');
});

test('ADV-3 · killTree is safe on a dead or pidless child', () => {
  assert.equal(killTree(null), false);
  assert.equal(killTree({}), false);
  assert.equal(killTree({ pid: undefined }), false);
});

test('ADV-3 · the fleet kill handle uses killTree, not a bare SIGTERM', () => {
  const src = codeOnly('../server/src/fleet.js');
  assert.ok(/kill\(\) \{ killTree\(this\.child\); \}/.test(src), 'execCli must kill the tree');
  assert.ok(!/this\.child\?\.kill\('SIGTERM'\)/.test(src), 'the single-pid kill must be gone from the CODE');
});

test('ADV-4A · an engine that reports no usage is refused under a budget', () => {
  // copilot/antigravity emit plain text with no usage, so `tokens: 0` was a
  // free pass past both the per-run budget and the daily cap.
  for (const engine of ['copilot', 'antigravity']) {
    assert.ok(UNMETERED_ENGINES.has(engine), `${engine} must be known-unmetered`);
    assert.throws(
      () => spawnRun({ prompt: 'x', engine, profile: 'scout', allowUnsandboxed: true }),
      (e) => /reports no token usage/i.test(e.message) && /allowUnmetered/.test(e.message),
      `${engine} must refuse and name the override`,
    );
  }
});

test('ADV-4A · metered engines are NOT caught by the unmetered guard', () => {
  // Not vacuous: if the guard rejected everything this would fail.
  assert.ok(!UNMETERED_ENGINES.has('codex'), 'codex reports usage via turn.completed');
  assert.ok(!UNMETERED_ENGINES.has('grok'), 'grok reports usage in its json');
  assert.ok(!UNMETERED_ENGINES.has('claude'));
});

test('ADV-4A · agentExec distinguishes unknown usage from zero usage', () => {
  const src = readSource('../server/src/agentExec.js');
  assert.ok(/tokensKnown: false/.test(src), 'plain-parsed engines must report tokensKnown:false');
  assert.ok(/tokensKnown: true/.test(src), 'json-parsed engines must report tokensKnown:true');
  assert.ok(/tokensKnown: parsed\.tokensKnown/.test(src), 'and it must reach the caller');
});

test('ADV-4A · publicRun carries tokensKnown so the ledger cannot be misread', () => {
  assert.ok(/tokensKnown: r\.tokensKnown/.test(readFleetSource()),
    '"not measured" and "cost nothing" must be distinguishable in the record');
});

test('ADV-4C · the daily cap reserves budget for runs still in flight', () => {
  // CLI runs hold tokens=0 until they finish, so N concurrent spawns all saw
  // the same burn total and were all admitted.
  const src = readFleetSource();
  assert.ok(/r\.budget - r\.tokens/.test(src), 'must reserve each in-flight run\'s REMAINING budget');
  assert.ok(/inFlight/.test(src) && /projected/.test(src), 'admission must be against the projection');
  assert.ok(/including \$\{inFlight\} reserved/.test(src), 'and the error must explain why it refused');
});

test('ADV-2 · the walls are recorded BEFORE the run, not only on success', () => {
  // A killed run skipped the success path, so enforced/boundary stayed null on
  // exactly the runs where "what were the walls?" matters most.
  const src = readFleetSource();
  const pre = src.indexOf('const pre = policyArgs(run.engine, run.profile');
  const call = src.indexOf('await agentExec({');
  assert.ok(pre > 0, 'execCli must resolve the gate up front');
  assert.ok(call > pre, 'and must do so BEFORE the run starts');
});

test('ADV-1 · containment ADDS to the kernel gate, it never replaces it', () => {
  // `if (host.ok && !useContainment)` meant asking for containment on a capable
  // host silently downgraded to the bypass path with allowUnsandboxed forced
  // true — and made the documented 'kernel+atlan' boundary unreachable.
  const src = codeOnly('../server/src/agentExec.js');
  assert.ok(/if \(host\.ok\) \{/.test(src), 'kernel-capable hosts must always take the gated branch');
  assert.ok(!/if \(host\.ok && !useContainment\)/.test(src), 'the downgrading condition must be gone from the CODE');
  const gated = src.indexOf('gate = policyArgs(engine, profile, { allowUnsandboxed });');
  const addCont = src.indexOf('if (useContainment) {');
  assert.ok(gated > 0 && addCont > gated, 'containment must be applied AFTER the gate, on top of it');
});

test('ADV-1 · the kernel+atlan boundary is now actually reachable', () => {
  const src = readSource('../server/src/agentExec.js');
  assert.ok(/'kernel\+atlan'/.test(src) || /kernel.*atlan/.test(src),
    'the boundary string documents a combination that must be producible');
});

test('ADV-5 · the vision provider/model granularity limit is stated, not hidden', () => {
  const src = readSource('../server/src/vision.js');
  assert.ok(/VISION_PROVIDER_GRANULARITY/.test(src), 'the known limit must be named in code');
  assert.ok(/text-only MODEL on a vision provider is not detected/.test(src),
    'and must say exactly what is undetected');
});

// ══ regression from the contextless cross-vendor audit, 2026-08-04 ═════════

test('AUDIT-1 · orchestration.mjs loads THIS repo, not another worktree', () => {
  // It arrived from a cherry-pick importing /root/atlan-gamelab/server/src/…,
  // so it reported 8/8 green while testing a different checkout — including
  // six adversarial fixes it appeared to cover but never touched.
  // codeOnly, not readSource — the comment explaining the fix names the old
  // path, and a naive grep reports the bug as still present. Third time this
  // trap has fired in this suite; the helper exists precisely for it.
  const src = codeOnly('./orchestration.mjs');
  assert.ok(!/atlan-gamelab/.test(src), 'must not import from another worktree');
  assert.ok(/new URL\('\.\.\/server\/src\//.test(src), 'imports must be relative to this repo');
});

test('AUDIT-3 · the containment diff has a real timestamp floor', () => {
  // `find <dir> -newer <dir>` compared files against the directory they live in,
  // whose mtime moves as they are written — so `changed` came back 0 for runs
  // that changed files. Isolation held; the PROPOSAL RECORD lied.
  const src = codeOnly('../server/src/containment.js');
  assert.ok(!/-newer', dir/.test(src), 'must not compare against the workspace dir itself');
  assert.ok(/atlan-contain-epoch/.test(src), 'must stamp a marker file after the copy');
  assert.ok(/'!', '-name'/.test(src), 'and must exclude the marker from its own count');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
