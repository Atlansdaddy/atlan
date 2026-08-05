# Security spine — what was built, what was proven, what is still open

**Status: every claim below was executed on a real kernel and its output recorded.**
Nothing here is inferred from a version string, a config flag, or a `/sys` file.
Where something could not be tested in this environment it is marked
**UNTESTED** and says what would settle it. Written 2026-08-05 on branch
`feat/security-spine`.

Measurement host: WSL2, `Linux 5.15.153.1-microsoft-standard-WSL2 x86_64`,
util-linux 2.39.3, node v22.23.1, running as root. **`bubblewrap` is NOT
installed on this host** — everything below works without it, which was a
requirement rather than an accident.

Gate: **225 passed / 0 failed across 12 suites** before, **347 passed / 0 failed
across 13 suites** after. No pre-existing test was modified or removed; every
pre-existing suite reports the same numbers it did at the start.

Read §7 before §2. Three contextless adversarial reviewers broke this code in
seven places, all seven were real, and the construction described below is the
one that exists *after* those fixes. The first version of it was escapable.

---

## 0. Why the bar is "cannot observe", not "does not leak"

On 2026-08-04 an agent read `/root/atlan/.auth-token` and drove the cockpit's own
API with it. Nothing leaked. No boundary was crossed that the agent was not
already inside. It looked, and the credential was there — which is why
leak-prevention is the wrong frame and blindness is the right one.

`server/src/containment.js` already says of itself, correctly, that it is
"containment against ERROR, not against ATTACK, and it must never be described
as a sandbox." That sentence is accurate and **nothing in this work weakens it**.
It is also an inventory of what was missing, and this report is the answer to it.

---

## 1. The measurements that decided the design

Each of these was run before any code was written. The results, not intuition,
chose the construction.

### 1.1 `delete process.env.X` does not scrub `/proc/self/environ` — CONFIRMED

```
$ ATLAN_SECRET_CANARY=supersecret123 node -e '
    delete process.env.ATLAN_SECRET_CANARY;
    console.log("in env object:", "ATLAN_SECRET_CANARY" in process.env);
    console.log("in /proc/self/environ:",
      require("fs").readFileSync("/proc/self/environ","utf8").includes("supersecret123"));'
in env object: false
in /proc/self/environ: true
```

glibc's `unsetenv()` rewrites the `environ` pointer array. `/proc/<pid>/environ`
reads the original strings on the process stack, which nobody scrubbed. **Any
environment-scrubbing approach — including the existing `scrubbedEnv()` — is
close to decorative on its own.** This is asserted as a live test
(`test/sandbox.mjs`, "MEASURED LIMIT") so that if the platform ever changes, the
report is forced to change with it.

### 1.2 A sibling process of the same uid reads the cockpit's environment — CONFIRMED

```
$ ATLAN_TOKEN=sibling-secret-xyz sleep 30 &
$ node -e 'console.log(require("fs").readFileSync("/proc/"+PID+"/environ","utf8")
             .includes("sibling-secret-xyz"))'
true
```

Cleaning the *child's* environment does nothing about this. The fix has to remove
`/proc/<other-pid>` from existence, which means a PID namespace.

### 1.3 Flag files are not evidence — CONFIRMED

```
$ cat /sys/kernel/security/lsm
cat: /sys/kernel/security/lsm: No such file or directory
$ cat /proc/sys/user/max_user_namespaces
127780
```

The LSM file does not exist here at all, and reads `n/a` on hosts where Landlock
IS actively enforcing. `max_user_namespaces` reports a large number and still
proves nothing — a seccomp filter or a container policy can make the call fail
regardless. **The behavioural canary in the same moment:**

```
$ unshare -Urn node -e '...connect 1.1.1.1:443...'
ISOLATED(ENETUNREACH)
```

That is evidence. The number is not. `test/sandbox.mjs` asserts that
`sandbox.js` contains no read of `/sys/kernel/security`,
`max_user_namespaces`, `unprivileged_userns_clone`, `/etc/os-release`, or
`CONFIG_USER_NS`.

> Note for whoever merges `feat/cross-engine-orchestration`: its
> `enginePolicy.js:sandboxCapableHost()` decides capability by **reading
> `/proc/sys/user/max_user_namespaces` and `unprivileged_userns_clone`**. That is
> the pattern this project forbids, and on this host the first of those files
> reports 127780 while `bwrap` is not even installed. It should be replaced with
> `probeConfinement()` before that branch lands.

### 1.4 The naive sandbox is escapable in one line — CONFIRMED

This is the finding that shaped everything. A mapped-root user namespace gives
the child `CAP_SYS_ADMIN` **in that namespace**, so it can undo its own confinement:

