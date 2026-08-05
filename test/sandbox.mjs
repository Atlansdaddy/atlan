// Security-spine suite — the OS sandbox and credential blindness, attacked.
//
// Every kernel-dependent assertion here RUNS the real confinement and reads
// back what the kernel did. Nothing is asserted from a flag file, a version
// string, or the module's own opinion of itself.
//
// HOST HONESTY. Confinement needs user namespaces. Termux/proot has none, and
// a locked-down CI container may have none either. On such a host the
// kernel-dependent tests SKIP — loudly, counted, and named in the summary — and
// the host-independent tests (plan validation, environment allowlist, fail-closed
// refusal, redaction, hardlink preflight) still run and still must pass. A skip
// is never printed as a pass. The last test asserts that the capability report
// was honest about which of the two happened.
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync,
  symlinkSync, linkSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  confinedSpawn, unconfinedSpawn, probeConfinement, confinementArgv, confinementReport,
} from '../server/src/lib/sandbox.js';
import {
  childEnv, ENV_ALLOW, VENDOR_STORES, credentialTargets, credentialPreflight, redactor,
} from '../server/src/lib/credblind.js';

let pass = 0, fail = 0, skip = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; failures.push(`${name} — ${err.message}`); console.log(`  ✗ ${name} — ${err.message}`); }
}
function skipped(name, why) { skip++; console.log(`  ⊘ ${name} — SKIPPED: ${why}`); }

console.log('SECURITY SPINE SUITE (OS sandbox + credential blindness)');

// Scratch lives under HOME, never /tmp: the sandbox replaces /tmp with a private
// tmpfs, so a canary placed there would read back empty because it was SHADOWED
// rather than because a control worked — a test that passes for the wrong reason
// is worse than no test. (This exact bug was found and fixed in the probe itself
// during the build.)
const ROOT = mkdtempSync(join(homedir(), '.atlan-spine-test-'));
const cleanup = () => { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* */ } };
process.on('exit', cleanup);

const SECRET = 'COCKPIT-TOKEN-a3f9c17b2e';
const ws = join(ROOT, 'workspace'); mkdirSync(ws);
const outside = join(ROOT, 'outside'); mkdirSync(outside);
const credFile = join(ROOT, '.auth-token'); writeFileSync(credFile, SECRET + '\n', { mode: 0o600 });
const credDir = join(ROOT, '.ssh'); mkdirSync(credDir); writeFileSync(join(credDir, 'id_ed25519'), 'PRIVATE-KEY-' + SECRET);
writeFileSync(join(outside, 'bystander.txt'), 'untouched');

const PROBE = probeConfinement({ net: 'none' });
const KERNEL = PROBE.ran && Object.values(PROBE.controls).every((c) => c.ok);
const NOKERNEL = `this host cannot confine — ${PROBE.raw.split('\n')[0].slice(0, 140)}`;

// Run a shell snippet inside the real sandbox and hand back everything it said.
// The snippet is passed as argv, never spliced into a command line.
const inSandbox = (script, opts = {}) => new Promise((res) => {
  let out = '';
  const c = confinedSpawn('sh', ['-c', script], {
    writable: [ws], mask: [credFile, credDir], net: 'none', cwd: ws, ...opts,
  });
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { out += d; });
  c.on('close', (code) => res({ out, code }));
});
const K = (name, fn) => (KERNEL ? test(name, fn) : Promise.resolve(skipped(name, NOKERNEL)));

