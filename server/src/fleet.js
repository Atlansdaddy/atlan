import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { atomicWrite } from './fsutil.js';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Fleet = server-global budgeted agent runs. Three guarantees, by construction:
//  1. HARD budget — canUseTool refuses every tool past the cap and interrupts.
//  2. Profiles, not permission cards — the profile IS the standing answer;
//     off-profile tools are denied with a reason the agent can read.
//  3. Idle = zero tokens — nothing runs unless spawned (or, M5c, scheduled).
const __dirname = dirname(fileURLToPath(import.meta.url));
import { FLEET_DIR, DAILY_TOKEN_CAP, MAX_CONCURRENT_RUNS, TURN_RESERVE, sandboxOption, PROJECTS_DIR } from './config.js';
import { agentExec, killTree } from './agentExec.js';
import { isUnder } from './guards.js';
import { engineFidelity, policyArgs } from './enginePolicy.js';

// Engines that report no usage numbers at all. Admitting one under a token
// budget would be a promise nothing can keep: the run burns real tokens and the
// ledger records zero, so both the per-run budget and the global daily cap are
// bypassed by simply choosing that engine. They are refused under a budget
// unless the caller explicitly accepts an unmetered run.
// (Cross-vendor adversarial review, 2026-08-02.)
export const UNMETERED_ENGINES = new Set(['copilot', 'antigravity']);

// ── engines ───────────────────────────────────────────────────────────────
// The fleet was Claude-only: spawnRun called the Agent SDK directly, so every
// budgeted autonomous run had to be Claude no matter which engine was actually
// best for the job. `agentExec` is the batch primitive that closes that, and
// `enginePolicy` is what keeps the profile promise honest on engines whose
// gating is weaker than the SDK's.
//
// THE TWO PATHS ARE NOT EQUIVALENT, and the run record says so rather than
// papering over it:
//
//   claude — Agent SDK. Per-tool gating via canUseTool, so the HARD budget can
//            halt MID-RUN and off-profile tools are refused individually.
//            Resumable (session id) → top-up works.
//   cli    — one batch invocation of codex/grok/copilot/antigravity. The gate
//            is the CLI's own native flag, enforced by the kernel where the
//            host allows it. There is no per-tool callback, so the budget is a
//            PRE-FLIGHT admission check plus a post-hoc record — it cannot
//            interrupt a turn. No session id → not resumable.
//
// Reporting those as the same thing would be a lie by omission about what the
// walls were, which is the one thing the deterministic-walls thesis cannot
// survive. Hence `budgetEnforcement` and `boundary` on every run.
export const CLI_ENGINES = ['codex', 'grok', 'copilot', 'antigravity'];
export const FLEET_ENGINES = ['claude', ...CLI_ENGINES];

/** What each engine can actually promise here — drives the UI, honestly. */
export function engineCapabilities() {
  return FLEET_ENGINES.map((id) => {
    if (id === 'claude') {
      return {
        id,
        fidelity: 'full',
        profiles: Object.keys(PROFILES),
        budgetEnforcement: 'mid-run',
        resumable: true,
        why: 'Agent SDK: per-tool canUseTool gating + mid-run budget halt',
      };
    }
    const profiles = Object.keys(PROFILES).filter((p) => {
      try { policyArgs(id, p); return true; } catch { return false; }
    });
    return {
      id,
      fidelity: engineFidelity(id),
      profiles,
      budgetEnforcement: 'pre-flight',
      resumable: false,
      why: profiles.length
        ? `native gate for ${profiles.join('/')}`
        : `cannot enforce any profile here (fidelity: ${engineFidelity(id)}) — refused unless explicitly unsandboxed`,
    };
  });
}

// Budget reservation (peer review): reserve headroom for the current in-flight
// turn so a single big generation can't overshoot the cap before we count it.
// Never reserve more than half the budget, so a small run still gets to work.
const reserveFor = (budget) => Math.min(TURN_RESERVE, Math.floor(budget / 2));
// True once we're within the reserve of the budget → stop authorizing new
// tool-driven turns (the current turn still finishes; the post-message halt is
// the hard backstop if it exceeds the raw budget).
const budgetExhausted = (tokens, budget) => tokens + reserveFor(budget) >= budget;
export const _testInternals = { reserveFor, budgetExhausted, TURN_RESERVE };
mkdirSync(FLEET_DIR, { recursive: true });
const HISTORY = join(FLEET_DIR, 'history.jsonl');
const BURN = join(FLEET_DIR, 'burn.json');

