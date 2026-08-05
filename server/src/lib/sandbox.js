import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

// A FAIL-CLOSED OS sandbox for anything Atlan launches on the user's behalf.
//
// WHY THIS EXISTS. `containment.js` says of itself, correctly: "containment
// against ERROR, not against ATTACK, and it must never be described as a
// sandbox." That honesty is the point — but it also names the hole. Three legs
// were missing:
//   · filesystem  — a tool-profile gate and an isUnder() string check, both in
//                   OUR process. A Bash tool runs as us and never passes them.
//   · credentials — scrubbedEnv() cleans the CHILD's environment, which does
//                   nothing about /proc/<parent>/environ (measured: still
//                   readable, still contains the secret — see the report).
//   · network     — nothing at all. No egress gate of any kind existed. That
//                   is the leg that turns a manipulated turn into real loss.
//
// On 2026-08-04 an agent read /root/atlan/.auth-token and drove the cockpit's
// own API with it. Privileges it already held — not escalation — but it is the
// exact shape this module exists to make impossible: the token is masked out of
// the child's filesystem view, and with net:'none' the cockpit's loopback port
// is not even routable from inside the namespace.
//
// THE CONSTRUCTION (all of it measured on this kernel, none of it assumed):
//   unshare -U  mapped-root user namespace — the only way an unprivileged
//               Termux/Linux user gets mount rights at all
//           -m  mount namespace: a private view; nothing we do is visible to
//               the host, so a confined run cannot damage the real tree
//           -p -f  PID namespace: /proc contains ONLY the run's own processes.
//               This is what kills the /proc/<pid>/{environ,cmdline,fd} scrape
//               of the cockpit and of sibling agents. Measured: the parent's
//               environ goes from "readable, contains the secret" to ENOENT.
//           -n  (optional) network namespace: loopback only, and not even up.
//               Measured ENETUNREACH both to the internet AND to the cockpit's
//               own 127.0.0.1 port — host loopback is a DIFFERENT loopback.
//   rbind / into a fresh root, remount every mount in it READ-ONLY deepest-
//   first, then reopen exactly the declared writable paths. Deny by default:
//   the fence is the absence of a writable mount, not a check on a string, so
//   there is no path spelling — `..`, unicode, symlink, race — that reaches
//   past it. The kernel refuses with EROFS regardless of how you spell it.
//   pivot_root + detach the old root so there is no `/oldroot` to walk back up.
//
//   THEN THE PART THAT MAKES IT REAL:
//   setpriv --bounding-set=-all --no-new-privs before exec.
//   Without it the whole thing is theatre. A process holding mapped root in its
//   own user namespace has CAP_SYS_ADMIN *in that namespace* and can simply
//   `umount` the mask and read the secret — MEASURED, it works, first try.
//   Emptying the capability bounding set means execve grants root no capability
//   at all (pP' = all & cap_bset = 0), and no_new_privs stops it being regained
//   by nesting a fresh user namespace. Measured after the drop: umount refused,
//   remount-rw refused, nested `unshare -U` refused (uid_map EPERM), chroot
//   refused. Node and git still run normally.
//
// FAIL-CLOSED MEANS FAIL-CLOSED. Every control this module claims is proven by
// a canary that performs the real confinement and observes the real outcome
// before any user command is spawned. If the canary does not come back with the
// evidence, confinedSpawn THROWS. It never returns a running-but-unconfined
// child. An unconfined run is still possible — the phone has no user namespaces
// and never will — but only by calling unconfinedSpawn(), which forces the
// caller to hold a labelled `{ enforced: false }` descriptor. There is no code
// path where a caller asks for confinement and silently does not get it.

