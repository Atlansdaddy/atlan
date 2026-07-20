import { query } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FLEET_DIR } from './config.js';
import { listCommands, listPersonas, compilePersona, compileCommand, templateSchema, runCheckers } from './personas.js';
import { getStoredKey } from './keys.js';

// Worker hierarchy — the approved schema, made runtime. A JOB is a chain of
// scoped LINKS; each Link is a Persona+ structured command run by the CHEAPEST
// capable worker on its ladder; deterministic checkers gate the output; a
// checker failure ESCALATES up the model tier; a human gate pauses where
// tier-3 (semantic-but-valid) risk concentrates. Decomposition is design-time
// (authored links), execution is deterministic — no runtime planner in the loop.
mkdirSync(FLEET_DIR, { recursive: true });
const JOBS_FILE = join(FLEET_DIR, 'hierarchy-jobs.json');
const loadJson = (p, f) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return f; } };

let broadcast = () => {};
export function initHierarchy(fn) { if (fn) broadcast = fn; }

// The model ladder — cheapest first. Config-aware would override this later;
// for now the honest default: free local → cheap cloud → frontier.
// Tier endpoints are env-overridable (tests point local/cloud-sm at mock
// engines to exercise the escalation ladder without real spend). An overridden
// base needs no key.
const localBase = process.env.ATLAN_TIER_LOCAL_BASE || 'http://127.0.0.1:8080/v1';
const cloudBase = process.env.ATLAN_TIER_CLOUDSM_BASE || 'https://api.deepseek.com/v1';
export const TIERS = {
  local:    { engine: 'local',    base: localBase, keyEnv: null,                                                   model: 'qwen',           constrained: true,  label: 'on-phone Qwen (free)' },
  'cloud-sm': { engine: 'deepseek', base: cloudBase, keyEnv: process.env.ATLAN_TIER_CLOUDSM_BASE ? null : 'DEEPSEEK_API_KEY', model: 'deepseek-chat', constrained: true, label: 'DeepSeek (cheap cloud)' },
  frontier: { engine: 'claude',   base: null,      keyEnv: null,                                                   model: 'claude-fable-5', constrained: false, label: 'Claude (frontier)' },
};
export const tierList = Object.entries(TIERS).map(([id, t]) => ({ id, label: t.label, constrained: t.constrained }));

// ── job store (authored plans persist; runs are in-memory + audit-logged) ──
let jobs = loadJson(JOBS_FILE, []);
const saveJobs = () => writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 1));
export function listJobs() { return jobs.map(publicJob); }
function publicJob(j) {
  return { id: j.id, title: j.title, humanGate: j.humanGate, maxEscalations: j.maxEscalations, budget: j.budget, links: j.links };
}

const S = (v, n = 400) => String(v ?? '').slice(0, n).trim();
export function upsertJob(input) {
  const links = (Array.isArray(input.links) ? input.links : []).slice(0, 30).map((l) => ({
    id: S(l.id, 40).replace(/\W/g, '_') || randomUUID().slice(0, 6),
    commandId: S(l.commandId, 40),
    inputsFrom: (Array.isArray(l.inputsFrom) ? l.inputsFrom : []).slice(0, 12).map((x) => S(x, 80)),
    startTier: TIERS[l.startTier] ? l.startTier : 'local',
    escalation: (Array.isArray(l.escalation) ? l.escalation : ['local', 'cloud-sm', 'frontier']).filter((t) => TIERS[t]),
    onCheckerFail: ['escalate', 'human', 'halt'].includes(l.onCheckerFail) ? l.onCheckerFail : 'escalate',
    humanGate: !!l.humanGate,
  })).filter((l) => l.commandId);
  const out = {
    id: input.id && jobs.some((j) => j.id === input.id) ? input.id : randomUUID().slice(0, 8),
    title: S(input.title, 120) || 'untitled job',
    humanGate: ['never', 'final', 'each-link', 'on-tier3'].includes(input.humanGate) ? input.humanGate : 'on-tier3',
    maxEscalations: Math.max(0, Math.min(5, Number(input.maxEscalations) || 2)),
    budget: Math.max(1000, Math.min(2_000_000, Number(input.budget) || 200000)),
    links,
  };
  if (!links.length) throw new Error('a job needs at least one link (each link references a structured command)');
  for (const l of links) if (!listCommands().some((c) => c.id === l.commandId)) throw new Error(`link "${l.id}": no such command ${l.commandId}`);
  jobs = [out, ...jobs.filter((j) => j.id !== out.id)].slice(0, 100);
  saveJobs();
  return publicJob(out);
}
export function deleteJob(id) {
  const n = jobs.length;
  jobs = jobs.filter((j) => j.id !== id);
  saveJobs();
  return jobs.length < n;
}

