import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';

const sh = promisify(exec);

// EVERY proot-boundary assumption lives here and nowhere else.
// When a Termux/Android update breaks something, this file names it.
export async function runDoctor() {
  const checks = await Promise.all([
    check('jdk', 'JDK 21', async () => {
      const { stderr, stdout } = await sh('java -version 2>&1 || true');
      const out = stdout + stderr;
      return { ok: /21\./.test(out), detail: out.split('\n')[0] };
    }),
    check('sdk', 'Android SDK 35', async () => ({
      ok: existsSync('/root/android-sdk/build-tools/35.0.0'),
      detail: '/root/android-sdk',
    })),
    check('aapt2', 'aapt2 qemu shim', async () => {
      const shim = '/root/android-sdk/build-tools/35.0.0/aapt2';
      if (!existsSync(shim)) return { ok: false, detail: 'shim missing' };
      const { stdout } = await sh(`${shim} version 2>&1 || true`, { timeout: 20000 });
      return { ok: /Android Asset Packaging/i.test(stdout) || /aapt2/i.test(stdout), detail: stdout.trim().slice(0, 80) };
    }),
    check('claude', 'claude binary', async () => {
      const { stdout } = await sh('which claude && claude --version 2>/dev/null | head -1 || true');
      return { ok: stdout.includes('claude'), detail: stdout.trim().replace('\n', ' · ') };
    }),
    check('auth', 'Claude auth', async () => ({
      ok: existsSync(`${process.env.HOME}/.claude/.credentials.json`) || !!process.env.ANTHROPIC_API_KEY,
      detail: process.env.ANTHROPIC_API_KEY ? 'API key (env)' : 'subscription OAuth',
    })),
    check('tmux', 'tmux', async () => {
      const { stdout } = await sh('tmux -V 2>&1 || true');
      return { ok: stdout.startsWith('tmux'), detail: stdout.trim() };
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
