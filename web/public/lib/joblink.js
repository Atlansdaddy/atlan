// The markup for one link row in the Hierarchy job editor.
//
// Pure string-building, so the shape of the row can be asserted without a
// browser — and the shape is what bit us: the command <select> has NO empty
// option, so assigning it '' silently drives selectedIndex to -1 and the picker
// renders blank. app.js used to build a new job's first row from `{}`, which is
// truthy, so it took the "restore a saved link" branch and did exactly that.
// The job then refused to save for having no link while one sat on screen.
//
// Anything that assigns into this row has to reckon with that, which is easier
// to remember when the row's shape is somewhere you can read in one screen.

import { escapeHtml } from './text.js';

const opt = (value, label = value) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;

/**
 * @param commands [{id, name}] — the command picker's options. Deliberately has
 *   no blank entry: every link must name a command.
 * @param tiers    [{id}]       — the escalation ladder, checked by default.
 */
export function linkRowHtml(commands = [], tiers = []) {
  const cmdOpts = commands.map((c) => opt(c.id, c.name)).join('');
  const tierChecks = tiers.map((t) => `<label class="ck"><input type="checkbox" data-tier="${escapeHtml(t.id)}" checked>${escapeHtml(t.id)}</label>`).join('');
  return `<div class="linkedit">
      <input data-k="id" placeholder="link id (e.g. extract)">
      <select data-k="commandId">${cmdOpts}</select>
      <input data-k="inputsFrom" placeholder="inputs from (comma: job.input, extract.field)">
      <div class="tierrow">start:<select data-k="startTier">${tiers.map((t) => opt(t.id)).join('')}</select>
        ladder: ${tierChecks}
        <select data-k="onCheckerFail"><option value="escalate">escalate</option><option value="human">ask me</option><option value="halt">halt</option></select></div>
      <button class="btn ghost linkdel">✖ link</button></div>`;
}
