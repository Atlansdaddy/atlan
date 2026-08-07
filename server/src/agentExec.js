import { spawn } from 'node:child_process';
import { policyArgs, sandboxCapableHost } from './enginePolicy.js';
import { openContained, scrubbedEnv } from './containment.js';
import { agyBin, grokBin, copilotBin } from './agents.js';

// agentExec — run a non-Claude agent CLI to completion and RETURN its result.
//
// This is the missing primitive. Atlan already drives these CLIs, but only
// through agentTurn(), which is WebSocket-shaped: it takes a `send` callback,
// streams frames at a live UI, and guards on `state.running`. Nothing can
// await it, so nothing that needs an answer — the hierarchy's tier ladder, a
// checker-gated link, a budget ledger — can use these engines at all.
//
// frontierExecute() in hierarchy.js already has the shape the ladder needs:
//   async (prompt, model) => { text, tokens }
// This gives the same shape to codex/grok/copilot/antigravity, which is what
// turns "Atlan can only automate Claude" into "Atlan can route a role to the
// engine that is actually best at it".
//
// It is deliberately NOT a second copy of agentTurn. agentTurn owns the
// interactive path — threading, resume, live tool frames, mood. This owns the
// batch path: one prompt, one answer, a token count, and a hard timeout.

// killTree now lives in procTree.js so the interactive chat path can use the
// same guarantee without agents.js and agentExec.js importing each other.
// Re-exported here because fleet.js and the suites already import it from this
// module, and the guarantee is the same one.
export { killTree } from './procTree.js';

const BIN = {
  codex: () => 'codex',
  antigravity: () => agyBin() ?? 'agy',
  grok: () => grokBin() ?? 'grok',
  copilot: () => copilotBin() ?? 'copilot',
};

// Headless invocation per CLI, with the profile's gate flags spliced in.
// Output formats differ, so each declares how to read text and tokens back.
function buildArgv(engine, prompt, gateArgs, model) {
  const m = model && model !== 'default' && model !== engine ? model : null;
  switch (engine) {
    case 'codex':
      // --json gives structured events: agent_message carries the text,
      // turn.completed carries usage. --skip-git-repo-check because a scratch
      // workspace is not always a repo (and codex refuses to start in one
      // that isn't trusted — a real failure mode, hit while testing this).
      return {
        args: ['exec', '--json', '--skip-git-repo-check', ...gateArgs, ...(m ? ['-m', m] : []), prompt],
        parse: 'codex-json',
      };
    case 'grok':
      return {
        args: ['--no-auto-update', '--output-format', 'json', ...gateArgs, ...(m ? ['-m', m] : []), '-p', prompt],
        parse: 'grok-json',
      };
    case 'copilot':
      return { args: [...gateArgs, ...(m ? ['--model', m] : []), '-p', prompt], parse: 'plain' };
    case 'antigravity':
      // agy 1.x has no stream-json; -p is plain text only.
      return { args: [...gateArgs, ...(m ? ['--model', m] : []), '-p', prompt], parse: 'plain' };
    default:
      throw new Error(`unknown engine: ${engine}`);
  }
}

function parseCodexJson(stdout) {
  let text = '', tokens = 0;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let e;
    try { e = JSON.parse(t); } catch { continue; }
    if (e.type === 'item.completed' && e.item) {
      const it = e.item;
      if ((it.type ?? it.item_type) === 'agent_message' && it.text) text += it.text;
    }
    if (e.type === 'turn.completed' && e.usage) {
      tokens += (e.usage.input_tokens ?? 0) + (e.usage.output_tokens ?? 0);
    }
  }
  return { text: text.trim(), tokens };
}

function parseGrokJson(stdout) {
  let text = '', tokens = 0;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const e = JSON.parse(t);
      if (typeof e.response === 'string') text += e.response;
      else if (typeof e.text === 'string') text += e.text;
      else if (typeof e.content === 'string') text += e.content;
      tokens += e.usage?.total_tokens ?? e.stats?.total_tokens ?? 0;
    } catch { /* not an event line */ }
  }
  return { text: text.trim(), tokens };
}

