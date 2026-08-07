// vision.mjs — brains can receive images, and fail honestly when they cannot.
//
// Closes docs/DOGFOOD-FINDINGS-2026-07-26.md "OPEN — brains cannot receive
// images at all". The old behaviour was the dangerous kind of broken: the turn
// SUCCEEDED, the model answered, and the answer was a guess, because the image
// travelled as a filesystem path a chat-only model cannot open. Nothing failed,
// so nothing surfaced.
//
// Written per GROUNDING.md §2 in BOTH directions:
//   - no assertion may pass because the feature is absent
//   - no assertion may fail because of how it measures (the vacuous FAILURE
//     found on 2026-08-02) — so the file-reading tests inject fakes rather than
//     depending on fixture bytes existing on disk.

import assert from 'node:assert';
import {
  IMAGE_MIME, VISION_PROVIDERS, MAX_IMAGE_BYTES,
  isImagePath, providerDoesVision, imageToDataUrl,
  attachImagesToHistory, buildImageParts,
} from '../server/src/vision.js';

let pass = 0, fail = 0;
// Awaits the body so a test can exercise an async path — brainChat's refusal
// returns before any fetch, so calling it for real costs nothing. Sync tests are
// unaffected: awaiting a non-promise is a no-op.
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('VISION SUITE');

// Injected fakes: these tests are about the SHAPE we send, not about whether a
// PNG exists in the repo. A test that needs a fixture on disk fails for the
// wrong reason when the fixture moves.
const fakeDeps = (bytes, size) => ({
  readFile: () => Buffer.from(bytes),
  stat: () => ({ size: size ?? bytes.length }),
});

// ── path/type recognition ──────────────────────────────────────────────────
test('isImagePath accepts the formats we can inline, case-insensitively', () => {
  for (const p of ['/a/b.png', '/a/b.JPG', 'c.jpeg', 'd.WebP', 'e.gif', 'f.bmp']) {
    assert.equal(isImagePath(p), true, p);
  }
});

test('isImagePath rejects non-images and junk input', () => {
  for (const p of ['/a/b.pdf', '/a/b.mp4', '/a/b', '', null, undefined, '/a/.png.txt']) {
    assert.equal(isImagePath(p), false, String(p));
  }
});

test('isImagePath cannot be tricked by prototype keys', () => {
  // extname('x.constructor') === '.constructor'; a bare `in`/index lookup would
  // return truthy. Same class as the langToExt bug found earlier today.
  assert.equal(isImagePath('x.constructor'), false);
  assert.equal(isImagePath('x.toString'), false);
});

test('every IMAGE_MIME value is a real image MIME type', () => {
  for (const [ext, mime] of Object.entries(IMAGE_MIME)) {
    assert.match(ext, /^\.[a-z]+$/, `${ext} should be a lowercase dotted extension`);
    assert.match(mime, /^image\/[a-z+]+$/, `${ext} → ${mime}`);
  }
});

// ── provider capability honesty ────────────────────────────────────────────
test('providerDoesVision is true for vision providers, false otherwise', () => {
  assert.equal(providerDoesVision('gemini'), true);
  assert.equal(providerDoesVision('openai'), true);
  // NOT vacuous: if the set were empty this line would fail, not pass.
  assert.ok(VISION_PROVIDERS.size >= 2, 'the vision set must not be empty');
});

test('providerDoesVision is false for text-only brains and junk', () => {
  for (const p of ['local', 'deepseek', 'cohere', 'groq', 'kimi', '', null, undefined, 'nonsense']) {
    assert.equal(providerDoesVision(p), false, String(p));
  }
});

test('local llama-server is NOT claimed as vision-capable', () => {
  // The on-phone free tier is the one most likely to be picked by default, and
  // claiming vision it does not have would produce a provider-side error the
  // user cannot act on. Conservative by design.
  assert.equal(providerDoesVision('local'), false);
});

