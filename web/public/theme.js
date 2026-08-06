/* ATLAN theme spine — the light/dark axis, wired. Own script (like guide.js)
   because it's DOM + fetch, which lib/ forbids; the decisions live in
   lib/theme.js where test/weblib.mjs pins them.

   State model, same contract as the tour flag: the SERVER (/api/prefs) is the
   source of truth because this cockpit spans origins (loopback + tailnet) and
   localStorage doesn't; localStorage stays as the same-origin fast path the
   pre-paint head script reads. An explicit choice (tap, or a saved pref) wins;
   with no choice anywhere we follow the system preference live.

   This file also persists the TEMPLATE axis: the picker (app.js) only writes
   localStorage + the data-template attribute, so a MutationObserver here
   forwards attribute changes to /api/prefs without touching the picker. */
import { effectiveTheme, nextTheme, editorThemeFor, themeButtonGlyph, themeButtonTitle } from './lib/theme.js';

(() => {
  const root = document.documentElement;
  const btn = document.getElementById('themeBtn');
  const media = matchMedia('(prefers-color-scheme: light)');
  const readSaved = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const writeSaved = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const postPref = (key, value) => fetch('/api/prefs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }),
  }).catch(() => { /* offline / logged out — localStorage still holds it */ });

  let explicit = readSaved('theme'); // null = following the system

  function apply(t) {
    root.setAttribute('data-theme', t);
    if (btn) { btn.textContent = themeButtonGlyph(t); btn.title = themeButtonTitle(t); }
    // browser chrome follows the ground color of whatever palette just won
    const ground = getComputedStyle(root).getPropertyValue('--ground').trim();
    if (ground) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ground);
    // open editors follow; ones created later read data-theme at init
    document.querySelectorAll('.CodeMirror').forEach((el) => el.CodeMirror?.setOption('theme', editorThemeFor(t)));
  }

  function choose(t) { // an explicit user choice — persists everywhere
    explicit = t;
    writeSaved('theme', t);
    postPref('theme', t);
    apply(t);
  }

  apply(effectiveTheme(explicit, media.matches));
  btn?.addEventListener('click', () => choose(nextTheme(root.getAttribute('data-theme'))));
  media.addEventListener?.('change', (e) => { if (!explicit) apply(effectiveTheme(null, e.matches)); });

  // ── server reconcile (same forward-sync contract as the tour flag) ──
  fetch('/api/prefs').then((r) => r.json()).then((p) => {
    if (p.theme && !explicit) { explicit = p.theme; writeSaved('theme', p.theme); apply(p.theme); }
    else if (explicit && !p.theme) postPref('theme', explicit);
    const localTpl = readSaved('atlanTemplate');
    if (p.template && !localTpl) { writeSaved('atlanTemplate', p.template); root.setAttribute('data-template', p.template); apply(root.getAttribute('data-theme')); }
    else if (localTpl && !p.template) postPref('template', localTpl);
  }).catch(() => { /* pre-login 401 or offline — local state already applied */ });

  // template picker writes the attribute; forward it server-side
  new MutationObserver(() => {
    const tpl = root.getAttribute('data-template') ?? '';
    if (tpl !== (readSaved('atlanTemplate') ?? '')) writeSaved('atlanTemplate', tpl);
    postPref('template', tpl);
    apply(root.getAttribute('data-theme')); // template swap can change --ground
  }).observe(root, { attributes: true, attributeFilter: ['data-template'] });
})();