// ══ A. FILESYSTEM FENCE ═══════════════════════════════════════════════════
// Deny by default. The fence is the absence of a writable mount, so the
// interesting question is not "does it block `../`" but "is there ANY spelling
// of a path that reaches a writable inode outside the workspace". Each of these
// is a different spelling, and one run collects them all.
console.log('\n── A. filesystem fence: escape by every spelling ──');
let A = null;
if (KERNEL) {
  const esc = [
    ['plain-absolute', `echo x > ${outside}/pwn`],
    ['dotdot-relative', `echo x > ../outside/pwn2`],
    ['dotdot-deep', `echo x > ./../../${ROOT.split('/').pop()}/outside/pwn3`],
    ['double-slash', `echo x > ${outside}//pwn4`],
    ['dot-segments', `echo x > ${outside}/./pwn5`],
    ['trailing-dot-dir', `echo x > ${outside}/./././pwn6`],
    ['home', `echo x > ${homedir()}/atlan-pwn`],
    ['etc', `echo x > /etc/atlan-pwn`],
    ['usr-bin', `echo x > /usr/bin/atlan-pwn`],
    ['proc-sysrq', `echo x > /proc/sys/kernel/atlan-pwn`],
    ['unicode-name', `echo x > ${outside}/pwň.txt`],
    ['newline-in-name', `echo x > "${outside}/pw
n.txt"`],
    ['overwrite-existing', `echo CLOBBERED > ${outside}/bystander.txt`],
    ['delete-outside', `rm -f ${outside}/bystander.txt`],
    ['rename-outside', `mv ${outside}/bystander.txt ${outside}/moved.txt`],
    ['chmod-outside', `chmod 777 ${outside}/bystander.txt`],
    ['append-outside', `echo more >> ${outside}/bystander.txt`],
    ['truncate-outside', `: > ${outside}/bystander.txt`],
    ['mkdir-outside', `mkdir ${outside}/pwndir`],
    ['symlink-then-write', `ln -s ${outside} ${ws}/link && echo x > ${ws}/link/pwn7`],
    ['symlink-to-file', `ln -s ${outside}/bystander.txt ${ws}/flink && echo x > ${ws}/flink`],
    ['tee-outside', `echo x | tee ${outside}/pwn8`],
    ['dd-outside', `dd if=/dev/zero of=${outside}/pwn9 bs=1 count=1`],
    ['cp-outside', `cp ${ws}/../workspace/. ${outside}/pwn10 -r`],
  ].map(([n, c]) => `echo "${n}=$( (${c}) >/dev/null 2>&1 && echo WROTE || echo refused )"`).join('\n');
  A = await inSandbox(`${esc}\necho "inside=$( (echo ok > ${ws}/legit) >/dev/null 2>&1 && echo WROTE || echo refused )"`);
}
const av = (k) => (A.out.match(new RegExp(`^${k}=(.*)$`, 'm')) || [, 'MISSING'])[1];

await K('workspace itself is writable (a fence that blocks everything is broken, not safe)', () => {
  assert.equal(av('inside'), 'WROTE', A.out);
});
for (const shape of ['plain-absolute', 'dotdot-relative', 'dotdot-deep', 'double-slash', 'dot-segments',
  'trailing-dot-dir', 'home', 'etc', 'usr-bin', 'proc-sysrq', 'unicode-name', 'newline-in-name',
  'overwrite-existing', 'delete-outside', 'rename-outside', 'chmod-outside', 'append-outside',
  'truncate-outside', 'mkdir-outside', 'symlink-then-write', 'symlink-to-file', 'tee-outside',
  'dd-outside', 'cp-outside']) {
  await K(`write escape refused: ${shape}`, () => {
    assert.equal(av(shape), 'refused', `${shape} was not refused — ${A.out}`);
  });
}
await K('the HOST tree is byte-identical after every escape attempt', () => {
  assert.equal(readFileSync(join(outside, 'bystander.txt'), 'utf8'), 'untouched');
  assert.ok(!existsSync(join(outside, 'pwn')), 'a canary file appeared on the host');
  assert.ok(!existsSync(join(homedir(), 'atlan-pwn')), 'HOME was written');
  assert.ok(!existsSync('/etc/atlan-pwn'), '/etc was written');
});
await K('the run\'s own writes DO land on the host (isolation must not be a black hole)', () => {
  assert.equal(readFileSync(join(ws, 'legit'), 'utf8').trim(), 'ok');
});