// ── data URL construction ──────────────────────────────────────────────────
test('imageToDataUrl builds a correct data: URL with the right MIME', () => {
  const url = imageToDataUrl('/x/pic.png', fakeDeps([1, 2, 3]));
  assert.ok(url.startsWith('data:image/png;base64,'), url.slice(0, 40));
  assert.equal(url.split(',')[1], Buffer.from([1, 2, 3]).toString('base64'));
});

test('imageToDataUrl picks MIME from the extension, not the content', () => {
  assert.ok(imageToDataUrl('/x/a.jpg', fakeDeps([9])).startsWith('data:image/jpeg;'));
  assert.ok(imageToDataUrl('/x/a.JPEG', fakeDeps([9])).startsWith('data:image/jpeg;'));
  assert.ok(imageToDataUrl('/x/a.webp', fakeDeps([9])).startsWith('data:image/webp;'));
});

test('imageToDataUrl refuses a non-image, and names what IS allowed', () => {
  assert.throws(
    () => imageToDataUrl('/x/doc.pdf', fakeDeps([1])),
    (e) => /not an inlineable image/i.test(e.message) && /\.png/.test(e.message),
    'the error must tell the user which formats work',
  );
});

test('imageToDataUrl refuses an oversized image with the real size', () => {
  assert.throws(
    () => imageToDataUrl('/x/big.png', fakeDeps([1], MAX_IMAGE_BYTES + 1)),
    (e) => /over the/i.test(e.message) && /MB/.test(e.message),
  );
});

test('imageToDataUrl accepts an image exactly at the limit', () => {
  assert.doesNotThrow(() => imageToDataUrl('/x/edge.png', fakeDeps([1], MAX_IMAGE_BYTES)));
});

test('imageToDataUrl refuses an empty file rather than sending an empty image', () => {
  assert.throws(() => imageToDataUrl('/x/empty.png', fakeDeps([], 0)), /empty/i);
});

// ── history attachment ─────────────────────────────────────────────────────
const IMG = [{ url: 'data:image/png;base64,AAA', name: 'a.png' }];

test('attachImagesToHistory converts the last user message to a content array', () => {
  const h = [{ role: 'user', content: 'what is this?' }];
  const out = attachImagesToHistory(h, IMG);
  assert.ok(Array.isArray(out[0].content));
  assert.deepEqual(out[0].content[0], { type: 'text', text: 'what is this?' });
  assert.equal(out[0].content[1].type, 'image_url');
  assert.equal(out[0].content[1].image_url.url, IMG[0].url);
});

test('attachImagesToHistory NEVER mutates the caller history', () => {
  // The same history object is reused across retries; mutating it would double
  // the attachments on the second attempt.
  const h = [{ role: 'user', content: 'hello' }];
  const snapshot = JSON.stringify(h);
  attachImagesToHistory(h, IMG);
  assert.equal(JSON.stringify(h), snapshot, 'input history must be untouched');
});

test('attachImagesToHistory targets the LAST user turn, not the first', () => {
  const h = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'second' },
  ];
  const out = attachImagesToHistory(h, IMG);
  assert.equal(typeof out[0].content, 'string', 'earlier turns stay as they were');
  assert.ok(Array.isArray(out[2].content), 'the newest user turn carries the image');
});

test('attachImagesToHistory leaves assistant turns alone entirely', () => {
  const h = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }];
  const out = attachImagesToHistory(h, IMG);
  assert.deepEqual(out[1], { role: 'assistant', content: 'a' });
});

test('attachImagesToHistory creates a user turn when there is none', () => {
  // An image with no question must not be dropped — dropping is the exact bug
  // this module exists to end.
  const out = attachImagesToHistory([], IMG);
  assert.equal(out.length, 1);
  assert.equal(out[0].role, 'user');
  assert.equal(out[0].content.filter((c) => c.type === 'image_url').length, 1);
});

test('attachImagesToHistory appends to an ALREADY multimodal message', () => {
  const h = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
  const out = attachImagesToHistory(h, IMG);
  assert.equal(out[0].content.length, 2, 'must append, not replace');
  assert.equal(out[0].content[0].text, 'hi');
});

