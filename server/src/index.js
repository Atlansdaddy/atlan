import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ClaudeSession } from './claudeEngine.js';
import { openPty, writePty, resizePty } from './pty.js';
import { runDoctor } from './doctor.js';
import { startPreviewProxy, setPreviewTarget, getPreviewTarget } from './preview.js';
import { engineRoster, brainChat } from './brains.js';
import { runBuild, APK_DIR } from './build.js';
import { keyStatus, setStoredKey } from './keys.js';
import { runPreflight } from './preflight.js';
import { agentStatus, agentTurn } from './agents.js';
import { localModels, activateLocalModel } from './localmodels.js';
import { initFleet, spawnRun, listRuns, killRun, killAll, todayBurn, profileList, historyTail, topUpRun } from './fleet.js';
import { pushPublicKey, addSub, subCount, notifyAll } from './push.js';
import {
  authMiddleware, wsAuthed, isConfigured, setPassword, checkPassword,
  newSession, dropSession, cookieHeader, COOKIE, originOk, revokeAllSessions,
  loginThrottled, recordLoginFail, clearLoginFails, allowOrigin,
} from './auth.js';
import { tailnetHost, tailnetOrigin } from './tailnet.js';
import { listRoutines, upsertRoutine, deleteRoutine, setPaused, fireRoutine, startScheduler } from './routines.js';
import { initHierarchy, listJobs, upsertJob, deleteJob, startJob, listRuns as listHierarchyRuns, getRun as getHierarchyRun, resolveGate, tierList } from './hierarchy.js';
import { saveUpload, saveRef, turnContext } from './attachments.js';
import { readFile, writeFile, listDir } from './files.js';
import { voiceRoster, synthesize } from './voice.js';
import {
  listPersonas, listCommands, upsertPersona, deletePersona, upsertCommand, deleteCommand,
  compilePersona, compileCommand, templateSchema, toolSchema, harnessRun,
} from './personas.js';

import { PORT, PROJECTS_DIR, DEFAULT_BUILD_PROJECT } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '../../web/public');

const SNAPDIR = join(__dirname, '../../.snapshots');
mkdirSync(SNAPDIR, { recursive: true });

const app = express();
// watermark: a provenance header on every response. Built by John Viruet /
// Mid-Atlantic AI; Apache-2.0 requires this attribution be preserved. 🧇
app.use((_req, res, next) => { res.setHeader('X-Atlan-Author', 'John Viruet / Mid-Atlantic AI'); res.setHeader('X-Atlan-License', 'Apache-2.0'); next(); });
app.use(express.static(WEB, { setHeaders: (res) => res.set('Cache-Control', 'no-cache') })); // always revalidate — a stale cockpit bundle is worse than a 304 round-trip
app.use(express.json({ limit: '1mb' }));

// Origin guard (peer review, 2026-07-22): reject cross-origin STATE changes —
// closes DNS-rebinding / cross-site POST against login, setup, and every
// mutating endpoint. Browsers send Origin; automation (no Origin) is bearer-gated.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !originOk(req)) return res.status(403).json({ error: 'bad origin' });
  next();
});

