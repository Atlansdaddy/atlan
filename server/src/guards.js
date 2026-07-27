import { resolve, dirname } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { APP_ROOT, PROJECTS_DIR } from './config.js';

// ONE source of truth for filesystem path safety, shared by the code editor
// (files.js) and attachment references (attachments.js).
//
// WHY THIS EXISTS: these two guards were copied and silently DRIFTED — the
// editor's copy lost `.fleet` and `.env`, so with a normal session it could read
// AND overwrite `.fleet/auth.json` (the scrypt password hash), the session store,
// and history, and — paired with the auto-respawning supervisor — rewrite the
// cockpit's own `server/src/auth.js` to execute on the next restart. The editor's
// comment even claimed "credential-shaped paths are refused" while not doing it.
// (Found by a PC code-review pass, 2026-07-23.) Keeping the regex + the guard in
// one place is the structural fix so they can't diverge again.

// Credential/secret-shaped paths refused even inside the project root. Includes
// the agent-CLI auth stores (.copilot/.codex/.grok/.gemini/.claude) — these sit
// under $HOME which is inside PROJECTS_DIR (/root) on the home node, and each
// holds a PLAINTEXT subscription token; without this the editor's /api/file
// would read them straight out over the tunnel. The SDK/CLIs read their own
// stores directly (not via guardPath), so blocking the editor path is safe.
export const SENSITIVE = /(^|\/)\.(ssh|aws|gnupg|gcloud|docker|kube|copilot|codex|grok|gemini|claude)(\/|$)|(^|\/)\.config\/(gh|github-copilot)(\/|$)|(^|\/)(\.auth-token|\.keys\.enc|\.keysecret|\.fleet|\.env|id_rsa|id_ed25519)(\/|$)/;

// SENSITIVE only knows `/` as a separator, so on win32 every credential path
// arrives as `C:\Users\x\.claude\...` and the regex misses it — the guard fails
// OPEN, the one direction a guard must never fail. Normalize a COPY for the
// test; the returned path stays untouched so callers still get a native path.
// (Linux is a no-op: no backslashes to replace.) Exported because guardPath's
// other checks are platform-bound via resolve(), so this is the only handle a
// Linux test run has on the win32 behaviour.
export const isSensitive = (p) => SENSITIVE.test(String(p).replace(/\\/g, '/'));

export function isUnder(p, root) {
  const r = root.endsWith('/') ? root : root + '/';
  return p === root || p.startsWith(r);
}

// Resolve + validate a path.
//   mustExist    — reject if it doesn't exist (reads/lists).
//   blockAppRoot — reject anything under Atlan's OWN repo (APP_ROOT). The editor
//                  sets this: it's a tool for the user's projects, not for editing
//                  the cockpit's own source or state. Defense beyond the regex — a
//                  write to server/src/auth.js would execute on the next supervisor
//                  respawn, so the editor must never be able to reach it.
//   verb         — wording for the credential-refusal message.
export function guardPath(p, { mustExist = true, blockAppRoot = false, verb = 'editable' } = {}) {
  const abs = resolve(String(p || ''));
  if (!isUnder(abs, PROJECTS_DIR)) throw new Error(`path must be under ${PROJECTS_DIR}`);
  if (blockAppRoot && isUnder(abs, APP_ROOT)) {
    throw new Error("Atlan's own files aren't editable here — this editor is for your projects, not the cockpit's source/state");
  }
  if (isSensitive(abs)) throw new Error(`that path looks like credentials/secrets — not ${verb} here`);
  if (mustExist && !existsSync(abs)) throw new Error('no such path');
  // Symlink guard: resolve() doesn't follow links, so realpath the nearest
  // EXISTING ancestor (for a new file that's the parent dir) and re-check it stays
  // in root, isn't the app root, and isn't a secret.
  let anc = abs;
  while (!existsSync(anc) && dirname(anc) !== anc) anc = dirname(anc);
  if (existsSync(anc)) {
    const real = realpathSync(anc);
    if (!isUnder(real, PROJECTS_DIR)) throw new Error('a symlinked path escapes the project root — refused');
    if (blockAppRoot && isUnder(real, APP_ROOT)) throw new Error("a symlinked path resolves into Atlan's own files — refused");
    if (isSensitive(real)) throw new Error('resolves to a credentials/secrets path — refused');
  }
  return abs;
}
