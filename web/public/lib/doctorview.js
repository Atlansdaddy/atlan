// doctorview.js — the Doctor, answering questions instead of listing checks.
//
// It was seventeen rows in one flat list, sorted by nothing, mixing four
// audiences: build toolchain, containment, live connections, and housekeeping.
// On a 6" screen that is a scroll, and the consequence was measured rather than
// imagined — someone looking for "the sandbox stuff" walked straight past the
// containment row at position thirteen.
//
// So: a verdict per group first, evidence underneath, collapsed by default. You
// should be able to answer "is anything wrong, and can I run agents safely here"
// without scrolling at all, and still get every rung of the ladder when you ask
// for it.
//
// GREEN GROUPS COLLAPSE, GROUPS WITH A PROBLEM OPEN THEMSELVES. Hiding a failure
// behind a tap would be the same mistake in a tidier coat.

const ORDER = ['safety', 'engines', 'build', 'health'];

const verdictOf = (rows) => {
  const fail = rows.filter((r) => !r.ok && !r.warn).length;
  const warn = rows.filter((r) => r.warn).length;
  if (fail) return { cls: '', text: `${fail} failing` };
  if (warn) return { cls: 'warn', text: `${warn} to look at` };
  return { cls: 'pass', text: 'all good' };
};

/**
 * @param {HTMLElement} list    container to render into
 * @param {Array}       checks  rows from /api/doctor, each carrying its group
 * @returns {boolean}   true when something is genuinely failing
 */
export function renderDoctor(list, checks) {
  // Labels come off the rows, so the server owns the wording and this file
  // cannot drift into naming a group something the server does not call it.
  const groups = {};
  for (const c of checks) {
    if (c.group && !groups[c.group]) groups[c.group] = { label: c.groupLabel ?? c.group, blurb: c.groupBlurb ?? '' };
  }
  return paint(list, checks, groups);
}

function paint(list, checks, groups) {
  list.textContent = '';
  let anyFail = false;

  const seen = new Set();
  const buckets = ORDER.map((g) => [g, checks.filter((c) => (c.group ?? 'health') === g)]);
  // Anything the server grouped into a name this client does not know about
  // still has to appear. A row that exists and renders nowhere is worse than an
  // ugly row.
  for (const [, rows] of buckets) for (const r of rows) seen.add(r);
  const orphans = checks.filter((c) => !seen.has(c));
  if (orphans.length) buckets.push(['other', orphans]);

  for (const [g, rows] of buckets) {
    if (!rows.length) continue;
    const v = verdictOf(rows);
    if (rows.some((r) => !r.ok && !r.warn)) anyFail = true;

    const wrap = document.createElement('details');
    wrap.className = 'docgroup';
    // Open when there is something to act on, closed when there is not.
    wrap.open = v.cls !== 'pass';

    const head = document.createElement('summary');
    head.className = 'docgroup-head';
    const name = document.createElement('span');
    name.className = 'docgroup-name';
    name.textContent = groups[g]?.label ?? g;
    const badge = document.createElement('span');
    badge.className = 'docgroup-badge ' + v.cls;
    badge.textContent = v.text;
    const blurb = document.createElement('span');
    blurb.className = 'docgroup-blurb';
    blurb.textContent = groups[g]?.blurb ?? '';
    head.append(name, badge, blurb);
    wrap.append(head);

    for (const c of rows) {
      const div = document.createElement('div');
      div.className = 'check ' + (c.ok ? 'pass' : c.warn ? 'warn' : '');
      const sig = document.createElement('span');
      sig.className = 'sig';
      const body = document.createElement('div');
      const what = document.createElement('div');
      what.className = 'what';
      what.textContent = c.label;
      const how = document.createElement('div');
      how.className = 'how';
      how.textContent = c.detail;
      body.append(what, how);

      // ONE BUTTON PER THING YOU CAN ACTUALLY DO.
      // A row used to end at prose — "run: codex login --device-auth (Term tab)"
      // — which is an instruction to go somewhere else and type it yourself. The
      // command is already known here, so the row runs it.
      //
      // The button never handles a credential. Every one of these is a
      // device-code or browser flow that only the account holder can complete;
      // all this does is put them at the prompt instead of making them find it.
      if (Array.isArray(c.actions) && c.actions.length) {
        const bar = document.createElement('div');
        bar.className = 'doc-actions';
        for (const a of c.actions) {
          const b = document.createElement('button');
          b.className = 'mini';
          b.textContent = a.label;
          b.title = a.run; // the exact line, so the button hides nothing
          b.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation(); // the row sits inside <details> — don't toggle it
            list.dispatchEvent(new CustomEvent('atlan:run-in-term', {
              bubbles: true,
              detail: { command: a.run, label: a.label },
            }));
          });
          bar.append(b);
        }
        body.append(bar);
      }

      div.append(sig, body);
      wrap.append(div);
    }
    list.append(wrap);
  }
  return anyFail;
}