// ── plan validation ────────────────────────────────────────────────────────
// Structural preconditions, checked before anything is spawned. These are not
// attack patterns — they are the conditions under which the construction below
// is well-defined at all. A path we cannot pass to the setup shell unambiguously
// is refused rather than quoted-and-hoped.
function checkPath(p, what) {
  const s = String(p);
  if (!isAbsolute(s)) throw new Error(`${what} must be an absolute path: ${JSON.stringify(s)}`);
  // A newline or NUL in a path cannot survive argv/mountinfo round-tripping
  // intact. Refusing is the only safe answer; there is no escaping that helps.
  if (/[\n\0]/.test(s)) throw new Error(`${what} contains a newline or NUL — refused`);
  return s;
}

// ── the setup script ───────────────────────────────────────────────────────
// Runs as mapped-root inside the new namespaces and drops every capability
// before exec'ing the caller's command.
//
// NOTHING IS INTERPOLATED INTO THIS STRING. Paths and the command arrive as
// POSITIONAL ARGUMENTS ($1, $2, …) and are consumed with `shift`, so no path or
// argument is ever parsed by the shell as syntax. That is a structural answer
// to command injection rather than a quoting one: there is no quoting to get
// wrong, and no encoding of a filename that becomes shell metacharacters.
// Layout: <nWritable> <w…> <nMask> <m…> <cmd> <args…>
const SETUP = `
set -e
WD=$(pwd)
NR=$(mktemp -d)
mount -t tmpfs tmpfs "$NR"
mkdir -p "$NR/newroot"
mount --rbind / "$NR/newroot"
mount --make-rslave "$NR/newroot"

# DENY BY DEFAULT. Remount every mount under the new root read-only, deepest
# first — a shallower remount does not cover a mount stacked on top of it, so
# doing parents first would silently leave children writable.
# A mount path containing a NEWLINE cannot be carried through a line-oriented
# pipeline at all, so the run is refused rather than the mount skipped. Skipping
# is what the previous version effectively did, and skipping leaves it WRITABLE.
if grep -q '\\\\012' /proc/self/mountinfo; then
  echo "atlan-confine: a mount path contains a newline — refusing to confine" >&2; exit 91
fi

# The kernel OCTAL-ESCAPES field 5 of mountinfo: space is \\040, tab \\011,
# backslash \\134. The previous version passed that escaped string straight to
# mount, so a mount point named "/media/user/My Passport" was addressed as
# "/media/user/My\\040Passport", which does not exist — the remount failed, the
# failure was swallowed by "|| true", and the volume stayed READ-WRITE inside a
# sandbox stamped enforced:true. Auto-mounted removable media are named exactly
# like that, so this was not exotic. Found by a contextless filesystem review,
# 2026-08-05; reproduced end to end before this fix was written.
# NUL cannot appear in a path, so a tab separator is unambiguous once unescaped.
awk -v p="$NR/newroot" 'index($5,p)==1 {
    s=$5; gsub(/\\\\040/," ",s); gsub(/\\\\011/,"\\t",s); gsub(/\\\\134/,"\\\\",s)
    print length(s) "\\t" s
  }' /proc/self/mountinfo \\
  | sort -rn | cut -f2- \\
  | while IFS= read -r m; do mount -o remount,bind,ro "$m" 2>/dev/null || true; done

# A private /tmp. Kills temp files, editor swap files and any core dump from
# outliving the run or being visible to it — and gives pivot_root a writable
# put_old inside the new root without creating a directory on the real host.
mount -t tmpfs tmpfs "$NR/newroot/tmp"
mkdir -p "$NR/newroot/tmp/.oldroot"

# $1 = empty-home mode, $2 = seal-/run mode. Both consumed before the counts.
EMPTYHOME=$1; SEALRUN=$2; HOMEDIR=$3; shift 3

# Mounts the child may legitimately still write. Seeded here and appended to as
# each writable region is created, then used by the property check at the end.
: > "$NR/allow"
echo "$NR/newroot/tmp" >> "$NR/allow"

# SEAL /run. A network namespace does not isolate filesystem-bound unix sockets:
# with the host root rbind-ed in, /run/tailscale/tailscaled.sock, the docker
# socket, the systemd journal and the D-Bus system bus all arrive intact, and
# read-only does not stop connect(). MEASURED: a child with net:'none' and
# outbound TCP returning ENETUNREACH connected to tailscaled's control socket and
# read 6KB of tailnet status back — real egress through a daemon that has the
# network the child was denied. An empty tmpfs removes the socket files, so there
# is no path to connect to. (Found by a contextless network review, 2026-08-05.)
#
# Sealed for BOTH net modes, not just net:'none'. With a shared network stack the
# sockets are not new egress, but /run/docker.sock and friends are still a
# straight path to privileges the agent was never given. What a shared-network
# run does need is $XDG_RUNTIME_DIR — the antigravity CLI keeps its token in the
# system keyring, which it reaches over D-Bus at /run/user/<uid>/bus — so the
# caller declares that one path as writable and gets it back, and nothing else.
if [ "$SEALRUN" = 1 ]; then
  mount -t tmpfs tmpfs "$NR/newroot/run" 2>/dev/null || true
  # Mounts UNDER /run are now shadowed by that tmpfs and unreachable by path,
  # but they are still listed in mountinfo. /run/user is one, it is rw, and the
  # property check below would otherwise refuse every run on any systemd host.
  echo "$NR/newroot/run" >> "$NR/allow"
fi

# EMPTY HOME. The mask list is a denylist, and a denylist is a list of the
# credentials somebody remembered — the exact criticism this module levels at
# environment denylists one layer up. Measured against it: .env.production,
# config.json, an editor's .auth-token.swp, ~/.vault-token and
# ~/.config/anthropic/key were all readable through a working mask set.
# So HOME becomes an EMPTY tmpfs and only declared paths are bound back in.
# Unlisted is invisible by construction, which is what "allowlist" has to mean.
# Remounted read-only after the binds below, so HOME itself is not a writable
# hole; anything the engine must write is a declared writable path.
if [ "$EMPTYHOME" = 1 ] && [ -n "$HOMEDIR" ]; then
  mkdir -p "$NR/newroot$HOMEDIR"
  mount -t tmpfs tmpfs "$NR/newroot$HOMEDIR"
  # Same shadowing note as /run: anything mounted under HOME is now unreachable
  # by path but still appears in mountinfo.
  echo "$NR/newroot$HOMEDIR" >> "$NR/allow"
fi

# Reopen exactly the declared writable paths (mkdir first: a workspace under
# /tmp or under an emptied HOME was just shadowed and has to be recreated there).
# Declared READ-ONLY paths FIRST, so a narrower writable path below can stack on
# top of a broader readable one. ~/.gitconfig is the load-bearing example: an
# emptied HOME otherwise leaves every commit authorless.
n=$1; shift
while [ "$n" -gt 0 ]; do
  if [ -e "$1" ]; then
    if [ -d "$1" ]; then mkdir -p "$NR/newroot$1"; else mkdir -p "$(dirname "$NR/newroot$1")"; : > "$NR/newroot$1" 2>/dev/null || true; fi
    if mount --bind "$1" "$NR/newroot$1" 2>/dev/null; then mount -o remount,bind,ro "$NR/newroot$1" 2>/dev/null || true; fi
  fi
  shift; n=$((n-1))
done

n=$1; shift
while [ "$n" -gt 0 ]; do
  mkdir -p "$NR/newroot$1"
  mount --bind "$1" "$NR/newroot$1"
  mount -o remount,bind,rw "$NR/newroot$1"
  echo "$NR/newroot$1" >> "$NR/allow"
  shift; n=$((n-1))
done

if [ "$EMPTYHOME" = 1 ] && [ -n "$HOMEDIR" ]; then
  mount -o remount,ro "$NR/newroot$HOMEDIR" 2>/dev/null || true
fi
if [ "$SEALRUN" = 1 ]; then
  mount -o remount,ro "$NR/newroot/run" 2>/dev/null || true
fi

# Mask credentials. A file becomes /dev/null (reads return empty); a directory
# becomes an empty read-only tmpfs. Existence is tested at the TARGET, i.e. in
# the view the child will actually get — a path already shadowed by the private
# /tmp or by an emptied HOME needs no mask and has no mount point to attach one
# to. Anything still absent stays absent: the root is read-only.
n=$1; shift
while [ "$n" -gt 0 ]; do
  if [ -d "$NR/newroot$1" ]; then mount -t tmpfs -o ro,size=4k tmpfs "$NR/newroot$1"
  elif [ -e "$NR/newroot$1" ]; then mount --bind /dev/null "$NR/newroot$1"
  fi
  shift; n=$((n-1))
done

# ── THE PROPERTY CHECK ────────────────────────────────────────────────────
# Everything above is a sequence of steps that can individually fail. This
# asserts the RESULT instead: no mount under the new root is writable unless we
# declared it. It catches the escaped-path case above, a mount type that refuses
# remount,bind,ro (FUSE, sshfs), a submount the loop never reached (/run/user was
# one — measured), and whatever the next one turns out to be. Verifying the
# property rather than the steps is the only version of this that stays true.
#
# If anything remains, the run is REFUSED. Not logged, not degraded, not
# "enforced:true with a caveat" — the previous behaviour left it writable and
# reported success, which is the fail-open this whole module exists to avoid.
awk -v p="$NR/newroot" 'index($5,p)==1 && $6 ~ /(^|,)rw(,|$)/ {
    s=$5; gsub(/\\\\040/," ",s); gsub(/\\\\011/,"\\t",s); gsub(/\\\\134/,"\\\\",s); print s
  }' /proc/self/mountinfo > "$NR/rw.list"
while IFS= read -r m; do
  [ -n "$m" ] || continue
  ok=0
  while IFS= read -r a; do
    [ -n "$a" ] || continue
    case "$m" in "$a"|"$a"/*) ok=1; break;; esac
  done < "$NR/allow"
  if [ "$ok" = 0 ]; then
    echo "atlan-confine: writable mount not declared: $m — refusing to confine" >&2
    exit 92
  fi
done < "$NR/rw.list"

cd "$NR/newroot"
pivot_root . tmp/.oldroot
cd /
mount -t proc proc /proc
# A FRESH sysfs too. The rbind carried the host's already-mounted /sys in, and
# sysfs renders its net directory for whichever network namespace it was mounted
# in — so /sys/class/net still listed the host's eth0 and the tailnet interface
# from inside a sealed network namespace. Not an egress path (connect() was
# already ENETUNREACH) but it named the operator's interfaces to the agent, and
# a boundary that leaks its own shape is a boundary that invites probing.
# Tolerated if it fails: losing the remount costs information, not containment,
# and aborting the run over it would be the wrong trade.
mount -t sysfs sysfs /sys 2>/dev/null || true
umount -l /tmp/.oldroot
cd "$WD" 2>/dev/null || cd /
exec setpriv --bounding-set=-all --inh-caps=-all --no-new-privs -- "$@"
`;