```
$ unshare -Urm --propagation private bash -c '
    mount --bind /dev/null /tmp/p2/secret/.auth-token
    echo -n "masked read: ["; cat /tmp/p2/secret/.auth-token; echo "]"
    umount /tmp/p2/secret/.auth-token && echo "UMOUNT SUCCEEDED (escape)"
    echo -n "after umount: ["; cat /tmp/p2/secret/.auth-token; echo "]"'
masked read: []
UMOUNT SUCCEEDED (escape)
after umount: [SECRET-TOKEN-VALUE]
```

**A mount-based sandbox without a capability drop is theatre.** With the drop:

```
$ ... exec setpriv --bounding-set=-all --inh-caps=-all --no-new-privs bash -c '
    echo caps: $(grep CapBnd /proc/self/status)
    umount /tmp/p2/secret/.auth-token || echo "umount refused (good)"
    mount -o remount,bind,rw /tmp/p2/work || echo "remount rw refused (good)"'
caps: CapBnd: 0000000000000000
umount: must be superuser to unmount.        umount refused (good)
mount: /tmp/p2/work: permission denied.      remount rw refused (good)
```

And the obvious follow-up — regain capabilities by nesting a fresh user namespace:

```
$ ... unshare -Urm bash -c "umount <cred>"
unshare: write failed /proc/self/uid_map: Operation not permitted
```

`no_new_privs` plus an empty bounding set closes it. For a uid-0 process,
`execve` computes `pP' = all & cap_bset`; an empty bounding set means an empty
permitted set.

### 1.5 A path-based mask does not cover a hardlink — CONFIRMED (still open, see §6)

```
$ ln /tmp/p2/secret/.auth-token /tmp/p2/hard     # planted BEFORE the run
$ unshare -Urm ... mount --bind /dev/null /tmp/p2/secret/.auth-token ...
via masked path:            []
via pre-existing hardlink:  [SECRET-TOKEN-VALUE]
```

A bind mount attaches to a *path*. A hardlink is a second directory entry for
the same inode, and the mask does not follow it. Mitigation and residual risk in §6.1.

---

## 2. The construction that shipped

`server/src/lib/sandbox.js`. Built from `unshare` and `setpriv` — both
util-linux, both present on Termux as well as on a home node — so it needs no
`bubblewrap`, which this host does not have.

| step | why |
|---|---|
| `unshare --user --map-root-user` | the only way an unprivileged Termux/Linux user gets mount rights at all |
| `--mount --propagation private` | a private view; nothing done inside is visible to the host |
| `--pid --fork --kill-child` + fresh `/proc` | **this is what kills the `/proc` scrape.** Sibling and parent `environ`/`cmdline`/`fd` stop existing |
| `--net` (when `net:'none'`) | loopback only, and not even up |
| `mount --rbind /` into a fresh tree | build the child's root without touching the host's |
| remount every mount **read-only, deepest first**, decoding mountinfo's octal escapes | deny by default. Shallowest-first leaves stacked child mounts writable; not decoding `\040` left space-named mounts writable — §7.1 |
| private tmpfs on `/tmp` | kills temp files, editor swap files and core-dump persistence; also supplies `pivot_root`'s `put_old` without creating a directory on the real host |
| **empty tmpfs on `/run`** | a netns does NOT isolate filesystem unix sockets; this removes `tailscaled.sock`, `docker.sock`, the system bus — §7.3 |
| **empty tmpfs on `$HOME`** | the credential story becomes an allowlist instead of a denylist; unlisted is invisible by construction — §7.2 |
| bind ro the declared `readable` paths, then bind + `remount,rw` the declared `writable` paths | broad read-only regions first so narrower writable holes can stack on top |
| `mount --bind /dev/null` / ro-tmpfs over credentials | the mask, for anything outside HOME (the app root, `/etc`-level stores) |
| **the property check** | after all of the above, refuse the run if ANY mount under the new root is writable and undeclared. Asserts the result rather than trusting the steps — §7.1 |
| `pivot_root` + `umount -l` the old root | no `/oldroot` to walk back up |
| fresh `sysfs` | see §4.3 |
| **`setpriv --bounding-set=-all --inh-caps=-all --no-new-privs`** | without this line every row above is undone by one `umount` — §1.4 |

Refused at the launcher, before any process exists: an empty `require` list, an
extra stdio file descriptor, a relative path, a path containing a newline or NUL,
a `writable` path that does not exist, and (under `strict`) a credential that
already has a second hardlink.

**The fence is the absence of a writable mount, not a check on a string.** There
is no spelling of a path — `..`, unicode, symlink, double slash, TOCTOU race —
that reaches past it, because the kernel returns `EROFS` regardless of how the
path is spelled. Nothing in this module pattern-matches an attack.