// ══ B. CREDENTIAL BLINDNESS — FILESYSTEM ══════════════════════════════════
// The mask is attached to a path, so every alias of that path is covered. These
// read the same secret by ten different names and through four different tools,
// because "cat is blocked" is not the claim — "the bytes are not reachable" is.
console.log('\n── B. credential blindness: filesystem ──');
let B = null;
if (KERNEL) {
  const rel = credFile.split('/').pop();
  const reads = [
    ['cat-absolute', `cat ${credFile}`],
    ['cat-relative', `cd ${ws} && cat ../${rel}`],
    ['cat-dotdot', `cat ${ws}/../${rel}`],
    ['cat-double-slash', `cat ${ROOT}//${rel}`],
    ['cat-dot-segment', `cat ${ROOT}/./${rel}`],
    ['head', `head -c 200 ${credFile}`],
    ['dd', `dd if=${credFile} bs=1 count=200`],
    ['od', `od -c ${credFile} | head -2`],
    ['grep', `grep -a . ${credFile}`],
    ['wc-then-read', `wc -c ${credFile}; cat ${credFile}`],
    ['via-symlink', `ln -sf ${credFile} ${ws}/s1 2>/dev/null; cat ${ws}/s1`],
    ['via-symlink-chain', `ln -sf ${ws}/s1 ${ws}/s2 2>/dev/null; cat ${ws}/s2`],
    ['find-exec', `find ${ROOT} -maxdepth 1 -name '.auth-token' -exec cat {} \\;`],
    ['ssh-key-in-masked-dir', `cat ${credDir}/id_ed25519`],
    ['ls-masked-dir', `ls -a ${credDir}`],
    ['glob-masked-dir', `cat ${credDir}/* 2>/dev/null`],
    ['node-readfile', `node -e 'try{process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))}catch(e){}' ${credFile}`],
    ['node-openfd', `node -e 'const fs=require("fs");try{const fd=fs.openSync(process.argv[1],"r");const b=Buffer.alloc(200);const n=fs.readSync(fd,b,0,200,0);process.stdout.write(b.slice(0,n))}catch(e){}' ${credFile}`],
    ['after-umount', `umount ${credFile} 2>/dev/null; cat ${credFile}`],
    ['after-remount-rw', `mount -o remount,bind,rw / 2>/dev/null; cat ${credFile}`],
    ['after-nested-userns', `unshare -Urm sh -c "umount ${credFile}; cat ${credFile}" 2>/dev/null`],
    ['after-chroot', `chroot / cat ${credFile} 2>/dev/null`],
  ].map(([n, c]) => `echo "${n}=$( (${c}) 2>/dev/null | tr -d '\\n' | head -c 80 )"`).join('\n');
  B = await inSandbox(reads);
}
const bv = (k) => (B.out.match(new RegExp(`^${k}=(.*)$`, 'm')) || [, 'MISSING'])[1];
for (const shape of ['cat-absolute', 'cat-relative', 'cat-dotdot', 'cat-double-slash', 'cat-dot-segment',
  'head', 'dd', 'od', 'grep', 'wc-then-read', 'via-symlink', 'via-symlink-chain', 'find-exec',
  'ssh-key-in-masked-dir', 'ls-masked-dir', 'glob-masked-dir', 'node-readfile', 'node-openfd',
  'after-umount', 'after-remount-rw', 'after-nested-userns', 'after-chroot']) {
  await K(`credential unreadable: ${shape}`, () => {
    const got = bv(shape);
    assert.ok(!String(got).includes(SECRET), `${shape} returned the secret: ${JSON.stringify(got)}`);
    assert.ok(!String(got).includes('PRIVATE-KEY'), `${shape} returned the private key: ${JSON.stringify(got)}`);
  });
}
await K('a credential path that does not exist cannot be CREATED inside the run', async () => {
  const r = await inSandbox(`echo "made=$( (mkdir -p ${homedir()}/.aws && echo k > ${homedir()}/.aws/credentials) 2>/dev/null && echo MADE || echo refused )"`);
  assert.ok(/made=refused/.test(r.out), r.out);
});
await K('masking is not a mutation: the credential is intact on the host afterwards', () => {
  assert.equal(readFileSync(credFile, 'utf8').trim(), SECRET);
  assert.ok(readFileSync(join(credDir, 'id_ed25519'), 'utf8').includes('PRIVATE-KEY'));
});

