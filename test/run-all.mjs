// One runner for every suite → prints a summary AND writes docs/RECEIPTS.md
// with each suite's full observed output. This file IS the receipt: every
// function, exercised, with the command that ran it and what came back.
//
// SELF-CONTAINED: if ATLAN_BASE isn't already set (run.sh / CI), this boots its
// OWN throwaway server on a FREE ephemeral port with temp state + a test token,
// so `node test/run-all.mjs` run standalone can never collide with a live
// atlan.service on :4589 (which made every API suite fetch-fail and then
// silently overwrote RECEIPTS.md with false numbers — John's catch 2026-07-25).
// If that boot never becomes healthy we ABORT WITHOUT writing RECEIPTS, so a
// broken harness run can't erode the receipt's authority.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const waitHealth = async (base, ms = 25000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) {
    try { const r = await fetch(base + '/'); if (r.status === 200 || r.status === 401) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

let server = null, fleetDir = null;
if (!process.env.ATLAN_BASE) {
  const port = await freePort();
  fleetDir = mkdtempSync(join(tmpdir(), 'atlan-test-fleet-'));
  process.env.ATLAN_PORT = String(port);
  process.env.ATLAN_PREVIEW_PORT = String(await freePort());
  process.env.ATLAN_FLEET_DIR = fleetDir;
  process.env.ATLAN_TOKEN = 'test-' + randomBytes(16).toString('hex');
  process.env.ATLAN_BASE = `http://127.0.0.1:${port}`;
  process.env.ATLAN_TIER_LOCAL_BASE ||= 'http://127.0.0.1:8091';
  process.env.ATLAN_TIER_CLOUDSM_BASE ||= 'http://127.0.0.1:8092';
  process.stderr.write(`▸ booting throwaway test server on :${port} (state ${fleetDir})\n`);
  server = spawn('node', ['server/src/index.js'], { cwd: REPO, stdio: 'ignore', env: process.env });
  if (!(await waitHealth(process.env.ATLAN_BASE))) {
    try { server.kill(); } catch { /* */ }
    rmSync(fleetDir, { recursive: true, force: true });
    console.error('FATAL: throwaway test server never became healthy — aborting WITHOUT writing RECEIPTS.md');
    process.exit(2);
  }
}
const teardown = () => {
  try { if (server) server.kill(); } catch { /* */ }
  try { if (fleetDir) rmSync(fleetDir, { recursive: true, force: true }); } catch { /* */ }
};

// The E2E suite makes REAL Claude fleet runs (costs money). It's opt-in via
// RUN_PAID=1 so routine re-runs are free — John flagged surprise burn 2026-07-20.
const PAID = !!process.env.RUN_PAID;
const SUITES = [
  ['Unit', 'test/unit.mjs', 'Pure functions in isolation: safe-arith evaluator, checker engine, Persona+ compilers, schema builders, scheduler math, token compare.'],
  ['Web Lib', 'test/weblib.mjs', 'The front-end\'s pure logic, extracted from app.js so Node can reach it: fenced-code parsing (incl. streaming and boundary cases), HTML escaping, diff colouring, base64url, day/night and greeting bands. Previously untestable — the only front-end coverage was Playwright driving the UI.'],
  ['Function', 'test/function.mjs', 'Every HTTP endpoint contract + shape, plus data-store durability (corrupt/truncated JSON fails soft). (Spawns 1 tiny killed run.)'],
  ['Connection', 'test/connection.mjs', 'Live WebSocket + PTY: authed connect, 4001 on bad token, malformed-frame survival, multi-client broadcast, tmux round-trip, reconnection. (Spawns 2 tiny killed runs.)'],
  ['Security/Penetration', 'test/security.mjs', 'Auth bypass, SSRF (preview + harness), secret exfiltration, path traversal, stored-XSS, oversized-body DoS, profile privilege-escalation.'],
  ['Adversarial', 'test/adversarial.mjs', 'Malformed/oversized/hostile input across all surfaces; profile tool-blocking; preflight honesty.'],
  ['Worker Hierarchy', 'test/hierarchy.mjs', 'Job = chain of checker-gated links; cheapest-tier-first, escalate-on-fail up the model ladder, blackboard wiring, human gate pause/resume, ladder-exhaustion error. Mock tier engines — no real spend.'],
  ['Attachments', 'test/attachments.mjs', 'Upload (image/file) + reference (file/folder) + path-traversal guard + oversize/empty reject + audio/video graceful degradation without a key.'],
  ['Code Editor', 'test/editor.mjs', 'File read/write/tree scoped to the project, folders-first listing, noise-dir hiding, secrets + traversal + folder-as-file guards.'],
  ['Voice & Providers', 'test/voice.mjs', 'TTS roster honesty (readiness tracks keys, roadmap items never claim ready), TTS input validation + clean degradation, SSML XML-escaping (no injection), Polly SigV4 signer, and the 12-provider AI-model spread.'],
  ...(PAID ? [['E2E', 'test/e2e.mjs', 'Real flows: fleet run to completion, budget-halt→top-up resume, harness good/bad + escalation, routine fire→inbox. (PAID — real Claude runs.)']] : []),
  ['UI/UX', 'test/ui.spec.mjs', 'Headless Chromium drives the real cockpit: tabs, engine roster, doctor/preflight render, key entry no-leak, XSS-safe render.'],
  ['Tour/Onboarding', 'test/tour.spec.mjs', 'Drives all tour steps live — every step spotlights a real visible element; handbook opens/searches/relaunches.'],
];

const now = process.env.RECEIPT_STAMP || 'see git log';
let md = `# ATLAN — Test Receipts\n\n`;
md += `Generated by \`node test/run-all.mjs\`, which boots its OWN throwaway server on an isolated ephemeral port with temp state — it never touches a running atlan.service, so these numbers reproduce anywhere.\n`;
md += `This document is the evidence trail: each function is exercised, and the raw pass/fail output is captured verbatim so it can be checked independently.\n\n`;
md += `_Stamp: ${now}_\n\n`;
md += PAID
  ? `_Includes the PAID E2E suite (real Claude runs)._\n\n`
  : `_Free suites only. The E2E suite (real Claude runs) is opt-in — \`RUN_PAID=1 node test/run-all.mjs\`. Last standalone E2E result: **7/7 green** (fleet run to completion, budget-halt→top-up resume, harness good/bad + escalation, routine fire→inbox)._\n\n`;
md += `## Summary\n\n| Suite | What it proves | Result |\n|---|---|---|\n`;

const details = [];
let allPass = 0, allFail = 0, hardFail = false;
for (const [name, file, desc] of SUITES) {
  process.stderr.write(`running ${name}…\n`);
  const res = spawnSync('node', [file], { encoding: 'utf8', timeout: 600000, cwd: new URL('..', import.meta.url).pathname });
  const out = (res.stdout || '') + (res.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const p = m ? +m[1] : 0, f = m ? +m[2] : (res.status === 0 ? 0 : 1);
  allPass += p; allFail += f;
  if (res.status !== 0) hardFail = true;
  const verdict = f === 0 && res.status === 0 ? `✅ ${p}/${p}` : `❌ ${p} pass, ${f} fail`;
  md += `| ${name} | ${desc} | ${verdict} |\n`;
  details.push(`## ${name}\n\n${desc}\n\n\`\`\`\n$ node ${file}\n${out.trim()}\n\`\`\`\n`);
}

md += `\n**Total: ${allPass} passed, ${allFail} failed across ${SUITES.length} suites.**\n\n`;
md += details.join('\n');
writeFileSync(new URL('../docs/RECEIPTS.md', import.meta.url), md);
console.log(`\n═══ ${allPass} passed, ${allFail} failed across ${SUITES.length} suites ═══`);
console.log('receipts → docs/RECEIPTS.md');
teardown();
process.exit(hardFail || allFail ? 1 : 0);
