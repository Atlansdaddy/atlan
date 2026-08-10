// chrome.js — giving the conversation its screen back, without fighting the
// scroller for it.
//
// On a 5.8" phone the chat was framed by a header, a History/+New row, a
// persona+engine row, the composer and an eight-tab nav; the conversation got
// about a third of the display.
//
// THE FIRST ATTEMPT TUCKED ON SCROLL AND IT JITTERED, badly, and it deserved to.
// Collapsing the chrome changes the scroller's height, which fires another scroll
// event; near the bottom the browser also adjusts scrollTop to compensate, which
// reads as "scrolled up" — so it shows, the height grows, that reads as "scrolled
// down", and it hides again. A feedback loop by construction, worst exactly where
// there is least room to absorb it.
//
// The loop is not tunable away. To reclaim space you must change layout, and
// changing layout is what generates the events. Thresholds and debounces make it
// flicker less often, not correctly.
//
// So it is ONE DELIBERATE CONTROL now. A tap collapses every row that is not the
// conversation; another restores them. Deterministic, silent, and it can hide
// more than an automatic version would dare, because the user asked for it.
//
// The COMPOSER and the NAV never collapse. You type mid-read, and the nav is the
// only route between eight panels.

/** The label a project wears in the picker. */
export function projectLabel(p) {
  // Nine of eleven entries were one repo — six worktrees, two clones — all named
  // atlan-something, all identical in the dropdown. The branch is the only thing
  // that told them apart, and it was the one thing not shown.
  if (!p.branch) return p.name;
  return `${p.name} · ${p.worktree ? '⑂ ' : ''}${p.branch}`;
}

/**
 * Fill the project picker, and say something true in all three outcomes.
 *
 * The old version appended to the picker without clearing it, so the
 * "loading projects…" placeholder stayed as option zero and a FRESH LOAD READ
 * AS LOADING FOREVER — even when the fetch had already succeeded. Nothing was
 * loading; nothing was selected. Its `.catch(() => {})` then swallowed real
 * failures whole, so a broken fetch and a slow one were indistinguishable.
 */
export function initProjectPicker({ select, fetchJson = () => fetch('/api/projects').then((r) => r.json()) }) {
  if (!select) return Promise.resolve();
  return fetchJson().then((list) => {
    select.textContent = '';
    if (!list.length) {
      select.append(new Option('no projects here — a project is a folder with .git or package.json', ''));
      return;
    }
    for (const p of list) select.append(new Option(projectLabel(p), p.path));
    select.dispatchEvent(new Event('change')); // adopt the first rather than sit on nothing
  }).catch((err) => {
    select.textContent = '';
    select.append(new Option(`could not list projects — ${String(err && err.message).slice(0, 60)}`, ''));
  });
}

/**
 * Focus mode: one tap hides every row that is not the conversation.
 *
 * `rows` are collapsed by class; `header` additionally gives back its own height,
 * because it lives outside the scrolling column and a transform alone would move
 * the pixels while leaving the box — a blank strip where the header used to be
 * instead of more conversation.
 *
 * No scroll listener. That is the entire point of this rewrite.
 */
export function initFocusMode({ button, header, rows = [], key = 'atlanFocus' }) {
  if (!button) return null;
  const group = rows.filter(Boolean);
  let on = false;
  const paint = () => {
    if (header) {
      header.classList.toggle('tucked', on);
      // Measured at collapse time: the header's height changes with the session
      // block, the wordmark and the mascot line, so a hardcoded offset would be
      // wrong on half the states this app has.
      header.style.marginTop = on ? `${-header.offsetHeight}px` : '';
    }
    for (const el of group) el.classList.toggle('tucked', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.textContent = on ? '⤡' : '⤢';
    button.title = on ? 'show the controls again' : 'focus mode — hide everything but the conversation';
  };
  try { on = localStorage.getItem(key) === '1'; } catch { /* private mode */ }
  paint();
  button.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* session only */ }
    paint();
  });
  return { set: (v) => { on = !!v; paint(); } };
}

/** Fold the set-once controls; remember the choice. */
export function initControlCollapse({ toggle, panel, also = [], key = 'atlanControls' }) {
  if (!toggle || !panel) return null;
  const apply = (open) => {
    panel.hidden = !open;
    // `also` are rows that live elsewhere in the DOM but belong to the same
    // decision — the attach-ref input sits below the composer for layout reasons
    // and would otherwise be the one row the chevron does not govern.
    for (const el of also) if (el) el.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? '⌃ fewer controls' : '⌄ more controls';
  };
  let open = false;
  try { open = localStorage.getItem(key) === '1'; } catch { /* private mode */ }
  apply(open);
  toggle.addEventListener('click', () => {
    open = !open;
    apply(open);
    try { localStorage.setItem(key, open ? '1' : '0'); } catch { /* session only */ }
  });
  return { apply };
}
