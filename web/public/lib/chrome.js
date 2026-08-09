// chrome.js — giving the conversation back its screen.
//
// On a 5.8" phone the chat was fighting a header, a History/New row, a
// persona+engine row, an auto-approve row, the composer, an attach-ref row and an
// eight-tab nav. The conversation — the thing you are actually here for — got
// about a third of the display, and it got worse the day auto-approve shipped.
//
// Two moves, both chosen to add no gesture anyone has to discover:
//   · the header hides on scroll-down and returns on scroll-up, which is the
//     pattern every mobile browser has already taught everyone;
//   · the set-once controls fold behind one chevron.
//
// The nav bar deliberately stays. It is the only way between eight panels, and
// hiding it behind a swipe would mean learning a gesture to go anywhere — worse
// still because Term and Editor swallow swipes, so it would fail in exactly the
// panels where you most need it.

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
 *
 * Three outcomes, three different sentences: some projects, no projects (with
 * what a project IS, since the answer is never obvious), or the error.
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
 * Hide the header while reading, bring it back on the way up.
 *
 * TRANSFORM, never display:none. Collapsing the box would reflow the scroller
 * mid-scroll, which jumps the content under the reader's thumb — the artifact
 * this is supposed to avoid.
 *
 * `threshold` exists because a scroller with momentum reports tiny direction
 * flips; without it the header strobes.
 */
export function initHeaderAutohide({ header, scroller, threshold = 24 }) {
  if (!header || !scroller) return null;
  let last = 0, hidden = false;
  const show = () => { if (hidden) { header.classList.remove('tucked'); hidden = false; } };
  const hide = () => { if (!hidden) { header.classList.add('tucked'); hidden = true; } };
  scroller.addEventListener('scroll', () => {
    const y = scroller.scrollTop;
    // Always visible at the top: a header you cannot get back by scrolling up to
    // the beginning is a header someone will think they broke.
    if (y <= 8) { show(); last = y; return; }
    if (Math.abs(y - last) < threshold) return;
    if (y > last) hide(); else show();
    last = y;
  }, { passive: true });
  return { show, hide };
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
