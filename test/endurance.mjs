// The endurance report must not say "survived" about a night it did not measure.
//
// bin/atlan-endurance.sh answers the one claim in the README with no receipt
// behind it — "send agents off to work on budgets while you sleep." The measuring
// tool is therefore load-bearing, and its failure mode is silent: a report that
// prints SURVIVED after a run the OS froze is worse than no report, because it
// converts an open question into a false answer.
//
// The signal is SAMPLE GAP. The sampler wakes on a fixed interval, so a gap
// beyond interval+tolerance means the process was suspended. Two things can go
// wrong with that, and both are asserted here:
//
//   1. The threshold is read from the LOG's own config line, never from the flags
//      on the reporting invocation. A 3s-interval run reported under the 60s
//      default would call a 400s freeze a normal gap.
//   2. A freeze and a dead server must not be reported as the same thing. Doze
//      throttling and a crashed cockpit need different fixes, and a verdict that
//      blurs them sends you to the wrong one.
import './_isolate.mjs';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(REPO, 'bin', 'atlan-endurance.sh');
const dir = mkdtempSync(join(tmpdir(), 'atlan-endurance-'));
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const cfg = (o = {}) => JSON.stringify({
  kind: 'config', at: 1000, hours: 8, interval: 3, load: 0, synthetic_load: false,
  wake_lock: false, charging: 'DISCHARGING', device: 'SM-S928U',
  kernel: '6.1.145-android14', note: 'fixture', ...o,
});
const sample = (o) => JSON.stringify({
  kind: 'sample', at: 0, elapsed: 0, gap: 3, battery: 95, charging: 'DISCHARGING',
  temp_c: 32, cockpit: 'up', load1: 0.4, ...o,
});
const report = (name, lines) => {
  const f = join(dir, `${name}.jsonl`);
  writeFileSync(f, lines.join('\n') + '\n');
  return execFileSync('bash', [SCRIPT, '--report', f], { encoding: 'utf8' });
};

console.log('\nEndurance report');

t('a clean run reports survival', () => {
  const out = report('clean', [
    cfg(),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    sample({ at: 1006, elapsed: 6, gap: 3 }),
    '{"kind":"end","at":1006}',
  ]);
  assert.match(out, /VERDICT: survived/);
  assert.match(out, /frozen intervals {3}0/);
});

t('a Doze-sized gap is reported as a freeze, not survival', () => {
  const out = report('frozen', [
    cfg(),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    sample({ at: 1403, elapsed: 403, gap: 400 }), // the OS suspended us
    '{"kind":"end","at":1403}',
  ]);
  assert.match(out, /VERDICT: the OS froze the process/);
  assert.doesNotMatch(out, /survived/);
  assert.match(out, /longest gap 400s/);
});

t('the freeze threshold comes from the log, not from the reporting flags', () => {
  // 100s gap in a 3s-interval run is a freeze. If the reporter used its own 60s
  // default with a 30s tolerance it would be under the threshold and vanish.
  const out = report('threshold', [
    cfg({ interval: 3 }),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    sample({ at: 1103, elapsed: 103, gap: 100 }),
    '{"kind":"end","at":1103}',
  ]);
  assert.match(out, /VERDICT: the OS froze/, 'a 100s gap at 3s interval must be a freeze');
  assert.match(out, /interval 3s/, 'the report must echo the log\'s interval, not the default');
});

t('a dead cockpit is blamed on the server, not on Doze', () => {
  const out = report('serverdown', [
    cfg({ wake_lock: true }),
    sample({ at: 1003, elapsed: 3, gap: 3, cockpit: 'up' }),
    sample({ at: 1006, elapsed: 6, gap: 3, cockpit: 'down' }),
    sample({ at: 1009, elapsed: 9, gap: 3, cockpit: 'down' }),
    '{"kind":"end","at":1009}',
  ]);
  assert.match(out, /Server-side failure, not Doze/);
  assert.match(out, /cockpit down {7}2 of 3/);
});

t('the verdict always carries the configuration it applies to', () => {
  // "Survived" means nothing without knowing whether it was plugged in, whitelisted
  // and holding a wake lock. The config line travels with every verdict so a
  // friendly run cannot be quoted as the pessimistic one.
  const out = report('config-attached', [
    cfg({ wake_lock: true, charging: 'CHARGING' }),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    '{"kind":"end","at":1003}',
  ]);
  assert.match(out, /Configuration this verdict applies to/);
  assert.match(out, /"wake_lock":true/);
  assert.match(out, /"charging":"CHARGING"/);
});