let broadcast = () => {};
let notify = async () => {};
export function initFleet(broadcastFn, notifyFn) {
  broadcast = broadcastFn;
  if (notifyFn) notify = notifyFn;
}

const READONLY = new Set(['Read', 'Grep', 'Glob', 'LS']);
// Defense in depth, learned live on 2026-07-17: canUseTool alone is NOT a
// gate — the CLI auto-approves "safe" sandboxed Bash (and settings allowlists,
// before settingSources:[] stripped those) without ever calling it. So each
// profile ALSO hard-blocks its forbidden tools via disallowedTools, which the
// CLI enforces at tool level. canUseTool remains for the finer-grained checks
// (builder write-path scoping) and as the second belt.
// v1 honesty: where Bash IS allowed (builder/verifier) it's unscoped — the
// profile gates tools, not shell side effects. Scout is provably read-only.
const NEVER = ['WebFetch', 'WebSearch', 'Task', 'TodoWrite'];
const PROFILES = {
  scout: {
    label: 'Scout — read-only, no shell',
    disallowed: ['Bash', 'Edit', 'Write', 'NotebookEdit', ...NEVER],
    check(tool) {
      return READONLY.has(tool)
        ? { ok: true }
        : { ok: false, why: 'scout is read-only (Read/Grep/Glob) — no shell, no writes, no web' };
    },
  },
  builder: {
    label: 'Builder — files + bash, writes scoped to project',
    disallowed: NEVER.filter((t) => t !== 'TodoWrite'),
    check(tool, input, cwd) {
      if (READONLY.has(tool) || tool === 'TodoWrite' || tool === 'Bash') return { ok: true };
      if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') {
        const p = resolve(String(input?.file_path ?? input?.notebook_path ?? ''));
        return isUnder(p, cwd)
          ? { ok: true }
          : { ok: false, why: `writes must stay under ${cwd}` };
      }
      return { ok: false, why: 'not in builder profile — no web, no subagents, outbound goes through the user' };
    },
  },
  verifier: {
    label: 'Verifier — reads + runs checks, never edits what it grades',
    disallowed: ['Edit', 'Write', 'NotebookEdit', ...NEVER],
    check(tool) {
      return (READONLY.has(tool) || tool === 'Bash')
        ? { ok: true }
        : { ok: false, why: 'verifier reads and runs checks only — it never edits the work it grades' };
    },
  },
};
export const profileList = Object.entries(PROFILES).map(([id, p]) => ({ id, label: p.label }));
export const PROFILES_FOR_TEST = PROFILES;

// ── burn ledger (per-day totals survive restarts; live run burn is in-memory) ──
function dateKey() { return new Date().toISOString().slice(0, 10); }
function loadBurn() { try { return JSON.parse(readFileSync(BURN, 'utf8')); } catch { return {}; } }
export function todayBurn() {
  const d = { tokens: 0, cost: 0, cacheRead: 0, ...loadBurn()[dateKey()] };
  for (const r of runs) if (r.status === 'running') { d.tokens += r.tokens; d.cost += r.cost; d.cacheRead += r.cacheRead ?? 0; }
  return d;
}
function commitBurn(tokens, cost, cacheRead = 0) {
  const b = loadBurn();
  const d = { tokens: 0, cost: 0, cacheRead: 0, ...b[dateKey()] };
  d.tokens += tokens; d.cost += cost; d.cacheRead += cacheRead;
  b[dateKey()] = d;
  atomicWrite(BURN, JSON.stringify(b));
}

// ── runs ──
const runs = [];          // newest first; durable copy appended to history.jsonl
const active = new Map(); // id → query handle

