import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Fleet = server-global budgeted agent runs. Three guarantees, by construction:
//  1. HARD budget — canUseTool refuses every tool past the cap and interrupts.
//  2. Profiles, not permission cards — the profile IS the standing answer;
//     off-profile tools are denied with a reason the agent can read.
//  3. Idle = zero tokens — nothing runs unless spawned (or, M5c, scheduled).
const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_DIR = join(__dirname, '../../.fleet');
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
        const root = cwd.endsWith('/') ? cwd : cwd + '/';
        const p = resolve(String(input?.file_path ?? input?.notebook_path ?? ''));
        return p.startsWith(root)
          ? { ok: true }
          : { ok: false, why: `writes must stay under ${cwd}` };
      }
      return { ok: false, why: 'not in builder profile — no web, no subagents, outbound goes through John' };
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
  const d = loadBurn()[dateKey()] ?? { tokens: 0, cost: 0 };
  for (const r of runs) if (r.status === 'running') { d.tokens += r.tokens; d.cost += r.cost; }
  return d;
}
function commitBurn(tokens, cost) {
  const b = loadBurn();
  const d = b[dateKey()] ?? { tokens: 0, cost: 0 };
  d.tokens += tokens; d.cost += cost;
  b[dateKey()] = d;
  writeFileSync(BURN, JSON.stringify(b));
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
export function spawnRun({ prompt, profile = 'scout', cwd = '/root', model = 'claude-haiku-4-5-20251001', budget = 150000, resume = null, resumedFrom = null, source = null }) {
  const prof = PROFILES[profile];
  if (!prof) throw new Error(`unknown profile: ${profile}`);
  if (!prompt?.trim()) throw new Error('empty prompt');
  budget = Math.min(2_000_000, Math.max(1000, Number(budget) || 150000));
  const run = {
    id: randomUUID().slice(0, 8), prompt: prompt.trim(), profile, cwd, model, budget,
    tokens: 0, cost: 0, status: 'running', startedAt: Date.now(), endedAt: null,
    lastLine: 'diving…', denials: [], resultText: null,
    sessionId: null, resume, resumedFrom, source: source ? String(source).slice(0, 80) : null,
  };
  runs.unshift(run);
  if (runs.length > 200) runs.pop();
  broadcast({ t: 'fleet.run', run: publicRun(run) });
  broadcast({ t: 'atlan.mood', mood: 'building', agents: active.size + 1 });
  exec(run, prof);
  return publicRun(run);
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
        // CRITICAL: no inherited settings. John's accumulated always-allow
        // rules (170+ Bash patterns in settings.local.json) would let tools
        // walk past the profile without ever reaching canUseTool — proven
        // live by a scout running `ls` on 2026-07-17. Profiles only mean
        // something if this stays empty.
        settingSources: [],
        disallowedTools: prof.disallowed,
        ...(run.resume ? { resume: run.resume } : {}),
        canUseTool: async (tool, input) => {
          if (run.status !== 'running') return { behavior: 'deny', message: 'run is stopping' };
          if (run.tokens >= run.budget) {
            halt(run, q);
            return { behavior: 'deny', message: `HARD BUDGET (${run.budget} tok) reached — Atlan halted this run.` };
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
          broadcast({ t: 'fleet.burn', id: run.id, tokens: run.tokens, budget: run.budget, cost: run.cost });
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
  commitBurn(run.tokens, run.cost);
  try { appendFileSync(HISTORY, JSON.stringify({ ...publicRun(run), prompt: run.prompt }) + '\n'); } catch {}
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
  if (prev.status !== 'halted-budget' || !prev.sessionId) throw new Error('run is not resumable');
  return spawnRun({
    prompt: `[Atlan top-up: John added ${extra} tokens — continue the task where you left off and finish with the compact report.]`,
    profile: prev.profile, cwd: prev.cwd, model: prev.model,
    budget: extra, resume: prev.sessionId, resumedFrom: prev.id,
  });
}

export function killRun(id) {
  const run = runs.find((r) => r.id === id);
  const q = active.get(id);
  if (!run || !q || (run.status !== 'running' && run.status !== 'halted-budget')) return false;
  run.status = 'killed';
  run.lastLine = 'killed by John';
  q.interrupt().catch(() => {});
  return true;
}

export function killAll() {
  let n = 0;
  for (const id of [...active.keys()]) if (killRun(id)) n++;
  broadcast({ t: 'fleet.killall', n });
  return n;
}
