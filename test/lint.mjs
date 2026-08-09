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

// NO `-o /dev/null`. The first version sent the JSON report to the void and then
// tried to print it on failure, so a failing gate said "eslint found problems:"
// followed by nothing at all — the evidence was discarded before it could be
// read. It also made the suite fail while `eslint .` passed, because -o writes a
// file and its own errors then land in the exit code with the findings gone.
//
// Read stdout, parse it, and say WHICH rule in WHICH file. A gate that can only
// say "something is wrong" sends you looking with no lead.
let report = [];
let raw = '';
try {
  raw = execFileSync('node_modules/.bin/eslint', ['.', '-f', 'json'], {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
  });
} catch (err) {
  // Exit 1 means findings, and the JSON is still on stdout. Anything else — a
  // crash, an unloadable config — has no JSON, and that is a different failure.
  raw = err.stdout || '';
  if (!raw.trim()) assert.fail(`eslint could not run:\n${(err.stderr || err.message).slice(0, 2000)}`);
}
try { report = JSON.parse(raw); } catch { assert.fail(`eslint output was not JSON:\n${raw.slice(0, 1000)}`); }

const problems = report.flatMap((f) =>
  f.messages.map((m) => `${f.filePath.replace(REPO, '')}:${m.line}  ${m.ruleId ?? 'parse'}  ${m.message}`));
assert.equal(problems.length, 0, `eslint found ${problems.length} problem(s):\n  ${problems.slice(0, 30).join('\n  ')}`);
pass++;
console.log('  ok  eslint reports no problems');

// The config itself must stay loadable. A flat config that throws makes eslint
// exit non-zero for a reason that has nothing to do with the code, and the
// message ("Cannot find package '@eslint/js'") is easy to read as a lint failure
// — which is exactly what happened while this was being set up.
await import('../eslint.config.mjs');
pass++;
console.log('  ok  eslint.config.mjs loads');

console.log(`\n${pass} passed, 0 failed`);