function publicRun(r) {
  return {
    id: r.id, prompt: r.prompt.slice(0, 300), profile: r.profile, cwd: r.cwd,
    model: r.model, budget: r.budget, tokens: r.tokens, cost: r.cost,
    status: r.status, startedAt: r.startedAt, endedAt: r.endedAt,
    lastLine: r.lastLine, denials: r.denials.length,
    resultText: r.resultText ? r.resultText.slice(0, 4000) : null,
    resumable: r.status === 'halted-budget' && !!r.sessionId,
    resumedFrom: r.resumedFrom ?? null,
    source: r.source ?? null,
    cacheRead: r.cacheRead ?? 0,
    // ── what the walls ACTUALLY were on this run ──
    // A ledger that cannot distinguish a kernel-gated run from an ungated one
    // is lying by omission. These four travel with every run, including into
    // history.jsonl, so a receipt read months later still says what was true.
    engine: r.engine ?? 'claude',
    enforced: r.enforced ?? null,       // was the profile actually enforced?
    boundary: r.boundary ?? null,       // kernel | atlan | kernel+atlan | none
    budgetEnforcement: r.budgetEnforcement ?? 'mid-run',
    // false ⇒ this engine reports no usage, so `tokens` is "not measured",
    // never "cost nothing". A ledger reader must be able to tell those apart.
    tokensKnown: r.tokensKnown ?? true,
    proposal: r.proposal ?? null,       // contained runs produce a diff, not a result
  };
}

// Inbox survives restarts: last N finished runs from the durable log.
export function historyTail(n = 30) {
  try {
    const lines = readFileSync(HISTORY, 'utf8').trim().split('\n');
    return lines.slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  } catch { return []; }
}
export function listRuns() { return runs.slice(0, 50).map(publicRun); }
export function activeCount() { return active.size; }
export function isActive(id) { return active.has(id); }

// Budget counts FRESH tokens (input + output + cache writes; cache reads are
// ~free and excluded). Turn 1 alone costs ~35k (system-prompt cache write),
// so ~50k is the practical floor for a run that does anything.
export function spawnRun({
  prompt, profile = 'scout', cwd = PROJECTS_DIR, model = null, budget = 150000,
  resume = null, resumedFrom = null, source = null,
  engine = 'claude', allowUnsandboxed = false, contain = null, timeoutMs = 480000,
  allowUnmetered = false,
}) {
  const prof = PROFILES[profile];
  if (!prof) throw new Error(`unknown profile: ${profile}`);
  if (!prompt?.trim()) throw new Error('empty prompt');
  if (!FLEET_ENGINES.includes(engine)) {
    throw new Error(`unknown engine: ${engine} — one of ${FLEET_ENGINES.join(', ')}`);
  }
  // Model default is PER ENGINE. A hardcoded claude-haiku default was fine
  // while the fleet was Claude-only and becomes a bug the moment it is not.
  if (!model) model = engine === 'claude' ? 'claude-haiku-4-5-20251001' : null;
  // Fail EARLY and loudly if this engine cannot honestly enforce the profile
  // here — before a run id exists, before the ledger sees it, before the UI
  // shows a run that was never gated. policyArgs throws with the reason.
  if (engine !== 'claude') {
    policyArgs(engine, profile, { allowUnsandboxed });
  }
  // An engine that cannot report usage cannot be held to a budget. Saying so
  // beats recording zero and letting the ledger lie.
  if (UNMETERED_ENGINES.has(engine) && !allowUnmetered) {
    throw new Error(`${engine} reports no token usage, so a budget cannot be enforced or recorded — its spend would be invisible to the daily cap. Pass allowUnmetered to run it anyway (the run will be labelled unmetered).`);
  }
  // Aggregate guards (peer review): cap concurrency + a global daily token
  // ceiling that all runs draw from — so N concurrent runs can't multiply past
  // the wall. todayBurn() already folds in live runs' current spend.
  if (MAX_CONCURRENT_RUNS > 0 && active.size >= MAX_CONCURRENT_RUNS) {
    throw new Error(`too many runs in flight (${active.size}/${MAX_CONCURRENT_RUNS}) — let some finish or KILL ALL`);
  }
  if (DAILY_TOKEN_CAP > 0) {
    // Count what is COMMITTED plus what is already PROMISED to in-flight runs.
    //
    // todayBurn() folds in a live run's tokens-so-far, which works for the
    // Claude path (usage streams in per turn) and fails for the CLI path, where
    // tokens stay 0 until the single batch call returns. So N concurrent CLI
    // runs each saw the same burn total and were all admitted, collectively
    // blowing far past the cap. Reserving each in-flight run's remaining budget
    // closes that — admission is now against the worst case, not the observed.
    // (Cross-vendor adversarial review, 2026-08-02.)
    const inFlight = runs
      .filter((r) => r.status === 'running')
      .reduce((sum, r) => sum + Math.max(0, r.budget - r.tokens), 0);
    const projected = todayBurn().tokens + inFlight;
    if (projected >= DAILY_TOKEN_CAP) {
      throw new Error(`daily token cap would be exceeded (${projected}/${DAILY_TOKEN_CAP}, including ${inFlight} reserved by runs still in flight) — let some finish, or raise ATLAN_DAILY_TOKEN_CAP`);
    }
  }
  budget = Math.min(2_000_000, Math.max(1000, Number(budget) || 150000));
  const run = {
    id: randomUUID().slice(0, 8), prompt: prompt.trim(), profile, cwd, model, budget,
    tokens: 0, cost: 0, status: 'running', startedAt: Date.now(), endedAt: null,
    lastLine: 'diving…', denials: [], resultText: null,
    sessionId: null, resume, resumedFrom, source: source ? String(source).slice(0, 80) : null,
    cacheRead: 0, // cache-read input tokens (~free) — measures caching savings
    engine,
    allowUnsandboxed, contain, timeoutMs,
    enforced: null, boundary: null, proposal: null,
    // Set at spawn, not at finish: if the process dies mid-run the record must
    // still say which kind of budget this run ever had.
    budgetEnforcement: engine === 'claude' ? 'mid-run' : 'pre-flight',
  };
  runs.unshift(run);
  if (runs.length > 200) runs.pop();
  broadcast({ t: 'fleet.run', run: publicRun(run) });
  broadcast({ t: 'atlan.mood', mood: 'building', agents: active.size + 1 });
  // fire-and-forget: exec self-handles internally, but a stray rejection must
  // never become an unhandledRejection that takes down the whole server.
  const runner = engine === 'claude' ? exec(run, prof) : execCli(run);
  runner.catch((err) => { console.error('[fleet] exec crashed:', err); });
  return publicRun(run);
}