// ══ C. CREDENTIAL BLINDNESS — ENVIRONMENT ═════════════════════════════════
console.log('\n── C. credential blindness: environment ──');
const dirty = {
  PATH: '/usr/bin', HOME: '/h', LANG: 'C',
  ATLAN_TOKEN: SECRET, ANTHROPIC_API_KEY: 'sk-ant-x', OPENAI_API_KEY: 'sk-y',
  // Shapes a name-based denylist or a trailing-suffix regex misses:
  AZURE_CLIENT_SECRET_ID: 'z', NPM_CONFIG__AUTH: 'b64', CLOUDSDK_AUTH_ACCESS_TOKEN_X: 'q',
  TOTALLY_NEW_PROVIDER_2027: 'nk-live-9', GH_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 'w',
  DATABASE_URL: 'postgres://u:p@h/db', SSH_AUTH_SOCK: '/tmp/agent.sock',
  NODE_OPTIONS: '--require=/tmp/evil.js',
};
await test('childEnv is an ALLOWLIST — no credential-shaped or unknown variable survives', () => {
  const e = childEnv(dirty);
  for (const k of Object.keys(dirty)) {
    if (ENV_ALLOW.includes(k)) continue;
    assert.ok(!(k in e), `${k} survived the allowlist`);
  }
  assert.ok(!JSON.stringify(e).includes(SECRET), 'the cockpit token survived');
});
await test('childEnv keeps exactly what a CLI needs to run at all', () => {
  const e = childEnv(dirty);
  assert.equal(e.PATH, '/usr/bin'); assert.equal(e.HOME, '/h'); assert.equal(e.LANG, 'C');
});
await test('childEnv drops NODE_OPTIONS — code execution, and no credential denylist would catch it', () => {
  assert.ok(!('NODE_OPTIONS' in childEnv(dirty)));
});
await test('childEnv drops SSH_AUTH_SOCK — an agent socket is a credential with no key-shaped name', () => {
  assert.ok(!('SSH_AUTH_SOCK' in childEnv(dirty)));
});
await test('grant adds exactly one provider key and nothing adjacent', () => {
  const e = childEnv(dirty, { grant: { XAI_API_KEY: 'xai-1' } });
  assert.equal(e.XAI_API_KEY, 'xai-1');
  assert.ok(!('ANTHROPIC_API_KEY' in e) && !('OPENAI_API_KEY' in e) && !('GH_TOKEN' in e));
});
await test('grant ignores empty/null values rather than exporting an empty credential', () => {
  const e = childEnv(dirty, { grant: { A_KEY: '', B_KEY: null, C_KEY: undefined } });
  assert.ok(!('A_KEY' in e) && !('B_KEY' in e) && !('C_KEY' in e));
});
await test('shell + pager history are pointed at /dev/null', () => {
  const e = childEnv(dirty);
  assert.equal(e.HISTFILE, '/dev/null'); assert.equal(e.LESSHISTFILE, '/dev/null');
});
await test('ENV_ALLOW itself contains no credential-bearing name (guards against a careless addition)', () => {
  for (const k of ENV_ALLOW) assert.ok(!/KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH/i.test(k), `${k} does not belong in the allowlist`);
});
await K('the confined child\'s OWN /proc/self/environ holds no credential', async () => {
  const r = await inSandbox(`tr -d '\\0' < /proc/self/environ | head -c 2000`, { env: childEnv({ ...process.env, ATLAN_TOKEN: SECRET }) });
  assert.ok(!r.out.includes(SECRET), r.out.slice(0, 300));
});
await test('MEASURED LIMIT: delete process.env does NOT scrub /proc/self/environ (why masking exists)', async () => {
  const out = await new Promise((res) => {
    let o = ''; const c = spawn(process.execPath, ['-e',
      'delete process.env.ATLAN_PROBE_X; process.stdout.write(String(require("fs").readFileSync("/proc/self/environ","utf8").includes("leak-me-9x")))'],
      { env: { ...process.env, ATLAN_PROBE_X: 'leak-me-9x' } });
    c.stdout.on('data', (d) => { o += d; }); c.on('close', () => res(o));
  });
  assert.equal(out, 'true', 'if this ever prints false the platform changed and the report needs revisiting');
});

// ══ D. /proc SCRAPE ═══════════════════════════════════════════════════════
// The vector the environment allowlist does NOT close: a child of the same uid
// reading the COCKPIT's /proc entries. Tested against a real sibling process
// holding a real secret, not against a hypothesis.
console.log('\n── D. /proc scrape of parent and siblings ──');
if (KERNEL) {
  const sib = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'],
    { env: { PATH: process.env.PATH, ATLAN_TOKEN: SECRET }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 250));
  const D = await inSandbox([
    `echo "environ=$( tr -d '\\0' < /proc/${sib.pid}/environ 2>/dev/null | head -c 200 )"`,
    `echo "cmdline=$( tr -d '\\0' < /proc/${sib.pid}/cmdline 2>/dev/null | head -c 200 )"`,
    `echo "fds=$( ls /proc/${sib.pid}/fd 2>/dev/null | wc -l )"`,
    `echo "cwdlink=$( readlink /proc/${sib.pid}/cwd 2>/dev/null )"`,
    `echo "parent=$( tr -d '\\0' < /proc/${process.pid}/environ 2>/dev/null | head -c 200 )"`,
    `echo "pids=$( ls -d /proc/[0-9]* 2>/dev/null | wc -l )"`,
    `echo "pid1=$( tr -d '\\0' < /proc/1/cmdline 2>/dev/null | head -c 60 )"`,
    // A blind sweep of EVERY readable environ. Written to the workspace and
    // checked by the parent, because grepping for the secret here would put it
    // on the child's own argv — where it would find itself and "fail" honestly
    // but for entirely the wrong reason.
    `cat /proc/*/environ > ${ws}/sweep.bin 2>/dev/null; echo "swept=$( wc -c < ${ws}/sweep.bin )"`,
  ].join('\n'));
  try { sib.kill('SIGKILL'); } catch { /* */ }
  const dv = (k) => (D.out.match(new RegExp(`^${k}=(.*)$`, 'm')) || [, 'MISSING'])[1];
  await K('sibling /proc/<pid>/environ is unreachable', () => assert.ok(!dv('environ').includes(SECRET), D.out));
  await K('sibling /proc/<pid>/cmdline is unreachable', () => assert.equal(dv('cmdline'), '', D.out));
  await K('sibling /proc/<pid>/fd is unreachable', () => assert.equal(dv('fds'), '0', D.out));
  await K('sibling /proc/<pid>/cwd is unreachable', () => assert.equal(dv('cwdlink'), '', D.out));
  await K('the COCKPIT process is not in /proc at all', () => assert.equal(dv('parent'), '', D.out));
  await K('only the run\'s own processes are visible', () => {
    const n = Number(dv('pids'));
    assert.ok(n > 0 && n <= 8, `saw ${n} pids — the host has far more`);
  });
  await K('PID 1 inside is the run itself, not the host init', () => {
    assert.ok(!/systemd|\/sbin\/init/.test(dv('pid1')), `pid1 = ${dv('pid1')}`);
  });
  await K('a blind sweep of every readable /proc/*/environ yields no credential', () => {
    const sweep = existsSync(join(ws, 'sweep.bin')) ? readFileSync(join(ws, 'sweep.bin'), 'latin1') : '';
    assert.ok(!sweep.includes(SECRET), `the sweep captured the secret (${dv('swept')} bytes)`);
  });
} else {
  for (const n of ['sibling environ', 'sibling cmdline', 'sibling fd', 'sibling cwd', 'cockpit invisible',
    'own pids only', 'pid1 is the run', 'blind /proc sweep']) skipped(`/proc: ${n}`, NOKERNEL);
}