// ── execution ──
const runs = new Map(); // runId → live run state
export function listRuns() { return [...runs.values()].map(publicRunState); }
export function getRun(id) { const r = runs.get(id); return r ? publicRunState(r) : null; }
function publicRunState(r) {
  return {
    id: r.id, jobId: r.jobId, title: r.title, status: r.status,
    tokens: r.tokens, budget: r.budget, startedAt: r.startedAt, endedAt: r.endedAt,
    steps: r.steps.map((s) => ({
      linkId: s.linkId, command: s.command, status: s.status, tier: s.tier,
      escalations: s.escalations, tokens: s.tokens, passed: s.passed,
      checks: s.checks, output: s.output, note: s.note,
    })),
    awaiting: r.awaiting, // { linkId } when paused at a human gate
    result: r.result,
  };
}

function emit(r) { broadcast({ t: 'hierarchy.update', run: publicRunState(r) }); }

export function startJob(jobId, jobInput = {}) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('no such job');
  const run = {
    id: randomUUID().slice(0, 8), jobId: job.id, title: job.title, job,
    status: 'running', tokens: 0, budget: job.budget, startedAt: Date.now(), endedAt: null,
    blackboard: { 'job.input': jobInput }, steps: [], awaiting: null, result: null,
  };
  runs.set(run.id, run);
  emit(run);
  execJob(run).catch((err) => { run.status = 'error'; run.result = String(err?.message ?? err); run.endedAt = Date.now(); emit(run); });
  return publicRunState(run);
}

// resume a run paused at a human gate: approve (optionally edited output) or reject
export function resolveGate(runId, { approve, editedOutput = null } = {}) {
  const run = runs.get(runId);
  if (!run || !run.awaiting) throw new Error('run is not awaiting a human gate');
  const resolver = run._gateResolver;
  run.awaiting = null;
  run._gateResolver = null;
  resolver?.({ approve: !!approve, editedOutput });
  return publicRunState(run);
}

async function execJob(run) {
  const { job } = run;
  for (const link of job.links) {
    if (run.status !== 'running') break;
    const cmd = listCommands().find((c) => c.id === link.commandId);
    const step = { linkId: link.id, command: cmd?.name ?? '(missing)', status: 'running', tier: link.startTier, escalations: 0, tokens: 0, passed: false, checks: [], output: null, note: '' };
    run.steps.push(step);
    emit(run);
    if (!cmd) { step.status = 'error'; step.note = 'command deleted'; run.status = 'error'; run.result = `link ${link.id}: command missing`; break; }

    const vars = resolveInputs(link, run.blackboard, jobInputOf(run));
    let tierIdx = Math.max(0, link.escalation.indexOf(link.startTier));
    let done = false;
    while (!done) {
      const tierId = link.escalation[tierIdx];
      step.tier = tierId;
      emit(run);
      let out, verdict, err = null;
      try {
        out = await callTier(tierId, cmd, vars, run);
        verdict = runCheckers(cmd, out, vars);
      } catch (e) { err = e; verdict = { passed: false, results: [{ tier: 0, check: 'engine', ok: false, got: String(e.message).slice(0, 120) }] }; }
      step.tokens += out?._tokens ?? 0;
      run.tokens += out?._tokens ?? 0;
      step.checks = verdict.results;
      step.output = out && !err ? stripMeta(out) : null;

      if (run.tokens >= run.budget) { step.status = 'halted'; step.note = 'job budget hit'; run.status = 'halted-budget'; done = true; break; }

      if (verdict.passed) {
        // human gate where configured / where tier-3 risk concentrates
        const gate = link.humanGate || job.humanGate === 'each-link'
          || (job.humanGate === 'on-tier3' && link.escalation.length && tierId === link.escalation[link.escalation.length - 1]);
        if (gate) {
          const decision = await humanGate(run, step);
          if (!decision.approve) { step.status = 'rejected'; step.note = 'you rejected this output'; run.status = 'halted'; run.result = `stopped at ${link.id} (human reject)`; done = true; break; }
          if (decision.editedOutput) step.output = decision.editedOutput;
        }
        step.status = 'done'; step.passed = true;
        run.blackboard[link.id] = step.output;
        done = true;
      } else if (tierIdx < link.escalation.length - 1 && step.escalations < job.maxEscalations && link.onCheckerFail === 'escalate') {
        step.escalations++; tierIdx++; step.note = `checks failed → escalating to ${link.escalation[tierIdx]}`;
        emit(run);
      } else if (link.onCheckerFail === 'human') {
        const decision = await humanGate(run, step);
        if (decision.approve) { step.status = 'done'; step.passed = true; step.output = decision.editedOutput ?? step.output; run.blackboard[link.id] = step.output; }
        else { step.status = 'failed'; run.status = 'halted'; run.result = `stopped at ${link.id}`; }
        done = true;
      } else {
        step.status = 'failed'; step.note = 'checks failed, ladder exhausted';
        run.status = 'error'; run.result = `link ${link.id} failed its checkers`;
        done = true;
      }
    }
    if (run.status !== 'running') break;
  }
  if (run.status === 'running') { run.status = 'done'; run.result = assemble(run); }
  run.endedAt = Date.now();
  emit(run);
}

