// Run this ON THE DEVICE. It is the whole answer to "can this phone hold a
// confinement tier", and it takes about ten seconds.
//
//   pkg install -y nodejs clang      # once, in Termux
//   cd ~/atlan && git pull
//   node test/phone-ladder.mjs
//
// Nothing here reads a flag, a version string, /proc/sys or an ANDROID_* env
// var. Every rung is established by ATTEMPTING the operation in a forked child
// and reading back what the kernel did — because on this platform the flags lie
// in both directions: /sys/kernel/security/lsm reads "n/a" on hosts where
// Landlock is enforcing, and max_user_namespaces reads a large positive number
// on kernels built with no CONFIG_USER_NS at all.
//
// It compiles the launcher first, on this device, with whichever compiler
// actually works here — discovered by compiling AND RUNNING a trivial program,
// not by `which`.
import { probe } from '../server/src/sandbox/probe.js';
import { LABEL, STATEMENT, REQUIRES, TIERS } from '../server/src/sandbox/tiers.js';
import { declaredTier } from '../server/src/config.js';

const v = probe();

console.log(`\n  device establishes : ${v.tier}  — ${LABEL[v.tier]}`);
console.log(`  runs declare       : ${declaredTier()}`);
if (v.arch) console.log(`  arch               : ${v.arch}`);
if (v.landlockAbi > 0) console.log(`  landlock abi       : ${v.landlockAbi}`);
console.log(`  launcher           : ${v.bin}`);

console.log('\n  ladder:');
for (const r of v.rungs) {
  console.log(`    ${r.ok ? '✓' : '✗'} rung${String(r.n).padEnd(2)} ${r.id.padEnd(24)} ${String(r.detail ?? '').slice(0, 90)}`);
}

const failed = v.rungs.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n  ${failed.length} rung(s) did not hold here:`);
  for (const r of failed) console.log(`    ${r.id} — ${r.detail}`);
}

// Which tiers this device could serve, so the answer is actionable rather than
// a single letter.
console.log('\n  what this device can serve:');
for (const t of TIERS) {
  const need = REQUIRES[t] ?? [];
  const ok = need.every((id) => v.rungs.find((r) => r.id === id)?.ok);
  const missing = need.filter((id) => !v.rungs.find((r) => r.id === id)?.ok);
  console.log(`    ${t}  ${ok ? 'YES' : 'no '}  ${LABEL[t]}${missing.length ? `   (missing: ${missing.join(', ')})` : ''}`);
}

console.log(`\n  what Atlan will SAY about a run at this tier:\n`);
console.log(String(STATEMENT[v.tier]).split('\n').map((l) => '    ' + l).join('\n'));
console.log('\n  Paste this whole output back — it is the phone transcript the');
console.log('  default tier is waiting on.\n');
