// previewmax.js — fill the screen with the preview, and get back out.
//
// WHY A CLASS AND NOT JUST THE FULLSCREEN API. On a phone the Fullscreen API is
// the nicer result — it takes the browser chrome too — but it is refused often
// enough that it cannot be the only path: iOS Safari has never supported it on
// arbitrary elements, and inside an installed PWA or an in-app webview the
// request can reject with no user-visible reason. So the class is the mechanism
// and fullscreen is the bonus: if the request throws or is denied, the pane is
// still maximised and the button still works. A control that silently does
// nothing on the primary platform is worse than no control.
//
// The iframe is deliberately NOT re-created or re-pointed. Toggling `src` would
// reload the previewed app, losing its state — the thing you were looking at is
// usually the thing you wanted bigger.

const MAXED = 'maxed';

/**
 * @param {object} o
 * @param {HTMLElement} o.section  the preview screen
 * @param {HTMLElement} o.button   the toggle
 * @param {Function}    [o.onChange] called with (isMaxed) so a caller can react
 */
export function initPreviewMax({ section, button, onChange = () => {} }) {
  if (!section || !button) return null;

  const isMaxed = () => section.classList.contains(MAXED);

  const paint = () => {
    const on = isMaxed();
    button.textContent = on ? '⤡' : '⤢';
    button.title = on ? 'Exit full screen' : 'Full screen';
    button.setAttribute('aria-pressed', String(on));
    // The tab bar is a sibling of the screens, so hiding it is a body-level
    // concern rather than something this section can do to itself.
    document.body.classList.toggle('preview-maxed', on);
    onChange(on);
  };

  async function enter() {
    section.classList.add(MAXED);
    paint();
    try {
      if (section.requestFullscreen) await section.requestFullscreen({ navigationUI: 'hide' });
    } catch { /* denied or unsupported — the class already did the work */ }
  }

  async function exit() {
    section.classList.remove(MAXED);
    paint();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch { /* nothing to leave */ }
  }

  const toggle = () => (isMaxed() ? exit() : enter());
  button.addEventListener('click', toggle);

  // Leaving fullscreen by the SYSTEM gesture (swipe, back button, Esc handled by
  // the browser) must not leave the pane stuck in the maximised class with no
  // visible way out. This is the resync.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && isMaxed()) { section.classList.remove(MAXED); paint(); }
  });

  // Escape works even when the browser never entered fullscreen, which is the
  // common case on the phone.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isMaxed()) exit(); });

  paint();
  return { enter, exit, toggle, isMaxed };
}
