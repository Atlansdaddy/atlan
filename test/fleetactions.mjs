// fleetactions.mjs — the fleet buttons that spend money or stop work.
//
// These were unreachable from Node until the handlers came out of app.js: both
// were bare fetch() calls wired straight into addEventListener, so the only way
// to exercise "what happens when the kill 500s" was to drive a browser and hope.
//
// Two properties matter more than the happy paths, and neither had any coverage:
//   1. Top-up disarms BEFORE the request, so a second tap cannot land in the gap.
//   2. NOTHING here fails silently. A kill that did not land must say so.

import assert from 'node:assert';

import { topUp, sendKill, TOPUP_LABEL, TOPUP_BUSY } from '../web/public/lib/fleetactions.js';

let pass = 0, fail = 0;
const test = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
};

/** A button stand-in — the two properties the guard actually touches. */
const button = () => ({ disabled: false, textContent: TOPUP_LABEL });

/** Records every error the user would have seen, and every request sent. */
function io({ reply = { id: 'new-run' }, ok = true, status = 200, boom = false } = {}) {
  const o = {
    errors: [], sent: [],
    onError: (m) => o.errors.push(m),
    fetchFn: async (url, opts) => {
      o.sent.push({ url, body: JSON.parse(opts.body) });
      if (boom) throw new Error('ECONNREFUSED');
      return { ok, status, json: async () => reply };
    },
  };
  return o;
}

console.log('\ntopUp');
await test('disarms the button BEFORE the request, not after the reply', async () => {
  const btn = button();
  const o = io();
  // Capture the button state from inside the request — the exact window a
  // second tap would land in.
  let armedDuringFlight = null;
  const inner = o.fetchFn;
  o.fetchFn = async (...a) => { armedDuringFlight = !btn.disabled; return inner(...a); };
  await topUp('run-1', btn, o);
  assert.equal(armedDuringFlight, false, 'the button was still live while the top-up was in flight');
});

await test('a successful top-up leaves the button disarmed', async () => {
  const btn = button();
  const o = io();
  const r = await topUp('run-1', btn, o);
  assert.deepEqual(r, { id: 'new-run' });
  assert.equal(btn.disabled, true, 're-arming after success is the double-spend');
  assert.deepEqual(o.errors, [], 'a clean top-up must not report an error');
});

await test('posts the run id and a real budget', async () => {
  const o = io();
  await topUp('run-halt', button(), o);
  assert.equal(o.sent[0].url, '/api/fleet/topup');
  assert.equal(o.sent[0].body.id, 'run-halt');
  assert.ok(o.sent[0].body.extra > 0, 'top-up must carry the extra budget');
});

await test('a REFUSED top-up re-arms so the user can retry', async () => {
  const btn = button();
  const o = io({ reply: { error: 'run is not resumable' } });
  assert.equal(await topUp('run-1', btn, o), null);
  assert.deepEqual(o.errors, ['run is not resumable']);
  assert.equal(btn.disabled, false, 'nothing was spent, so the button must come back');
  assert.equal(btn.textContent, TOPUP_LABEL, 'the button is stuck on its busy label');
});

await test('an unreachable server re-arms and says so', async () => {
  const btn = button();
  const o = io({ boom: true });
  assert.equal(await topUp('run-1', btn, o), null);
  assert.match(o.errors[0] ?? '', /unreachable/i);
  assert.equal(btn.disabled, false);
});

await test('works with no button at all (keyboard / programmatic path)', async () => {
  const o = io();
  assert.doesNotThrow(() => topUp('run-1', null, o));
  assert.deepEqual(await topUp('run-1', undefined, o), { id: 'new-run' });
});

await test('the busy label is not the idle label', () => {
  assert.notEqual(TOPUP_BUSY, TOPUP_LABEL, 'the user must be able to see the difference');
});

console.log('\nsendKill');
await test('a successful kill posts the id and reports nothing', async () => {
  const o = io({ reply: { killed: 2 } });
  assert.deepEqual(await sendKill('all', o), { killed: 2 });
  assert.equal(o.sent[0].url, '/api/fleet/kill');
  assert.equal(o.sent[0].body.id, 'all');
  assert.deepEqual(o.errors, []);
});

await test('a KILL ALL that 500s tells the user the fleet may still be running', async () => {
  const o = io({ ok: false, status: 500, reply: { error: 'kill failed' } });
  assert.equal(await sendKill('all', o), null);
  assert.equal(o.errors.length, 1, 'a dead kill must not look like a successful one');
  assert.match(o.errors[0], /KILL ALL/);
  assert.match(o.errors[0], /still be running/, 'the user needs to know the fleet did not stop');
});

await test('a per-run kill that fails names the run', async () => {
  const o = io({ ok: false, status: 500, reply: { error: 'nope' } });
  assert.equal(await sendKill('run-7', o), null);
  assert.match(o.errors[0] ?? '', /run-7/);
});

await test('a 200 carrying an error body is still a failure', async () => {
  // The server answers 200 with {error} on some paths. Checking only res.ok
  // would read that as a successful kill.
  const o = io({ ok: true, status: 200, reply: { error: 'no such run' } });
  assert.equal(await sendKill('run-7', o), null);
  assert.match(o.errors[0] ?? '', /no such run/);
});

await test('an unreachable server on kill is reported, never swallowed', async () => {
  const o = io({ boom: true });
  assert.equal(await sendKill('all', o), null);
  assert.match(o.errors[0] ?? '', /unreachable/i);
  assert.match(o.errors[0] ?? '', /still be running/);
});

await test('a non-JSON body does not crash the kill path', async () => {
  const o = io();
  o.fetchFn = async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
  assert.doesNotReject(() => sendKill('all', o));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
