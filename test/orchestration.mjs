// End-to-end test of the cross-engine path. Real codex calls — small prompts.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, repo, scratch } from './lib/paths.mjs';
import { homedir } from 'node:os';
process.env.PATH += ':/root/.local/bin';

// RELATIVE, not absolute. This file was cherry-picked from another worktree and
// arrived importing /root/atlan-gamelab/server/src/… — so it was exercising a
// DIFFERENT CHECKOUT's copies of these modules. It reported 8/8 green while
// testing none of the code in this repo, including six adversarial fixes to
// agentExec.js that it appeared to cover. A test that loads its subject from
// outside the repo is a vacuous pass at the file level, and it also made the
// suite unrunnable from any clone that is not at /root/atlan-gamelab.
// Found by a contextless cross-vendor audit, 2026-08-04.
const { agentExec } = await import(new URL('../server/src/agentExec.js', import.meta.url));
const { policyArgs, sandboxCapableHost, policyReport } = await import(new URL('../server/src/enginePolicy.js', import.meta.url));
const { scrubbedEnv, openContained } = await import(new URL('../server/src/containment.js', import.meta.url));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name} — ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log('CROSS-ENGINE ORCHESTRATION\n');

console.log('host capability:');
console.log(' ', JSON.stringify(sandboxCapableHost()));
console.log(' ', JSON.stringify(policyReport().engines));
console.log();

// ── policy projection (pure) ──
await t('codex maps builder -> workspace-write', () => {
  const g = policyArgs('codex', 'builder');
  assert(g.args.join(' ') === '-s workspace-write', g.args.join(' '));
  assert(g.enforced === true, 'not marked enforced');
});
await t('codex maps verifier -> read-only (reads + runs, never edits)', () => {
  assert(policyArgs('codex', 'verifier').args.join(' ') === '-s read-only');
});
await t('an engine that cannot enforce a profile REFUSES rather than bypassing', () => {
  let threw = null;
  try { policyArgs('grok', 'builder'); } catch (e) { threw = e; }
  assert(threw, 'grok builder should have thrown — fidelity is unverified');
  assert(/refusing rather than running it ungated/.test(threw.message), threw.message);
});
await t('bypass is reachable only by explicit acknowledgement', () => {
  const g = policyArgs('grok', 'builder', { allowUnsandboxed: true });
  assert(g.enforced === false, 'must be labelled unenforced');
});

// ── env scrubbing ──
await t('scrubbedEnv drops known and pattern-matched credentials, keeps PATH/HOME', () => {
  const env = scrubbedEnv({
    PATH: '/usr/bin', HOME: homedir(),
    ATLAN_TOKEN: 'secret1', OPENAI_API_KEY: 'secret2',
    SOME_NEW_PROVIDER_API_KEY: 'secret3', MY_SECRET: 'secret4',
    // Keys the fallback heuristic CANNOT catch, so the explicit DROP list is
    // the only thing holding them: AWS_ACCESS_KEY_ID ends _ID, AWS_SECRET_ACCESS_KEY
    // ends _KEY (the pattern needs API_KEY), ATLAN_ORIGIN matches nothing at all.
    // Without these the test was held up entirely by the heuristic and passed
    // with the DROP list disabled. (Mutation pass, 2026-08-06.)
    AWS_ACCESS_KEY_ID: 'AKIA0', AWS_SECRET_ACCESS_KEY: 'secret5', ATLAN_ORIGIN: 'http://x',
    HARMLESS: 'keep',
  });
  assert(env.PATH && env.HOME, 'PATH/HOME must survive');
  assert(env.HARMLESS === 'keep', 'non-secret dropped');
  for (const k of ['ATLAN_TOKEN', 'OPENAI_API_KEY', 'SOME_NEW_PROVIDER_API_KEY', 'MY_SECRET',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'ATLAN_ORIGIN']) {
    assert(!(k in env), `${k} survived scrubbing`);
  }
});

// ── containment (the phone path) ──
const proj = scratch('atlan-contain-test-');
execFileSync('git', ['init', '-q'], { cwd: proj });
execFileSync('git', ['config', 'user.email', 't@t'], { cwd: proj });
execFileSync('git', ['config', 'user.name', 't'], { cwd: proj });
writeFileSync(join(proj, 'real.txt'), 'PRISTINE\n');
execFileSync('git', ['add', '-A'], { cwd: proj });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });

await t('openContained gives a git worktree, not a copy, for a repo', async () => {
  const w = await openContained(proj, 'test');
  try {
    assert(w.kind === 'git-worktree', `kind was ${w.kind}`);
    assert(existsSync(join(w.dir, 'real.txt')), 'project contents missing from workspace');
  } finally { await w.cleanup(); }
});
await t('edits in the contained workspace do NOT touch the real project', async () => {
  const w = await openContained(proj, 'test');
  try {
    writeFileSync(join(w.dir, 'real.txt'), 'MODIFIED BY AGENT\n');
    writeFileSync(join(w.dir, 'new.txt'), 'added\n');
    assert(readFileSync(join(proj, 'real.txt'), 'utf8') === 'PRISTINE\n', 'REAL PROJECT WAS MODIFIED');
    const d = w.diff();
    assert(d.changed === 2, `expected 2 changed files, got ${d.changed}`);
    assert(/MODIFIED BY AGENT/.test(d.patch), 'patch does not carry the change');
  } finally { await w.cleanup(); }
});
await t('cleanup removes the workspace and leaves the project clean', async () => {
  const w = await openContained(proj, 'test');
  const dir = w.dir;
  writeFileSync(join(dir, 'junk.txt'), 'x');
  await w.cleanup();
  assert(!existsSync(dir), 'workspace survived cleanup');
  const st = execFileSync('git', ['status', '--porcelain'], { cwd: proj }).toString();
  assert(st.trim() === '', `project left dirty: ${st}`);
});

// ── live: the actual cross-engine call ──
if (process.env.RUN_LIVE === '1') {
  await t('LIVE agentExec(codex, scout) returns text + tokens, kernel-gated', async () => {
    const r = await agentExec({
      engine: 'codex', profile: 'scout', cwd: proj, timeoutMs: 240000,
      prompt: 'Reply with exactly the word PONG and nothing else. Do not create any files.',
    });
    console.log(`      -> text="${r.text.slice(0, 60)}" tokens=${r.tokens} boundary=${r.boundary} gate="${r.gate}"`);
    assert(/PONG/i.test(r.text), `no PONG in: ${r.text.slice(0, 200)}`);
    assert(r.tokens > 0, 'no token count parsed — budget ledger would be blind');
    assert(r.enforced === true, 'should be kernel-enforced on this host');
    assert(r.boundary === 'kernel', `boundary was ${r.boundary}`);
  });

  await t('LIVE contained run proposes a diff and never touches the project', async () => {
    const r = await agentExec({
      engine: 'codex', profile: 'builder', cwd: proj, contain: true, timeoutMs: 240000,
      prompt: 'Create a file named agent_made.txt containing exactly the word HELLO. Then stop.',
    });
    console.log(`      -> boundary=${r.boundary} contained=${r.contained} changed=${r.proposal?.changed} tokens=${r.tokens}`);
    // The property that MATTERS is asserted first, before any labelling: the
    // real project is untouched and a reviewable proposal came back.
    assert(!existsSync(join(proj, 'agent_made.txt')), 'AGENT WROTE INTO THE REAL PROJECT');
    assert(r.proposal, 'no proposal returned');
    assert(r.proposal.changed >= 1, `expected >=1 changed file, got ${r.proposal.changed}`);
    assert(/agent_made\.txt/.test(r.proposal.patch || ''), 'patch does not mention the new file');
    assert(r.contained === true, 'run was not contained');
    // Both boundaries apply on this host; on the phone it would be 'atlan'.
    assert(/atlan/.test(r.boundary), `boundary was ${r.boundary}`);
  });
  // ── the PHONE path, exercised on this machine ──
  // Termux/proot has no user namespaces, so no CLI sandbox can initialise and
  // every engine must run with its gate off. That path is unreachable on the
  // only host that can run this suite, so it is simulated — and the property
  // under test is the one that matters on the phone: with NO kernel help, the
  // real project still cannot be touched.
  await t('LIVE phone simulation: no kernel sandbox, project still untouchable', async () => {
    process.env.ATLAN_ASSUME_NO_SANDBOX = '1';
    try {
      const r = await agentExec({
        engine: 'codex', profile: 'builder', cwd: proj, timeoutMs: 240000,
        prompt: 'Create a file named phone_made.txt containing exactly the word FROMPHONE. Then stop.',
      });
      console.log(`      -> boundary=${r.boundary} enforced=${r.enforced} changed=${r.proposal?.changed}`);
      assert(!existsSync(join(proj, 'phone_made.txt')), 'AGENT WROTE INTO THE REAL PROJECT WITH NO KERNEL GATE');
      assert(r.enforced === false, 'must NOT claim kernel enforcement without a kernel gate');
      assert(r.boundary === 'atlan', `boundary was ${r.boundary} — should be atlan-only on a proot host`);
      assert(r.contained === true, 'phone path must contain');
      assert(r.proposal?.changed >= 1, 'no proposal produced');
    } finally { delete process.env.ATLAN_ASSUME_NO_SANDBOX; }
  });
} else {
  console.log('  · live engine tests skipped (RUN_LIVE=1 to enable)');
}

rmSync(proj, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