// SETUP is a template literal, so a stray backtick in one of its comments ENDS
// the string. That happened: a comment reading "swallowed by `|| true`" closed
// the template 130 lines early, and the shell received a 23-line script that
// stopped after the newline guard. Nothing crashed — the probe simply found no
// evidence and every confinedSpawn refused, which is the fail-closed design
// working as intended on an internal defect rather than a hostile host. It is
// still a defect, and a silent one, so it gets a structural guard: the script
// must end where it is supposed to end.
if (!/exec setpriv --bounding-set=-all[\s\S]*"\$@"\s*$/.test(SETUP) || !SETUP.includes('pivot_root')) {
  throw new Error('atlan/sandbox: the confinement script is truncated — a backtick in a comment ends the template literal');
}

// Build the argv for `unshare`. Exported so the capability probe below can run
// the EXACT construction that ships — a probe of some other, simpler command
// would prove nothing about this one.
export function confinementArgv({
  writable = [], readable = [], mask = [], net = 'none',
  // HOME becomes an empty tmpfs with only `writable`/`readable` bound back in.
  // Default ON: the alternative is the credential denylist a contextless review
  // walked straight through (~/.vault-token, ~/.config/<vendor>/key, an editor's
  // .swp sibling — none of them on any list, all of them readable).
  emptyHome = true, home = process.env.HOME || '',
  // /run replaced by an empty tmpfs. On by default for BOTH network modes:
  // a network namespace does not isolate filesystem-bound unix sockets, and
  // /run/docker.sock reaches privileges no agent was granted whether or not the
  // IP stack is up.
  sealRun = true,
  cmd, args = [],
} = {}) {
  const w = writable.map((p) => checkPath(p, 'writable path'));
  const r = readable.map((p) => checkPath(p, 'readable path'));
  const m = mask.map((p) => checkPath(p, 'mask path'));
  if (home) checkPath(home, 'home');
  if (!cmd) throw new Error('cmd is required');
  return [
    '--user', '--map-root-user', '--mount', '--pid', '--fork', '--kill-child',
    '--propagation', 'private',
    ...(net === 'none' ? ['--net'] : []),
    '--', 'sh', '-c', SETUP, 'atlan-confine',
    emptyHome ? '1' : '0', sealRun ? '1' : '0', home,
    String(r.length), ...r,
    String(w.length), ...w,
    String(m.length), ...m,
    cmd, ...args,
  ];
}

