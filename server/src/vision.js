// vision.js — turning attached images into something a chat-only brain can
// actually SEE. Pure functions: no fetch, no provider state, no DOM.
//
// THE BUG THIS CLOSES (docs/DOGFOOD-FINDINGS-2026-07-26.md, "OPEN — brains
// cannot receive images at all"). Attaching an image put a POINTER in the turn
// context — `• image "x" at /path — Read/view that file to SEE it`. An AGENT
// has a Read tool and opens it. A BRAIN is chat-only: no tools, no filesystem.
// So the bytes were never transmitted and the model was handed a path it had
// no way to open, then asked what the picture showed. It guessed. On a
// phone-first cockpit with a camera in your hand, that is the most mobile-native
// capability in the product, and it was dead.
//
// The OpenAI /chat/completions shape supports it directly and Gemini's
// OpenAI-compat endpoint accepts the same body, so this is a message-shape
// change, not a new transport:
//
//   { role: 'user', content: [ {type:'text',text}, {type:'image_url',image_url:{url}} ] }
//
// HONEST FAILURE OVER SILENT DROP. Not every provider does vision. Where one
// cannot, we say so and refuse the turn rather than quietly sending the text
// half — silently dropping the image is exactly the failure that hid this bug
// for a week.

import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

/** Extensions we will inline, mapped to the MIME type a data: URL needs. */
export const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/**
 * Providers whose OpenAI-compat endpoint accepts `image_url` parts.
 *
 * Conservative on purpose: an entry here is a PROMISE that a turn carrying an
 * image will work. A provider missing from this map produces a clear refusal,
 * which is recoverable; a wrong `true` produces a provider-side 400 the user
 * cannot act on.
 */
export const VISION_PROVIDERS = new Set(['gemini', 'openai', 'openrouter', 'grok', 'mistral', 'together', 'fireworks']);

// KNOWN LIMIT, stated rather than hidden (cross-vendor adversarial review,
// 2026-08-02): this gates on the PROVIDER, not the MODEL. An aggregator like
// openrouter serves both vision and text-only models, so picking a text-only
// model on a vision-capable provider still sends the image parts. A provider
// that 400s is visible and fine; one that returns 200 while ignoring the image
// reproduces the original silent-drop, one layer up.
//
// It is not fixable here — there is no reliable cross-provider capability
// lookup by model id, and inventing one would be a table that silently rots.
// The honest mitigations are: keep this set conservative, and treat a reply
// that never references the image as the user's signal to switch models. If a
// per-model source of truth ever exists, this is the hook for it.
export const VISION_PROVIDER_GRANULARITY = 'provider-level; a text-only MODEL on a vision provider is not detected';

/** Largest image we will inline. Base64 inflates ~33%, and request bodies are capped. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function isImagePath(p) {
  return Object.hasOwn(IMAGE_MIME, extname(String(p ?? '')).toLowerCase());
}

export function providerDoesVision(provider) {
  return VISION_PROVIDERS.has(String(provider ?? ''));
}

/**
 * Read one image file into a data: URL.
 * Throws with an actionable message — these surface straight to the user.
 */
export function imageToDataUrl(path, { readFile = readFileSync, stat = statSync } = {}) {
  const ext = extname(String(path)).toLowerCase();
  const mime = IMAGE_MIME[ext];
  if (!mime) {
    throw new Error(`${ext || 'that file'} is not an inlineable image (${Object.keys(IMAGE_MIME).join(', ')})`);
  }
  const size = stat(path).size;
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(`image is ${(size / 1048576).toFixed(1)}MB — over the ${MAX_IMAGE_BYTES / 1048576}MB inline limit`);
  }
  if (size === 0) throw new Error('image file is empty');
  return `data:${mime};base64,${readFile(path).toString('base64')}`;
}

/**
 * Attach images to the LAST user message of an OpenAI-compat history.
 *
 * The last user turn is the one the images belong to — a user attaches a photo
 * and asks about it in the same breath. Earlier turns are left exactly as they
 * are, so re-sending a long history does not re-upload every image in it.
 *
 * Returns a NEW array; the caller's history is never mutated, because the same
 * history object is reused across retries and a mutated copy would double the
 * attachments on the second attempt.
 *
 * @param {Array} history  [{role, content}] — content may already be a string
 * @param {Array<{url:string, name?:string}>} images
 */
export function attachImagesToHistory(history, images) {
  const list = Array.isArray(history) ? history : [];
  if (!images?.length) return list.slice();

  const out = list.slice();
  let idx = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]?.role === 'user') { idx = i; break; }
  }
  // No user turn to attach to (an image with no question). Make one, rather
  // than dropping the image — dropping is the behaviour this file exists to end.
  if (idx === -1) {
    out.push({ role: 'user', content: '' });
    idx = out.length - 1;
  }

  const msg = out[idx];
  const existing = Array.isArray(msg.content)
    ? msg.content
    : [{ type: 'text', text: String(msg.content ?? '') }];

  out[idx] = {
    ...msg,
    content: [
      ...existing,
      ...images.map((img) => ({ type: 'image_url', image_url: { url: img.url } })),
    ],
  };
  return out;
}

/**
 * Build the image parts for a set of attachment paths, reporting per-file
 * failures instead of throwing the whole turn away for one bad file.
 *
 * @returns {{images: Array<{url,name}>, errors: string[]}}
 */
export function buildImageParts(paths, deps = {}) {
  const images = [];
  const errors = [];
  for (const p of paths ?? []) {
    try { images.push({ url: imageToDataUrl(p, deps), name: String(p).split('/').pop() }); } catch (err) { errors.push(`${String(p).split('/').pop()}: ${err.message}`); }
  }
  return { images, errors };
}
