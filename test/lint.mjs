// Lint as a GATE, not a suggestion.
//
// This exists because the linter's first run found a real bug that 846 tests
// never reached: agentExec.js used `export { killTree } from './procTree.js'`,
// which creates no local binding, so the run-timeout handler threw
// ReferenceError instead of killing the process tree. `no-undef` catches that
// whole class — a name referenced and never bound — and it can only keep
// catching it if a violation fails the build rather than scrolling past someone.
//
// Deliberately the whole ruleset, not a chosen subset. Picking "the important
// rules" here is how a config drifts from what CI enforces.
import './_isolate.mjs';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
let pass = 0;

console.log('\nLint');

try {
  execFileSync('node_modules/.bin/eslint', ['.', '-f', 'json', '-o', '/dev/null'], {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  pass++;
  console.log('  ok  eslint reports no problems');
} catch (err) {
  // eslint exits non-zero with the findings on stdout. Surface them here rather
  // than "lint failed", so the failure is actionable from the suite output.
  const out = (err.stdout || '') + (err.stderr || '');
  assert.fail(`eslint found problems:\n${out.slice(0, 4000)}`);
}

// The config itself must stay loadable. A flat config that throws makes eslint
// exit non-zero for a reason that has nothing to do with the code, and the
// message ("Cannot find package '@eslint/js'") is easy to read as a lint failure
// — which is exactly what happened while this was being set up.
await import('../eslint.config.mjs');
pass++;
console.log('  ok  eslint.config.mjs loads');

console.log(`\n${pass} passed, 0 failed`);
