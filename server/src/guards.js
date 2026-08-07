import { resolve, dirname, relative, isAbsolute } from 'node:path';
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
//
// MATCH FAMILIES, NOT LITERALS. The previous form listed exact filenames, so
// the third alternative matched only a bare `.env` — `.env.local`,
// `.env.production` and `.env.development.local` were fully readable AND
// writable through /api/file, and referenceable into a chat turn through
// /api/attach/ref. Those are the files the Next/Vite/CRA conventions put REAL
// untracked deploy secrets in; a bare `.env` is the one people commit by
// mistake. Same shape for keys: only id_rsa/id_ed25519 were listed, so
// id_ecdsa and id_dsa walked straight through. A fixed list cannot be complete,
// and an incomplete credential guard fails OPEN — the one direction a guard
// must never fail. Every alternative below is now a FAMILY.
// (Cross-vendor adversarial review, 2026-08-06.)
export const SENSITIVE = new RegExp([
  // credential STORES — whole directories whose contents are all secret
  '(^|/)\\.(ssh|aws|gnupg|gcloud|docker|kube|copilot|codex|grok|gemini|claude)(/|$)',
  '(^|/)\\.config/(gh|github-copilot|gcloud)(/|$)',
  // Atlan's own secrets + state
  '(^|/)(\\.auth-token|\\.keys\\.enc|\\.keysecret|\\.fleet)(/|$)',
  // the .env FAMILY — `.env`, `.env.local`, `.env.production`, `.env.a.b` …
  // EXCEPT the suffixes that exist precisely to be committed and shared, which
  // a user has every reason to open in the editor. `.environment` is not an env
  // file and the trailing (/|$) keeps it out.
  '(^|/)\\.env(?!\\.(example|sample|template|defaults?|dist)(/|$))(\\.[^/]*)?(/|$)',
  // SSH private keys. Enumerated by KEY TYPE (the complete set ssh-keygen
  // emits) rather than by filename, so id_ecdsa/id_dsa can't be forgotten
  // again — and narrow enough that a project directory called `id_generator`
  // is not swept up. `id_rsa.pub` is the public half and stays readable.
  '(^|/)id_(rsa|dsa|ecdsa|ed25519)(_sk)?(/|$)',
  // credential-shaped filenames, wherever they sit
  '(^|/)(\\.npmrc|\\.netrc|_netrc|\\.pgpass|\\.htpasswd|\\.pypirc|\\.dockercfg|\\.git-credentials|credentials\\.json|secrets\\.(json|ya?ml))(/|$)',
  // private-key material by EXTENSION — the only signal a file like
  // `deploy-prod.pem` or `service.key` gives before you have read it
  '(^|/)[^/]*\\.(pem|key|p12|pfx|jks|keystore)(/|$)',
].join('|'), 'i');

// SENSITIVE only knows `/` as a separator, so on win32 every credential path
// arrives as `C:\Users\x\.claude\...` and the regex misses it — the guard fails
// OPEN, the one direction a guard must never fail. Normalize a COPY for the
// test; the returned path stays untouched so callers still get a native path.
// (Linux is a no-op: no backslashes to replace.) Exported because guardPath's
// other checks are platform-bound via resolve(), so this is the only handle a
// Linux test run has on the win32 behaviour.
export const isSensitive = (p) => SENSITIVE.test(String(p).replace(/\\/g, '/'));

// Separator-agnostic containment test. The old `root + '/'` prefix check knew
// only POSIX separators, so on win32 (`C:\Users\x\proj`) every legitimate path
// missed the prefix and the guard failed CLOSED — safe, but the editor, tree,
// attachments and git were all dead there. path.relative() speaks the host's
// separators (and win32 drive-letter case) natively: inside ⇢ a plain relative
// path; outside ⇢ starts with '..' or stays absolute (a different drive).
export function isUnder(p, root) {
  const a = resolve(String(p)), r = resolve(String(root));
  if (a === r) return true;
  const rel = relative(r, a);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

// CONTAINMENT, on its own. Resolve a path and prove it stays inside the sandbox
// — including through symlinks, which resolve() does not follow.
//
// Split out from guardPath because containment and the credential DENYLIST are
// two different questions, and one caller legitimately needs the first without
// the second: /api/scan is a secret SCANNER, so refusing to look at `.env` would
// disable the probe the user is asking for. That endpoint had been wired to a
// bare isUnder() with no realpath at all, which made a single symlink anywhere
// under the projects root a read oracle for the whole filesystem. Giving it the
// real containment check — rather than letting it keep its own weaker copy — is
// what stops that drifting again. Everything else goes through guardPath below.
//
//   mustExist    — reject if it doesn't exist (reads/lists).
//   blockAppRoot — reject anything under Atlan's OWN repo (APP_ROOT). The editor
//                  sets this: it's a tool for the user's projects, not for editing
//                  the cockpit's own source or state. Defense beyond the regex — a
//                  write to server/src/auth.js would execute on the next supervisor
//                  respawn, so the editor must never be able to reach it.
//   credentials  — 'refuse' (default) applies the SENSITIVE denylist; 'allow'
//                  skips it. ONE caller passes 'allow' and its reason is above.
//                  Note the ORDER: the credential refusal fires BEFORE the
//                  existence check, so asking for a credential path that isn't
//                  there gets "looks like credentials", not "no such path" —
//                  the guard must not answer an existence question about a file
//                  it would never have served anyway.
//   verb         — wording for the credential-refusal message.
export function resolveInProjects(p, { mustExist = true, blockAppRoot = false, credentials = 'refuse', verb = 'editable' } = {}) {
  const abs = resolve(String(p || ''));
  if (!isUnder(abs, PROJECTS_DIR)) throw new Error(`path must be under ${PROJECTS_DIR}`);
  if (blockAppRoot && isUnder(abs, APP_ROOT)) {
    throw new Error("Atlan's own files aren't editable here — this editor is for your projects, not the cockpit's source/state");
  }
  if (credentials === 'refuse' && isSensitive(abs)) throw new Error(`that path looks like credentials/secrets — not ${verb} here`);
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
    if (credentials === 'refuse' && isSensitive(real)) throw new Error('resolves to a credentials/secrets path — refused');
  }
  return abs;
}

// Containment + the credential denylist — the default, and what every
// path-accepting endpoint that hands file CONTENT to a human or a model uses.
export function guardPath(p, opts = {}) {
  return resolveInProjects(p, { ...opts, credentials: 'refuse' });
}
