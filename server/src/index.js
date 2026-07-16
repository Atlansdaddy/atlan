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

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '../../web/public');
const PORT = 4589;

const SNAPDIR = join(__dirname, '../../.snapshots');
mkdirSync(SNAPDIR, { recursive: true });

const app = express();
app.use(express.static(WEB));
app.use(express.json({ limit: '1mb' }));

app.get('/api/doctor', async (_req, res) => res.json(await runDoctor()));

app.get('/api/engines', async (_req, res) => {
  const brains = (await engineRoster()).map((e) => ({ ...e, group: e.id === 'local' ? 'local' : 'cloud' }));
  res.json([...agentStatus(), ...brains]);
});
app.use('/apk', express.static(APK_DIR));

app.get('/api/preflight', async (_req, res) => res.json(await runPreflight()));

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
app.post('/api/preview/target', (req, res) => {
  const url = String(req.body?.url ?? '');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    return res.status(400).json({ error: 'local urls only (127.0.0.1 / localhost)' });
  }
  setPreviewTarget(url);
  res.json({ url });
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

wss.on('connection', (ws) => {
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
