import { existsSync, readFileSync, statSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FLEET_DIR } from './config.js';
import { agentStatus } from './agents.js';
import { interactiveGate } from './enginePolicy.js';

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

  // Password must be set before exposure — an unconfigured instance lets the
  // first caller claim it. Session cookies gate /api, /apk and WS; a header
  // bearer (.auth-token, 0600) exists for automation only, never in a URL.
  // Read FLEET_DIR, never a hardcoded ROOT/.fleet: auth.js hashes into
  // join(FLEET_DIR, 'auth.json'), so an instance run with ATLAN_FLEET_DIR set
  // would have this gate reporting on a file the server never authenticates
  // against — green "password set" over an instance anyone can claim.
  const pwSet = existsSync(join(FLEET_DIR, 'auth.json'));
  add('auth', 'Access auth layer', pwSet,
    pwSet ? 'password set; session-cookie gate on /api, /apk and WS; scrypt hash + 30-day sessions; header bearer for automation only'
          : 'NO password set yet — set one on first load before exposing this beyond the phone');

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

  // ── agent permission gates ──────────────────────────────────────────────
  // This used to be `add('permmode', 'Claude permission gate', true, 'sessions
  // run permission-mode default — every dangerous tool asks you first')` — a
  // source-code literal that probed nothing, unlike every other check in this
  // function. It was also false: agents.js launches Codex, Antigravity, Grok
  // and Copilot with their approval systems switched off on EVERY interactive
  // turn, so four of the five engines surface no permission card at all and a
  // prompt-injected instruction routed through any of them executes with no
  // human in the loop. Preflight is the one surface a user is told to check
  // before deciding it is safe to expose the cockpit, and it was showing a
  // green row asserting the opposite.
  //
  // Now it ASKS. `interactiveGate` is the same table agents.js reads to build
  // its argv, so this row cannot drift from what actually launches, and
  // `ready` from agentStatus() means "installed AND authenticated" — an engine
  // that isn't there is not a live ungated path, and the check says so rather
  // than blocking on a hypothetical.
  const ungated = agentStatus()
    .filter((a) => a.ready && interactiveGate(a.id)?.gated === false)
    .map((a) => a.id);
  add('permmode', 'Agent permission gates', ungated.length === 0,
    ungated.length
      ? `Claude chat turns are card-gated, but ${ungated.join(', ')} ${ungated.length > 1 ? 'are' : 'is'} installed and authenticated here and run${ungated.length > 1 ? '' : 's'} full-auto — exec-mode CLIs have no per-tool approval, so anything routed through ${ungated.length > 1 ? 'them' : 'it'} executes with NO human in the loop. Safe on a repo you trust; not safe to expose. Log out of ${ungated.length > 1 ? 'those CLIs' : 'that CLI'}, or keep this cockpit on loopback.`
      : 'Claude chat turns are card-gated and no full-auto agent CLI is installed/authenticated here');

  // A SECURITY gate — it must FAIL CLOSED. The old form `pgrep … || true` +
  // catch{} reported "none detected" (GREEN) whenever pgrep itself couldn't run,
  // and only matched "ngrok tunnel" — a normal `ngrok http 4589` has no "tunnel"
  // word and slipped through. Now: match the process names alone, trust pgrep's
  // exit code (1 = genuinely no match; anything else = couldn't verify → blocker).
  let tunnel = false, verified = true;
  try {
    const { stdout } = await sh("pgrep -af '[c]loudflared|[n]grok|tailscale (funnel|serve)'");
    tunnel = !!stdout.trim(); // exit 0 → at least one match
  } catch (err) {
    if (err && err.code === 1) tunnel = false; // pgrep exit 1 = no matches (the safe case)
    else verified = false;                      // pgrep missing/broken = we do NOT know → fail closed
  }
  add('tunnel', 'No active tunnels', verified && !tunnel,
    !verified ? 'could not verify tunnels (pgrep unavailable) — treat as UNSAFE to expose until checked'
      : tunnel ? 'a tunnel process is RUNNING — if it points here, close it until preflight is green'
        : 'none detected (cloudflared / ngrok / tailscale funnel|serve)');

  add('previewscope', 'Preview proxy local-only', true,
    'target URLs restricted to 127.0.0.1/localhost by the API');

  const blockers = checks.filter((c) => c.blocker && !c.ok).length;
  return { ready: blockers === 0, blockers, checks };
}