**No caller-supplied string is ever parsed by a shell.** Paths and the command
arrive as positional arguments (`$1`, `$2`, …) consumed with `shift`; the setup
script text is a constant. A test asserts that four distinctive sentinels passed
as `writable`/`mask`/`cmd`/`args` appear in argv and *never* in the script body.

**Nothing is hardcoded.** No `/root`, no username, no hostname, no port. Credential
paths derive from `os.homedir()` and the caller's app root; the probe's scratch
directory derives from `homedir()`. A test asserts that `credblind.js` code
contains no literal `/root` and no literal `/home/<user>`.

### Fail-closed, precisely

`confinedSpawn()` requires a named list of controls. Anything the probe did not
*prove* causes a **throw before any process exists** — the error says which
control, what evidence was observed, and "Nothing was spawned." There is no
`failIfUnavailable:false` and no degrade flag.

An ungated run is still possible, because Termux/proot has no user namespaces and
never will, and refusing there would mean Atlan does not run on its primary
platform. But it goes through `unconfinedSpawn()`, which:
- throws unless the caller passes `acknowledgeUnconfined: true`, and
- returns a child carrying `{ enforced: false, why: <the kernel's own reason> }`.

`ATLAN_CONFINE` has **three** states, not two: unset (labelled ungated), `1`
(confine where the host proves it can, labelled ungated where it cannot), and
`strict` (confine or the run does not happen).

---

## 3. Vector-by-vector results

Every row below is an assertion in `test/sandbox.mjs`, executed against the real
kernel. **122 assertions**; the counts in each section are the shapes tried.

### 3.1 Filesystem escape — 24 shapes, all refused

`plain-absolute` · `dotdot-relative` · `dotdot-deep` · `double-slash` ·
`dot-segments` · `trailing-dot-dir` · `$HOME` · `/etc` · `/usr/bin` ·
`/proc/sys/kernel` · `unicode-name` · `newline-in-name` · `overwrite-existing` ·
`delete-outside` · `rename-outside` · `chmod-outside` · `append-outside` ·
`truncate-outside` · `mkdir-outside` · `symlink-then-write` · `symlink-to-file` ·
`tee-outside` · `dd-outside` · `cp-outside`

Plus three assertions that keep the result meaningful: the workspace **is**
writable (a fence that blocks everything is broken, not safe), the run's own
writes **do** land on the host (isolation must not be a black hole), and the host
tree is byte-identical afterwards.

### 3.2 Credential blindness, filesystem — 22 read attempts, none returned bytes

Same secret by ten different names (`cat` absolute / relative / `..` /
double-slash / dot-segment, via symlink, via a symlink *chain*, via `find -exec`)
and through eight different tools (`cat`, `head`, `dd`, `od`, `grep`, `wc`,
`node:readFileSync`, `node:openSync`+`readSync` — different syscall shapes, not
just different commands), plus a masked **directory** (`~/.ssh`) read by
`cat`, `ls` and glob.

Then the four ways of removing the mask, all refused: `umount`,
`mount -o remount,bind,rw /`, a nested `unshare -Urm`, and `chroot /`.

Also asserted: a credential path that does not exist **cannot be created** inside
the run (the root is read-only), and masking is not a mutation — the credential
is intact on the host afterwards.

### 3.3 Credential blindness, environment

The allowlist is tested against names a denylist or a trailing-suffix regex
misses: `AZURE_CLIENT_SECRET_ID`, `NPM_CONFIG__AUTH`,
`CLOUDSDK_AUTH_ACCESS_TOKEN_X`, `TOTALLY_NEW_PROVIDER_2027`, `DATABASE_URL`,
`SSH_AUTH_SOCK` (a credential with no key-shaped name) and `NODE_OPTIONS`
(`--require=/tmp/evil.js` is arbitrary code execution, and is not a credential at
all, so no credential denylist would have caught it). None survive.

`grant` adds exactly one provider key; a test asserts no adjacent key comes with
it. `HISTFILE` and `LESSHISTFILE` are pointed at `/dev/null`. A test asserts
`ENV_ALLOW` itself contains no credential-bearing name, so a careless future
addition fails the build.

### 3.4 `/proc` scrape — tested against a real sibling holding a real secret

A second Node process is spawned with the secret in its environment, and the
confined child is asked to read it eight ways: `environ`, `cmdline`, `fd`, `cwd`,
the cockpit's own pid, the visible pid count, `/proc/1/cmdline`, and a blind
`cat /proc/*/environ` sweep written to the workspace and inspected by the parent
(grepping for the secret *inside* the child would have put it on the child's own
argv and found itself). All eight: nothing.

Visible pids inside: **3**, versus 56 on the host. `/proc/1` is the run itself.

### 3.5 Network egress

