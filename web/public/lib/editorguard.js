// The two irreversible things the editor can do to you, and the guards that
// stand in front of them.
//
// Both used to be one-liners in app.js: openFile() called cmEditor.setValue()
// straight over whatever you were typing, and edSave() posted to
// `$('edPath').value.trim() || edCurrentPath` — the SAME box you navigate with.
// So typing the next file you meant to open and then tapping Save aimed the
// current buffer at it, and files.js writeFile() has no existence check. A file
// you never opened was gone, silently, in two taps.
//
// Neither guard asks unless it has to: no dialog when the buffer is clean, none
// when the path is the file you already have open, none when the target does
// not exist yet. A prompt that fires on every save is a prompt people learn to
// dismiss without reading, which is worse than no prompt at all.
//
// The DOM lives in app.js and reaches this module through a small `ui` object,
// which is also what makes these testable without a browser.

export const DISCARD_MSG =
  'You have unsaved changes in this file.\n\nOpening another file will discard them. Continue?';

export const overwriteMsg = (path) =>
  `${path} already exists.\n\nSaving will replace its contents with what is in the editor right now. Continue?`;

/** app.js writes '● unsaved' into #edDirty; 'saved ✓' and '' both mean safe. */
export function isDirty(text) {
  return /unsaved/i.test(String(text ?? ''));
}

/** A read that comes back without an error means something is already there. */
export async function fileExists(path, fetchFn = fetch) {
  try {
    const r = await fetchFn('/api/file?path=' + encodeURIComponent(path));
    return !(await r.json()).error;
  } catch {
    return false; // unreachable server: let the save attempt report the real fault
  }
}

const defaultAsk = (m) => (typeof confirm === 'function' ? confirm(m) : true);

/**
 * Load `path` into the editor, but never over unsaved work without asking.
 * Returns the loaded file, or null if it was declined or could not be read.
 */
export async function openInto(path, ui, { fetchFn = fetch, ask = defaultAsk } = {}) {
  if (!path) return null;
  if (isDirty(ui.dirty()) && !ask(DISCARD_MSG)) return null;
  let f;
  try {
    f = await (await fetchFn('/api/file?path=' + encodeURIComponent(path))).json();
  } catch (e) {
    ui.fail(`could not read ${path} — ${e?.message ?? e}`);
    return null;
  }
  if (f.error) {
    ui.fail(f.error);
    return null;
  }
  ui.load(f);
  return f;
}

/**
 * Save `content` to `path`, but never over a DIFFERENT existing file without
 * asking. Returns the saved file, or null if declined or refused by the server.
 */
export async function saveTo(path, content, ui, { fetchFn = fetch, ask = defaultAsk } = {}) {
  if (!path) {
    ui.fail('set a path to save to');
    return null;
  }
  if (path !== ui.current() && (await fileExists(path, fetchFn)) && !ask(overwriteMsg(path))) return null;
  let f;
  try {
    f = await (
      await fetchFn('/api/file', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path, content }),
      })
    ).json();
  } catch (e) {
    ui.fail(`could not save ${path} — ${e?.message ?? e}`);
    return null;
  }
  if (f.error) {
    ui.fail(f.error);
    return null;
  }
  ui.saved(f);
  return f;
}
