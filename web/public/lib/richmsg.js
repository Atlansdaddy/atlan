// richmsg.js — a chat brain's reply, with its code fenced into review cards.
//
// Extracted from app.js, which sits under a line ceiling that only ever moves
// down (see test/docdrift.mjs). This is pure DOM construction with one injected
// callback, so it moves cleanly and is testable without a browser.
//
// WHY ONLY BRAINS GET THE CARDS. A chat brain has no hands: its code has nowhere
// to go unless the UI gives it a destination, so every fence becomes a card with
// "→ Editor" on it. The autonomous coding agents already write to disk like
// their CLIs do — routing their diffs through a manual card would be pure
// fatigue, and the Editor tab is right there when you do want to look.

import { parseMessageParts } from './text.js';

/**
 * @param {HTMLElement} container      node to append into
 * @param {string}      text           raw assistant text, possibly fenced
 * @param {Function}    onSendToEditor (code, lang) => void
 */
export function renderRichMessage(container, text, onSendToEditor) {
  for (const part of parseMessageParts(text)) {
    if (part.type === 'text') container.appendChild(document.createTextNode(part.content));
    else container.appendChild(buildCodeBlock(part.content, part.lang, onSendToEditor));
  }
}

export function buildCodeBlock(code, lang, onSendToEditor) {
  const wrap = document.createElement('div'); wrap.className = 'codeblock';
  const bar = document.createElement('div'); bar.className = 'codebar';
  if (lang) { const t = document.createElement('span'); t.className = 'codelang'; t.textContent = lang; bar.append(t); }
  const toEd = document.createElement('button');
  toEd.className = 'btn ghost'; toEd.textContent = '→ Editor';
  toEd.title = 'Open this code in the Editor to review — then set a path and Save. Nothing writes until you do.';
  toEd.addEventListener('click', () => onSendToEditor?.(code, lang));
  const cp = document.createElement('button');
  cp.className = 'btn ghost'; cp.textContent = 'Copy';
  cp.addEventListener('click', () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      cp.textContent = 'Copied';
      setTimeout(() => { cp.textContent = 'Copy'; }, 1200);
    }
  });
  bar.append(toEd, cp);
  const pre = document.createElement('pre'); const codeEl = document.createElement('code');
  codeEl.textContent = code; pre.append(codeEl);
  wrap.append(bar, pre);
  return wrap;
}