/**
 * Run an agent CLI to completion.
 *
 * @param {object}  o
 * @param {string}  o.engine   codex | grok | copilot | antigravity
 * @param {string}  o.prompt
 * @param {string}  o.cwd      the workspace — for a gated engine this is also
 *                             the write boundary the kernel enforces
 * @param {string}  o.profile  scout | builder | verifier
 * @param {number}  o.timeoutMs
 * @param {boolean} o.allowUnsandboxed  explicitly accept an UNGATED run (the
 *                                      phone case). Never defaults to true.
 * @returns {Promise<{text,tokens,engine,enforced,gate,exitCode}>}
 */
export async function agentExec({
  engine, prompt, cwd, profile = 'scout', model = null,
  timeoutMs = 480000, allowUnsandboxed = false, contain = null, env: extraEnv = {},
  onSpawn = null,
}) {
  if (!prompt?.trim()) throw new Error('empty prompt');
  if (!cwd) throw new Error('cwd is required — it IS the sandbox boundary');

  // ── choose a boundary ───────────────────────────────────────────────────
  // Kernel first. Where the kernel can't help (the phone), fall back to
  // containment on OUR side rather than to nothing. `contain` defaults to
  // "whatever this host can actually do", so callers get the strongest
  // available boundary without having to know which host they're on.
  const host = sandboxCapableHost();
  const useContainment = contain === true || (contain === null && !host.ok);

  // openContained is AWAITED. It used to be fully synchronous — cpSync of the
  // whole project, or execFileSync('git worktree add') — running on the event
  // loop inside the POST /api/fleet/run handler, so every contained run froze
  // the entire single-threaded cockpit for the length of the copy: measured
  // 566ms for a 20k-file project on an SSD, and this is the MANDATORY path on
  // the phone, where flash is several times slower. During the stall the
  // terminal is dead, preview frames are dropped and permission cards cannot be
  // answered. (Cross-vendor adversarial review, 2026-08-06.)
  let gate, workspace = null, runDir = cwd;
  if (host.ok) {
    // KERNEL FIRST, ALWAYS — even when containment is also requested.
    //
    // This used to be `if (host.ok && !useContainment)`, so asking for
    // containment on a sandbox-capable host silently DOWNGRADED the run to the
    // bypass path with allowUnsandboxed forced true, discarding both the
    // kernel gate and the caller's explicit refusal preference. It also made
    // the documented 'kernel+atlan' boundary unreachable — the code advertised
    // a combination it could never produce.
    //
    // Now the two boundaries compose the way the boundary string always said
    // they did: the kernel decides the gate, containment adds the disposable
    // workspace on top. (Cross-vendor adversarial review, 2026-08-02.)
    gate = policyArgs(engine, profile, { allowUnsandboxed });
    if (useContainment) {
      workspace = await openContained(cwd, engine);
      runDir = workspace.dir;
    }
  } else {
    // No kernel boundary. The CLI runs with its own gate off — that is the
    // only thing that starts under proot — but it is pointed at a disposable
    // copy, and its environment is stripped of every credential we hold.
    gate = policyArgs(engine, profile, { allowUnsandboxed: true });
    workspace = await openContained(cwd, engine);
    runDir = workspace.dir;
  }

  const { args, parse } = buildArgv(engine, prompt, gate.args, model);
  const bin = BIN[engine]();

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: runDir,
      // Own process GROUP. These CLIs spawn shells and tool children; killing
      // only the immediate process left descendants running while the fleet
      // reported the run killed. detached:true makes the child a group leader
      // so a negative-PID signal reaches the whole tree.
      detached: true,
      // Secrets are dropped from the child's environment on EVERY path, not
      // just the contained one. A gated agent has no more business reading
      // ATLAN_TOKEN than an ungated one.
      // SCRUB LAST, not first. `{...scrubbed, ...extraEnv}` let any caller
      // re-introduce exactly the credentials scrubbedEnv had just removed —
      // passing `{ ATLAN_TOKEN: '…' }` as extraEnv put it straight back on the
      // child. Merging first and scrubbing the RESULT makes the guarantee hold
      // at the API boundary rather than only for callers who behave.
      // (Cross-vendor adversarial review, 2026-08-02.)
      env: scrubbedEnv({ ...process.env, ...extraEnv }),
      stdio: ['ignore', 'pipe', 'pipe'],   // stdin ignored: codex otherwise
    });                                    // blocks reading it as prompt input
    // Hand the child to the caller so a long batch run stays killable. The
    // fleet's KILL ALL is a hard guarantee; without this the CLI path would be
    // the one kind of run that ignores it, which is exactly the sort of
    // silent asymmetry the profile work exists to prevent.
    try { onSpawn?.(child); } catch { /* a bad callback must not kill the run */ }
    let out = '', err = '', killed = null;
    const timer = setTimeout(() => { killed = `timeout after ${timeoutMs}ms`; killTree(child); }, timeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d.toString().slice(0, 4000); });
    // cleanup() is async and deliberately NOT awaited: the caller already has
    // the patch (see containment.diff), so teardown is pure housekeeping and must
    // not hold the event loop while a big tree is removed.
    const finish = (fn) => { try { fn(); } finally { if (workspace) Promise.resolve(workspace.cleanup()).catch(() => {}); } };

    child.on('error', (e) => {
      clearTimeout(timer);
      finish(() => reject(new Error(`${engine} failed to start: ${e.message}`)));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return finish(() => reject(new Error(`${engine}: ${killed}`)));
      // `tokensKnown` is the honest half of this. copilot and antigravity emit
      // plain text with NO usage numbers, and reporting that as `tokens: 0` let
      // a caller burn unlimited tokens while the ledger recorded nothing —
      // choosing one of those engines was a free pass past both the per-run
      // budget and the daily cap. An unknown count must be UNKNOWN, not zero.
      // (Cross-vendor adversarial review, 2026-08-02.)
      const parsed = parse === 'codex-json' ? { ...parseCodexJson(out), tokensKnown: true }
        : parse === 'grok-json' ? { ...parseGrokJson(out), tokensKnown: true }
          : { text: out.trim(), tokens: 0, tokensKnown: false };
      if (!parsed.text && code !== 0) {
        return finish(() => reject(new Error(`${engine} exited ${code}: ${(err || out).trim().slice(0, 300)}`)));
      }
      // A contained run produces a PROPOSAL, never a result. The diff is
      // captured before teardown so the caller can review and apply it; the
      // real project has not been touched at any point.
      let proposal = null;
      if (workspace) {
        try { proposal = { ...workspace.diff(), workspace: workspace.dir, kind: workspace.kind }; }
        catch (e) { proposal = { changed: -1, patch: null, status: `diff failed: ${e.message}` }; }
      }
      finish(() => resolve({
        text: parsed.text,
        tokens: parsed.tokens,
        // false ⇒ this engine reports no usage; `tokens` is a floor of 0 and
        // means "not measured", never "cost nothing". Callers that keep a
        // ledger MUST branch on this rather than trusting the number.
        tokensKnown: parsed.tokensKnown,
        engine,
        // Callers MUST be able to tell a gated run from an ungated one. A
        // budget ledger or a receipt that cannot distinguish them is lying by
        // omission about what the walls were during that run.
        enforced: gate.enforced,
        gate: gate.why,
        contained: !!workspace,
        // The two boundaries are INDEPENDENT and can both apply. Reporting
        // only the stronger one would hide that a run was also diff-gated,
        // and a receipt that understates the walls is as wrong as one that
        // overstates them.
        //   'kernel'       — the OS refused writes outside the workspace
        //   'atlan'        — disposable copy + diff gate + scrubbed env;
        //                    guards against ERROR, not against a hostile
        //                    process
        //   'kernel+atlan' — both: the phone's discipline with the home
        //                    node's enforcement
        //   'none'         — ungated and unconfined; only reachable by an
        //                    explicit allowUnsandboxed
        boundary: [gate.enforced ? 'kernel' : null, workspace ? 'atlan' : null].filter(Boolean).join('+') || 'none',
        proposal,
        exitCode: code,
        // The tail of stderr. Dropping it meant a caller could see 
        // and still have nothing to tell the user about what went wrong.
        stderr: err.trim().slice(-600),
      }));
    });
  });
}
