// mutation.mjs — break each control on purpose, confirm its test goes red.
//
// NOT a suite and deliberately NOT registered in run-all.mjs: it EDITS THE
// WORKING TREE (and restores it) and takes ~2 minutes. It is the receipt for
// test/sandbox.mjs, run by hand:  node test/mutation.mjs
//
// WHY IT EXISTS. A test that passes against broken code is worthless, and this
// repo already carries the reason to distrust a green suite: three of eleven
// WarLibrary guards were broken while every fixture was green, and AI-authored
// tests over AI-authored code share their blind spots by construction. So each
// mutant below removes or inverts exactly ONE control and the suite is re-run.
// The mutant is CAUGHT only if the suite fails.
//
// An ESCAPED mutant is reported with what it removed, never quietly dropped —
// the escapes are the honest part of the output. Three of them are mutations of
// the PROBE'S OWN STRICTNESS (a rung that stops checking the exact errno still
// reads green on a host where the capability is present), and they cannot be
// falsified from outside without building test hooks into the launcher, which
// would be a worse trade. One is an equivalent mutant. One is a no-op control
// that MUST escape, or the suite is asserting on prose.
//
// The tree is restored from a pristine in-memory copy on every exit path,
// including SIGINT, and verified byte-identical at the end. An earlier run of
// this harness was killed mid-mutant and left the arch guard disabled in the
// tree for twenty minutes — hence the exit hooks and the final compare.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const C = 'server/native/atlan-confine.c';
const TI = 'server/src/sandbox/tiers.js';
const PL = 'server/src/sandbox/plan.js';
const PR = 'server/src/sandbox/probe.js';
const CO = 'server/src/sandbox/confine.js';
const BU = 'server/src/sandbox/build.js';
const FILES = [C, TI, PL, PR, CO, BU];

const ORIG = new Map(FILES.map((f) => [f, readFileSync(join(REPO, f), 'utf8')]));
const restore = () => { for (const [f, s] of ORIG) writeFileSync(join(REPO, f), s); };
process.on('exit', restore);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { restore(); process.exit(130); });

