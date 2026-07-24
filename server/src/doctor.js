import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { PORT, sandboxEnabled } from './config.js';

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
    check('sdk', 'Android SDK 35', async () => ({
      ok: existsSync('/root/android-sdk/build-tools/35.0.0'),
      detail: '/root/android-sdk',
    })),
    check('aapt2', 'aapt2 qemu shim', async () => {
      const shim = '/root/android-sdk/build-tools/35.0.0/aapt2';
      if (!existsSync(shim)) return { ok: false, detail: 'shim missing' };
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
      ok: existsSync(`${process.env.HOME}/.claude/.credentials.json`) || !!process.env.ANTHROPIC_API_KEY,
      detail: process.env.ANTHROPIC_API_KEY ? 'API key (env)' : 'subscription OAuth',
    })),
    check('tmux', 'tmux', async () => {
      // Require the "tmux <version>" banner. A present-but-broken tmux prints
      // "tmux: error while loading shared libraries…" which startsWith('tmux')
      // and would falsely read green (the broken-binary trap).
      const { stdout } = await sh('tmux -V 2>&1 || true');
      return { ok: /^tmux \d/.test(stdout.trim()), detail: stdout.trim() };
    }),
    check('disk', 'Free disk', async () => {
      const { stdout } = await sh("df -h /root | tail -1 | awk '{print $4}'");
      const free = stdout.trim();
      const gb = parseFloat(free);
      return { ok: !(free.endsWith('G') && gb < 5), warn: free.endsWith('G') && gb < 10, detail: `${free} free` };
    }),
    check('sw-no-fetch', 'push SW has no fetch handler', async () => {
      // The stale-SW landmine stays dead only while sw.js never intercepts
      // requests. If this goes red, someone added caching — rip it out.
      const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../web/public/sw.js', import.meta.url), 'utf8'));
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
    check('llama', 'llama-server :8080', async () => {
      try {
        const res = await fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1500) });
        return { ok: res.ok, detail: 'up' };
      } catch {
        return { ok: false, warn: true, detail: 'not running (optional)' };
      }
    }),
  ]);
  return checks;
}

async function check(id, label, fn) {
  try {
    const r = await fn();
    return { id, label, ok: !!r.ok, warn: !!r.warn, detail: r.detail ?? '' };
  } catch (err) {
    return { id, label, ok: false, warn: false, detail: String(err?.message ?? err).slice(0, 100) };
  }
}