With `net:'none'`: outbound TCP `ENETUNREACH`; the **cockpit's own loopback port
unreachable** — the 2026-08-04 vector, tested against a live listener the parent
actually stood up; IPv6 loopback unreachable; DNS fails; `curl` fails; no host
interface visible.

**With a control run.** The same listener, same code, `net:'shared'` — reachable.
Without that control, the `net:'none'` result could simply have meant the
listener was never reachable and the test would prove nothing.

`net:'shared'` reports `network: { ok: false, evidence: 'no egress gate exists' }`.
It is never quietly claimed.

### 3.6 Fail-closed

A required control the host cannot prove ⇒ throws, and the test asserts **no
child was returned**. A nonexistent writable path is a refusal, not a silently
created hole (and the test asserts the path was not created). A relative path is
refused. A newline or NUL in a path is refused rather than quoted-and-hoped.
`unconfinedSpawn` refuses without an explicit acknowledgement — including when
passed a truthy non-`true` value. Exit codes propagate correctly through
`unshare` + `setpriv` (verified: 42 in, 42 out).

### 3.7 The wired path, verified end-to-end against real host state

`ATLAN_CONFINE=1`, real `HOME`, real app root, the machine's actual vendor auth
stores:

| | codex run | grok run |
|---|---|---|
| own vendor store | readable | readable |
| other vendors' stores | **gone** | **gone** |
| unlisted HOME credentials (`~/.vault-token`, `~/.config/<x>/key`, `*.swp`) | **gone** | **gone** |
| everything else in HOME, incl. the cockpit's own directory | **gone** | **gone** |
| `~/.gitconfig` | present (ro) | present (ro) |
| `ATLAN_TOKEN` in env | **absent** | **absent** |
| `ANTHROPIC_API_KEY` in env | **absent** | **absent** |
| `XAI_API_KEY` in env | **absent** | granted (its own) |
| cockpit `.auth-token` | **empty** | **empty** |
| `~/.ssh` | **empty** | **empty** |
| workspace write | ok | ok |
| `$HOME` write | refused | refused |
| network | up (needed) | up (needed) |
| descriptor | `enforced:true, masked:35` | `enforced:true, masked:35` |

Before this change `agents.js` passed `{...process.env}` verbatim: codex received
the xAI key, grok received the Anthropic key, and all four received `ATLAN_TOKEN`
— the credential the incident used.

---

## 4. Bugs found and fixed during the build

### 4.1 The probe passed for the wrong reason

The capability probe originally placed its canary secret in `os.tmpdir()`. The
construction replaces `/tmp` with a private tmpfs, so the canary read back empty
because it was **shadowed**, not because the mask worked. A probe that passes for
the wrong reason is worse than no probe. Scratch now defaults to `homedir()`, and
the test suite carries the same warning at the top of the file.

### 4.2 One credential path under `TMPDIR` bricked every run

Mask existence was tested at the **source** path. Under the private `/tmp` the
corresponding target does not exist, `mount` failed, `set -e` aborted the setup,
and **the child never ran at all**. Found by mutation testing (M14), which is the
only reason it was found — no existing assertion noticed, because the suite's own
scratch is under `HOME`. Existence is now tested at the target, and there is a
regression test that masks a path under `TMPDIR` and asserts the run still starts.

### 4.3 `/sys/class/net` leaked the host's interfaces out of a sealed netns

```
✗ net:none — the namespace has only loopback — interfaces: eth0 lo tailscale0
```

The `rbind` of `/` carried the host's already-mounted sysfs in, and sysfs renders
its `net` directory for whichever network namespace it was mounted in. **Not an
egress path** — `connect()` was already `ENETUNREACH` — but it named the
operator's interfaces, including the tailnet one, to the agent. A boundary that
leaks its own shape invites probing. Fixed with a fresh `sysfs` after
`pivot_root`; tolerated if it fails, because losing it costs information, not
containment.

### 4.4 The test suite had the hole it was built to prevent

See §5.

---

## 5. Mutation testing — 15 mutants, 15 caught

A test that passes against broken code is worthless. Each control was
deliberately broken, the suite re-run, and the result recorded. Harness:
`/root/mutate.py` (applies the mutation, runs the suite, `git checkout`s back).