// ── the CLI path ──────────────────────────────────────────────────────────
// One batch invocation, gated by the engine's own native flag. Deliberately
// short: everything hard (boundary choice, containment, credential scrubbing,
// output parsing) already lives in agentExec, and duplicating any of it here
// would give us two places for the same guarantee to drift.
async function execCli(run) {
  const handle = { child: null, kill() { killTree(this.child); } };
  active.set(run.id, handle);
  event(run, `⚙ ${run.engine} · ${run.profile}`);
  // Record the walls BEFORE the run, not after it resolves. A run killed (or
  // crashed) mid-flight skips the success path, so deferring this left
  // enforced/boundary null on exactly the runs where "what were the walls?" is
  // the most important question. agentExec re-reports both on success and we
  // overwrite with its authoritative answer.
  // (Cross-vendor adversarial review, 2026-08-02.)
  try {
    const pre = policyArgs(run.engine, run.profile, { allowUnsandboxed: run.allowUnsandboxed });
    run.enforced = pre.enforced;
    run.boundary = pre.enforced ? 'kernel' : 'none';
  } catch { /* spawnRun already validated this; a throw here must not lose the run */ }
  try {
    const res = await agentExec({
      engine: run.engine,
      prompt: run.prompt,
      cwd: run.cwd,
      profile: run.profile,
      model: run.model,
      timeoutMs: run.timeoutMs,
      allowUnsandboxed: run.allowUnsandboxed,
      contain: run.contain,
      onSpawn: (child) => { handle.child = child; },
    });
    run.tokens = res.tokens ?? 0;
    run.tokensKnown = res.tokensKnown !== false;
    run.enforced = res.enforced;
    run.boundary = res.boundary;
    run.proposal = res.proposal ?? null;
    run.resultText = res.text || null;
    // A contained run changed a disposable copy, never the project. Say so in
    // the one line the inbox shows, or a reviewer will assume it landed.
    if (res.proposal) {
      run.lastLine = `proposal: ${res.proposal.changed} file(s) changed — review, nothing applied`;
    } else {
      run.lastLine = (res.text || 'surfaced').slice(0, 120);
    }
    if (run.status === 'running') run.status = 'done';
    // Post-hoc budget: this path cannot interrupt a turn, so an overrun is
    // RECORDED rather than prevented. Marking it keeps the ledger honest and
    // gives the UI something true to show.
    if (run.tokens > run.budget) {
      run.lastLine = `over budget: ${run.tokens}/${run.budget} tok (pre-flight budget — CLI runs cannot halt mid-turn)`;
    }
  } catch (err) {
    if (run.status === 'running') {
      run.status = 'error';
      run.lastLine = String(err?.message ?? err).slice(0, 160);
    }
  } finally {
    finish(run);
  }
}

