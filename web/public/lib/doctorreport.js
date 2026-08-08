// doctorreport.js — one tap turns the Doctor into text you can paste.
//
// This exists because "what does your Doctor say?" had no good answer on a
// phone. Reading it aloud is hopeless, screenshots lose the detail strings that
// carry the actual evidence (the confinement ladder is sixteen rungs of it), and
// the alternative — plugging into USB so someone can read /api/doctor over adb —
// means handing over a session credential to look at a health page.
//
// So the report is assembled on the device, from the same checks the tab already
// fetched, and goes to the clipboard. Nothing leaves the phone that the user did
// not choose to paste.
//
// IT CONTAINS NO SECRETS BY CONSTRUCTION, and that is a property to keep: it is
// built only from `label` and `detail`, which are strings the server already
// renders on screen. If a check ever needs to report something sensitive, it has
// to not put it in `detail` — the same rule the tab itself lives by.

/** Turn the fetched checks into a paste-able report. */
export function doctorReportText(checks, meta = {}) {
  const stamp = new Date().toISOString();
  const bad = checks.filter((c) => !c.ok && !c.warn);
  const warn = checks.filter((c) => c.warn);

  const lines = [
    `Atlan diagnostics — ${stamp}`,
    meta.ua ? `device: ${meta.ua}` : null,
    `${checks.length} checks · ${bad.length} failing · ${warn.length} warning`,
    '',
  ].filter(Boolean);

  for (const c of checks) {
    lines.push(`[${c.ok ? 'ok' : c.warn ? 'warn' : 'FAIL'}] ${c.label}`);
    // The detail is where the evidence lives — the rung list, the version
    // strings, the reason a thing is red. Wrapped, not truncated: truncating it
    // would remove exactly the part worth sending.
    for (const part of wrap(String(c.detail ?? ''), 96)) lines.push(`      ${part}`);
  }
  return lines.join('\n');
}

/** Soft-wrap on spaces so a pasted report stays readable in a chat bubble. */
function wrap(s, width) {
  const out = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (line && (line + ' ' + word).length > width) { out.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Attach a copy control to the Doctor panel.
 *
 * Falls back to a selectable textarea when the clipboard API is unavailable —
 * which it is on plain http origins in some browsers, and Atlan is http on
 * loopback by design. A copy button that silently does nothing on the primary
 * platform would be worse than no button.
 */
export function initDoctorReport({ button, getChecks, panel }) {
  if (!button) return;
  button.addEventListener('click', async () => {
    const checks = getChecks() ?? [];
    if (!checks.length) { button.textContent = 'run the checks first'; setTimeout(() => { button.textContent = '⧉ Copy report'; }, 1800); return; }
    const text = doctorReportText(checks, { ua: navigator.userAgent });
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      button.textContent = `copied ${checks.length} checks ✓`;
    } catch {
      const ta = document.createElement('textarea');
      ta.className = 'doc-report';
      ta.value = text;
      ta.readOnly = true;
      ta.setAttribute('aria-label', 'diagnostics report — select all and copy');
      panel?.prepend(ta);
      ta.focus(); ta.select();
      button.textContent = 'select and copy ↑';
    }
    setTimeout(() => { button.textContent = '⧉ Copy report'; }, 2600);
  });
}