| mutant | disables | verdict |
|---|---|---|
| M1 drop the capability drop | child keeps `CAP_SYS_ADMIN`, can `umount` the mask | CAUGHT |
| M2 drop the deny-by-default remount | whole filesystem writable | CAUGHT |
| M3 drop the network namespace | `net:none` no longer isolates | CAUGHT |
| M4 drop the PID namespace | `/proc` scrape works again | CAUGHT |
| M5 drop credential masking | credentials readable | CAUGHT |
| M6 env allowlist → passthrough | every key reaches the child | CAUGHT (4 tests) |
| M7 fail-closed → fail-open | runs start without the controls | CAUGHT |
| M8 hardlink preflight goes blind | planted alias undetected | CAUGHT |
| M9 redactor → identity | secrets pass through logs verbatim | CAUGHT (3 tests) |
| M10 probe always reports success | refusals become false assurances | CAUGHT (2 tests) |
| M11 path validation accepts newline/NUL | argument-list splitting | CAUGHT |
| M12 writable paths not realpath-resolved | symlinked workspace binds the link | CAUGHT (2 tests) |
| M13 drop the fresh sysfs | host interfaces visible in a sealed netns | CAUGHT |
| M14 mask existence tested at source | a `TMPDIR` mask aborts the setup | CAUGHT |
| M15 vendor stores never masked | every other subscription token readable | CAUGHT |

**The first run was 12 caught, 3 escaped — and the escapes were the important
ones.** M1, M2, M4 and M5 break a control so thoroughly that the module's own
probe correctly reports "this host cannot confine". The suite then *skipped* every
kernel assertion and **exited 0**. Green, and enforcing nothing. That is precisely
the failure this project's threat model forbids.

Fixed by asking the kernel directly, with none of the code under test in the path:

```js
const HOST_CAN = spawnSync('unshare', ['--user','--map-root-user','true']).status === 0;
```

If `unshare` succeeds here and the module still could not confine, that is a
**defect, not a host limitation**, and the suite fails on it by name. A real
proot/Termux host still skips — loudly, counted, and named in the summary.

**Honest note on the mutants caught this way:** M1/M2/M4/M5 are caught by that
`NO SILENT SKIPPING` assertion rather than by the specific control test, because
breaking those controls also breaks the probe that gates the specific tests. The
mutant is caught (non-zero exit, named failure) but the diagnostic reads "the
module could not establish confinement" rather than "the mask can be unmounted."
That is a real, if minor, weakness in the suite's diagnostics, not in its
detection.

---

## 6. NOT COVERED — the honest limits

This section matters as much as the wins. Nothing here is claimed to be handled.

### 6.1 A pre-planted hardlink bypasses the mask — OPEN, mitigated, asserted

Confirmed in §1.5. A bind mask attaches to a path; a hardlink is a second name
for the inode and is not covered.

**Mitigation:** `credentialPreflight()` stats every credential path and refuses
on `st_nlink > 1`, which is a structural fact about the inode rather than a
pattern match. It is now actually *called* — `spawnAgentCli` runs it, `strict`
refuses to launch, and the Doctor reports it. (A contextless review found it had
been written and never wired; see §7.2 L2-2.)

**Residual:** it is a check-then-use, and it does not cover a link planted
**inside the workspace** pointing at an inode on the same filesystem — which a
previous agent turn could do, since the workspace is writable by design. Emptying
HOME removed most of the surface (a hardlink to a credential now has to live in
the workspace or the app root to be reachable at all), but not this. **The gap is
asserted as a test** — if a hardlink ever stops bypassing the mask, that test
fails and forces this section to be rewritten.

### 6.2 There is no egress allowlist — OPEN, and this is the biggest gap

`net:'none'` is a real, kernel-enforced kill: no internet, no DNS, and no reach to
the cockpit's own loopback port. **But an agent CLI must reach its provider**, so
it runs `net:'shared'` and there is **no egress gate at all** on that path. A
compromised turn can still POST anywhere it likes.

What partially covers it: with the cockpit token gone from the filesystem and
absent from the environment, an agent reaching `127.0.0.1:4589` cannot
authenticate. The preview proxy on `:4590` remains reachable and unauthenticated,
exactly as `SECURITY.md` already records.

**A contextless reviewer demonstrated the full shape of this** (§7.2 L2-3): a
parent HTTP service on loopback holding a token, and a `net:'shared'` child
reading it straight out of the API. That is the 2026-08-04 incident reproduced
under the configuration that actually ships for agent CLIs. It is disclosed —
`net:'shared'` reports `network: ok:false` and the Doctor says "Egress is NOT
gated" — but disclosure is not mitigation, and this is the gap to close next.

What would actually close it: a netns plus a veth pair routed only to a local
CONNECT proxy with a host allowlist. That needs `CAP_NET_ADMIN` in the **host**
namespace — root on a home node, and **impossible on Termux**. Deliberately not
attempted here rather than half-built.

### 6.3 Termux / Android / proot — UNTESTED

**Android is the primary platform and none of this was tested there.** No device
was reachable from this environment. What is known:
- proot provides no user namespaces, so no part of the confinement can initialise.
- Therefore the expected behaviour is: `probeConfinement()` returns `ran:false`
  with the kernel's own error, `confinedSpawn()` throws, `ATLAN_CONFINE=strict`
  refuses every run, and `ATLAN_CONFINE` unset or `1` runs with
  `enforced:false` and the reason attached.
