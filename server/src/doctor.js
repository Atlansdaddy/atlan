import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { agentStatus } from './agents.js';
import { chatUsage } from './chatlog.js';
import { existsSync, statSync } from 'node:fs';
import { arch, homedir } from 'node:os';
import { join } from 'node:path';
import { PORT, sandboxEnabled, LOCAL_LLM_BASE, ANDROID_SDK } from './config.js';

const sh = promisify(exec);

// EVERY proot-boundary assumption lives here and nowhere else.
// When a Termux/Android update breaks something, this file names it.
export async function runDoctor() {
  const checks = await Promise.all([
    check('jdk', 'JDK 21', async () => {
      const { stderr, stdout } = await sh('java -version 2>&1 || true');
      const out = stdout + stderr;
      // Parse the MAJOR version from the `version "21…"` field — an unanchored
      // /21\./ falsely matches JDK 11's build "11.0.21.1" (the "21." substring).
      const m = out.match(/version "(\d+)/);
      return { ok: m ? m[1] === '21' : false, detail: out.split('\n')[0] };
    }),
    check('sdk', 'Android SDK 35', async () => {
      const ok = existsSync(join(ANDROID_SDK, 'build-tools/35.0.0'));
      return {
        ok,
        // "missing" against a bare path is a dead end — it does not say which
        // path was looked at, that the path is overridable, or that a host with
        // no SDK is a normal state rather than a broken install. The APK
        // pipeline is the on-phone proot recipe; a home node that only serves
        // local models has no reason to carry a 600MB SDK.
        detail: ok ? ANDROID_SDK
          : `not installed at ${ANDROID_SDK} — only needed to build APKs on THIS host `
            + '(set ATLAN_ANDROID_SDK if yours lives elsewhere)',
      };
    }),
    // NAMED FOR THE ARCHITECTURE, because the shim is not universal. aapt2 ships
    // as an x86_64 binary, so an arm64 phone runs it under qemu — and an x86_64
    // host runs it directly, with nothing to emulate. Reporting "aapt2 qemu shim
    // — missing" on x86_64 sent someone looking for a component that host must
    // never have. What both cases actually need is the same: aapt2 runs.
    check('aapt2', arch() === 'x64' ? 'aapt2 (native — no shim on x86_64)' : 'aapt2 qemu shim', async () => {
      const shim = join(ANDROID_SDK, 'build-tools/35.0.0/aapt2');
      if (!existsSync(shim)) {
        return {
          ok: false,
          detail: arch() === 'x64'
            ? 'aapt2 not found — it comes with the SDK above; no qemu shim is needed on x86_64'
            : 'shim missing',
        };
      }
      // Require the real version banner or an "aapt2 <version>" line — NOT the
      // bare word "aapt2", which also appears in error output (the same trap the
      // Piper check fell into). No `|| true`: a broken qemu shim rejects and we
      // report the real failure instead of falsely passing on its error text.
      try {
        const { stdout, stderr } = await sh(`${shim} version`, { timeout: 20000 });
        const out = (stdout + stderr).trim();
        const ok = /Android Asset Packaging Tool/i.test(out) || /\baapt2\s+v?\d+\.\d/i.test(out);
        return { ok, detail: out.slice(0, 80) };
      } catch (err) {
        return { ok: false, detail: `shim run failed: ${String(err.message).slice(0, 70)}` };
      }
    }),
    check('claude', 'claude binary', async () => {
      // Presence via `command -v` exit code, not a word-grep; version is detail only.
      try {
        const { stdout } = await sh('command -v claude', { timeout: 5000 });
        if (!stdout.trim()) return { ok: false, detail: 'not on PATH' };
        const { stdout: v } = await sh('claude --version 2>/dev/null | head -1 || true');
        return { ok: true, detail: `${stdout.trim()}${v.trim() ? ' · ' + v.trim() : ''}` };
      } catch { return { ok: false, detail: 'not on PATH' }; }
    }),
    check('auth', 'Claude auth', async () => ({
      ok: existsSync(join(homedir(), '.claude/.credentials.json')) || !!process.env.ANTHROPIC_API_KEY,
      detail: process.env.ANTHROPIC_API_KEY ? 'API key (env)' : 'subscription OAuth',
    })),
    // AGENT CLI CONNECTIONS. Two independent things have to be true for a
    // non-Claude engine to answer, and until now chat reported neither: the
    // binary has to exist, and it has to be authenticated. A CLI that was
    // installed-but-logged-out and one that was never installed produced the
    // same thing on screen — nothing — so this asks both questions by RUNNING
    // the binary rather than reading a flag, and names which half is missing.
    // CHAT STORAGE. Reported, never enforced. Nothing here deletes anything —
    // it exists so the store is visible long before it is a problem, and so the
    // decision to archive is made by the person whose conversations they are.
    check('chat-store', 'Chat transcripts', async () => {
      const u = chatUsage();
      const gb = (n) => (n == null ? 'unknown' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);
      const base = `${u.count} conversation${u.count === 1 ? '' : 's'}, ${gb(u.bytes)}`
        + (u.freeDisk != null ? ` · ${gb(u.freeDisk)} free` : '')
        + (u.memAvailable != null ? ` · ${gb(u.memAvailable)} RAM available` : '');
      return {
        ok: !u.suggestArchive,
        warn: u.suggestArchive,
        detail: u.suggestArchive
          ? `${base} — ${u.reason}. Archiving keeps every conversation readable in History and only compresses the older ones; nothing is deleted.`
          : base,
      };
    }),
    check('cli-connections', 'Agent CLI connections', async () => {
      // CLAUDE IS ON THIS PANE TOO, even though it is not an agentTurn CLI.
      // Its binary and its credential already had their own two rows elsewhere,
      // which meant the one place you go to ask "which engines can actually
      // answer me" was the one place that did not list the default engine.
      // agentStatus() now lists claude too, and resolves every binary through
      // the proot container when that is where it lives. This used to ask the
      // Termux PATH directly and therefore reported four working CLIs as
      // missing on the one device the project is built for.
      const engines = agentStatus().map((a) => ({
        id: a.id, authed: !!a.ready, needs: a.needs, login: a.login, installed: !!a.installed,
      }));
      const rows = [];
      const actions = [];
      let ready = 0, half = 0;
      for (const { id, authed, needs, login, installed } of engines) {
        const ver = '';
        if (installed && authed) ready++;
        else if (installed !== authed) half++;
        rows.push(`${id}: ${installed ? `bin ok${ver ? ` (${ver})` : ''}` : 'BIN MISSING'}`
          + ` · ${authed ? 'auth ok' : `NO AUTH — ${needs ?? 'not configured'}`}`);
        // ONE BUTTON PER ENGINE THAT CAN BE SIGNED IN. Every one of these is a
        // device-code or browser flow only the account holder can finish, so the
        // button's job is to put them at the prompt — it cannot and must not
        // authenticate on their behalf. No credential passes through here.
        if (installed && !authed && login) {
          actions.push({ id, label: `Log in to ${id}`, run: login });
        }
      }
      // The on-phone local model is an engine you can pick in chat, so it belongs
      // in the same answer — but it is a SERVER, not a binary, so it is asked the
      // only question that means anything for it: does it answer right now.
      let localUp = false;
      try { localUp = (await fetch(`${LOCAL_LLM_BASE}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { /* not running */ }
      rows.push(`local: ${localUp ? 'llama-server up' : 'llama-server not running (optional)'}`);
      if (localUp) ready++;
      return {
        // Half-configured is the state worth flagging: it is the one that looks
        // like a broken cockpit from chat. Nothing installed at all is a choice.
        ok: half === 0,
        warn: half > 0,
        detail: `${ready}/${rows.length} usable — ${rows.join('  |  ')}`,
        actions,
      };
    }),
    check('tmux', 'tmux (terminal persistence)', async () => {
      // Require the "tmux <version>" banner. A present-but-broken tmux prints
      // "tmux: error while loading shared libraries…" which startsWith('tmux')
      // and would falsely read green (the broken-binary trap).
      const { stdout } = await sh('tmux -V 2>&1 || true');
      const have = /^tmux \d/.test(stdout.trim());
      // WARN, NOT FAIL. Without tmux the Term tab still works — it falls back to
      // a plain login shell — so this is a lost capability, not a broken one.
      // It read as a hard failure while the terminal was genuinely dead, which
      // conflated two different problems; the terminal being dead was pty.js
      // assuming tmux existed, and that is fixed.
      return {
        ok: have,
        warn: !have,
        detail: have
          ? `${stdout.trim()} — sessions survive a reconnect, and \`tmux attach -t atlan-main\` reaches them from a shell`
          : 'not installed — the terminal falls back to a plain shell, so sessions do NOT survive a reconnect and cannot be attached from Termux. Install with: pkg install tmux',
      };
    }),
    check('disk', 'Free disk', async () => {
      const { stdout } = await sh(`df -h "${homedir()}" | tail -1 | awk '{print $4}'`);
      const free = stdout.trim();
      const gb = parseFloat(free);
      return { ok: !(free.endsWith('G') && gb < 5), warn: free.endsWith('G') && gb < 10, detail: `${free} free` };
    }),
    check('sw-no-fetch', 'push SW has no fetch handler', async () => {
      // The stale-SW landmine stays dead only while sw.js never intercepts
      // requests. If this goes red, someone added caching — rip it out.
      const { readFile } = await import('node:fs/promises');
      const src = await readFile(new URL('../../web/public/sw.js', import.meta.url), 'utf8');
      const hasFetch = /addEventListener\(\s*['"]fetch['"]/.test(src);
      return { ok: !hasFetch, detail: hasFetch ? 'FETCH HANDLER FOUND — stale-cache risk, remove it' : 'push-only, cannot cache' };
    }),
    check('bash-sandbox', 'Bash OS-sandbox (bubblewrap)', async () => {
      // Claude Code's docs offer an OS-level Bash sandbox via bubblewrap, which
      // needs real user namespaces. proot (ptrace-based) doesn't provide them,
      // so on-phone it CAN'T run — tool-level profile gating is the control
      // here; a native Linux host (e.g. the 4060Ti node) gets the full sandbox.
      //
      // SECURITY-CRITICAL honesty: trust bwrap's EXIT CODE, never a grep of its
      // error text. `bwrap ... true` exits 0 ONLY if it actually created the
      // namespaces; any failure is non-zero. The old code masked the exit with
      // `|| true` then grepped for known error words — an unrecognized failure
      // would slip through and falsely report the sandbox "available." Claiming
      // a boundary that isn't there is the exact thing the threat model forbids.
      // Report ENFORCEMENT, not just availability, so the boundary is never
      // overstated. The autonomous fleet OS-confines Bash only when ATLAN_SANDBOX=1
      // AND bubblewrap can actually create namespaces here.
      const on = sandboxEnabled();
      let avail = false, notInstalled = false;
      try {
        await sh('bwrap --ro-bind / / --unshare-all true', { timeout: 5000 });
        avail = true;
      } catch (err) {
        notInstalled = /ENOENT|not found|command not found/i.test(String(err?.message ?? err));
      }
      if (avail && on) return { ok: true, detail: 'ENFORCED — autonomous (builder/verifier) Bash runs OS-confined via bubblewrap+seccomp (ATLAN_SANDBOX=1)' };
      if (avail && !on) return { ok: false, warn: true, detail: 'available but OFF — set ATLAN_SANDBOX=1 to OS-confine autonomous Bash (interactive Chat stays permission-carded)' };
      if (!avail && on) return { ok: false, warn: true, detail: notInstalled
        ? 'ATLAN_SANDBOX=1 but bubblewrap not installed — `apt install bubblewrap` (Linux/WSL2); until then autonomous Bash runs UNSANDBOXED (failIfUnavailable=false keeps runs working)'
        : 'ATLAN_SANDBOX=1 but no user namespaces here (proot) — autonomous Bash runs UNSANDBOXED; run the server on a Linux/WSL2/native host to actually confine it' };
      return { ok: false, warn: true, detail: notInstalled
        ? 'bubblewrap not installed (optional) — on a Linux/WSL2 host: `apt install bubblewrap` + ATLAN_SANDBOX=1 to confine autonomous Bash'
        : 'unavailable in proot (no namespaces) — profiles gate tools; a native Linux/WSL2 host + ATLAN_SANDBOX=1 gives real OS confinement' };
    }),
    // Two layers, two checks, deliberately not merged into one line. The first
    // reports NAMESPACES (unshare + setpriv) — a real filesystem and PID
    // boundary that an unrooted phone cannot have. The second reports the
    // SECCOMP ladder, which is the one kernel control that survives there. A
    // single combined verdict would let one layer's green hide the other's red.
    check('cli-confinement', 'Agent-CLI OS confinement (namespaces)', async () => {
      // The bubblewrap check above covers the Agent SDK's Bash sandbox. This one
      // covers the FOUR exec-mode CLIs the SDK never touches, and it reports what
      // the KERNEL did rather than what a config file claims: the probe performs
      // the real confinement on a throwaway workspace and reads back the syscall
      // results. /sys/kernel/security/lsm does not exist on this WSL2 kernel at
      // all, and reads `n/a` on hosts where Landlock IS actively enforcing — a
      // flag file is not evidence, so none is consulted.
      const { confinementReport } = await import('./lib/sandbox.js');
      const { confineMode, APP_ROOT } = await import('./config.js');
      const { credentialTargets, credentialPreflight } = await import('./lib/credblind.js');
      const mode = confineMode();
      const rep = confinementReport();
      const gated = Object.entries(rep.modes['net:shared']).filter(([, v]) => v.ok).map(([k]) => k);
      // A hardlinked credential defeats the mask no matter how well the
      // namespaces work, so it outranks everything else this check reports.
      const linked = credentialPreflight(credentialTargets({ appRoot: APP_ROOT })).filter((p) => p.kind === 'hardlinked');
      if (linked.length) {
        return { ok: false, warn: true, detail: `${linked.map((p) => p.path).join(', ')} has a second hardlink — a credential mask cannot hide an inode that has another name. Remove the extra link; ATLAN_CONFINE=strict refuses to run until you do` };
      }
      if (!rep.available) {
        return { ok: false, warn: true, detail: mode === 'strict'
          ? 'ATLAN_CONFINE=strict but this host cannot create user namespaces (proot/Termux) — agent-CLI runs are REFUSED here'
          : 'no user namespaces here (proot/Termux) — agent CLIs run UNCONFINED and every spawn is labelled enforced:false. A Linux/WSL2 home node can confine them; the phone cannot' };
      }
      if (mode === 'off') {
        return { ok: false, warn: true, detail: `confinement AVAILABLE but OFF — this host can enforce ${gated.join(', ')}; set ATLAN_CONFINE=1 (or =strict) to use it` };
      }
      return { ok: true, detail: `ENFORCED (${mode}) — ${gated.join(', ')}, each verified by a live probe. Egress is NOT gated (net:shared): the CLIs must reach their provider, so the cockpit token is masked instead of the network being closed` };
    }),
    // NAMED FOR THE QUESTION, NOT THE IMPLEMENTATION. This was "Homebuilt
    // confinement ladder (atlan-confine, seccomp)" — which tells you what was
    // built, not that this is the row answering "how contained is an agent on my
    // phone". A user looking for exactly that scrolled past it, and landed on
    // "Bash OS-sandbox" instead, which is a different thing. The implementation
    // names still appear, in the detail, where an engineer will still find them.
    check('confine', 'Agent containment on this device', async () => {
      // Everything this reports was ESTABLISHED BY ATTEMPT on this boot. Nothing
      // here reads /proc/sys, /sys/kernel/security/lsm, uname, an Android release
      // or ANDROID_* — each of those has been observed to lie in at least one
      // direction on a platform Atlan ships to, and one of them (the
      // max_user_namespaces file) reads a large positive number on a kernel built
      // WITHOUT user namespaces because kernel/ucount.c registers it with no
      // CONFIG_USER_NS guard. A flag file lies; a forked child that performs the
      // operation does not.
      const { probe, ladderLines } = await import('./sandbox/probe.js');
      const { LABEL, NO_FS_ON_THIS_DEVICE, SUPERVISOR_ON_THIS_DEVICE, dominates } = await import('./sandbox/tiers.js');
      const { declaredTier } = await import('./config.js');
      const v = probe();
      const declared = declaredTier();
      const failed = v.rungs.filter((r) => !r.ok);
      const ladder = ladderLines(v).join(' · ');
      const noFs = v.rungs.some((r) => r.id === 'landlock-canary' && !r.ok);
      // A supervisor is not a weaker kernel, it is a kernel we are no longer
      // talking to directly, and the rungs it costs are known by name. Saying so
      // is the difference between "your device is worse" and "here is what is
      // between us and the kernel, and here is exactly what that removes".
      const supervised = v.rungs.some((r) => r.id === 'ptrace-arbitration' && !r.ok);
      const detail = `established ${v.tier} (${LABEL[v.tier]}) · runs declare ${declared}`
        + (v.arch ? ` · ${v.arch}` : '')
        + (v.landlockAbi > 0 ? ` · landlock abi ${v.landlockAbi}` : '')
        + ` — ${ladder}`
        + (supervised ? ` — ${SUPERVISOR_ON_THIS_DEVICE.replace(/\*\*/g, '')}` : '')
        + (noFs ? ` — ${NO_FS_ON_THIS_DEVICE.replace(/\*\*/g, '')}` : '');
      // ok tracks whether the run CAN START — which is CONTAINMENT, not
      // magnitude. The hardcoded ['T0','T1','T2','T3'] this replaced would have
      // scored TS at indexOf -1, i.e. below T0, and reported the primary
      // platform as red for declaring the tier it actually holds.
      return { ok: dominates(v.tier, declared), warn: failed.length > 0, detail: detail.slice(0, 1200) };
    }),
    check('piper', 'Piper voice (local TTS)', async () => {
      // Optional "sounds good" local voice. Browser voice always works without
      // it; ElevenLabs/OpenAI cover BYO-key. Green only when the binary AND a
      // model are both present, since Piper needs a .onnx to speak.
      // `command -v` resolves the binary or prints nothing — never the word
      // "piper" from an error message (which a `--version` grep would falsely match).
      const { stdout } = await sh('command -v piper 2>/dev/null || true', { timeout: 3000 });
      const hasBin = !!stdout.trim();
      if (!hasBin) return { ok: false, warn: true, detail: 'not installed (optional) — prebuilt piper binary + a .onnx voice (pip install piper-tts only works on Python ≤3.12); browser/BYO-key voices still work' };
      const model = process.env.PIPER_MODEL || (await import('./keys.js')).getStoredKey('PIPER_MODEL');
      const hasModel = !!model && existsSync(model);
      return { ok: hasModel, warn: !hasModel, detail: hasModel ? `installed · ${model.split('/').pop()}` : 'installed, but PIPER_MODEL unset/missing — set a .onnx voice path in Keys' };
    }),
    check('tailnet', 'Tailscale reach (phone ↔ this host)', async () => {
      // Optional. The cockpit binds loopback-only; to reach it from another device
      // you proxy it over your tailnet with `tailscale serve`. The one thing that
      // silently breaks that is the origin guard — so this check surfaces the reach
      // URL and confirms the guard will allow it (Atlan auto-allows the tailnet
      // origin at boot, so this is normally green with no config).
      const { tailnetHost, tailnetOrigin } = await import('./tailnet.js');
      const host = await tailnetHost();
      if (!host) {
        return { ok: false, warn: true, detail: `Tailscale not detected here — cockpit is loopback-only (fine for local use). To reach it from your phone: run \`tailscale serve --bg ${PORT}\` on this host + set ATLAN_SECURE_COOKIE=1 (see docs/SETUP.md).` };
      }
      const origin = tailnetOrigin(host);
      const { allowedOrigins } = await import('./auth.js');
      const allowed = allowedOrigins().includes(origin);
      const secure = !!process.env.ATLAN_SECURE_COOKIE;
      return {
        ok: allowed,
        warn: !allowed || !secure,
        detail: `reach at ${origin} — origin guard ${allowed ? 'ALLOWS it (auto)' : 'will BLOCK it (set ATLAN_ORIGIN=' + origin + ')'}; `
          + `cookie ${secure ? 'Secure ✓' : 'not Secure (set ATLAN_SECURE_COOKIE=1 for TLS)'}. `
          + `Expose with \`tailscale serve --bg ${PORT}\` — never \`funnel\` (that's public).`,
      };
    }),
    check('llama', `llama-server ${LOCAL_LLM_BASE.replace(/^https?:\/\/127\.0\.0\.1/, '')}`, async () => {
      try {
        const res = await fetch(`${LOCAL_LLM_BASE}/health`, { signal: AbortSignal.timeout(1500) });
        return { ok: res.ok, detail: 'up' };
      } catch {
        return { ok: false, warn: true, detail: 'not running (optional)' };
      }
    }),
    check('watchdog', 'Auto-recovery watchdog (Termux)', async () => {
      // The OUTER net: a native-Termux JobScheduler task that resurrects the
      // whole proot stack when it's force-killed at once (thermal shed, phantom
      // killer, OOM) — the one failure the in-proot supervisor can't survive,
      // because it dies with the tree. Only meaningful on a Termux/proot phone;
      // on a PC/home node the supervisor + your OS init is the durability path.
      const TX = '/data/data/com.termux/files/home';
      if (!existsSync(TX)) {
        return { ok: true, detail: 'N/A — not a Termux/proot host; use the supervisor + your OS init (systemd/pm2) for durability' };
      }
      const script = `${TX}/.atlan/watchdog.sh`;
      const stamp = `${TX}/.atlan/watchdog.stamp`;
      if (!existsSync(script)) {
        return { ok: false, warn: true, detail: 'not installed — copy bin/atlan-watchdog.sh to ~/.atlan/watchdog.sh in Termux, then register it (see the script header)' };
      }
      if (!existsSync(stamp)) {
        return { ok: false, warn: true, detail: 'installed but never fired — in native Termux run: termux-job-scheduler --script $HOME/.atlan/watchdog.sh --job-id 4589 --period-ms 900000 --persisted true' };
      }
      const ageMin = (Date.now() - statSync(stamp).mtimeMs) / 60000;
      if (ageMin <= 20) {
        return { ok: true, detail: `armed — last heartbeat ${Math.round(ageMin)} min ago; resurrects the stack ≤15 min after a proot-tree kill` };
      }
      return { ok: false, warn: true, detail: `stale — last heartbeat ${Math.round(ageMin)} min ago (>20); JobScheduler may be unregistered or Doze-throttled (check: termux-job-scheduler --pending)` };
    }),
  ]);
  return checks;
}

/**
 * WHICH QUESTION DOES THIS CHECK ANSWER? Seventeen rows in one flat list, sorted
 * by nothing, is why a user hunting for "the sandbox stuff" walked past the
 * confinement ladder at position thirteen. The groups are the four questions
 * someone actually opens this tab holding:
 *
 *   safety   — how contained is an agent on this device
 *   engines  — what can answer me right now
 *   build    — can I produce an app from here
 *   health   — is the cockpit itself okay
 *
 * A check with no group still renders; it lands in health, which is the honest
 * default for "something we watch".
 */
export const DOCTOR_GROUPS = {
  safety: { label: 'Containment', blurb: 'how much an agent can reach on this device' },
  engines: { label: 'Engines', blurb: 'what can answer you right now' },
  build: { label: 'Build toolchain', blurb: 'what it takes to produce an installable app' },
  health: { label: 'Health', blurb: 'the cockpit looking after itself' },
};

const GROUP_OF = {
  confine: 'safety', 'bash-sandbox': 'safety', 'cli-confinement': 'safety',
  'cli-connections': 'engines', claude: 'engines', auth: 'engines', llama: 'engines', piper: 'engines',
  jdk: 'build', sdk: 'build', aapt2: 'build',
  tailnet: 'health', disk: 'health', 'chat-store': 'health', tmux: 'health',
  watchdog: 'health', 'sw-no-fetch': 'health',
};

async function check(id, label, fn) {
  // The group's LABEL rides on every row rather than being fetched separately.
  // /api/doctor has always returned a flat array and something may depend on
  // that; changing the response into {checks, groups} to save a few duplicated
  // strings would be trading a real compatibility risk for a cosmetic win.
  const group = GROUP_OF[id] ?? 'health';
  const meta = { group, groupLabel: DOCTOR_GROUPS[group].label, groupBlurb: DOCTOR_GROUPS[group].blurb };
  try {
    const r = await fn();
    // `actions` are the things a row can DO — a login command a button runs.
    // Omitted entirely when there are none, so every other row is byte-identical
    // to what it returned before and nothing downstream has to learn a new shape.
    return {
      id, label, ...meta, ok: !!r.ok, warn: !!r.warn, detail: r.detail ?? '',
      ...(r.actions?.length ? { actions: r.actions } : {}),
    };
  } catch (err) {
    return { id, label, ...meta, ok: false, warn: false, detail: String(err?.message ?? err).slice(0, 100) };
  }
}