// [id, file, what it does, what it removes, old, new]
const MUTANTS = [
  ['M01', C, 'arch guard returns ALLOW instead of KILL',
    'the compat-ABI guard — a 32-bit entry indexes a DIFFERENT syscall table, so every rule below names the wrong call',
    'BPF_JEQ | BPF_K, ATLAN_ARCH, 1, 0));\n  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));',
    'BPF_JEQ | BPF_K, ATLAN_ARCH, 1, 0));\n  emit((struct sock_filter)BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));'],
  ['M02', C, 'default tail ALLOWs instead of killing', 'default-deny — the allow-list stops being an allow-list',
    'BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));\n  return FN;', 'BPF_RET | BPF_K, SECCOMP_RET_ALLOW));\n  return FN;'],
  ['M03', C, 'io_uring dropped from the deny set', 'ring opcodes never become syscalls, so a filter io_uring walks around is decorative',
    '    __NR_io_uring_setup, __NR_io_uring_enter, __NR_io_uring_register,\n', ''],
  ['M04', C, 'ptrace / process_vm dropped from the deny set', 'sibling-process memory read and write',
    '    __NR_ptrace, __NR_process_vm_readv, __NR_process_vm_writev, __NR_process_madvise,\n', ''],
  ['M05', C, 'egress denial is a no-op', "T2's only claim",
    '  rule(__NR_socket, ERRNO(EACCES));\n  rule(__NR_socketcall, ERRNO(EACCES));', '  (void)0;'],
  ['M06', C, 'Landlock ruleset built then never entered', 'the entire filesystem boundary',
    '    if (syscall(__NR_landlock_restrict_self, rs, 0)) die("L3 landlock_restrict_self: %s", strerror(errno));', '    (void)0;'],
  ['M07', C, 'Landlock handles read rights only', 'writes outside the grant become unrestricted',
    '    struct ll_ruleset_attr attr = { .handled_access_fs = handled };\n    int rs =',
    '    struct ll_ruleset_attr attr = { .handled_access_fs = LL_RO };\n    int rs ='],
  ['M08', C, 'seccomp never installed in confine mode', 'every capability claim at once',
    '  int n = build_filter(p->deny_egress);\n  if (install_prog(F, n)) die',
    '  int n = build_filter(p->deny_egress);\n  if (getpid() < 0 && install_prog(F, n)) die'],
  ['M09', C, 'L1 fd hygiene skipped', 'an inherited descriptor is checked at open() and never at read(), so L2-L4 become decorative',
    '  if (fd_hygiene(2, -1, err, sizeof(err))) die("L1 fd hygiene: %s", err);', '  (void)err;'],
  ['M10', C, 'NO_NEW_PRIVS skipped', 'the prerequisite for an unprivileged L3/L4',
    '  if (nnp()) die("L2 PR_SET_NO_NEW_PRIVS failed: %s", strerror(errno));', '  (void)0;'],
  ['M11', C, 'unknown policy directives ignored', 'a policy nobody wrote runs silently',
    "    else die(\"policy: unknown directive '%s' — refusing a policy we do not fully understand\", k);", '    else { }'],
  ['M12', C, 'tty on stdout/stderr accepted', 'TIOCSTI keystroke injection into the parent shell',
    '  if (isatty(1) || isatty(2)) die(', '  if (0) die('],
  ['M13', C, 'the sentinel rung accepts any errno',
    'the FLOOR — proof that the kernel arbitrates OUR decision rather than that a syscall happened to fail',
    '  if (errno != EOWNERDEAD) { snprintf(d, n, "%s returned errno %d (%s), expected EOWNERDEAD=%d", MARKER_NAME, errno, strerror(errno), EOWNERDEAD); return 1; }',
    '  if (0) { return 1; }'],
  ['M14', C, 'the io_uring rung accepts any failure, not our EPERM', '"happens to fail" is not a design',
    '  if (errno != EPERM) { snprintf(d, n, "io_uring_setup failed with %s, not our EPERM — it merely happens to be unavailable, which is not enforcement", strerror(errno)); return 1; }',
    '  if (0) { return 1; }'],
  ['M15', C, 'the egress rung skips its baseline', 'airplane mode and working egress control become indistinguishable',
    '  if (s < 0 || connect(s, (struct sockaddr *)&a, sizeof(a))) { snprintf(d, n, "BASELINE connect to 127.0.0.1:%u failed (%s) — cannot certify egress denial without proving egress worked first", g_port, strerror(errno)); return 1; }',
    '  if (0) { return 1; }'],
  ['M16', C, 'the landlock rung drops its inside-the-grant half', 'denying everything would read as enforcing something',
    '  f = open(g_llinside, O_RDONLY);\n  if (f < 0) { snprintf(d, n, "scratch INSIDE the grant is not openable (%s) — that is breakage, not a boundary", strerror(errno)); return 1; }',
    '  f = open(g_llinside, O_RDONLY);\n  if (0) { return 1; }'],
  ['M17', TI, 'ladder climbable from the middle', 'a broken floor with working egress would report T2',
    '    if (!REQUIRES[t].every((id) => ok.has(id))) break;\n    top = t;',
    '    if (REQUIRES[t].every((id) => ok.has(id))) top = t;'],
  ['M18', TI, 'assertTier always passes', 'fail-closed itself',
    '  if (rank(established) >= rank(declared)) return true;', '  return true;'],
  ['M19', TI, 'a missing rung counts as green', 'absence reads as a pass',
    "      if (!r || !r.ok) return r ?? { n: 0, id, ok: false, detail: 'rung never ran, so nothing was proven' };",
    '      if (r && !r.ok) return r;'],
  ['M20', TI, 'the phone tier calls itself a sandbox', 'the one regression that would discredit everything else',
    '**This is capability removal plus containment against error. It is not a sandbox.**',
    '**This is a lightweight sandbox for the phone.**'],
  ['M21', PL, 'credential grant check disabled', "codex could be granted grok's token",
    '    if (isSensitive(abs) && abs !== blessed) {', '    if (false && isSensitive(abs) && abs !== blessed) {'],
  ['M22', PL, 'reachability check disabled', 'a grant of $HOME is not credential-shaped and hands over every token on the device',
    '      if (isUnder(resolve(d), abs)) {', '      if (false) {'],
  ['M23', PL, '/etc + /proc + /dev granted wholesale', '/etc/shadow and every /proc/<pid>/environ',
    "  for (const r of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/system', '/apex']) ro.add(r);",
    "  for (const r of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/opt', '/system', '/apex', '/etc', '/proc', '/dev']) ro.add(r);"],
  ['M24', PL, 'IP-1 egress denied too', 'the split that IS the architecture — the agent CLI stops being able to reach its model',
    "  const denyEgress = insertionPoint === 'ip2-sdk-bash' && rank(declared) >= rank('T2');",
    "  const denyEgress = rank(declared) >= rank('T2');"],
  ['M25', PL, 'workspace no longer goes through guards.js', 'PROJECTS_DIR scoping, APP_ROOT blocking and the realpath symlink check',
    "    guardPath(workspace, { mustExist: true, blockAppRoot: true, verb: 'grantable' });", '    void workspace;'],
  ['M26', PL, '/tmp granted again instead of a per-run scratch', 'a shared channel between concurrently confined agents',
    "    scratch = join(ws, '.atlan-scratch');", "    scratch = join(ws, '.atlan-scratch'); rw.push('/tmp');"],
  ['M27', PR, 'probe trusts a wrong sentinel', 'a cached binary that is not what this source builds',
    '  if (j?.sentinel !== SENTINEL) {', '  if (false) {'],
  ['M28', PR, 'a malformed probe is treated as a capability', 'not-measured is not a capability',
    "  if (!Array.isArray(j.rungs) || !j.rungs.length) return t0('--probe returned no rungs', built.bin);",
    '  if (!Array.isArray(j.rungs)) j.rungs = [];'],
  ['M29', BU, 'compiler accepted without running its output', 'behavioural compiler discovery',
    "      const r = spawnSync(out, [], { stdio: 'ignore', timeout: 10000 });\n      if (r.status === 0) return cc;",
    '      return cc;'],
  ['M30', CO, 'IP-2 rewrite quoting removed', 'a command containing a single quote breaks out of the wrapper',
    "const shq = (s) => `'${String(s).replace(/'/g, `'\\\\''`)}'`;", "const shq = (s) => `'${String(s)}'`;"],
  ['M31', CO, 'IP-2 silently skips confinement instead of refusing',
    'the fail-closed direction at the one insertion point that has a real egress boundary',
    "export function confineBash({ declared, command, cwd }) {\n  if (rank(declared) < rank('T1')) return null;",
    'export function confineBash({ declared, command, cwd }) {\n  return null;'],
  ['M32', CO, 'IP-1 silently spawns unconfined instead of refusing', 'capability removal at the agent-CLI insertion point',
    "export function confineSpawn({ declared, cmd, args, cwd, engine = null }) {\n  if (rank(declared) < rank('T1')) return null;",
    'export function confineSpawn({ declared, cmd, args, cwd, engine = null }) {\n  return null;'],
  ['M33', C, 'the policy accepts a path instead of only argv/fd',
    "the TOCTOU rule — the launcher's own configuration must not be swappable between resolution and read",
    '  } else {\n    /* argv literal: frozen by execve', "  } else if (spec[0] == '/') {\n    int pf = open(spec, O_RDONLY);\n    ssize_t pk = pf < 0 ? -1 : read(pf, blob, sizeof(blob) - 1);\n    if (pk < 0) die(\"policy path\");\n    blob[pk] = 0; close(pf);\n  } else {\n    /* argv literal: frozen by execve"],
  ['M34', TI, 'NO-OP CONTROL: a comment is reworded', 'NOTHING — this mutant MUST escape, or the suite is asserting on prose',
    '// tiers.js — the confinement ladder', '// tiers.js -- the confinement ladder'],
];