// ══ E. NETWORK EGRESS ═════════════════════════════════════════════════════
// Including the exact 2026-08-04 shape: a live loopback listener standing in for
// the cockpit's own API, which the run must not be able to reach.
console.log('\n── E. network egress ──');
if (KERNEL) {
  // The probe client hangs up the instant it sees a connection, so both the
  // socket and the server must swallow ECONNRESET — an unhandled one would take
  // the whole suite down and look like a security failure.
  const srv = createServer((s) => { s.on('error', () => {}); s.end('SERVED'); });
  srv.on('error', () => {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const netScript = (host, p) => `node -e 'const s=require("net").connect({host:"${host}",port:${p}});s.setTimeout(2500);s.on("connect",()=>{console.log("OPEN");process.exit(0)});s.on("error",e=>{console.log(e.code);process.exit(0)});s.on("timeout",()=>{console.log("TIMEOUT");process.exit(0)})'`;
  const E = await inSandbox([
    `echo "internet=$( ${netScript('1.1.1.1', 443)} )"`,
    `echo "cockpit=$( ${netScript('127.0.0.1', port)} )"`,
    `echo "cockpit6=$( ${netScript('::1', port)} )"`,
    `echo "dns=$( getent hosts api.anthropic.com >/dev/null 2>&1 && echo RESOLVED || echo failed )"`,
    `echo "curl=$( curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/ 2>/dev/null || echo failed )"`,
    `echo "ifaces=$( ls /sys/class/net 2>/dev/null | tr '\\n' ' ' )"`,
  ].join('\n'));
  const ev = (k) => (E.out.match(new RegExp(`^${k}=(.*)$`, 'm')) || [, 'MISSING'])[1];
  // Cross-check with net:'shared' on the SAME listener. Without this the netns
  // result could just mean the listener was never reachable in the first place.
  let shared = '';
  await new Promise((res) => {
    const c = confinedSpawn('sh', ['-c', `echo "cockpit=$( ${netScript('127.0.0.1', port)} )"`],
      { writable: [ws], mask: [], net: 'shared', cwd: ws });
    c.stdout.on('data', (d) => { shared += d; });
    c.on('close', () => res());
  });
  srv.close();

  await K('net:none — outbound internet is unreachable', () => {
    assert.ok(['ENETUNREACH', 'EHOSTUNREACH', 'EAFNOSUPPORT'].includes(ev('internet')), E.out);
  });
  await K('net:none — the cockpit\'s own loopback port is unreachable (the 2026-08-04 vector)', () => {
    assert.ok(ev('cockpit') !== 'OPEN', E.out);
  });
  await K('net:none — IPv6 loopback is unreachable too', () => assert.ok(ev('cockpit6') !== 'OPEN', E.out));
  await K('net:none — DNS resolution fails', () => assert.equal(ev('dns'), 'failed', E.out));
  await K('net:none — curl to the cockpit fails', () => assert.ok(!/^2|^3|^4/.test(ev('curl')), E.out));
  await K('net:none — the namespace has only loopback, no host interface', () => {
    assert.ok(!/eth|wlan|ens|enp/.test(ev('ifaces')), `interfaces: ${ev('ifaces')}`);
  });
  await K('CONTROL: the same listener IS reachable under net:shared (so the block above is real)', () => {
    assert.ok(/cockpit=OPEN/.test(shared), `net:shared could not reach it either — the net:none result proves nothing. ${shared}`);
  });
} else {
  for (const n of ['internet', 'cockpit loopback', 'ipv6', 'dns', 'curl', 'interfaces', 'shared control']) skipped(`net: ${n}`, NOKERNEL);
}
await test('net:shared reports network as NOT enforced — no quiet claim of an egress gate', () => {
  const rep = probeConfinement({ net: 'shared' });
  assert.equal(rep.controls.network.ok, false);
  assert.ok(/no egress gate/i.test(rep.controls.network.evidence));
});

// ══ F. FAIL-CLOSED ════════════════════════════════════════════════════════
console.log('\n── F. fail-closed behaviour ──');
await test('a required control the host cannot prove ⇒ THROWS and spawns nothing', () => {
  let spawned = false;
  try {
    confinedSpawn('sh', ['-c', 'echo ran'], {
      writable: [ws], mask: [], net: 'shared',
      require: ['network'], // impossible under net:shared, by construction
    });
    spawned = true;
  } catch (err) {
    assert.ok(/refusing to run unconfined/.test(err.message), err.message);
    assert.ok(/Nothing was spawned/.test(err.message), err.message);
  }
  assert.equal(spawned, false, 'it returned a running child instead of refusing');
});
await test('a nonexistent writable path is a refusal, not a silently created hole', () => {
  assert.throws(() => confinedSpawn('sh', ['-c', 'true'], { writable: [join(ROOT, 'nope')], net: 'shared' }),
    /does not exist/);
  assert.ok(!existsSync(join(ROOT, 'nope')), 'the path was created');
});
await test('a relative writable path is refused (it would mean something different inside)', () => {
  assert.throws(() => confinedSpawn('sh', ['-c', 'true'], { writable: ['relative/path'], net: 'shared' }), /absolute/);
});
await test('a path containing a newline or NUL is refused rather than quoted-and-hoped', () => {
  assert.throws(() => confinementArgv({ writable: ['/a\nb'], cmd: 'true' }), /newline or NUL/);
  assert.throws(() => confinementArgv({ mask: ['/a\0b'], cmd: 'true' }), /newline or NUL/);
});
await test('unconfinedSpawn refuses without an explicit acknowledgement', () => {
  assert.throws(() => unconfinedSpawn('true', [], {}), /acknowledgeUnconfined/);
  assert.throws(() => unconfinedSpawn('true', [], { acknowledgeUnconfined: 'yes' }), /acknowledgeUnconfined/);
});
await test('an acknowledged unconfined child is LABELLED enforced:false with a reason', async () => {
  const c = unconfinedSpawn('true', [], { acknowledgeUnconfined: true, stdio: 'ignore' });
  assert.equal(c.confinement.enforced, false);
  assert.ok(typeof c.confinement.why === 'string' && c.confinement.why.length > 10);
  await new Promise((r) => c.on('close', r));
});
await K('a confined child is LABELLED enforced:true and carries the kernel\'s evidence', async () => {
  const c = confinedSpawn('true', [], { writable: [ws], mask: [credFile], net: 'none', stdio: 'ignore' });
  assert.equal(c.confinement.enforced, true);
  assert.equal(c.confinement.masked, 1);
  assert.ok(/workspace=rw/.test(c.confinement.controls.filesystem), JSON.stringify(c.confinement));
  assert.ok(/ENETUNREACH|EHOSTUNREACH/.test(c.confinement.controls.network), JSON.stringify(c.confinement));
  await new Promise((r) => c.on('close', r));
});
await K('a workspace given as a SYMLINK is resolved, so the real directory is the writable one', async () => {
  const realDir = join(ROOT, 'realws'); mkdirSync(realDir, { recursive: true });
  const link = join(ROOT, 'linkws');
  if (!existsSync(link)) symlinkSync(realDir, link);
  const c = confinedSpawn('sh', ['-c', `echo hi > ${realDir}/proof`], { writable: [link], net: 'shared', stdio: 'ignore' });
  await new Promise((r) => c.on('close', r));
  assert.ok(existsSync(join(realDir, 'proof')), 'the bind landed on the link path, not the real directory');
});
await K('the child\'s exit code reaches the parent through unshare + setpriv', async () => {
  const code = await new Promise((res) => {
    const c = confinedSpawn('sh', ['-c', 'exit 42'], { writable: [ws], net: 'shared', stdio: 'ignore' });
    c.on('close', res);
  });
  assert.equal(code, 42);
});

// ══ G. CREDENTIAL INVENTORY + PREFLIGHT ═══════════════════════════════════
console.log('\n── G. credential inventory and preconditions ──');
await test('credentialTargets is derived from HOME and appRoot — no hardcoded path or username', () => {
  const t = credentialTargets({ appRoot: '/opt/app', home: '/home/nobody' });
  assert.ok(t.every((p) => p.startsWith('/opt/app/') || p.startsWith('/home/nobody/')), t.filter((p) => !p.startsWith('/opt/app/') && !p.startsWith('/home/nobody/')).join(','));
  const src = readFileSync(new URL('../server/src/lib/credblind.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, ''); // comments describe the incident and may name paths
  assert.ok(!/['"]\/root/.test(src), 'a literal /root appears in credblind.js code');
  assert.ok(!/\/home\/[a-z]/.test(src), 'a literal user home appears in credblind.js code');
});
await test('the cockpit token — the file the 2026-08-04 incident read — is in the mask set', () => {
  assert.ok(credentialTargets({ appRoot: '/opt/app' }).includes('/opt/app/.auth-token'));
});
await test('every vendor store except the running engine\'s is masked', () => {
  for (const engine of Object.keys(VENDOR_STORES)) {
    const t = credentialTargets({ home: '/h', keepFor: engine });
    for (const d of VENDOR_STORES[engine]) assert.ok(!t.includes(`/h/${d}`), `${engine} lost its own store ${d}`);
    for (const [other, dirs] of Object.entries(VENDOR_STORES)) {
      if (other === engine) continue;
      for (const d of dirs) assert.ok(t.includes(`/h/${d}`), `${other}'s ${d} was not masked while running ${engine}`);
    }
  }
});
await test('shell history files are treated as credential stores', () => {
  const t = credentialTargets({ home: '/h' });
  for (const f of ['.bash_history', '.zsh_history', '.python_history']) assert.ok(t.includes(`/h/${f}`));
});
await test('preflight DETECTS a planted hardlink — the one bypass a path mask cannot cover', () => {
  const target = join(ROOT, 'hl-target'); writeFileSync(target, SECRET, { mode: 0o600 });
  assert.deepEqual(credentialPreflight([target]), []);
  const alias = join(ROOT, 'hl-alias'); if (!existsSync(alias)) linkSync(target, alias);
  const p = credentialPreflight([target]);
  assert.equal(p.length, 1); assert.equal(p[0].kind, 'hardlinked');
  assert.ok(/st_nlink=2/.test(p[0].detail));
});
await K('KNOWN GAP, asserted so it cannot silently change: a hardlink DOES bypass the mask', async () => {
  const target = join(ROOT, 'gap-cred'); writeFileSync(target, SECRET, { mode: 0o600 });
  const alias = join(ROOT, 'gap-alias'); if (!existsSync(alias)) linkSync(target, alias);
  const r = await inSandbox(`echo "masked=$(cat ${target} 2>/dev/null)"; echo "alias=$(cat ${alias} 2>/dev/null)"`,
    { mask: [target] });
  assert.ok(!/masked=.*COCKPIT/.test(r.out), `the mask itself failed: ${r.out}`);
  assert.ok(/alias=.*COCKPIT-TOKEN/.test(r.out),
    'the hardlink no longer bypasses the mask — good news, but SECURITY-SPINE-REPORT.md says it does. Update the report.');
});
await test('preflight flags a credential readable beyond its owner', () => {
  const loose = join(ROOT, 'loose-cred'); writeFileSync(loose, SECRET, { mode: 0o644 });
  assert.ok(credentialPreflight([loose]).some((p) => p.kind === 'permissive-mode'));
});
await test('preflight is silent about paths that do not exist', () => {
  assert.deepEqual(credentialPreflight([join(ROOT, 'absent'), join(ROOT, 'also-absent')]), []);
});

// ══ H. INDIRECT READBACK ══════════════════════════════════════════════════
console.log('\n── H. indirect readback (logs, tool results, error messages) ──');
await test('redactor removes the exact value wherever it appears', () => {
  const r = redactor([SECRET]);
  assert.ok(!r(`error: auth failed with ${SECRET} at line 3`).includes(SECRET));
  assert.ok(!r(`{"token":"${SECRET}"}`).includes(SECRET));
  assert.ok(!r(`${SECRET}${SECRET}`).includes(SECRET));
});
await test('redactor prefers the longest value, so an overlapping secret is not half-left', () => {
  const long = 'abcdef-1234567890', short = 'abcdef-12';
  const out = redactor([short, long])(`x ${long} y`);
  assert.ok(!out.includes(long) && !out.includes(short), out);
});
await test('redactor ignores values too short to redact without shredding ordinary text', () => {
  assert.equal(redactor(['abc'])('abc def abc'), 'abc def abc');
});
await test('redactor tolerates empty/non-string input without throwing', () => {
  assert.equal(redactor([])(null), '');
  assert.equal(redactor([undefined, 12345678, SECRET])(`v ${SECRET}`), 'v [redacted-credential]');
});
await test('HONEST LIMIT, asserted: a re-encoded secret passes the redactor untouched', () => {
  const b64 = Buffer.from(SECRET).toString('base64');
  assert.ok(redactor([SECRET])(b64).includes(b64),
    'if this starts failing the redactor grew encoding awareness and the report must say so');
});

// ══ I. THE PROBE ITSELF ═══════════════════════════════════════════════════
console.log('\n── I. the capability probe is behavioural, not declarative ──');
await test('sandbox.js consults NO capability flag file', () => {
  const src = readFileSync(new URL('../server/src/lib/sandbox.js', import.meta.url), 'utf8')
    .replace(/^\s*\/\/.*$/gm, ''); // the comments explain WHY these files are not trusted
  for (const flag of ['/sys/kernel/security', 'max_user_namespaces', 'unprivileged_userns_clone', '/etc/os-release', 'CONFIG_USER_NS']) {
    assert.ok(!src.includes(flag), `sandbox.js code reads ${flag} — that is a declaration, not evidence`);
  }
});
await test('every probe verdict carries evidence, whichever way it went', () => {
  for (const mode of ['none', 'shared']) {
    const p = probeConfinement({ net: mode });
    for (const [k, c] of Object.entries(p.controls)) {
      assert.equal(typeof c.ok, 'boolean', k);
      assert.ok(typeof c.evidence === 'string' && c.evidence.length > 0, `${k} has no evidence`);
    }
  }
});
await test('the probe tests the SHIPPED construction (same argv builder as confinedSpawn)', () => {
  // Sentinels distinctive enough that a hit cannot be an accident. Short ones
  // like "/m" match inside the script's own `/proc/self/mountinfo` and would
  // fail this test for a reason that has nothing to do with injection.
  const SW = '/zqxWRITEsentinel', SM = '/zqxMASKsentinel', SC = 'zqxCMDsentinel', SA = 'zqxARGsentinel';
  const argv = confinementArgv({ writable: [SW], mask: [SM], net: 'none', cmd: SC, args: [SA] });
  assert.ok(argv.includes('--net') && argv.includes('--map-root-user') && argv.includes('--pid'));
  // Command and paths are POSITIONAL — never spliced into the script text.
  const script = argv[argv.indexOf('-c') + 1];
  for (const s of [SW, SM, SC, SA]) {
    assert.ok(!script.includes(s), `${s} reached the shell script body — that is an injection surface`);
    assert.ok(argv.includes(s), `${s} is not in argv either — the launcher would not receive it`);
  }
  assert.ok(/setpriv --bounding-set=-all/.test(script), 'the capability drop is missing — the whole thing is theatre without it');
});
await test('net:none adds a network namespace and net:shared does not', () => {
  assert.ok(confinementArgv({ net: 'none', cmd: 't' }).includes('--net'));
  assert.ok(!confinementArgv({ net: 'shared', cmd: 't' }).includes('--net'));
});
await test('confinementReport says plainly what this host can and cannot do', () => {
  const rep = confinementReport();
  assert.equal(typeof rep.available, 'boolean');
  assert.ok(rep.modes['net:none'] && rep.modes['net:shared']);
  assert.equal(rep.available, KERNEL || PROBE.ran);
});
await test('HOST HONESTY: the suite reported its own coverage truthfully', () => {
  if (KERNEL) assert.equal(skip, 0, `${skip} kernel tests skipped although the host CAN confine — coverage was silently lost`);
  else assert.ok(skip > 0 && PROBE.raw.length > 0, 'the host cannot confine but the suite claimed full coverage');
});

console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} SKIPPED (host cannot confine: ${NOKERNEL})` : ''}`);
if (failures.length) console.log('\nfailures:\n  ' + failures.join('\n  '));
cleanup();
process.exit(fail ? 1 : 0);