// ── behavioural capability probe ───────────────────────────────────────────
// NEVER read a flag file. /sys/kernel/security/lsm does not even exist on this
// WSL2 kernel, and on hosts where Landlock IS enforcing it can read `n/a`;
// /proc/sys/user/max_user_namespaces reports 127780 here but a seccomp filter
// or a container policy can still make the call fail. A number is not evidence.
//
// So: actually perform the confinement on a throwaway workspace, have the
// confined child attempt each forbidden thing, and read back what the KERNEL
// did. Every verdict below is an observed syscall result.
const CANARY = 'atlan-canary-4f1c9d';
let cache = new Map();

// The probe's scratch defaults to HOME, NOT to os.tmpdir(). The construction
// replaces /tmp with a private tmpfs, so a canary secret placed in /tmp would
// read back empty because it was SHADOWED, not because the mask worked — the
// probe would pass while proving nothing. HOME is derived from the environment
// (Termux, /root, a CI user — all produce their own), never hardcoded.
const defaultScratch = () => homedir();

// Single-quoting for the PROBE's own inner script only. Callers' commands never
// pass through here — those go as argv positional arguments and are never
// parsed by a shell. These are paths this module generated itself.
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const mkdirp = (d) => { try { mkdirSync(d, { recursive: true }); } catch { /* exists */ } };