async function exec(run, prof) {
  const framed = `[Atlan fleet run · profile: ${run.profile} · HARD budget: ${run.budget} tokens — past it every tool is refused and the run halts. Off-profile tools are auto-denied; don't fight denials, work within the profile. End with a compact report of what you found or did.]\n\n${run.prompt}`;
  let q = null;
  try {
    q = query({
      prompt: framed,
      options: {
        cwd: run.cwd,
        model: run.model,
        maxTurns: 40,
        // CRITICAL: no inherited settings. Accumulated always-allow rules in
        // settings.local.json would let tools walk past the profile without
        // ever reaching canUseTool — proven live by a scout running `ls` on
        // 2026-07-17. Profiles only mean something if this stays empty.
        settingSources: [],
        // Trim the per-run system-prompt cost: excludeDynamicSections drops the
        // per-session dynamic preamble so the preset caches across the fleet's
        // many short-lived runs, instead of each one paying a full ~35k write.
        systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
        disallowedTools: prof.disallowed,
        // OS-confine autonomous Bash (bubblewrap/seccomp) when ATLAN_SANDBOX=1 and
        // the host supports it. Deliberately WITHOUT autoAllowBashIfSandboxed —
        // sandboxed Bash still flows through canUseTool below, so the HARD budget
        // halt and profile gating stay in force. On proot it degrades to
        // unsandboxed (failIfUnavailable:false) and the Doctor reports it honestly.
        ...(sandboxOption() ? { sandbox: sandboxOption() } : {}),
        ...(run.resume ? { resume: run.resume } : {}),
        canUseTool: async (tool, input) => {
          if (run.status !== 'running') return { behavior: 'deny', message: 'run is stopping' };
          if (budgetExhausted(run.tokens, run.budget)) {
            halt(run, q);
            return { behavior: 'deny', message: `HARD BUDGET (${run.budget} tok, ${run.tokens} used + ${reserveFor(run.budget)} reserved for the in-flight turn) reached — Atlan halted this run.` };
          }
          const gate = prof.check(tool, input, run.cwd);
          if (!gate.ok) {
            run.denials.push(`${tool}: ${gate.why}`);
            event(run, `⛔ ${tool} — ${gate.why}`);
            return { behavior: 'deny', message: `Atlan ${run.profile} profile: ${gate.why}` };
          }
          event(run, `⚙ ${tool}`);
          return { behavior: 'allow', updatedInput: input };
        },
      },
    });
    active.set(run.id, q);
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') {
        run.sessionId = m.session_id;
      } else if (m.type === 'assistant') {
        const u = m.message?.usage;
        if (u) {
          run.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          run.cacheRead += (u.cache_read_input_tokens ?? 0); // cache hits, billed at ~0.1x — excluded from budget
          broadcast({ t: 'fleet.burn', id: run.id, tokens: run.tokens, budget: run.budget, cost: run.cost, cacheRead: run.cacheRead });
          if (run.tokens >= run.budget && run.status === 'running') halt(run, q);
        }
        for (const b of m.message?.content ?? []) {
          if (b.type === 'text' && b.text.trim()) {
            run.resultText = b.text.trim();
            run.lastLine = run.resultText.slice(0, 120);
          }
        }
      } else if (m.type === 'result') {
        if (m.total_cost_usd != null) run.cost = m.total_cost_usd;
        if (m.session_id) run.sessionId = m.session_id;
      }
    }
    if (run.status === 'running') { run.status = 'done'; run.lastLine = 'surfaced'; }
    // The Claude path's profile IS enforced — by disallowedTools at the CLI
    // level plus canUseTool as the second belt. Recorded explicitly so the
    // field means the same thing on both paths rather than being null here and
    // meaningful there.
    run.enforced = true;
    run.boundary = sandboxOption() ? 'kernel' : 'atlan';
  } catch (err) {
    if (run.status === 'running') {
      run.status = 'error';
      run.lastLine = String(err?.message ?? err).slice(0, 160);
    }
  } finally {
    finish(run);
  }
}

