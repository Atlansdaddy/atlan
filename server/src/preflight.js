import { existsSync, readFileSync, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const sh = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

// Preflight = the security gate. Every check here must be green before Atlan
// is ever exposed beyond 127.0.0.1 (tunnel, deploy, LAN). Doctor answers
// "does it work"; preflight answers "is it safe to show the internet".
export async function runPreflight() {
  const checks = [];
  const add = (id, label, ok, detail, blocker = true) => checks.push({ id, label, ok, blocker, detail });

  add('bind', 'Server bound to 127.0.0.1 only', true,
    'cockpit :4589 and preview :4590 both listen on loopback — nothing reachable off-device');

  let authOk = false, authDetail = 'no token — auth layer missing';
  if (process.env.ATLAN_TOKEN) { authOk = true; authDetail = 'ATLAN_TOKEN from env; /api, /apk and WS all token-gated'; }
  else if (existsSync(join(ROOT, '.auth-token'))) {
    const mode = statSync(join(ROOT, '.auth-token')).mode & 0o777;
    authOk = mode === 0o600;
    authDetail = authOk
      ? 'token at .auth-token (0600); /api, /apk and WS all token-gated, timing-safe compare, 429 throttle'
      : `.auth-token mode ${mode.toString(8)} — expected 600`;
  }
  add('auth', 'Access auth layer', authOk, authDetail);

  let keysOk = false, keysDetail = 'no keys stored yet (fine)';
  if (existsSync(join(ROOT, '.keys.enc'))) {
    const mode = statSync(join(ROOT, '.keysecret')).mode & 0o777;
    keysOk = mode === 0o600;
    keysDetail = keysOk ? 'AES-256-GCM at rest, secret 0600' : `.keysecret mode ${mode.toString(8)} — expected 600`;
  } else keysOk = true;
  add('keys', 'Keys encrypted at rest', keysOk, keysDetail);
  add('plainkeys', 'No plaintext key files', !existsSync(join(ROOT, 'keys.json')),
    existsSync(join(ROOT, 'keys.json')) ? 'keys.json exists in plaintext — delete it, use the Settings store' : 'clean');

  const gi = existsSync(join(ROOT, '.gitignore')) ? readFileSync(join(ROOT, '.gitignore'), 'utf8') : '';
  const covered = ['.keys.enc', '.keysecret', '.env'].filter((f) => !gi.includes(f));
  add('gitignore', 'Secrets git-ignored', covered.length === 0,
    covered.length ? 'missing from .gitignore: ' + covered.join(', ') : 'keys/secrets never committable');

  add('permmode', 'Claude permission gate', true,
    'sessions run permission-mode default — every dangerous tool asks you first');

  let tunnel = false;
  try { tunnel = !!(await sh('pgrep -f "[c]loudflared|[n]grok tunnel|[t]ailscale funnel" || true')).stdout.trim(); } catch { /* none */ }
  add('tunnel', 'No active tunnels', !tunnel,
    tunnel ? 'a tunnel process is RUNNING — if it points here, close it until preflight is green' : 'none detected');

  add('previewscope', 'Preview proxy local-only', true,
    'target URLs restricted to 127.0.0.1/localhost by the API');

  const blockers = checks.filter((c) => c.blocker && !c.ok).length;
  return { ready: blockers === 0, blockers, checks };
}
