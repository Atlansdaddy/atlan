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
import { scanProject } from './preflight/scanProject.mjs';
import { resolveInProjects } from './guards.js';
import { agentStatus, agentTurn, killAgentTurns } from './agents.js';
import { localModels, activateLocalModel } from './localmodels.js';
import { handleInlineAiEdit } from './editorAi.js';
import {
  getGitStatus, getGitDiff, gitStage, gitUnstage, gitCommit, gitPush, gitPull, gitAiCommitMsg,
} from './git.js';
import { initFleet, spawnRun, listRuns, killRun, killAll, todayBurn, profileList, historyTail, topUpRun, engineCapabilities, recoverInflight } from './fleet.js';
import { pushPublicKey, addSub, subCount, notifyAll } from './push.js';
import {
  authMiddleware, wsAuthed, isConfigured, setPassword, checkPassword,
  newSession, dropSession, cookieHeader, COOKIE, originOk, setupAllowed, revokeAllSessions,
  loginThrottled, recordLoginFail, clearLoginFails, allowOrigin,
} from './auth.js';
import { tailnetHost, tailnetOrigin } from './tailnet.js';
import { listRoutines, upsertRoutine, deleteRoutine, setPaused, fireRoutine, startScheduler } from './routines.js';
import { appendChat, listChats, readChat, deleteChat, validId } from './chatlog.js';
import { initHierarchy, listJobs, upsertJob, deleteJob, startJob, listRuns as listHierarchyRuns, getRun as getHierarchyRun, resolveGate, tierList } from './hierarchy.js';
import { ladderRungs, CHAT_LADDER, MIN_USEFUL_CHARS } from './ladder.js';
import { saveUpload, saveRef, turnContext } from './attachments.js';
import { studioRoster, generateImage } from './studio.js';
import { readFile, writeFile, listDir } from './files.js';
import { getPrefs, setPref } from './prefs.js';
import { voiceRoster, synthesize } from './voice.js';
import {
  listPersonas, listCommands, upsertPersona, deletePersona, upsertCommand, deleteCommand,
  compilePersona, compileCommand, templateSchema, toolSchema, harnessRun,
} from './personas.js';

