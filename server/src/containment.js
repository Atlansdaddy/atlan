import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { execFileSync, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFile = promisify(execFileCb);

// Containment for hosts where the KERNEL cannot help — i.e. the phone.
//
// On the home node an agent CLI is confined by Landlock/seccomp: told to write
// outside its workspace it gets "Read-only file system" from the kernel. Under
// Termux/proot there are no user namespaces, so no CLI's OS sandbox can even
// initialise, and every one of them must be launched with its gate off. That
// is a property of Android, not something Atlan can argue with.
//
// So on the phone the boundary moves to OUR side: the agent is not restrained,
// it is REDIRECTED. It runs against a disposable copy of the project, and
// nothing it produces reaches the real tree until a diff has been reviewed.
// Same doctrine ARCHITECTURE.md already states — walls are Atlan's job, not
// the vendor's — applied where the vendor's walls cannot run.
//
// BE PRECISE ABOUT WHAT THIS IS AND IS NOT:
//   IT DOES stop an agent from corrupting your project by mistake, from a bad
//   refactor landing unreviewed, and (with scrubbedEnv) from reading your
//   tokens out of its own environment.
//   IT DOES NOT stop a determined adversary. The process is unconfined: it can
//   still read anything the Termux user can read and can still reach the
//   network. This is containment against ERROR, not against ATTACK, and it
//   must never be described as a sandbox.
//
// The distinction matters because Atlan's whole claim is that its walls are
// real. A wall described accurately as a guardrail is honest. The same wall
// described as a sandbox is the lie that discredits the rest.

// Secrets never belong in a child agent's environment. Cheap, works on every
// host including the phone, and closes the one exfiltration path we DO control.
export function scrubbedEnv(base = process.env) {
  const env = { ...base };
  const DROP = [
    'ATLAN_TOKEN', 'ATLAN_ORIGIN',
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
    'DEEPSEEK_API_KEY', 'XAI_API_KEY', 'ANTIGRAVITY_API_KEY', 'GROQ_API_KEY',
    'MISTRAL_API_KEY', 'TOGETHER_API_KEY', 'OPENROUTER_API_KEY',
    'FIREWORKS_API_KEY', 'COHERE_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'GH_TOKEN',
  ];
  for (const k of DROP) delete env[k];
  // Anything that merely LOOKS like a credential goes too — a new provider
  // shouldn't need this list updated before it stops leaking.
  for (const k of Object.keys(env)) {
    if (/(^|_)(API_?KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)$/i.test(k)) delete env[k];
  }
  // PATH/HOME stay: the CLI needs to find its own binary and its own auth
  // store, which is how it runs on the subscription at all.
  return env;
}

// A disposable place for an agent to work.
//
// Prefers a git worktree when the project is a repo: it is near-instant, costs
// no disk for unchanged files, and — the real reason — `git diff` in it gives
// the write-back gate for free, already in review form.
// ASYNC on purpose. Every step here — copying a project, adding a git worktree —
// used to run synchronously on the event loop inside the HTTP handler that
// started the run, freezing the whole single-threaded cockpit for the duration.
// See the note in agentExec.
export async function openContained(projectDir, label = 'agent') {
  if (!existsSync(projectDir)) throw new Error(`no such project: ${projectDir}`);
  const isRepo = await git(['rev-parse', '--is-inside-work-tree'], projectDir).then(() => true, () => false);

  const dir = mkdtempSync(join(tmpdir(), `atlan-contained-${label}-`));

  if (isRepo) {
    const branch = `atlan/contained/${label}-${Date.now().toString(36)}`;
    await rm(dir, { recursive: true, force: true }); // git insists on creating it
    await git(['worktree', 'add', '-b', branch, dir, 'HEAD'], projectDir);
    return {
      dir,
      kind: 'git-worktree',
      // The proposed change set, in the only form a human should approve one.
      diff() {
        const stat = execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString();
        execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
        const patch = execFileSync('git', ['diff', '--cached'], { cwd: dir, maxBuffer: 32 * 1024 * 1024 }).toString();
        return { changed: stat.split('\n').filter(Boolean).length, patch, status: stat };
      },
      async cleanup() {
        try { await git(['worktree', 'remove', '--force', dir], projectDir); } catch { /* */ }
        try { await git(['branch', '-D', branch], projectDir); } catch { /* */ }
      },
    };
  }

  // Not a repo: a plain copy. Costs disk, and on the phone that matters, so
  // node_modules and .git-less heavy dirs are skipped.
  await cp(projectDir, dir, { recursive: true, filter: (src) => !SKIP.test(src) });

  return {
    dir,
    kind: 'copy',
    // COMPARE AGAINST THE ORIGINAL PROJECT, not against a timestamp.
    //
    // This used to be `find <dir> -newer <marker> -type f`, which by
    // construction can only enumerate files that still EXIST — so a proposal
    // that deleted half the project reported `changed: 0`, under-reporting
    // exactly the destructive changes a reviewer most needs to see. Worse, the
    // patch was always null and the workspace was rm -rf'd before the caller
    // ever saw the result, so every contained run on a non-git project (the
    // default on the phone) produced a record that said "N file(s) changed —
    // review, nothing applied" while pointing at paths inside a directory that
    // no longer existed. The run burned real tokens and the work product was
    // irretrievably gone.
    //
    // Walking BOTH trees fixes both halves at once: deletions are visible
    // because they are absences from the workspace, and the patch carries the
    // actual content, so the proposal survives teardown the same way the
    // git-worktree kind always did.
    // (Cross-vendor adversarial review, 2026-08-06.)
    diff() {
      const before = walk(projectDir), after = walk(dir);
      const added = [], removed = [], modified = [];
      for (const rel of after.keys()) if (!before.has(rel)) added.push(rel);
      for (const rel of before.keys()) {
        if (!after.has(rel)) { removed.push(rel); continue; }
        if (before.get(rel) !== after.get(rel)) modified.push(rel);
      }
      added.sort(); removed.sort(); modified.sort();
      const status = [
        ...added.map((f) => `A  ${f}`),
        ...modified.map((f) => `M  ${f}`),
        ...removed.map((f) => `D  ${f}`),
      ].join('\n');
      return { changed: added.length + removed.length + modified.length, patch: buildPatch(projectDir, dir, { added, removed, modified }), status };
    },
    async cleanup() { await rm(dir, { recursive: true, force: true }); },
  };
}

const SKIP = /(^|[\\/])(node_modules|\.fleet|\.snapshots|\.apk|\.git)([\\/]|$)/;
const git = (args, cwd) => execFile('git', args, { cwd });

// path → sha256(content), for every file the copy would have taken. Hashing
// rather than holding contents keeps a large project's comparison bounded.
function walk(root) {
  const out = new Map();
  const rec = (dir, prefix) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (SKIP.test(abs)) continue;
      // Symlinks are neither followed nor hashed: isDirectory()/isFile() are
      // false for them, so a link inside the workspace cannot walk us out of it.
      if (e.isDirectory()) rec(abs, rel);
      else if (e.isFile()) {
        try { out.set(rel, createHash('sha256').update(readFileSync(abs)).digest('hex')); } catch { /* unreadable file: treated as absent on both sides, so it never shows as a change */ }
      }
    }
  };
  rec(root, '');
  return out;
}

// A reviewable patch that OUTLIVES the workspace. Text files get their content;
// binary and oversized files are recorded by name and size, because a reviewer
// needs to know they changed even when the bytes are not worth showing.
const MAX_PATCH_FILE = 256 * 1024;
function buildPatch(src, dst, { added, removed, modified }) {
  const body = (base, rel) => {
    try {
      const buf = readFileSync(join(base, rel));
      if (buf.length > MAX_PATCH_FILE) return `[${buf.length} bytes — too large to inline]`;
      if (buf.includes(0)) return `[binary, ${buf.length} bytes]`;
      return buf.toString('utf8');
    } catch { return '[unreadable]'; }
  };
  const parts = [];
  for (const rel of added) parts.push(`+++ ADDED ${rel}\n${body(dst, rel)}`);
  for (const rel of modified) parts.push(`--- WAS ${rel}\n${body(src, rel)}\n+++ NOW ${rel}\n${body(dst, rel)}`);
  for (const rel of removed) parts.push(`--- DELETED ${rel}\n${body(src, rel)}`);
  return parts.length ? parts.join('\n\n') : null;
}
