// lib/theme.js — the light/dark axis DECISIONS. NO DOM.
//
// The spine (web/public/theme.js) reads the clock-equivalents — saved choice,
// system preference — and these decide. Kept pure so test/weblib.mjs can pin
// the precedence rules without a browser.

/** The effective theme: an EXPLICIT user choice always wins; otherwise follow
    the system preference; dark is the app's native fallback. */
export function effectiveTheme(saved, systemPrefersLight) {
  if (saved === 'light' || saved === 'dark') return saved;
  return systemPrefersLight ? 'light' : 'dark';
}

/** The toggle is a strict two-state flip. */
export function nextTheme(current) {
  return current === 'light' ? 'dark' : 'light';
}

/** CodeMirror ships one dark skin (material-darker) and its stock light one;
    the editor follows the app's axis rather than staying dark on a light UI. */
export function editorThemeFor(theme) {
  return theme === 'light' ? 'default' : 'material-darker';
}

/** Button affordance shows the DESTINATION, not the state. */
export function themeButtonGlyph(theme) {
  return theme === 'light' ? '🌙' : '☀️';
}
export function themeButtonTitle(theme) {
  return theme === 'light' ? 'switch to dark theme' : 'switch to light theme';
}