function halt(run, q) {
  run.status = 'halted-budget';
  run.lastLine = `hard budget hit at ${run.tokens} tok — halted`;
  q?.interrupt().catch(() => {});
}

function event(run, line) {
  run.lastLine = line;
  broadcast({ t: 'fleet.event', id: run.id, line });
}

function finish(run) {
  active.delete(run.id);
  if (!run.endedAt) run.endedAt = Date.now();
  commitBurn(run.tokens, run.cost, run.cacheRead);
  try { appendFileSync(HISTORY, JSON.stringify({ ...publicRun(run), prompt: run.prompt }) + '\n'); } catch { /* best-effort: history append is non-critical, a disk error here must not fail the run */ }
  broadcast({ t: 'fleet.done', run: publicRun(run), today: todayBurn() });
  broadcast({
    t: 'atlan.mood',
    mood: active.size ? 'building'
      : run.status === 'done' ? 'proud'
      : run.status === 'killed' ? 'calm' : 'alarmed',
    agents: active.size,
  });
  const snippet = run.prompt.slice(0, 60);
  if (run.status === 'done') notify('❖ Fleet run surfaced', `${run.profile}: ${snippet}`).catch(() => {});
  else if (run.status === 'halted-budget') notify('⚠ NEEDS YOU — budget hit', `${run.profile} halted at ${run.tokens} tok: ${snippet}. Top up to resume.`).catch(() => {});
  else if (run.status === 'error') notify('✗ Fleet run error', `${run.profile}: ${run.lastLine}`).catch(() => {});
}

// Budget halts aren't dead ends: same session, fresh budget, keeps going.
export function topUpRun(id, extra = 100000) {
  const prev = runs.find((r) => r.id === id);
  if (!prev) throw new Error('no such run');
  // Only the Claude path carries a session id, so only it can be continued.
  // Saying WHY beats a generic "not resumable" a user can't act on.
  if ((prev.engine ?? 'claude') !== 'claude') {
    throw new Error(`${prev.engine} runs are one-shot batch invocations with no session id — they cannot be topped up. Re-run with a larger budget.`);
  }
  if (prev.status !== 'halted-budget' || !prev.sessionId) throw new Error('run is not resumable');
  return spawnRun({
    prompt: `[Atlan top-up: the user added ${extra} tokens — continue the task where you left off and finish with the compact report.]`,
    profile: prev.profile, cwd: prev.cwd, model: prev.model, engine: prev.engine ?? 'claude',
    budget: extra, resume: prev.sessionId, resumedFrom: prev.id,
  });
}

export function killRun(id) {
  const run = runs.find((r) => r.id === id);
  const h = active.get(id);
  if (!run || !h || (run.status !== 'running' && run.status !== 'halted-budget')) return false;
  run.status = 'killed';
  run.lastLine = 'killed by you';
  // Two handle shapes, one guarantee. The SDK query exposes interrupt(); the
  // CLI path hands back a child process. KILL ALL must mean the same thing on
  // both or it is not a guarantee.
  if (typeof h.interrupt === 'function') h.interrupt().catch(() => {});
  else h.kill?.();
  return true;
}

export function killAll() {
  let n = 0;
  for (const id of [...active.keys()]) if (killRun(id)) n++;
  broadcast({ t: 'fleet.killall', n });
  return n;
}