export function probeConfinement({ net = 'none', scratch = defaultScratch(), force = false } = {}) {
  const key = `${net}|${scratch}`;
  if (!force && cache.has(key)) return cache.get(key);
  let root = null;
  try {
    root = mkdtempSync(join(scratch, 'atlan-probe-'));
    const ws = join(root, 'ws');
    const outside = join(root, 'outside');
    const secret = join(root, 'secret.txt');
    mkdirp(ws); mkdirp(outside);
    writeFileSync(secret, CANARY + '\n', { mode: 0o600 });

    // A sibling process holding the canary in its environment, so the /proc
    // scrape is tested against a REAL other process and not a hypothesis.
    const sib = spawn(process.execPath, ['-e', 'setTimeout(()=>{},20000)'], {
      env: { PATH: process.env.PATH, ATLAN_PROBE_SECRET: CANARY }, stdio: 'ignore',
    });
    let out = '';
    try {
      // The confined child reports what it could and could not do. Each line is
      // a verdict; a missing line is treated as a FAILED control, not a pass —
      // a probe that cannot speak must not be read as consent.
      const script = [
        `echo "ws=$( (echo x > ${shq(ws)}/probe) 2>/dev/null && echo rw || echo ro )"`,
        `echo "outside=$( (echo x > ${shq(outside)}/probe) 2>/dev/null && echo rw || echo ro )"`,
        `echo "etc=$( (echo x > /etc/${CANARY}) 2>/dev/null && echo rw || echo ro )"`,
        `echo "mask=$( cat ${shq(secret)} 2>/dev/null | head -c 64 )"`,
        // POSITIVE proof the mask exists, not just that the read came back empty.
        // An empty read also happens when the canary was merely SHADOWED — by the
        // private /tmp, or by an emptied HOME — and a contextless review used
        // exactly that to make this probe certify `credentials: ok` on a run where
        // no mask mount had been created at all. A verdict that cannot tell
        // "hidden" from "never there" converts a refusal into a false assurance,
        // which is the worst bug this module can have.
        `echo "maskmount=$( grep -c ${shq(' ' + secret + ' ')} /proc/self/mountinfo 2>/dev/null )"`,
        // A network namespace does not isolate filesystem unix sockets. With
        // sealRun the socket files are gone, so this counts what is left.
        `echo "socks=$( find /run /var/run -maxdepth 4 -type s 2>/dev/null | wc -l )"`,
        `echo "caps=$( grep CapBnd /proc/self/status | tr -d '\\t ' )"`,
        `echo "procscrape=$( cat /proc/${sib.pid}/environ 2>/dev/null | tr -d '\\0' | head -c 64 )"`,
        `echo "pids=$( ls -d /proc/[0-9]* 2>/dev/null | wc -l )"`,
        `echo "unmask=$( umount ${shq(secret)} 2>/dev/null && cat ${shq(secret)} 2>/dev/null | head -c 64 )"`,
        `echo "renest=$( unshare -Urm true 2>/dev/null && echo REGAINED || echo refused )"`,
        `echo "net=$( ${shq(process.execPath)} -e 'const s=require("net").connect({host:"1.1.1.1",port:443});s.setTimeout(2500);s.on("connect",()=>{console.log("open");process.exit(0)});s.on("error",e=>{console.log(e.code);process.exit(0)});s.on("timeout",()=>{console.log("timeout");process.exit(0)})' 2>/dev/null )"`,
        `echo "done=1"`,
      ].join('\n');
      // `readable: [root]` matters: HOME is an empty tmpfs in the shipped
      // construction, and the probe's own canary lives under HOME. Without it
      // the canary would be shadowed rather than masked — which is precisely the
      // false-assurance bug the maskmount check above exists to catch, and the
      // probe would trip its own trap.
      const r = spawnSync('unshare', confinementArgv({
        readable: [root], writable: [ws], mask: [secret], net, cmd: 'sh', args: ['-c', script],
      }), { encoding: 'utf8', timeout: 30000, cwd: root });
      out = (r.stdout || '') + '\n' + (r.stderr || '');
      if (r.error) out += `\nspawn-error=${r.error.code || r.error.message}`;
    } finally { try { sib.kill('SIGKILL'); } catch { /* already gone */ } }

    const v = (k) => (out.match(new RegExp(`^${k}=(.*)$`, 'm')) || [, null])[1];
    const ran = v('done') === '1';

    // Each control is ok ONLY on positive evidence. Absence of a line, a
    // timeout, a missing `unshare` — all land here as false.
    const controls = {
      // The workspace is writable and everything else is not. Both halves
      // matter: a fence that also blocks the workspace is not a working
      // sandbox, it is a broken one, and would be "passed" by a naive test.
      filesystem: {
        ok: ran && v('ws') === 'rw' && v('outside') === 'ro' && v('etc') === 'ro',
        evidence: `workspace=${v('ws')} outside=${v('outside')} /etc=${v('etc')}`,
      },
      // The masked credential reads as empty AND stays empty after the child
      // tries to umount the mask. The second half is the one that matters:
      // without the capability drop the umount succeeds and the secret is back.
      credentials: {
        ok: ran && v('mask') === '' && v('unmask') === '' && v('caps') === 'CapBnd:0000000000000000'
          && Number(v('maskmount')) >= 1,
        evidence: `masked-read=${JSON.stringify(v('mask'))} mask-mount-present=${v('maskmount')} after-umount=${JSON.stringify(v('unmask'))} ${v('caps')}`,
      },
      // The sibling's environment is unreachable and only the run's own
      // processes are visible.
      procIsolation: {
        ok: ran && !String(v('procscrape') ?? '').includes(CANARY) && Number(v('pids')) > 0 && Number(v('pids')) <= 8,
        evidence: `sibling-environ=${JSON.stringify(v('procscrape'))} visible-pids=${v('pids')}`,
      },
      // Capabilities cannot be regained by nesting a fresh user namespace.
      privDrop: {
        ok: ran && v('renest') === 'refused' && v('caps') === 'CapBnd:0000000000000000',
        evidence: `nested-userns=${v('renest')} ${v('caps')}`,
      },
      // Only claimed when a netns was actually requested. With net:'shared'
      // this is honestly false — there is no egress gate, and saying so is the
      // whole point of the descriptor.
      // "No network" has to mean every transport, not just the IP stack. The
      // first version of this check tested one outbound TCP connect and the
      // descriptor then advertised "no network access at all" — a contextless
      // review used the gap between those two sentences to reach tailscaled's
      // control socket from inside a namespace reporting ENETUNREACH. So the
      // count of reachable unix sockets is now part of the verdict.
      network: net === 'none'
        ? {
          ok: ran && ['ENETUNREACH', 'EHOSTUNREACH', 'EAFNOSUPPORT'].includes(String(v('net'))) && Number(v('socks')) === 0,
          evidence: `outbound-connect=${v('net')} unix-sockets-reachable=${v('socks')}`,
        }
        : { ok: false, evidence: 'net:"shared" — the run keeps the host network stack; no egress gate exists' },
    };
    const res = { ran, controls, raw: out.trim().slice(0, 4000) };
    cache.set(key, res);
    return res;
  } catch (err) {
    const res = { ran: false, controls: {}, raw: `probe threw: ${err.message}` };
    cache.set(key, res);
    return res;
  } finally { if (root) try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } }
}