// Auth endpoints are OPEN (they're how you get in). Everything else needs a
// session cookie or the automation bearer.
app.get('/api/auth/status', (_req, res) => res.json({ configured: isConfigured() }));
app.post('/api/auth/setup', (req, res) => {
  if (isConfigured()) return res.status(400).json({ error: 'already set up — log in instead' });
  try {
    setPassword(String(req.body?.password ?? ''));
    res.setHeader('Set-Cookie', cookieHeader(newSession()));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/auth/login', (req, res) => {
  if (loginThrottled()) return res.status(429).json({ error: 'too many attempts — wait a minute' });
  if (!isConfigured()) return res.status(400).json({ error: 'not set up yet' });
  if (!checkPassword(String(req.body?.password ?? ''))) {
    recordLoginFail();
    return res.status(401).json({ error: 'wrong password' });
  }
  clearLoginFails();
  res.setHeader('Set-Cookie', cookieHeader(newSession()));
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  const m = /(?:^|;\s*)atlan_session=([^;]+)/.exec(req.headers.cookie || '');
  if (m) dropSession(m[1]);
  res.setHeader('Set-Cookie', cookieHeader('', { clear: true }));
  res.json({ ok: true });
});
app.post('/api/auth/password', authMiddleware, (req, res) => {
  // change password: must know the current one; revoke ALL sessions (peer
  // review — a stolen cookie must die), then re-issue one for this caller.
  if (!checkPassword(String(req.body?.current ?? ''))) return res.status(401).json({ error: 'current password is wrong' });
  try {
    setPassword(String(req.body?.next ?? ''));
    revokeAllSessions();
    res.setHeader('Set-Cookie', cookieHeader(newSession()));
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Everything after this line needs auth; the static shell + /api/auth above don't.
app.use('/api', authMiddleware);
app.use('/apk', authMiddleware);

app.get('/api/doctor', async (_req, res) => res.json(await runDoctor()));

app.get('/api/engines', async (_req, res) => {
  const brains = (await engineRoster()).map((e) => ({ ...e, group: e.id === 'local' ? 'local' : 'cloud' }));
  res.json([...agentStatus(), ...brains]);
});
// Local model picker — list is free; activation restarts llama-server and
// blocks until /health answers (big models take a minute). Home node only;
// `supported:false` elsewhere and the UI hides the card.
app.get('/api/local/models', (_req, res) => res.json(localModels()));
app.post('/api/local/models', async (req, res) => {
  try { res.json(await activateLocalModel(String(req.body?.name ?? ''))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.use('/apk', express.static(APK_DIR));

app.get('/api/preflight', async (_req, res) => res.json(await runPreflight()));

app.get('/api/fleet', (_req, res) => res.json({ runs: listRuns(), history: historyTail(30), today: todayBurn(), profiles: profileList, pushSubs: subCount() }));
app.post('/api/fleet/topup', (req, res) => {
  try {
    res.json(topUpRun(String(req.body?.id), Number(req.body?.extra) || 100000));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get('/api/push/pubkey', (_req, res) => res.json({ key: pushPublicKey() }));
app.post('/api/push/subscribe', (req, res) => {
  try {
    res.json({ subs: addSub(req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/fleet/run', (req, res) => {
  try {
    res.json(spawnRun(req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/fleet/kill', (req, res) => {
  const id = req.body?.id;
  if (id === 'all') return res.json({ killed: killAll() });
  res.json({ killed: killRun(String(id)) ? 1 : 0 });
});

// ── routines: scheduled budgeted runs ──
app.get('/api/routines', (_req, res) => res.json(listRoutines()));
app.post('/api/routines', (req, res) => {
  try { res.json(upsertRoutine(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/routines/delete', (req, res) => res.json({ deleted: deleteRoutine(String(req.body?.id)) }));
app.post('/api/routines/pause', (req, res) => res.json({ paused: setPaused(req.body?.paused) }));
app.post('/api/routines/fire', (req, res) => {
  try { res.json(fireRoutine(String(req.body?.id), { late: !!req.body?.late })); } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Persona+ builder: personas, structured commands, test harness ──
app.get('/api/personas', (_req, res) => res.json({ personas: listPersonas(), commands: listCommands() }));
app.post('/api/personas', (req, res) => {
  try { res.json(upsertPersona(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/personas/delete', (req, res) => res.json({ deleted: deletePersona(String(req.body?.id)) }));
app.post('/api/commands', (req, res) => {
  try { res.json(upsertCommand(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/commands/delete', (req, res) => res.json({ deleted: deleteCommand(String(req.body?.id)) }));
// Compile preview: what the persona/command actually become (system prompt,
// REQUEST block, response json-schema, tool schema) — receipts for the method.
app.get('/api/commands/:id/compiled', (req, res) => {
  const cmd = listCommands().find((c) => c.id === req.params.id);
  if (!cmd) return res.status(404).json({ error: 'no such command' });
  const persona = listPersonas().find((p) => p.id === cmd.personaId);
  res.json({
    system: persona ? compilePersona(persona) : null,
    request: compileCommand(cmd, {}),
    responseSchema: templateSchema(cmd),
    toolSchema: toolSchema(cmd),
  });
});
app.post('/api/harness/run', async (req, res) => {
  try { res.json(await harnessRun(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/harness/escalate', (req, res) => {
  // Failed local execution climbs the ladder: same compiled persona+command,
  // now as a Claude fleet run (budgeted, profiled, reported like any run).
  try {
    const prompt = String(req.body?.prompt ?? '').trim();
    if (!prompt) throw new Error('nothing to escalate');
    res.json(spawnRun({ prompt, profile: 'scout', cwd: PROJECTS_DIR, budget: Number(req.body?.budget) || 100000, source: 'harness-escalation' }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── worker hierarchy: jobs = chains of scoped links, tiered + checker-gated ──
app.get('/api/hierarchy', (_req, res) => res.json({ jobs: listJobs(), runs: listHierarchyRuns(), tiers: tierList }));
app.post('/api/hierarchy/job', (req, res) => {
  try { res.json(upsertJob(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/hierarchy/job/delete', (req, res) => res.json({ deleted: deleteJob(String(req.body?.id)) }));
app.post('/api/hierarchy/start', (req, res) => {
  try { res.json(startJob(String(req.body?.jobId), req.body?.input ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.get('/api/hierarchy/run/:id', (req, res) => {
  const r = getHierarchyRun(req.params.id);
  if (!r) return res.status(404).json({ error: 'no such run' });
  res.json(r);
});
app.post('/api/hierarchy/gate', (req, res) => {
  try { res.json(resolveGate(String(req.body?.runId), { approve: !!req.body?.approve, editedOutput: req.body?.editedOutput ?? null })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// ── attachments: upload (base64, up to 20MB) or reference an existing path ──
// 20MB raw → ~27MB base64; 34mb gives headroom so a legit large photo doesn't
// hit a 413 (which returns non-JSON and surfaced as a useless "upload failed").
app.post('/api/attach', express.json({ limit: '34mb' }), async (req, res) => {
  try { res.json(await saveUpload(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/attach/ref', (req, res) => {
  try { res.json(saveRef(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── code editor: read / write / list, scoped to the project ──
app.get('/api/file', (req, res) => {
  try { res.json(readFile(req.query.path)); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post('/api/file', express.json({ limit: '4mb' }), (req, res) => {
  try { res.json(writeFile(req.body?.path, req.body?.content ?? '')); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.get('/api/tree', (req, res) => {
  try { res.json(listDir(req.query.path)); } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── voice: TTS roster + synthesis (STT is browser-side Web Speech) ──
app.get('/api/voice/roster', async (_req, res) => res.json(await voiceRoster()));
app.post('/api/voice/tts', async (req, res) => {
  try { res.json(await synthesize(req.body ?? {})); } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/keys', (_req, res) => res.json(keyStatus()));
app.post('/api/keys', (req, res) => {
  try {
    setStoredKey(String(req.body?.env), req.body?.value ?? '');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/preview/target', (_req, res) => res.json({ url: getPreviewTarget() }));
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
app.post('/api/preview/target', (req, res) => {
  const raw = String(req.body?.url ?? '');
  let u;
  try { u = new URL(raw); } catch { return res.status(400).json({ error: 'not a url' }); }
  // Parse the host — hostname compares exactly, so 127.0.0.1.evil.com is rejected.
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !LOCAL_HOSTS.has(u.hostname)) {
    return res.status(400).json({ error: 'local urls only (127.0.0.1 / localhost)' });
  }
  setPreviewTarget(u.origin);
  res.json({ url: u.origin });
});

// Candidate project dirs: anything in /root with a .git or package.json.
app.get('/api/projects', (_req, res) => {
  const out = [];
  for (const name of readdirSync(PROJECTS_DIR)) {
    if (name.startsWith('.')) continue;
    const p = `${PROJECTS_DIR}/${name}`;
    try {
      if (!statSync(p).isDirectory()) continue;
      const hasGit = existsQuiet(`${p}/.git`);
      const hasPkg = existsQuiet(`${p}/package.json`);
      if (hasGit || hasPkg) out.push({ name, path: p });
    } catch { /* unreadable dir */ }
  }
  res.json(out);
});
function existsQuiet(p) { try { statSync(p); return true; } catch { return false; } }

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ── time awareness ──────────────────────────────────────────────────────────
// Atlan should feel the passage of time. Each turn gets a compact clock line
// appended to the *end* of the prompt — the uncached tail — so the stable
// system prompt + history stay cached and only these few digits are fresh
// (John's insight: cache the template, not the numbers). The model then knows
// the wall-clock time and how long since the last exchange.
let lastActivityAt = null;
function fmtGap(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? h + 'h ' : ''}${m || h ? m + 'm ' : ''}${sec}s`;
}
const TAB_NAMES = {
  's-chat': 'Chat', 's-preview': 'Preview', 's-term': 'Terminal', 's-build': 'Build',
  's-editor': 'Editor', 's-fleet': 'Fleet', 's-doctor': 'Doctor',
};
// Atlan's live self-awareness block — rides the uncached tail of each turn (like
// the clock always did), so identity stays in the cached system prompt while the
// model's sense of *now* is always fresh. Folds in time (John: "add time
// awareness to this as well") + which tab he's on + the fleet running right now
// + today's burn + the open project + a derived mood. Kept compact (~60 tokens)
// and framed as telemetry so the model never mistakes it for the user's words.
function cockpitContext(tab, cwd) {
  const now = new Date();
  const clock = now.toTimeString().slice(0, 8);
  const date = now.toISOString().slice(0, 10);
  const lines = [`time ${date} ${clock}` + (lastActivityAt ? ` (last exchange ${fmtGap(now - lastActivityAt)} ago)` : '')];
  lastActivityAt = now;
  lines.push(`tab: ${TAB_NAMES[tab] || 'Chat'}`);
  lines.push(`project: ${cwd || '/root'}`);
  const running = listRuns().filter((r) => r.status === 'running');
  const burn = todayBurn();
  lines.push(running.length
    ? `fleet: ${running.length} agent(s) working — ${running.map((r) => r.profile).join(', ')}`
    : 'fleet: idle');
  lines.push(`today's burn: ${burn.tokens.toLocaleString()} tokens`);
  lines.push(`mood: ${running.length ? 'building' : 'calm'}`);
  return `\n\n[Atlan cockpit — your live state right now; perceive it, don't recite it]\n` + lines.join('\n');
}

// Fleet events are server-global — every open cockpit sees the same runs.
// Finished/halted runs also go out as real push notifications (app closed OK).
const wsBroadcast = (obj) => {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
};
initFleet(wsBroadcast, notifyAll);
initHierarchy(wsBroadcast);
// Routines wake with the server; missed slots get flagged + pushed, never
// auto-fired (a rebooted server must not spend tokens by surprise).
startScheduler(wsBroadcast, notifyAll);

wss.on('connection', (ws, req) => {
  // Origin pinning (peer review): the WS *executes* things — reject any browser
  // upgrade from an origin that isn't our own (cross-site-WS / rebinding).
  if (!originOk(req)) { ws.close(4003, 'bad origin'); return; }
  if (!wsAuthed(req)) { ws.close(4001, 'auth required'); return; }
  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  let claude = null;
  let currentTab = 's-chat'; // last tab the client reported → feeds Atlan's self-awareness
  const brainHistory = new Map();
  const agentState = new Map();
  // Preview context that auto-attaches to the next turn: errors since last
  // turn + any snapshots taken. Logs/warns stay in the UI only.
  const pending = { errors: [], snaps: [] };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'chat.send': {
        let text = m.text;
        // Attachments this turn: images/files/folders as path refs the agent
        // Reads; audio/video already turned to text by a multimodal model.
        if (Array.isArray(m.attachments) && m.attachments.length) text += turnContext(m.attachments);
        if (pending.errors.length) {
          text += `\n\n[Atlan preview console — errors since last turn, from ${getPreviewTarget()}]\n`
            + pending.errors.slice(-12).map((e) => `• ${e}`).join('\n');
        }
        const isClaude = !m.engine || m.engine === 'claude';
        const isAgentCli = m.engine === 'codex' || m.engine === 'gemini-cli';
        if (isClaude || isAgentCli) {
          for (const p of pending.snaps) {
            text += `\n\n[Atlan preview snapshot saved at ${p} — Read/view that image file to SEE the current preview.]`;
          }
        }
        pending.errors = []; pending.snaps = (isClaude || isAgentCli) ? [] : pending.snaps;

        // live self-awareness (incl. clock) rides the uncached tail — always fresh, ~0 token cost
        text += cockpitContext(currentTab, (claude && claude.cwd) || m.cwd || '/root');

        if (isAgentCli) {
          const state = agentState.get(m.engine) ?? {};
          agentState.set(m.engine, state);
          agentTurn({ engine: m.engine, cwd: m.cwd || '/root', text, send, state });
        } else if (isClaude) {
          if (!claude || (m.cwd && claude.cwd !== m.cwd)) {
            claude?.dispose(); // end the old warm session before replacing it (cwd changed)
            claude = new ClaudeSession({ cwd: m.cwd || '/root', model: m.model || 'claude-fable-5', send });
          } else if (m.model) {
            claude.setModel(m.model); // warm-session model switch — no respawn, keeps context
          }
          claude.prompt(text);
        } else {
          // Brains keep their own short history per connection+provider so a
          // conversation holds together; snapshots stay queued for Claude.
          const h = brainHistory.get(m.engine) ?? [
            { role: 'system', content: 'You are a helpful engineering brain inside Atlan, a phone cockpit. Be concise. You have no tools or file access — say so if asked to act.' },
          ];
          h.push({ role: 'user', content: text });
          brainChat({ provider: m.engine, model: m.model, history: h, send }).then((reply) => {
            if (reply) h.push({ role: 'assistant', content: reply });
            while (h.length > 21) h.splice(1, 2); // keep system + last 10 exchanges
            brainHistory.set(m.engine, h);
          });
        }
        break;
      }
      case 'ui.tab':
        // client tells us which tab it's on → Atlan's self-awareness stays current
        if (typeof m.tab === 'string') currentTab = m.tab;
        break;
      case 'preview.log':
        if (m.level === 'error') {
          pending.errors.push(String(m.text).slice(0, 500));
          if (pending.errors.length > 50) pending.errors.shift();
        }
        break;
      case 'preview.snap': {
        try {
          const b64 = String(m.data).replace(/^data:image\/png;base64,/, '');
          const path = join(SNAPDIR, `snap-${Date.now()}.png`);
          writeFileSync(path, Buffer.from(b64, 'base64'));
          pending.snaps.push(path);
          if (pending.snaps.length > 3) pending.snaps.shift();
          send({ t: 'preview.snapped', path, count: pending.snaps.length });
        } catch (err) {
          send({ t: 'chat.err', msg: 'snapshot save failed: ' + err.message });
        }
        break;
      }
      case 'perm.reply':
        claude?.resolvePermission(m.id, !!m.approved);
        break;
      case 'build.start':
        runBuild(m.path || DEFAULT_BUILD_PROJECT, send);
        break;
      case 'pty.open':
        openPty(m.name || 'main', ws, { cols: m.cols, rows: m.rows, cwd: m.cwd || '/root' });
        break;
      case 'pty.input':
        writePty(m.name || 'main', m.data);
        break;
      case 'pty.resize':
        resizePty(m.name || 'main', m.cols, m.rows);
        break;
    }
  });
});

startPreviewProxy();
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔════════════════════════════════════════════════════════════');
  console.log('║  🧇 ATLAN cockpit is up.');
  console.log(`║  Open  http://127.0.0.1:${PORT}  and log in.`);
  console.log(`║  ${isConfigured() ? 'Enter your password.' : 'First run — set a password.'}`);
  console.log('║  Built by John Viruet · Mid-Atlantic AI · Apache-2.0');
  console.log('╚════════════════════════════════════════════════════════════\n');
  // Reach-from-your-phone, zero friction: if this host is on a tailnet, auto-allow
  // its own tailnet origin so the origin guard won't 400 browser requests coming
  // in over `tailscale serve` — no manual ATLAN_ORIGIN needed.
  tailnetHost().then((host) => {
    const origin = tailnetOrigin(host);
    if (!origin) return;
    allowOrigin(origin);
    console.log(`   ↳ tailnet detected: reach this cockpit from another device at ${origin}`);
    console.log(`     (run \`tailscale serve --bg ${PORT}\` on this host; set ATLAN_SECURE_COOKIE=1 for the Secure cookie)`);
  }).catch(() => {});
});