- The suite's kernel tests will skip, loudly and counted.

**That path is exercised only through the fail-closed and unconfined-labelling
tests, which do not need namespaces — not on a real phone.** What would settle
it: run `node test/sandbox.mjs` in Termux and confirm the skip count is non-zero,
the `NO SILENT SKIPPING` test passes (because `HOST_CAN` is false there), and
`agentTurn` still completes a real turn with `enforced:false`.

Related and also untested: whether `unshare` and `setpriv` are present in a
default Termux install at all. If they are missing the probe fails closed, which
is correct, but it means the *home node* story depends on util-linux being
installed — which it is on Debian/Ubuntu by default.

### 6.4 The engine reads its own auth store — BY DESIGN, not fixed

`HOME` is preserved so the subscription login works, which is the whole reason
these CLIs run without an API key. So the running engine can read its own
credential store. Every *other* store is masked, which reduces the set from "all
credentials on the box" to "one credential, the one it authenticates with" — but
it is a reduction, not an elimination, and it is not claimed as one.

### 6.5 The redactor only catches verbatim values — asserted as a limit

`redactor()` removes exact byte sequences of known secrets. A secret the child
base64s, reverses, or splits across two lines passes through untouched, and no
value-matching redactor can fix that. **This is asserted as a test** so it cannot
change silently. It is a backstop behind blindness, not a substitute: if an agent
could read the secret at all, this was already the wrong layer to rely on.

### 6.6 Not wired everywhere

- **`server/src/build.js:71`** still runs `spawn('bash', ['-c', script], { env: process.env })`
  — full environment inheritance for an APK build. Left alone deliberately: the
  build script sources an Android SDK environment and stripping variables would
  break real builds. It is human-initiated, but an agent can cause it to run.
  *(Separately noted: that script hardcodes `/root/android-sdk/env.sh`, an
  operator path, which is a pre-existing user-agnosticism bug outside this scope.)*
- **`server/src/pty.js:8`** builds the Term tab's environment from
  `{...process.env}` plus injected keys. Left alone deliberately: that tab is the
  human's own shell, and a human who exported a key for their own use should keep
  it. It is not an agent-controlled surface.
- **The Claude Agent SDK fleet path** (`fleet.js`) is unchanged. It has its own
  `sandbox` option via `ATLAN_SANDBOX`, which needs bubblewrap; this host does not
  have bubblewrap installed, so that path remains unconfined here regardless.
- **`containment.js`** is on `agent/live-self-edits-2026-08-04`, not on `main`,
  and was not modified. Its `scrubbedEnv()` denylist and `childEnv()` allowlist
  now overlap; whoever merges should replace the former with the latter.

### 6.7 Things that were reasoned about but not proven

- **Landlock.** Kernel 5.15 has Landlock ABI v1, but there is no userspace tool on
  this host and Node cannot make the syscall without a native module. The
  construction here does not use Landlock. Not tested, not claimed.
- **TOCTOU between `realpath()` and `mount --bind`.** The window exists. The bind
  attaches to the inode resolved at mount time, and the mount happens inside the
  child's private namespace, so a successful race changes only that child's view —
  but it is a real window and it was not closed. Closing it needs `openat2` with
  `RESOLVE_NO_SYMLINKS` and dir-fd confinement, which is the same fix
  `SECURITY.md` already names as outstanding for the path guards.
- **Resource exhaustion.** No cgroup limits, no rlimits, no PID cap. A confined
  child can still fork-bomb or fill the workspace filesystem. Out of scope here
  and not addressed.
- **Core dumps.** The private `/tmp` and read-only root mean a core dump has
  nowhere to land except the workspace. `RLIMIT_CORE` is not set. Untested.
- **A real agent turn under `ATLAN_CONFINE=1`.** The launch path is verified end
  to end (§3.7) — the right stores are present, the wrong ones are gone, the
  workspace is writable, the network is up — but no actual `codex`/`grok` turn was
  run to completion under confinement, because that costs money and needs live
  auth. **What would settle it:** `ATLAN_CONFINE=1` plus one real turn per engine
  that edits a file and commits. The specific risk is an emptied HOME missing
  something an engine needs that `homeReadable()` does not list; the symptom
  would be an engine failing to start or committing without an author, not a
  silent loss of confinement.

---

### 6.8 A unix socket inside a declared path is connectable — asserted as a gap

`/run` is sealed, so the system daemons are unreachable. But **read-only does not
block `connect(2)`**, so a unix socket sitting inside the workspace — or inside
any path bound in for the run — can be talked to. Declaring the path is declaring
the socket.