export function resetProbeCache() { cache = new Map(); }

// ── the launcher ───────────────────────────────────────────────────────────
// Drop-in for child_process.spawn, minus the option to be lied to.
//
// `require` names the controls the caller is depending on. Anything in it that
// the probe did not prove causes a THROW before any process exists. There is
// deliberately no `failIfUnavailable:false` and no `degrade` flag: a caller who
// wants an unconfined run calls unconfinedSpawn() and holds the label.
export function confinedSpawn(cmd, args = [], opts = {}) {
  const {
    writable = [], readable = [], mask = [], net = 'none',
    emptyHome = true, home,
    require: required = ['filesystem', 'credentials', 'procIsolation', 'privDrop', ...(net === 'none' ? ['network'] : [])],
    scratch, ...spawnOpts
  } = opts;

  // An empty requirement list used to sail through — nothing missing, so nothing
  // refused — and the child came back stamped `enforced: true` with an empty
  // controls object, having verified precisely nothing. A descriptor that
  // asserts enforcement it never checked is a lie told to every downstream
  // consumer, so asking for confinement of nothing is now an error.
  // (Found by a contextless review of the module's self-assessment, 2026-08-05.)
  if (!Array.isArray(required) || required.length === 0) {
    throw new Error('confinedSpawn requires a non-empty `require` list — a run that verifies nothing must not be labelled enforced');
  }

  // An inherited file descriptor is a transport the namespaces never see. A
  // socket connected in the PARENT keeps working after the child enters a new
  // network namespace and after execve — MEASURED: a caller passing a live
  // 127.0.0.1 socket as fd 3 got bytes out of a net:'none' child that was
  // simultaneously reporting ENETUNREACH. The caller here is Atlan itself, so
  // this is defence in depth rather than a boundary — but a launcher whose
  // promise can be voided by one option deserves to refuse that option.
  if (spawnOpts.stdio !== undefined) {
    const s = spawnOpts.stdio;
    const extra = Array.isArray(s)
      ? s.length > 3 || s.slice(0, 3).some((e) => typeof e === 'number' && e > 2)
      : false;
    if (extra) {
      throw new Error('confinedSpawn refuses extra stdio file descriptors — an inherited socket is egress the network namespace cannot see');
    }
  }

  // Resolve writable roots through realpath BEFORE planning. A workspace given
  // as a symlink would otherwise be bind-mounted at its link path while the
  // real directory stayed read-only — a fence that reports success and does not
  // hold. Refuse a path that does not exist rather than create it: a typo must
  // not silently become a new writable hole.
  const w = writable.map((p) => {
    const s = checkPath(p, 'writable path');
    if (!existsSync(s)) throw new Error(`writable path does not exist: ${s}`);
    return realpathSync(s);
  });
  const r = readable.map((p) => {
    const s = checkPath(p, 'readable path');
    return existsSync(s) ? realpathSync(s) : s;
  });
  const m = mask.map((p) => {
    const s = checkPath(p, 'mask path');
    return existsSync(s) ? realpathSync(s) : s;
  });

  const probe = probeConfinement({ net, ...(scratch ? { scratch } : {}) });
  const missing = required.filter((k) => !probe.controls[k]?.ok);
  if (missing.length) {
    const why = missing.map((k) => `${k} (${probe.controls[k]?.evidence ?? 'no evidence — probe did not complete'})`).join('; ');
    throw new Error(
      `refusing to run unconfined: this host cannot enforce ${missing.join(', ')} — ${why}. ` +
      `Nothing was spawned. Run it on a host with user namespaces, or call unconfinedSpawn() and label the run.`,
    );
  }

  const childHome = home ?? spawnOpts.env?.HOME ?? process.env.HOME ?? '';
  const child = spawn('unshare', confinementArgv({
    writable: w, readable: r, mask: m, net, emptyHome, home: childHome, cmd, args,
  }), spawnOpts);
  child.confinement = {
    enforced: true, net, writable: w, readable: r, masked: m.length, emptyHome,
    controls: Object.fromEntries(required.map((k) => [k, probe.controls[k].evidence])),
  };
  return child;
}

