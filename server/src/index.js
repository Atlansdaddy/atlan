import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { ClaudeSession } from './claudeEngine.js';
import { openPty, writePty, resizePty } from './pty.js';
import { runDoctor } from './doctor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB = join(__dirname, '../../web/public');
const PORT = 4589;

const app = express();
app.use(express.static(WEB));

app.get('/api/doctor', async (_req, res) => res.json(await runDoctor()));

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

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'chat.send': {
        if (!claude || (m.cwd && claude.cwd !== m.cwd)) {
          claude = new ClaudeSession({ cwd: m.cwd || '/root', model: m.model || 'claude-fable-5', send });
        }
        if (m.model) claude.model = m.model;
        claude.prompt(m.text);
        break;
      }
      case 'perm.reply':
        claude?.resolvePermission(m.id, !!m.approved);
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ATLAN cockpit · http://127.0.0.1:${PORT}`);
});