Exploiting it requires a cooperating listener already running with access to that
directory, which on a single-user box means the attacker is already inside. It is
recorded rather than fixed because the fix (sweeping bound-in paths for socket
inodes) is both expensive and racy — a writable path can grow a new socket at any
time. **Asserted as a test** so it cannot change silently in either direction.

### 6.9 Secrets inside the workspace are visible — BY DESIGN

A contextless reviewer listed `.env.production` and a token-bearing `config.json`
among its recoveries. Both were inside the project directory. An agent asked to
work on a project can read that project; that is what a workspace is. The mask
set covers the *cockpit's* state and the user's *personal* credential stores, not
the contents of the repository the agent was pointed at. Worth stating plainly
because it is the difference between "the agent cannot see a credential" (false)
and "the agent cannot see a credential it was not given the directory for" (true).

---

## 7. What the three adversarial layers found

Three independent reviewers were given **only** the three source files — no
documentation, no tests, no git history, no statement of intent — each told to
break the code rather than confirm it, and each given a different lens. A
reviewer who knows what the code is supposed to do is not contextless.

**They found seven things. All seven were real.** Every one was independently
reproduced here before any fix was written, and every one now has a test that
fails when its fix is removed.

### 7.1 Layer 1 — filesystem escape

**L1-1 · CONFIRMED · a writable mount whose path contains a SPACE was never made
read-only.** The kernel octal-escapes field 5 of `/proc/self/mountinfo` (space →
`\040`). The escaped string was passed straight to `mount`, which addressed a
path that does not exist; the remount failed; `|| true` swallowed the failure;
and the volume stayed **read-write** inside a sandbox stamped `enforced: true`.

The reviewer's reproduction, and mine, both landed a file in a real host
directory that was never declared writable. This is not exotic — udisks and
GNOME auto-mount removable media at `/media/<user>/<Volume Label>`, and labels
like "My Passport" contain spaces.

FIXED two ways. The escapes are decoded. More importantly, **the code no longer
performs a sequence of steps and assume the result — it asserts the result.**
After everything is mounted, no mount under the new root may be writable unless
it was declared; if one is, the run is refused. That check immediately caught a
second case nobody had gone looking for — `/run/user`, a submount the remount
loop never reached — and it is the version of this control that stays true
against the next mount type that refuses `remount,bind,ro`.

**L1-2 · SUSPECTED, accepted, now covered by the same fix.** Any mount type that
refuses `remount,bind,ro` (FUSE, sshfs, rclone) was left writable by the same
`|| true`. The reviewer could not reproduce it on this host — 9p honours the
remount — but the reasoning held. The property check covers it without needing
to enumerate filesystem types.

**L1-3 · SUSPECTED, still open.** `realpath()` → `mount --bind` is a
check-then-use. See §6.7; unchanged.

### 7.2 Layer 2 — credential recovery

**L2-1 · CONFIRMED · the filesystem mask was a DENYLIST.** The sharpest finding
of the three, because it turned the module's own argument against it: the
environment layer was inverted to an allowlist precisely because "a denylist is
a list of the credentials someone remembered", and the filesystem layer was then
built as a denylist. Recovered through a mask set working exactly as written:
`.env.production` (the list had `.env` and `.env.local`), a `config.json` holding
a token, an editor's `.auth-token.swp` sibling, `~/.vault-token`, and
`~/.config/anthropic/key`.

FIXED. **HOME is now an empty tmpfs** with only declared paths bound back in:
the engine's own auth store (writable — these CLIs rewrite their token on
refresh) and `~/.gitconfig` (read-only — without it every agent commit is
authorless). Unlisted is invisible by construction. Verified after the fix, a
confined codex run sees exactly `. .. .codex .gitconfig <workspace>` in HOME and
nothing else. As a side effect the cockpit's whole state directory, which lives
under HOME, now disappears from the agent's view rather than being masked file by
file.

**L2-2 · CONFIRMED · `credentialPreflight` was dead code.** The hardlink bypass
was described in a comment, a detector was written for it, and nothing ever
called it. Correct and embarrassing. FIXED: `spawnAgentCli` runs it, `strict`
refuses to launch when a credential already has a second name, and the Doctor
reports it. The underlying gap is unchanged and still asserted as a gap (§6.1).

**L2-3 · CONFIRMED · under `net:'shared'` the child reached the cockpit's own
loopback API and read the token from it.** A disclosed limitation rather than a
hidden bypass — `net:'shared'` reports `network: ok:false` — but it is the exact
shape of the 2026-08-04 incident and it is the configuration that actually ships
for agent CLIs. **NOT FIXED.** See §6.2; this is the biggest remaining gap.

