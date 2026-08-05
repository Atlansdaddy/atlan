// previewurl.mjs — where the preview iframe points, and when it honestly can't.
//
// This decision was three hardcoded literals in app.js and it made the preview
// pane structurally impossible on a phone: an http frame in an https page is
// blocked as mixed content, and the workaround baked one operator's tailscale
// port and hostname into shared code. Every case below is a real failure that
// shipped, so none of them are hypothetical.

import assert from 'node:assert';
import { previewUrl } from '../web/public/lib/previewurl.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
};

test('plain loopback uses the configured http port', () => {
  const r = previewUrl({ protocol: 'http:', hostname: '127.0.0.1', port: 4590, tlsPort: 0 });
  assert.equal(r.url, 'http://127.0.0.1:4590/');
  assert.equal(r.origin, 'http://127.0.0.1:4590');
  assert.equal(r.why, null);
});

test('a non-default preview port is honoured, not ignored', () => {
  // The client used to hardcode 4590, so ATLAN_PREVIEW_PORT silently killed
  // console capture and snapshots for anyone who set it.
  const r = previewUrl({ protocol: 'http:', hostname: '127.0.0.1', port: 7777, tlsPort: 0 });
  assert.equal(r.url, 'http://127.0.0.1:7777/');
});

test('https WITH a TLS front door uses it, and matches scheme', () => {
  const r = previewUrl({ protocol: 'https:', hostname: 'box.tailnet.ts.net', port: 4590, tlsPort: 4591 });
  assert.equal(r.url, 'https://box.tailnet.ts.net:4591/');
  assert.ok(r.url.startsWith('https:'), 'an http frame in an https page is blocked as mixed content');
  assert.equal(r.why, null);
});

test('https WITHOUT a front door refuses to guess, and says what to do', () => {
  // The old code guessed 4591 — right for exactly one machine on earth.
  const r = previewUrl({ protocol: 'https:', hostname: 'box.tailnet.ts.net', port: 4590, tlsPort: 0 });
  assert.equal(r.url, null, 'guessing a port here is what hardcoded one operator into the build');
  assert.match(r.why, /ATLAN_PREVIEW_TLS_PORT/, 'the message must name the setting that fixes it');
  assert.match(r.why, /tailscale serve/, 'and the command that creates it');
});

test('the origin always derives from the url, never a second literal', () => {
  // postMessage is origin-pinned both ways. A listener aimed at a different
  // origin than the frame drops every console line and snapshot, silently.
  for (const c of [
    { protocol: 'http:', hostname: 'localhost', port: 4590, tlsPort: 0 },
    { protocol: 'https:', hostname: 'box.tailnet.ts.net', port: 4590, tlsPort: 4591 },
    { protocol: 'http:', hostname: '127.0.0.1', port: 9999, tlsPort: 4591 },
  ]) {
    const r = previewUrl(c);
    assert.equal(r.origin, new URL(r.url).origin, `origin must match ${r.url}`);
  }
});

test('a hostname is never assumed — it comes from the page', () => {
  const r = previewUrl({ protocol: 'https:', hostname: 'someone-else.tailnet.ts.net', port: 4590, tlsPort: 4591 });
  assert.ok(r.url.includes('someone-else.tailnet.ts.net'));
  assert.ok(!/johnpc|tail7538c0/.test(r.url), 'no operator hostname may survive in this path');
});

test('a missing port falls back rather than producing "undefined" in a url', () => {
  const r = previewUrl({ protocol: 'http:', hostname: '127.0.0.1' });
  assert.ok(!r.url.includes('undefined'), `built a broken url: ${r.url}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