test('attachImagesToHistory attaches every image, not just the first', () => {
  const many = [
    { url: 'data:image/png;base64,A' },
    { url: 'data:image/png;base64,B' },
    { url: 'data:image/png;base64,C' },
  ];
  const out = attachImagesToHistory([{ role: 'user', content: 'q' }], many);
  assert.equal(out[0].content.filter((c) => c.type === 'image_url').length, 3);
});

test('attachImagesToHistory with no images returns an equal but distinct array', () => {
  const h = [{ role: 'user', content: 'q' }];
  const out = attachImagesToHistory(h, []);
  assert.deepEqual(out, h);
  assert.notEqual(out, h, 'still a copy — callers must never share the array');
});

test('attachImagesToHistory survives a null/undefined history', () => {
  assert.doesNotThrow(() => attachImagesToHistory(null, IMG));
  assert.doesNotThrow(() => attachImagesToHistory(undefined, []));
});

// ── per-file error reporting ───────────────────────────────────────────────
test('buildImageParts reports per-file failures instead of losing the turn', () => {
  const deps = {
    readFile: (p) => { if (String(p).includes('bad')) throw new Error('EACCES'); return Buffer.from([1]); },
    stat: () => ({ size: 1 }),
  };
  const { images, errors } = buildImageParts(['/x/ok.png', '/x/bad.png'], deps);
  assert.equal(images.length, 1, 'the good image still goes');
  assert.equal(errors.length, 1, 'the bad one is REPORTED, not silently dropped');
  assert.ok(errors[0].includes('bad.png'), 'the error names the file');
});

test('buildImageParts returns the basename, not the full path', () => {
  const { images } = buildImageParts(['/deep/nested/pic.png'], fakeDeps([1]));
  assert.equal(images[0].name, 'pic.png');
});

test('buildImageParts on an empty list is empty, not an error', () => {
  const r = buildImageParts([], fakeDeps([1]));
  assert.deepEqual(r, { images: [], errors: [] });
  assert.deepEqual(buildImageParts(undefined, fakeDeps([1])), { images: [], errors: [] });
});

// ── the regression guard for the original bug ──────────────────────────────
// This used to grep brains.js for four strings. A text search cannot tell a
// live refusal from a DEAD BRANCH: wrapping the check as
// `if (false && !providerDoesVision(provider))` leaves all four strings on
// their original lines, and the suite — whose own description calls this "the
// failure mode that let this bug hide for a week" — stayed green while the bug
// was back in exactly the form the guard was written for.
// (Mutation pass, 2026-08-06.)
//
// So: CALL it. The refusal returns before any fetch, so a text-only provider
// with no key requirement exercises the branch with zero network and zero spend.
await test('brainChat REFUSES a text-only provider an image turn', async () => {
  const { brainChat } = await import('../server/src/brains.js');
  assert.equal(providerDoesVision('local'), false, 'fixture assumption broke: local now does vision');
  const frames = [];
  await brainChat({
    provider: 'local',
    model: 'whatever',
    history: [{ role: 'user', content: 'what is in this picture?' }],
    images: ['/tmp/atlan-vision-does-not-need-to-exist.png'],
    send: (f) => frames.push(f),
  });
  const err = frames.find((f) => f.t === 'chat.err');
  assert.ok(err, 'the turn was NOT refused — frames: ' + JSON.stringify(frames).slice(0, 300));
  assert.match(err.msg, /cannot receive images/, err.msg);
  assert.equal(frames.filter((f) => f.t === 'chat.msg').length, 0, 'it was sent text-only after "refusing"');
});

await test('the multimodal parts really reach the message a vision provider gets', () => {
  // The mirror image: proving the refusal fires is only half of it, because
  // refusing EVERYTHING would also satisfy the test above.
  const out = attachImagesToHistory(
    [{ role: 'user', content: 'look' }],
    [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
  );
  const last = out.at(-1);
  assert.ok(Array.isArray(last.content), 'the last user turn was not made multimodal');
  assert.ok(last.content.some((c) => c.type === 'image_url'), 'the image part never reached the message');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