// The phone. Termux/proot has no user namespaces, so no confinement of any kind
// can initialise, and refusing outright would mean Atlan does not run on its
// PRIMARY platform. So this exists — but it makes the caller say so out loud,
// it records WHY the host could not do better, and it returns a descriptor that
// reads `enforced: false`. Nothing downstream can mistake it for a gated run.
export function unconfinedSpawn(cmd, args = [], opts = {}) {
  const { acknowledgeUnconfined, net = 'shared', scratch, ...spawnOpts } = opts;
  if (acknowledgeUnconfined !== true) {
    throw new Error('unconfinedSpawn requires acknowledgeUnconfined:true — an ungated run must be a decision, not a default');
  }
  const probe = probeConfinement({ net, ...(scratch ? { scratch } : {}) });
  const child = spawn(cmd, args, spawnOpts);
  child.confinement = {
    enforced: false,
    why: probe.ran
      ? 'confinement was available but the caller opted out'
      : `this host cannot confine: ${probe.raw.slice(0, 200)}`,
    controls: Object.fromEntries(Object.entries(probe.controls).map(([k, c]) => [k, c.ok ? 'available, not used' : c.evidence])),
  };
  return child;
}

// For the Doctor surface: what this host can actually enforce, in the words of
// the kernel rather than of a config file.
export function confinementReport({ scratch } = {}) {
  const opts = scratch ? { scratch } : {};
  const isolated = probeConfinement({ net: 'none', ...opts });
  const shared = probeConfinement({ net: 'shared', ...opts });
  return {
    available: isolated.ran,
    modes: {
      'net:none': Object.fromEntries(Object.entries(isolated.controls).map(([k, c]) => [k, { ok: c.ok, evidence: c.evidence }])),
      'net:shared': Object.fromEntries(Object.entries(shared.controls).map(([k, c]) => [k, { ok: c.ok, evidence: c.evidence }])),
    },
  };
}