t('a log with no samples refuses to render a verdict', () => {
  const out = report('empty', [cfg(), '{"kind":"end","at":1000}']);
  assert.match(out, /no samples/);
  assert.doesNotMatch(out, /VERDICT/);
});

t('a log with no config line is refused rather than guessed at', () => {
  const f = join(dir, 'noconfig.jsonl');
  writeFileSync(f, sample({ at: 1003, elapsed: 3, gap: 3 }) + '\n');
  assert.throws(
    () => execFileSync('bash', [SCRIPT, '--report', f], { encoding: 'utf8', stdio: 'pipe' }),
    /cannot set a freeze threshold|Command failed/,
  );
});

t('missing battery and thermal read as unavailable, never as zero', () => {
  // A phone without termux-api reports null. Printing "0%" or "0.0 C" would look
  // like a measurement and would be a fabricated one.
  const out = report('nulls', [
    cfg(),
    sample({ at: 1003, elapsed: 3, gap: 3, battery: null, temp_c: null }),
    '{"kind":"end","at":1003}',
  ]);
  assert.match(out, /battery {12}unavailable/);
  assert.match(out, /temperature {8}unavailable/);
  assert.doesNotMatch(out, /0\.0 C/);
});

// ── agent-work mode ──────────────────────────────────────────────────────────
// Survival was only ever the precondition. The claim is "send agents off to work
// on budgets while you sleep", so the report must separate a run that never came
// back from one that did, from one that came back WRONG, from one that was never
// issued because the spend ceiling stopped it. Those are four different answers
// about the product and collapsing any two of them produces a false receipt.
const run = (o) => JSON.stringify({ kind: 'run', at: 0, ...o });

t('a run that never finished is stuck, not counted as work done', () => {
  const out = report('stuck', [
    cfg({ fleet: true }),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    run({ started: true, id: 'r1', n: 1 }),
    run({ id: 'r1', finished: false, why: 'still running after 10min' }),
    '{"kind":"end","at":1003}',
  ]);
  assert.match(out, /runs started {5}1/);
  assert.match(out, /never finished {3}1/);
  assert.doesNotMatch(out, /runs finished {4}1/, 'a stuck run must not count as finished');
});

t('a wrong answer counts as finished but NOT as correct', () => {
  // A run can come back on time and come back garbage. Folding those together is
  // how "the fleet worked all night" gets said about a night that produced junk.
  const out = report('wrong', [
    cfg({ fleet: true }),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    run({ started: true, id: 'r1', n: 1 }),
    run({ id: 'r1', finished: true, status: 'done', tokens: 41000, cost: 0.02, answer: '9', correct: false, spent_total: 41000 }),
    '{"kind":"end","at":1003}',
  ]);
  assert.match(out, /runs finished {4}1/);
  assert.match(out, /answers correct {2}0/);
  assert.match(out, /tokens spent {5}41000/);
});

t('runs stopped by the token ceiling are reported, never silently dropped', () => {
  // A harness that quietly stops spending looks identical to one that ran all
  // night. The ceiling doing its job IS a result and has to appear as one.
  const out = report('capped', [
    cfg({ fleet: true }),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    run({ started: true, id: 'r1', n: 1 }),
    run({ id: 'r1', finished: true, status: 'done', tokens: 60000, cost: 0.03, answer: '1', correct: true, spent_total: 60000 }),
    run({ skipped: 'token ceiling reached', spent: 60000, cap: 60000 }),
    '{"kind":"end","at":1003}',
  ]);
  assert.match(out, /answers correct {2}1/);
  assert.match(out, /skipped \(cap\) {4}1/);
});

t('a survival-only log says nothing at all about agent work', () => {
  // The dangerous one: reading "VERDICT: survived" off a night that issued no
  // agent turns, and quoting it as proof of the overnight claim.
  const out = report('survival-only', [
    cfg({ fleet: false }),
    sample({ at: 1003, elapsed: 3, gap: 3 }),
    '{"kind":"end","at":1003}',
  ]);
  assert.match(out, /VERDICT: survived/);
  assert.doesNotMatch(out, /AGENT WORK/, 'no agent-work section without agent-work data');
  assert.match(out, /"fleet":false/, 'the config line must show agent work was OFF');
});

t('--dry-run spends nothing and states the ceiling', () => {
  const out = execFileSync('bash', [SCRIPT, '--fleet', '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /nothing has been sent/i);
  assert.match(out, /profile {11}scout/);
  assert.match(out, /night ceiling/);
  assert.doesNotMatch(out, /VERDICT/, 'a dry run must not produce a verdict');
});

console.log(`\n${pass} passed, 0 failed`);