const run = (file) => spawnSync(process.execPath, [file], { cwd: REPO, encoding: 'utf8', timeout: 900000 });
const redLines = (r) => (r.stdout + r.stderr).split('\n').filter((l) => l.trim().startsWith('✗'));

console.log('MUTATION TEST — test/sandbox.mjs + test/docdrift.mjs\n');
const b1 = run('test/sandbox.mjs'), b2 = run('test/docdrift.mjs');
if (b1.status !== 0 || b2.status !== 0) {
  console.error('baseline is not green — refusing to mutation-test against a red suite');
  console.error(redLines(b1).concat(redLines(b2)).join('\n'));
  process.exit(2);
}
console.log(`baseline green (${(b1.stdout.match(/✓/g) || []).length} assertions)\n`);

let caught = 0; const escaped = [];
for (const [id, file, what, removes, oldS, newS] of MUTANTS) {
  const src = ORIG.get(file);
  const n = src.split(oldS).length - 1;
  if (n !== 1) { escaped.push([id, what, `ANCHOR MISS — ${n} occurrences, mutant never applied`]); console.log(`!!      ${id} ${what} — ANCHOR MISS`); continue; }
  writeFileSync(join(REPO, file), src.replace(oldS, newS));
  const r1 = run('test/sandbox.mjs'), r2 = run('test/docdrift.mjs');
  restore();
  if (r1.status !== 0 || r2.status !== 0) {
    const first = redLines(r1).concat(redLines(r2))[0] ?? '[no ✗ line — the suite failed hard]';
    console.log(`CAUGHT  ${id} ${what}\n        by:${first.replace(/^\s*/, ' ')}`.slice(0, 200));
    caught++;
  } else {
    escaped.push([id, what, removes]);
    console.log(`ESCAPED ${id} ${what}\n        would remove: ${removes}`);
  }
}

console.log(`\n=== ${caught} caught, ${escaped.length} escaped, of ${MUTANTS.length} ===`);
for (const [id, what, why] of escaped) console.log(`  ${id} ${what} — ${why}`);
restore();
let clean = true;
for (const [f, s] of ORIG) if (readFileSync(join(REPO, f), 'utf8') !== s) { console.error('TREE NOT RESTORED: ' + f); clean = false; }
console.log(clean ? 'tree restored byte-identical' : 'TREE DIRTY — restore it from git before committing');
process.exit(clean ? 0 : 1);