import { PORT, PREVIEW_PORT, PREVIEW_TLS_PORT, PROJECTS_DIR, DEFAULT_BUILD_PROJECT } from './config.js';

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
  // First-run race: only this device may claim setup (browser Origin or bearer).
  if (!setupAllowed(req)) return res.status(403).json({ error: 'first-run setup must come from this device' });
  try {
    setPassword(String(req.body?.password ?? ''));
    res.setHeader('Set-Cookie', cookieHeader(newSession(), { req }));
    res.json({ ok: true });
  } catch (err) {
    // Pre-auth endpoint: only surface the known length-validation message; any
    // other error (e.g. an fs failure writing auth.json) must not leak an
    // internal path to an unauthenticated caller — log it, return generic.
    const safe = /at least \d+ characters/i.test(err?.message || '');
    if (!safe) console.error('[auth/setup] unexpected error:', err);
    res.status(400).json({ error: safe ? err.message : 'setup failed — check the server log' });
  }
});
app.post('/api/auth/login', (req, res) => {
  if (loginThrottled()) return res.status(429).json({ error: 'too many attempts — wait a minute' });
  if (!isConfigured()) return res.status(400).json({ error: 'not set up yet' });
  if (!checkPassword(String(req.body?.password ?? ''))) {
    recordLoginFail();
    return res.status(401).json({ error: 'wrong password' });
  }
  clearLoginFails();
  res.setHeader('Set-Cookie', cookieHeader(newSession(), { req }));
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  const m = /(?:^|;\s*)atlan_session=([^;]+)/.exec(req.headers.cookie || '');
  if (m) dropSession(m[1]);
  res.setHeader('Set-Cookie', cookieHeader('', { clear: true, req }));
  res.json({ ok: true });
});
app.post('/api/auth/password', authMiddleware, (req, res) => {
  // change password: must know the current one; revoke ALL sessions (peer
  // review — a stolen cookie must die), then re-issue one for this caller.
  if (!checkPassword(String(req.body?.current ?? ''))) return res.status(401).json({ error: 'current password is wrong' });
  try {
    setPassword(String(req.body?.next ?? ''));
    revokeAllSessions();
    res.setHeader('Set-Cookie', cookieHeader(newSession(), { req }));
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

// SAST scan of a project with the vendored PreFlight engine (server/src/preflight).
//
// Containment goes through the SHARED guard, like every other path-accepting
// endpoint. It used to do its own `isUnder()` and nothing else: resolve() does
// not follow symlinks, so `ln -s / ~/escape` turned this route into a read
// oracle for the entire filesystem — it walked straight through the link and
// returned matched secret material from outside the projects root, while the
// sibling /api/attach/ref refused the identical path. A second, weaker copy of
// a guard is exactly the drift guards.js exists to prevent.
//
// resolveInProjects, NOT guardPath: this endpoint is the secret SCANNER. Its
// whole job is to open `.env` and tell you a live key is sitting in it, so the
// credential denylist must NOT apply here — refusing to look would disable the
// probe the user came for. Containment and the denylist are separate questions
// and this is the one caller that legitimately answers them differently.
app.get('/api/scan', (req, res) => {
  try {
    const target = resolveInProjects(req.query.path ? String(req.query.path) : PROJECTS_DIR, { credentials: 'allow' });
    res.json(scanProject(target));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// `engines` is the honest capability roster: which engines can run a fleet
// job HERE, which profiles each can actually enforce on THIS host, and whether
// its budget can halt mid-run. The UI must not offer a combination the runtime
// would have to fake — spawnRun refuses those, and this is how the client
// knows before asking.
app.get('/api/fleet', (_req, res) => res.json({
  runs: listRuns(), history: historyTail(30), today: todayBurn(),
  profiles: profileList, engines: engineCapabilities(), pushSubs: subCount(),
}));
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
  // KILL ALL means ALL. It used to walk only the fleet's own map, so a chat-path
  // agent CLI — launched full-auto with its approval system off — reported
  // `killed: 0` and kept editing the repo. A kill guarantee with a second class
  // of child it cannot reach is not a guarantee.
  if (id === 'all') return res.json({ killed: killAll() + killAgentTurns() });
  res.json({ killed: killRun(String(id)) ? 1 : 0 });
});

// ── routines: scheduled budgeted runs ──
// Chat transcripts. Below app.use('/api', authMiddleware), so a transcript is
// exactly as protected as the cockpit itself — these are the most personal
// bytes in the product and must never be the one surface that forgot.
app.get('/api/chats', (_req, res) => res.json({ chats: listChats() }));
app.get('/api/chats/:id', (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad conversation id' });
  res.json({ id, messages: readChat(id) });
});
app.post('/api/chats/delete', (req, res) => res.json({ deleted: deleteChat(String(req.body?.id ?? '')) }));

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
// The escalation ladder, described for the CHAT picker. Separate from
// /api/hierarchy (which is the job builder's view) because chat needs the rungs
// in climb order with the free/paid split called out — on a phone that is the
// deciding fact. Reads from TIERS, so it cannot drift from what actually runs.
app.get('/api/ladder', (req, res) => {
  try {
    const custom = req.query.rungs ? String(req.query.rungs).split(',').filter(Boolean) : null;
    res.json({ rungs: ladderRungs(custom), default: CHAT_LADDER, minUsefulChars: MIN_USEFUL_CHARS });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
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

// ── editor inline AI ──
// Sits below app.use('/api', authMiddleware) so it inherits the password/cookie/
// bearer gate and the origin pin. Kept in its own region so its import and route
// stay off the lines neighbouring stages touch.
app.post('/api/editor/ai-edit', express.json({ limit: '4mb' }), handleInlineAiEdit);

// ── git ──
// Same posture as the editor: post-auth, origin-pinned, and every handler
// refuses APP_ROOT so the cockpit can't be made to stage its own .fleet/
// .keys.enc/.auth-token and push them somewhere.
app.get('/api/git/status', getGitStatus);
app.get('/api/git/diff', getGitDiff);
app.post('/api/git/stage', express.json(), gitStage);
app.post('/api/git/unstage', express.json(), gitUnstage);
app.post('/api/git/commit', express.json(), gitCommit);
app.post('/api/git/push', express.json(), gitPush);
app.post('/api/git/pull', express.json(), gitPull);
app.post('/api/git/ai-commit-msg', express.json(), gitAiCommitMsg);

// ── voice: TTS roster + synthesis (STT is browser-side Web Speech) ──
// ── studio: generation surfaces (image on the ChatGPT subscription, no key) ──
app.get('/api/studio/roster', (_req, res) => res.json(studioRoster()));
app.post('/api/studio/image', express.json(), async (req, res) => {
  try { res.json(await generateImage({ prompt: req.body?.prompt, cwd: req.body?.cwd || PROJECTS_DIR })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

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

// UI prefs live server-side because the cockpit spans origins (loopback +
// tailnet) and localStorage doesn't — see docs/TUTORIAL-OVERHAUL.md §1b.
app.get('/api/prefs', (_req, res) => res.json(getPrefs()));
app.post('/api/prefs', (req, res) => {
  const p = setPref(String(req.body?.key), req.body?.value);
  p ? res.json(p) : res.status(400).json({ error: 'unknown pref' });
});

// Instance facts the CLIENT needs but must never hardcode. Three separate bugs
// came from baking these into app.js:
//   · the preview port — any ATLAN_PREVIEW_PORT override (or the test harness)
//     pointed the iframe at a dead port AND made the origin check silently drop
//     every console message and snapshot;
//   · the scheme/TLS front door — an http frame inside an https page is blocked
//     as mixed content, which is why preview could never load on a phone, and
//     the first workaround hardcoded one operator's tailscale port;
//   · the projects root — placeholders and copy named the author's own /root.
// Two of those were fixed independently on two branches, each adding its own
// /api/config. Express serves the FIRST match, so the second route was dead and
// its field silently absent. One route, all three facts.
app.get('/api/config', (_req, res) => res.json({
  previewPort: PREVIEW_PORT,
  previewTlsPort: PREVIEW_TLS_PORT,
  projectsDir: PROJECTS_DIR,
}));
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
  // Refuse to point the preview proxy at ITSELF. The host check above passes
  // for :PREVIEW_PORT — it is loopback — but proxying to your own listener is
  // an infinite self-proxy: the first request spawns a second, and so on until
  // the port stops answering entirely. Observed live 2026-07-28: typing the
  // proxy's own URL into the preview bar took it from 502 to no response at
  // all, and the only recovery was restarting the server. Cheap to prevent,
  // and a self-DoS a user can trigger by pasting a plausible URL is a defect,
  // not a mistake on their part.
  // Any TLS front door (`tailscale serve`) forwards straight back here, so
  // targeting it is the same loop one hop longer — observed live 2026-08-04:
  // each round trip prepended another inject tag until the request died as a
  // megabyte 502 and the phone showed a blank frame. PREVIEW_TLS_PORT is that
  // front door; 0 disables the check rather than guessing a number.
  if (Number(u.port) === PREVIEW_PORT || (PREVIEW_TLS_PORT && Number(u.port) === PREVIEW_TLS_PORT)) {
    return res.status(400).json({
      error: `that IS the preview proxy (:${PREVIEW_PORT}${PREVIEW_TLS_PORT ? ` / its TLS front door :${PREVIEW_TLS_PORT}` : ''}) — pointing it at itself would loop. Give it the address your app actually listens on, e.g. http://127.0.0.1:5173`,
    });
  }
  setPreviewTarget(u.origin);
  res.json({ url: u.origin });
});

// Candidate project dirs: anything in PROJECTS_DIR with a .git or package.json.
app.get('/api/projects', (_req, res) => {
  const out = [];
  for (const name of readdirSync(PROJECTS_DIR)) {
    if (name.startsWith('.')) continue;
    const p = join(PROJECTS_DIR, name);
    try {
      if (!statSync(p).isDirectory()) continue;
      const hasGit = existsQuiet(join(p, '.git'));
      const hasPkg = existsQuiet(join(p, 'package.json'));
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
  's-editor': 'Editor', 's-fleet': 'Fleet', 's-doctor': 'Doctor', 's-scan': 'Scan',
  's-git': 'Git',
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
  lines.push(`project: ${cwd || PROJECTS_DIR}`);
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
// Reconcile anything that was mid-run when the last process died — an OOM kill,
// the phantom-process killer, or any supervisor respawn. finish() is the only
// place that commits burn and writes the report card, and a hard death skips it
// entirely, so those runs used to vanish: no card, no history line, and their
// tokens invisible to the daily cap. Runs first, so the ledger is whole before
// anything new is admitted.
recoverInflight();
initHierarchy(wsBroadcast);
// Routines wake with the server; missed slots get flagged + pushed, never
// auto-fired (a rebooted server must not spend tokens by surprise).
startScheduler(wsBroadcast, notifyAll);

wss.on('connection', (ws, req) => {
  // Origin pinning (peer review): the WS *executes* things — reject any browser
  // upgrade from an origin that isn't our own (cross-site-WS / rebinding).
  if (!originOk(req)) { ws.close(4003, 'bad origin'); return; }
  if (!wsAuthed(req)) { ws.close(4001, 'auth required'); return; }
  const rawSend = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  // TRANSCRIPT CAPTURE RIDES THE ONE FUNNEL EVERY OUTBOUND FRAME PASSES THROUGH.
  // Deliberately here and not in each engine: agents.js, brains.js and
  // claudeEngine.js all emit chat frames, and a per-engine hook is a list that
  // the next engine gets left off. Claude streams (textstart → delta* → result)
  // while the others send a whole chat.msg, so both shapes are handled and a
  // streamed turn is written ONCE, complete, at the end.
  let convId = null;
  let streamed = '';
  let streamEngine = 'Claude';
  const send = (obj) => {
    try {
      if (convId) {
        if (obj.t === 'chat.msg') appendChat(convId, { role: obj.role, text: obj.text, engine: obj.engine });
        // The engine label rides on textstart so a streamed agent-CLI turn is
        // filed under the engine that produced it rather than all of them being
        // recorded as Claude.
        else if (obj.t === 'chat.textstart') { streamed = ''; streamEngine = obj.engine ?? 'Claude'; }
        else if (obj.t === 'chat.delta') streamed += obj.text ?? '';
        else if (obj.t === 'chat.result') {
          if (streamed.trim()) appendChat(convId, { role: 'claude', text: streamed, engine: streamEngine });
          streamed = '';
        }
      }
    } catch { /* a transcript must never be able to take a live turn down */ }
    rawSend(obj);
  };
  const connId = Symbol('ws');
  let claude = null;
  let currentTab = 's-chat'; // last tab the client reported → feeds Atlan's self-awareness
  const brainHistory = new Map();
  const agentState = new Map();
  // Preview context that auto-attaches to the next turn: errors since last
  // turn + any snapshots taken. Logs/warns stay in the UI only.
  const pending = { errors: [], snaps: [] };

  // ── teardown ───────────────────────────────────────────────────────────
  // Everything this connection started dies with it. There was no close handler
  // at all: `claude` held a WARM ClaudeSession whose _input() generator loops
  // until dispose() flips _closed, and dispose() was called from exactly one
  // place — a cwd change. So every dropped socket left a live `claude` CLI
  // (~258 MB) running forever, unreachable, holding pendingPerms whose promises
  // could never resolve. app.js reconnects 1.5s after every close, so a flaky
  // phone link minted a fresh one per turn and never reaped the old one; two or
  // three flaps exhaust RAM on the reference platform. The chat-path agent CLIs
  // go the same way, via the registry in agents.js.
  // (Cross-vendor adversarial review, 2026-08-06.)
  ws.on('close', () => {
    claude?.dispose().catch(() => {});
    claude = null;
    killAgentTurns((t) => t.owner === connId);
    pending.errors = []; pending.snaps = [];
    brainHistory.clear(); agentState.clear();
  });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'chat.send': {
        // The conversation id comes from the client and is validated as a shape,
        // never trusted as a path — see chatlog.js validId. What gets logged is
        // what the USER TYPED, before the attachment refs, console errors and
        // cockpit context are appended below: a transcript full of injected
        // machinery is not a transcript of a conversation.
        const cid = validId(m.conv);
        if (cid) { convId = cid; appendChat(convId, { role: 'user', text: m.text }); }
        let text = m.text;
        // Attachments this turn: images/files/folders as path refs the agent
        // Reads; audio/video already turned to text by a multimodal model.
        if (Array.isArray(m.attachments) && m.attachments.length) text += turnContext(m.attachments);
        if (pending.errors.length) {
          text += `\n\n[Atlan preview console — errors since last turn, from ${getPreviewTarget()}]\n`
            + pending.errors.slice(-12).map((e) => `• ${e}`).join('\n');
        }
        const isClaude = !m.engine || m.engine === 'claude';
        const isAgentCli = m.engine === 'codex' || m.engine === 'antigravity' || m.engine === 'grok' || m.engine === 'copilot';
        if (isClaude || isAgentCli) {
          for (const p of pending.snaps) {
            text += `\n\n[Atlan preview snapshot saved at ${p} — Read/view that image file to SEE the current preview.]`;
          }
        }
        pending.errors = []; pending.snaps = (isClaude || isAgentCli) ? [] : pending.snaps;

        // live self-awareness (incl. clock) rides the uncached tail — always fresh, ~0 token cost
        text += cockpitContext(currentTab, (claude && claude.cwd) || m.cwd || PROJECTS_DIR);

        if (isAgentCli) {
          const state = agentState.get(m.engine) ?? {};
          agentState.set(m.engine, state);
          // `owner` ties the child to THIS socket so closing it reaps the child.
          agentTurn({ engine: m.engine, cwd: m.cwd || PROJECTS_DIR, text, send, state, model: m.model, owner: connId });
        } else if (isClaude) {
          if (!claude || (m.cwd && claude.cwd !== m.cwd)) {
            claude?.dispose(); // end the old warm session before replacing it (cwd changed)
            claude = new ClaudeSession({ cwd: m.cwd || PROJECTS_DIR, model: m.model || 'claude-fable-5', send });
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
          }).catch((err) => { console.error('[brain]', m.engine, err); });
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
        openPty(m.name || 'main', ws, { cols: m.cols, rows: m.rows, cwd: m.cwd || PROJECTS_DIR });
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
