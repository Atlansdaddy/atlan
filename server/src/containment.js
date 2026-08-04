import { mkdtempSync, rmSync, existsSync, cpSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
export function openContained(projectDir, label = 'agent') {
  if (!existsSync(projectDir)) throw new Error(`no such project: ${projectDir}`);
  const isRepo = (() => {
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectDir, stdio: 'pipe' });
      return true;
    } catch { return false; }
  })();

  const dir = mkdtempSync(join(tmpdir(), `atlan-contained-${label}-`));

  if (isRepo) {
    const branch = `atlan/contained/${label}-${Date.now().toString(36)}`;
    rmSync(dir, { recursive: true, force: true }); // git insists on creating it
    execFileSync('git', ['worktree', 'add', '-b', branch, dir, 'HEAD'], { cwd: projectDir, stdio: 'pipe' });
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
      cleanup() {
        try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: projectDir, stdio: 'pipe' }); } catch { /* */ }
        try { execFileSync('git', ['branch', '-D', branch], { cwd: projectDir, stdio: 'pipe' }); } catch { /* */ }
      },
    };
  }

  // Not a repo: a plain copy. Costs disk, and on the phone that matters, so
  // node_modules and .git-less heavy dirs are skipped.
  cpSync(projectDir, dir, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(node_modules|\.fleet|\.snapshots|\.apk)([\\/]|$)/.test(src),
  });

  // A timestamp floor written AFTER the copy finishes. Everything the agent
  // touches is newer than this file; nothing the copy produced is.
  //
  // The previous version compared against the workspace directory itself —
  // `find <dir> -newer <dir>` — and a directory's mtime updates as files are
  // written into it, so the copied tree was rarely newer than its own parent
  // and `changed` came back 0 even when the agent had edited files. The project
  // stayed isolated (that part held), but the PROPOSAL RECORD said "0 files
  // changed" for a run that changed several — a reviewer would have approved an
  // empty diff for real work.
  //
  // A containment record that under-reports is the same failure class as a
  // ledger that cannot tell a gated run from an ungated one: isolation you
  // cannot audit is not isolation you can trust.
  // Found by a contextless cross-vendor audit, 2026-08-04.
  const marker = join(dir, '.atlan-contain-epoch');
  writeFileSync(marker, String(Date.now()));

  return {
    dir,
    kind: 'copy',
    diff() {
      // No git to diff against, so report the changed-file LIST and let the
      // caller review it. `-newer <marker>` is a real floor; the marker itself
      // is excluded so it never counts as a change.
      const out = execFileSync('find', [dir, '-newer', marker, '-type', 'f', '!', '-name', '.atlan-contain-epoch'], { cwd: dir }).toString();
      const files = out.split('\n').filter(Boolean);
      return { changed: files.length, patch: null, status: files.join('\n') };
    },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}
