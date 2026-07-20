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
import { initFleet, spawnRun, listRuns, killRun, killAll, todayBurn, profileList, historyTail, topUpRun } from './fleet.js';
import { pushPublicKey, addSub, subCount, notifyAll } from './push.js';
import { authMiddleware, wsAuthed } from './auth.js';
import { listRoutines, upsertRoutine, deleteRoutine, setPaused, fireRoutine, startScheduler } from './routines.js';
import {
  listPersonas, listCommands, upsertPersona, deletePersona, upsertCommand, deleteCommand,
  compilePersona, compileCommand, templateSchema, toolSchema, harnessRun,
} from './personas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '../../web/public');
const PORT = 4589;

const SNAPDIR = join(__dirname, '../../.snapshots');
mkdirSync(SNAPDIR, { recursive: true });

const app = express();
app.use(express.static(WEB));
app.use(express.json({ limit: '1mb' }));

// Everything after this line needs the token; the static shell above doesn't
// (the login screen has to come from somewhere).
app.use('/api', authMiddleware);
app.use('/apk', authMiddleware);

app.get('/api/doctor', async (_req, res) => res.json(await runDoctor()));

app.get('/api/engines', async (_req, res) => {
  const brains = (await engineRoster()).map((e) => ({ ...e, group: e.id === 'local' ? 'local' : 'cloud' }));
  res.json([...agentStatus(), ...brains]);
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
    res.json(spawnRun({ prompt, profile: 'scout', cwd: '/root', budget: Number(req.body?.budget) || 100000, source: 'harness-escalation' }));
  } catch (err) { res.status(400).json({ error: err.message }); }
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
  for (const name of readdirSync('/root')) {
    if (name.startsWith('.')) continue;
    const p = `/root/${name}`;
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

// Fleet events are server-global — every open cockpit sees the same runs.
// Finished/halted runs also go out as real push notifications (app closed OK).
const wsBroadcast = (obj) => {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
};
initFleet(wsBroadcast, notifyAll);
// Routines wake with the server; missed slots get flagged + pushed, never
// auto-fired (a rebooted server must not spend tokens by surprise).
startScheduler(wsBroadcast, notifyAll);

wss.on('connection', (ws, req) => {
  if (!wsAuthed(req)) { ws.close(4001, 'auth required'); return; }
  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  let claude = null;
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

        if (isAgentCli) {
          const state = agentState.get(m.engine) ?? {};
          agentState.set(m.engine, state);
          agentTurn({ engine: m.engine, cwd: m.cwd || '/root', text, send, state });
        } else if (isClaude) {
          if (!claude || (m.cwd && claude.cwd !== m.cwd)) {
            claude = new ClaudeSession({ cwd: m.cwd || '/root', model: m.model || 'claude-fable-5', send });
          }
          if (m.model) claude.model = m.model;
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
        runBuild(m.path || '/root/d2d', send);
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
  console.log(`ATLAN cockpit · http://127.0.0.1:${PORT}`);
});
