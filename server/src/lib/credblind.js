import { statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// CREDENTIAL BLINDNESS — the bar is not "don't leak", it is "cannot observe".
//
// THE INCIDENT. 2026-08-04: an agent read `.auth-token` out of the app root and
// drove the cockpit's own API with it. Lateral movement inside privileges it
// already held, not escalation — which is exactly why "don't leak" is the wrong
// frame. Nothing leaked. The agent looked, and the credential was there.
//
// WHY scrubbedEnv() IS NOT ENOUGH — and this is measured, not argued:
//   ATLAN_SECRET=x node -e 'delete process.env.ATLAN_SECRET;
//                           fs.readFileSync("/proc/self/environ")'
//   → the secret is STILL THERE. glibc's unsetenv() rewrites the `environ`
//   pointer array; /proc/<pid>/environ reads the original strings on the
//   process stack, which nobody scrubbed. And a sibling process of the same uid
//   can read /proc/<server-pid>/environ directly — also measured, also returns
//   the secret. Cleaning the child's environment does nothing about either.
// So env hygiene is one layer of several, and on its own it is close to
// decorative. The layers that actually hold are in sandbox.js: a PID namespace
// removes /proc/<other-pid> from existence, and a mount mask removes the file.
//
// This module supplies the three things that layer needs and cannot invent:
//   1. WHICH environment variables a child may see  — an ALLOWLIST, not a
//      denylist. A denylist is a list of the credentials someone remembered.
//   2. WHICH paths hold credentials on THIS host    — derived from HOME and the
//      app root, never hardcoded, minus the one vendor store the running engine
//      genuinely needs in order to authenticate at all.
//   3. WHAT must be true before a run starts        — structural preconditions
//      that catch a mask that would not actually mask.

// ── 1. environment ─────────────────────────────────────────────────────────
// ALLOWLIST. The previous shape was `delete` a list of known key names plus a
// regex over the rest, which is a guess about naming: it passes through
// `CLOUDSDK_AUTH_ACCESS_TOKEN` (no trailing _TOKEN boundary... it has one, but
// `AZURE_CLIENT_SECRET_ID` and `NPM_CONFIG__AUTH` do not), and it passes through
// every future provider whose variable nobody thought to add. Inverting it means
// a new provider's key is invisible by default and becomes visible only when
// someone writes it down here on purpose.
//
// HOME and PATH stay. That is a deliberate, load-bearing hole: the vendor CLIs
// authenticate from their own on-disk store under $HOME, and a subscription
// login is the whole reason Atlan can run an agent without an API key. The
// consequence — the running engine can read its OWN auth store — is not fixed
// here and is not claimed to be. It is narrowed in section 2 (every OTHER
// vendor's store is masked) and stated plainly in SECURITY-SPINE-REPORT.md.
export const ENV_ALLOW = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'TMPDIR',
  'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'TZ',
  'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
];
// NODE_OPTIONS is deliberately absent: `NODE_OPTIONS=--require=/tmp/x.js` is
// arbitrary code execution in every node-based CLI we launch. It is not a
// credential, so a credential denylist would have passed it straight through.

// Build a child environment containing ONLY what is allowed, plus exactly the
// grants the caller names. `grant` is how an engine gets its OWN key and no
// other: codex gets no XAI_API_KEY, grok gets no ANTHROPIC_API_KEY, and neither
// of them gets ATLAN_TOKEN — which is the credential the 2026-08-04 incident
// actually used.
export function childEnv(base = process.env, { grant = {}, extraAllow = [] } = {}) {
  const allow = new Set([...ENV_ALLOW, ...extraAllow]);
  const env = {};
  for (const k of allow) if (base[k] !== undefined) env[k] = base[k];
  for (const [k, v] of Object.entries(grant)) if (v != null && v !== '') env[k] = String(v);
  // Shell history is a credential vector in its own right: a `curl -H
  // "Authorization: …"` typed once lives in ~/.bash_history for every later
  // run to read. Pointed at /dev/null rather than left to the default.
  env.HISTFILE = '/dev/null';
  env.LESSHISTFILE = '/dev/null';
  return env;
}