**L2-4 · CONFIRMED, minor, NOT FIXED.** `/proc/self/mountinfo` inside the child
names the masked paths, handing the agent a map of where credentials live. Much
reduced by the empty HOME (there are far fewer mask mounts now), but a child can
always read its own mount table. Accepted.

**L2-benign.** An inherited `fd 3 → /proc/<pid>/fd` appears in the child; the
reviewer chased it and confirmed it points at an already-exited setup process
(`readlink` empty, `openat` ENOENT). An fd-hygiene wart, not a recovery.

### 7.3 Layer 3 — network egress and self-assessment

**L3-1 · CONFIRMED · a network namespace does not isolate filesystem unix
sockets.** With the host root rbind-ed in, a child reporting `ENETUNREACH`
connected to `/run/tailscale/tailscaled.sock` and read back 6KB of tailnet
status — **real egress through a daemon holding the network the child had been
denied**, plus disclosure of the tailnet topology. Read-only does not block
`connect(2)`.

FIXED: `/run` is an empty tmpfs in **both** network modes — `/run/docker.sock` is
a privilege path whether or not the IP stack is up. `$XDG_RUNTIME_DIR` is
declared back for the one CLI that keeps its token in the system keyring over
D-Bus. The probe now counts reachable unix sockets as part of the `net:'none'`
verdict, so the narrow definition that produced the gap cannot return.

**L3-2 · CONFIRMED · same mechanism with a parent-planted socket.** Fixed by the
same change; an *undeclared* parent socket is now unreachable. A socket **inside
a declared path** remains connectable — that is inherent to declaring the path,
and is asserted as a known gap (§6.8).

**L3-3 · CONFIRMED · an inherited connected socket survived the namespace.** A
socket connected in the parent keeps working after the child enters a new netns
and after `execve`, so a caller passing a live `127.0.0.1` socket as fd 3 got
bytes out of a `net:'none'` child. FIXED: extra stdio descriptors are refused.
The caller here is Atlan itself, so this is defence in depth — but a launcher
whose promise can be voided by one option deserves to refuse that option.

**L3-4 · CONFIRMED · the probe could not tell "masked" from "merely shadowed".**
Both read empty. Because the scratch directory (and `$HOME`, from which it
derives) is environment-controlled, a scratch under `/tmp` made the probe certify
`credentials: ok` on a run where **no mask mount had been created at all** — a
refusal converted into a false assurance, cached under the probe key. This is the
worst class of bug this module can have, and the reviewer named it as such.
FIXED: the verdict now requires the mask **mount** to be present in
`/proc/self/mountinfo`, not merely an empty read.

**L3-5 · CONFIRMED · `require: []` returned `enforced: true` having verified
nothing.** Nothing missing, so nothing refused, and the descriptor asserted
enforcement with an empty controls object. FIXED: an empty requirement list is an
error.

### 7.4 A defect found while fixing theirs

A comment inside the setup script wrapped `|| true` in backticks — and those
backticks **ended the JavaScript template literal 130 lines early**. The shell
received a 23-line script that stopped after the newline guard.

Nothing crashed and nothing leaked: the probe found no evidence, and every
`confinedSpawn` refused. That is the fail-closed design working correctly on an
*internal* defect rather than a hostile host, which is the strongest evidence in
this report that the fail-closed posture is worth its cost. It was still silent,
so the script now asserts its own last line at import time.

---

## 8. Mutation testing, round 2 — 23 mutants, 23 caught

The battery was extended with one mutant per control the reviews forced into
existence (M16–M23). Full table in `/root/mutate2.py`; result: **23 caught, 0
escaped.**

Four escapes were fixed along the way, and each was a genuine weakness in the
suite rather than a scoring problem:

- **M22 / M23** — the mask-mount check and the unix-socket count were asserted in
  the *evidence strings* but not in the *decisions*. Deleting the term from the
  `ok` expression left every behavioural test green while reopening the
  false-assurance path. Now asserted where the decision lives.
- **M16** — the space-named-mount test accepted "the run was refused" as success.
  With the octal decoding removed, the property check refuses and the test
  passed — hiding both the bug and the fact that a machine with any space-named
  mount would then refuse *every* run. The test now requires the child to have
  actually run *and* the write to have been refused.
- **M16 / M17, second round** — both tests planted their mount inside the suite's
  own scratch, which is bound in read-only, so the mount was protected by
  shadowing rather than by the control under test. Exactly the trap the probe
  fell into in §4.1, in a different costume. Test mounts now go outside every
  region the sandbox replaces or binds back in.

**One mutant is deliberately not scored.** Removing the runtime truncated-script
guard (§7.4) breaks nothing, because that guard and the marker test detect the
same condition — delete one and the other still fires. Counting it as an escape
would be theatre; so would contorting a test to catch it. Recorded here instead.
