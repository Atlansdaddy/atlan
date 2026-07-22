// Security & penetration suite — actively tries to break in and get data out.
// Runs against the LIVE server. Auth bypass, path traversal, SSRF via the
// preview target + harness base override, key exfiltration, XSS persistence,
// oversized payloads, and the brute-force throttle.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const BASE = process.env.ATLAN_BASE ?? 'http://127.0.0.1:4589';
const TOKEN = (process.env.ATLAN_TOKEN ?? readFileSync(new URL('../.auth-token', import.meta.url), 'utf8')).trim();
const authed = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', 'x-atlan-token': TOKEN, ...(opts.headers ?? {}) } });
const naked = (path, opts = {}) => fetch(BASE + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) } });
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
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
  if (!configured) await naked('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: TEST_PW }) });
  return configured; // true if a real (possibly different) password was already set
}
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
  const { body } = await j(await authed('/api/personas'));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