// ── 2. where credentials live on THIS host ────────────────────────────────
// Every path is derived from HOME and the caller's app root. There is no
// literal `/root`, no username, no operator hostname — a fork, a phone with
// HOME=/data/data/com.termux/files/home, and a CI box all produce their own.
//
// Vendor auth stores are listed with the engine that owns them, so `keepFor`
// can subtract exactly one and mask the rest. This is the answer to "HOME is
// deliberately preserved, which is exactly why this is hard": HOME stays, but
// the only credential store reachable inside it is the one the running engine
// must have to authenticate.
export const VENDOR_STORES = {
  claude: ['.claude', '.claude.json'],
  codex: ['.codex'],
  grok: ['.grok'],
  antigravity: ['.gemini', '.config/antigravity'],
  copilot: ['.copilot', '.config/github-copilot'],
};

// Credential stores that belong to no agent engine and that no engine needs.
const HOME_SECRETS = [
  '.ssh', '.aws', '.gnupg', '.gcloud', '.docker', '.kube', '.azure',
  '.netrc', '.git-credentials', '.npmrc', '.pypirc', '.cargo/credentials.toml',
  '.config/gh', '.config/hub', '.config/gcloud', '.config/op',
  // History files are read straight back as text; a private /tmp does not cover
  // them because they live in HOME.
  '.bash_history', '.zsh_history', '.sh_history', '.python_history', '.node_repl_history',
];

// The cockpit's own state. `.auth-token` is first on this list by name: it is
// the file the 2026-08-04 incident read.
const APP_SECRETS = ['.auth-token', '.keys.enc', '.keysecret', '.env', '.env.local', '.fleet', '.npmrc'];

export function credentialTargets({ appRoot, home = homedir(), keepFor = null } = {}) {
  const out = [];
  if (appRoot) for (const f of APP_SECRETS) out.push(join(appRoot, f));
  for (const f of HOME_SECRETS) out.push(join(home, f));
  for (const [engine, dirs] of Object.entries(VENDOR_STORES)) {
    if (engine === keepFor) continue;
    for (const d of dirs) out.push(join(home, d));
  }
  return out;
}

// ── 3. preconditions the mask depends on ──────────────────────────────────
// A bind mask is attached to a PATH. It hides every way of SPELLING that path —
// `..`, a symlink, a unicode homograph, a case variant, a race — because the
// kernel resolves all of them to the same mount. What it does not hide is a
// SECOND directory entry for the same inode: a hardlink created earlier, from
// somewhere the mask does not cover.
//
// MEASURED: with `mount --bind /dev/null <cred>` in force, reading <cred>
// returns empty and reading a pre-existing hardlink to it returns the secret.
//
// A hardlink is detectable, cheaply and structurally — st_nlink on a credential
// file is 1 unless someone made another name for it. So this is checked before
// a run starts, and a planted link is a refusal rather than a silent bypass.
// This is a fact about the inode, not a pattern match on a filename.
export function credentialPreflight(targets) {
  const problems = [];
  for (const p of targets) {
    let st;
    try { st = statSync(p); } catch { continue; } // absent: nothing to hide
    if (st.isFile() && st.nlink > 1) {
      problems.push({ path: p, kind: 'hardlinked', detail: `st_nlink=${st.nlink} — another name for this inode exists, and a path mask cannot cover it` });
    }
    if (st.isFile() && (st.mode & 0o077)) {
      problems.push({ path: p, kind: 'permissive-mode', detail: `mode ${(st.mode & 0o777).toString(8)} — readable beyond the owner` });
    }
  }
  return problems;
}

// ── 4. indirect readback ──────────────────────────────────────────────────
// Even blind, an agent's next turn is auto-fed tool results, log lines, error
// messages and the preview console. If the COCKPIT ever prints a secret into
// one of those, the agent reads it without ever having looked at a file.
//
// This redacts by EXACT VALUE, not by pattern. We hold the real bytes, so we
// can remove exactly those bytes; there is no key shape to guess and no
// encoding of an unknown secret to fail to match. Values shorter than 8 bytes
// are ignored — redacting a 3-character string would shred ordinary text and
// teach people to turn the redactor off.
//
// HONEST LIMIT: this catches the VERBATIM form only. A secret the child
// base64s, reverses, or splits across two lines passes through, and no
// value-matching redactor can fix that. It is a backstop behind blindness, not
// a substitute for it — if the agent could read the secret at all, this is
// already the wrong layer to be relying on.
export function redactor(values = []) {
  const secrets = [...new Set(values.filter((v) => typeof v === 'string' && v.length >= 8))]
    .sort((a, b) => b.length - a.length); // longest first: a key containing a shorter one still fully redacts
  if (!secrets.length) return (s) => String(s ?? '');
  return (s) => {
    let out = String(s ?? '');
    for (const v of secrets) out = out.split(v).join('[redacted-credential]');
    return out;
  };
}