// Frontier execution: a no-tools Agent SDK query, awaited, returns text+tokens.
async function frontierExecute(prompt, model) {
  const q = query({
    prompt,
    options: {
      model,
      settingSources: [],
      maxTurns: 1,
      systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
      disallowedTools: ['Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookEdit'],
    },
  });
  let text = '', tokens = 0;
  for await (const m of q) {
    if (m.type === 'assistant') {
      for (const b of m.message?.content ?? []) if (b.type === 'text') text += b.text;
      const u = m.message?.usage;
      if (u) tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    }
  }
  return { text, tokens };
}

function jobInputOf(run) { return run.blackboard['job.input'] ?? {}; }
// inputsFrom wiring: "job.input.x" or "<linkId>.<field>" or bare "<linkId>"
function resolveInputs(link, blackboard, jobInput) {
  const vars = {};
  for (const ref of link.inputsFrom) {
    const [head, ...rest] = ref.split('.');
    if (head === 'job') { const key = rest.slice(1).join('.') || rest[0]; vars[rest[rest.length - 1] || 'input'] = dig(jobInput, rest.slice(1)); }
    else {
      const src = blackboard[head];
      const field = rest.join('.');
      vars[field || head] = field ? dig(src, rest) : src;
    }
  }
  // also expose the raw job input fields by name for convenience
  if (jobInput && typeof jobInput === 'object') for (const [k, v] of Object.entries(jobInput)) if (!(k in vars)) vars[k] = v;
  return vars;
}
function dig(obj, path) { return path.reduce((o, k) => (o == null ? o : o[k]), obj); }
function stripMeta(o) { if (o && typeof o === 'object') { const { _tokens, ...rest } = o; return rest; } return o; }

function humanGate(run, step) {
  run.awaiting = { linkId: step.linkId };
  step.status = 'awaiting-you';
  emit(run);
  return new Promise((resolve) => { run._gateResolver = resolve; });
}

function assemble(run) {
  // deterministic final: the last link's output, plus the full blackboard
  const last = run.steps[run.steps.length - 1];
  return { final: last?.output ?? null, blackboard: run.blackboard, audit: run.steps.map((s) => ({ link: s.linkId, tier: s.tier, escalations: s.escalations, tokens: s.tokens })) };
}

// Run a compiled command at a given tier. Frontier uses a real fleet run
// (has hands); local/cloud use constrained OpenAI-compat chat completions.
async function callTier(tierId, cmd, vars, run) {
  const tier = TIERS[tierId];
  const persona = listPersonas().find((p) => p.id === cmd.personaId);
  if (tier.engine === 'claude') {
    // frontier tier: the Agent SDK, no tools, awaited to completion so its JSON
    // is checked and passed down the chain like any other tier's output.
    const prompt = `${persona ? compilePersona(persona) + '\n\n' : ''}${compileCommand(cmd, vars)}\n\n[Reply with ONLY the JSON object the template demands — no prose, no fences. This is a hierarchy escalation: a smaller model failed the deterministic checkers.]`;
    const { text, tokens } = await frontierExecute(prompt, tier.model);
    let parsed;
    try { parsed = JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, '').trim()); } catch { throw new Error('frontier output was not valid JSON'); }
    parsed._tokens = tokens;
    return parsed;
  }
  const key = tier.keyEnv ? (process.env[tier.keyEnv] || getStoredKey(tier.keyEnv)) : null;
  if (tier.keyEnv && !key) throw new Error(`${tierId} needs ${tier.keyEnv}`);
  const messages = [
    { role: 'system', content: (persona ? compilePersona(persona) + '\n\n' : '') + 'Execute one structured command; reply with ONLY the JSON object the template demands.' },
    { role: 'user', content: compileCommand(cmd, vars) },
  ];
  const res = await fetch(`${tier.base}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: tier.model, messages, temperature: 0.1, stream: false,
      response_format: { type: 'json_schema', json_schema: { name: 'template', schema: templateSchema(cmd), strict: true } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`${tierId} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? '';
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^```(json)?\s*|\s*```$/g, '')); } catch { throw new Error('output was not valid JSON'); }
  parsed._tokens = json.usage?.total_tokens ?? 0;
  return parsed;
}
