import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStoredKey } from './keys.js';

// Persona+ engine — John's 2023 framework, compiled to the agentic stack:
//   persona block  → system prompt (stable identity, scoped, short NO_NOS)
//   structured command → a typed tool: VARIABLES = JSON-Schema params,
//   TEMPLATE = constrained response format, checkers = deterministic
//   assertions (a model never grades a model here).
// Tier taxonomy from the vertical blueprint: tier-1 format failures die at
// constrained decoding; tier-2 referential/arithmetic failures die at the
// checkers below; tier-3 (semantic-but-valid) is surfaced to John, never
// silently passed.
const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_DIR = join(__dirname, '../../.fleet');
mkdirSync(FLEET_DIR, { recursive: true });
const PERSONAS = join(FLEET_DIR, 'personas.json');
const COMMANDS = join(FLEET_DIR, 'commands.json');

const load = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return []; } };
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1));

let personas = load(PERSONAS);
let commands = load(COMMANDS);

// ── stores ──
export function listPersonas() { return personas; }
export function listCommands() { return commands; }

const S = (v, max = 4000) => String(v ?? '').slice(0, max).trim();
const SLIST = (v, max = 40) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((x) => S(x, 300)).filter(Boolean).slice(0, max);

export function upsertPersona(p) {
  const out = {
    id: p.id && personas.some((x) => x.id === p.id) ? p.id : randomUUID().slice(0, 8),
    name: S(p.name, 80), focus: S(p.focus, 600), bio: S(p.bio),
    skills: SLIST(p.skills), no_nos: SLIST(p.no_nos),
    template: S(p.template), instructions: S(p.instructions),
    profile: ['scout', 'builder', 'verifier'].includes(p.profile) ? p.profile : 'scout',
    updatedAt: Date.now(),
  };
  if (!out.name) throw new Error('persona needs a NAME');
  if (!out.focus) throw new Error('persona needs a FOCUS — scope is the moat');
  personas = [out, ...personas.filter((x) => x.id !== out.id)].slice(0, 200);
  save(PERSONAS, personas);
  return out;
}
export function deletePersona(id) {
  const before = personas.length;
  personas = personas.filter((x) => x.id !== id);
  save(PERSONAS, personas);
  return personas.length < before;
}

const VAR_TYPES = new Set(['string', 'number', 'boolean', 'enum']);
export function upsertCommand(c) {
  const vars = (Array.isArray(c.variables) ? c.variables : []).slice(0, 24).map((v) => ({
    name: S(v.name, 60).replace(/\W/g, '_'),
    type: VAR_TYPES.has(v.type) ? v.type : 'string',
    required: v.required !== false,
    description: S(v.description, 300),
    ...(v.type === 'enum' ? { values: SLIST(v.values, 30) } : {}),
  })).filter((v) => v.name);
  const fields = (Array.isArray(c.fields) ? c.fields : []).slice(0, 24).map((f) => ({
    name: S(f.name, 60).replace(/\W/g, '_'),
    type: ['string', 'number', 'boolean', 'array'].includes(f.type) ? f.type : 'string',
    description: S(f.description, 300),
  })).filter((f) => f.name);
  const out = {
    id: c.id && commands.some((x) => x.id === c.id) ? c.id : randomUUID().slice(0, 8),
    name: S(c.name, 80).toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'REQUEST_TASK',
    personaId: personas.some((p) => p.id === c.personaId) ? c.personaId : null,
    focus: S(c.focus, 600), instructions: S(c.instructions),
    variables: vars, fields,
    checkers: sanitizeCheckers(c.checkers, fields, vars),
    updatedAt: Date.now(),
  };
  if (!fields.length) throw new Error('command needs at least one TEMPLATE field — typed fields are what checkers grip');
  commands = [out, ...commands.filter((x) => x.id !== out.id)].slice(0, 500);
  save(COMMANDS, commands);
  return out;
}
export function deleteCommand(id) {
  const before = commands.length;
  commands = commands.filter((x) => x.id !== id);
  save(COMMANDS, commands);
  return commands.length < before;
}

// ── checkers: deterministic assertions, tier-2 of the blueprint ──
const CHECKER_KINDS = new Set(['enum', 'range', 'regex', 'subset-of-var', 'not-empty', 'max-length', 'arith']);
function sanitizeCheckers(list, fields, vars) {
  const fieldNames = new Set(fields.map((f) => f.name));
  const varNames = new Set(vars.map((v) => v.name));
  return (Array.isArray(list) ? list : []).slice(0, 40).map((k) => {
    if (!CHECKER_KINDS.has(k.kind) || !fieldNames.has(k.field)) return null;
    const base = { kind: k.kind, field: k.field };
    if (k.kind === 'enum') return { ...base, values: SLIST(k.values, 50) };
    if (k.kind === 'range') return { ...base, min: Number(k.min ?? -Infinity), max: Number(k.max ?? Infinity) };
    if (k.kind === 'regex') { try { new RegExp(k.pattern); } catch { return null; } return { ...base, pattern: S(k.pattern, 200) }; }
    if (k.kind === 'subset-of-var') return varNames.has(k.ofVar) ? { ...base, ofVar: k.ofVar } : null;
    if (k.kind === 'max-length') return { ...base, max: Number(k.max) || 500 };
    if (k.kind === 'arith') return { ...base, formula: S(k.formula, 200), tolerance: Number(k.tolerance) || 0.01 };
    return base; // not-empty
  }).filter(Boolean);
}

// Tiny safe arithmetic evaluator for arith checkers: numbers, field/var names,
// + - * / and parens. No eval(), no function calls, unknown identifier = fail.
export function safeArith(formula, scope) {
  const tokens = formula.match(/\d+\.?\d*|[A-Za-z_]\w*|[()+\-*/]/g);
  if (!tokens || tokens.join('') !== formula.replace(/\s+/g, '')) throw new Error('bad formula');
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function atom() {
    const t = next();
    if (t === '(') { const v = expr(); if (next() !== ')') throw new Error('unbalanced ()'); return v; }
    if (t === '-') return -atom();
    if (/^\d/.test(t)) return parseFloat(t);
    if (/^[A-Za-z_]/.test(t)) {
      const v = Number(scope[t]);
      if (!Number.isFinite(v)) throw new Error(`"${t}" is not a number in scope`);
      return v;
    }
    throw new Error('bad token ' + t);
  }
  function term() { let v = atom(); while (peek() === '*' || peek() === '/') v = next() === '*' ? v * atom() : v / atom(); return v; }
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term(); return v; }
  const v = expr();
  if (i !== tokens.length) throw new Error('trailing tokens');
  return v;
}

export function runCheckers(cmd, output, vars = {}) {
  const results = [];
  // tier-1: every declared field present with the declared type
  for (const f of cmd.fields) {
    const v = output?.[f.name];
    const ok = f.type === 'array' ? Array.isArray(v)
      : f.type === 'number' ? typeof v === 'number' && Number.isFinite(v)
      : typeof v === f.type;
    results.push({ tier: 1, check: `field "${f.name}" is ${f.type}`, ok, got: ok ? undefined : JSON.stringify(v)?.slice(0, 80) ?? 'missing' });
  }
  // tier-2: authored deterministic assertions
  for (const k of cmd.checkers ?? []) {
    const v = output?.[k.field];
    let ok = false, got;
    try {
      if (k.kind === 'not-empty') ok = Array.isArray(v) ? v.length > 0 : String(v ?? '').trim().length > 0;
      else if (k.kind === 'enum') ok = k.values.includes(String(v));
      else if (k.kind === 'range') ok = typeof v === 'number' && v >= k.min && v <= k.max;
      else if (k.kind === 'regex') ok = new RegExp(k.pattern).test(String(v ?? ''));
      else if (k.kind === 'max-length') ok = String(v ?? '').length <= k.max;
      else if (k.kind === 'subset-of-var') {
        const allowed = String(vars[k.ofVar] ?? '').split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
        const items = (Array.isArray(v) ? v : [v]).map((s) => String(s).trim().toLowerCase());
        const strays = items.filter((it) => !allowed.some((a) => a.includes(it) || it.includes(a)));
        ok = strays.length === 0;
        if (!ok) got = `not in ${k.ofVar}: ${strays.join(', ')}`.slice(0, 120);
      } else if (k.kind === 'arith') {
        const scope = { ...vars, ...output };
        const expect = safeArith(k.formula, scope);
        ok = typeof v === 'number' && Math.abs(v - expect) <= k.tolerance * Math.max(1, Math.abs(expect));
        if (!ok) got = `${v} ≠ ${k.formula} = ${Number(expect.toFixed(4))}`;
      }
      if (got === undefined && !ok) got = JSON.stringify(v)?.slice(0, 80);
    } catch (err) { ok = false; got = String(err.message).slice(0, 100); }
    results.push({ tier: 2, check: describeChecker(k), ok, got: ok ? undefined : got });
  }
  const passed = results.every((r) => r.ok);
  return {
    results, passed,
    // tier-3 is irreducible: all checks green ≠ the answer is RIGHT for this
    // situation. The harness says so instead of pretending.
    tier3: passed ? 'all deterministic checks pass — semantic fitness is yours to judge (tier-3)' : null,
  };
}
function describeChecker(k) {
  if (k.kind === 'enum') return `"${k.field}" ∈ [${k.values.join(', ')}]`;
  if (k.kind === 'range') return `"${k.field}" in ${k.min}…${k.max}`;
  if (k.kind === 'regex') return `"${k.field}" matches /${k.pattern}/`;
  if (k.kind === 'subset-of-var') return `"${k.field}" ⊆ input "${k.ofVar}"`;
  if (k.kind === 'max-length') return `"${k.field}" ≤ ${k.max} chars`;
  if (k.kind === 'arith') return `"${k.field}" = ${k.formula} (±${k.tolerance * 100}%)`;
  return `"${k.field}" not empty`;
}

// ── compilers ──
export function compilePersona(p) {
  if (!p) return '';
  return [
    `PERSONA: ${p.name}`,
    `FOCUS: ${p.focus}`,
    p.bio && `BIO: ${p.bio}`,
    p.skills?.length && `SKILLS:\n${p.skills.map((s) => `- ${s}`).join('\n')}`,
    p.no_nos?.length && `NO_NOS (hard limits — never violate):\n${p.no_nos.map((s) => `- ${s}`).join('\n')}`,
    p.template && `TEMPLATE: ${p.template}`,
    p.instructions && `INSTRUCTIONS: ${p.instructions}`,
    `You stay strictly inside your FOCUS. If asked outside it, say it is out of scope.`,
  ].filter(Boolean).join('\n\n');
}

export function compileCommand(cmd, vars = {}) {
  const lines = [`${cmd.name}`];
  if (cmd.focus) lines.push(`FOCUS: ${cmd.focus}`);
  if (cmd.variables.length) {
    lines.push('VARIABLES:');
    for (const v of cmd.variables) lines.push(`- ${v.name}: ${JSON.stringify(vars[v.name] ?? '')}`);
  }
  lines.push('RESPONSE TEMPLATE — reply with ONLY a JSON object of exactly these fields:');
  for (const f of cmd.fields) lines.push(`- "${f.name}" (${f.type})${f.description ? ` — ${f.description}` : ''}`);
  if (cmd.instructions) lines.push(`INSTRUCTIONS: ${cmd.instructions}`);
  return lines.join('\n');
}

// JSON Schema of the response TEMPLATE → llama-server / OpenAI-compat
// response_format json_schema = tier-1 failures impossible by construction.
export function templateSchema(cmd) {
  const props = {};
  for (const f of cmd.fields) {
    props[f.name] = f.type === 'array' ? { type: 'array', items: { type: 'string' } } : { type: f.type };
  }
  return {
    type: 'object', properties: props,
    required: cmd.fields.map((f) => f.name), additionalProperties: false,
  };
}

// The command's input side as a tool schema (VARIABLES → parameters) — this is
// the "Persona+ compiles to a tool" half; shown in the builder + used by docs.
export function toolSchema(cmd) {
  const props = {};
  for (const v of cmd.variables) {
    props[v.name] = v.type === 'enum'
      ? { type: 'string', enum: v.values ?? [], description: v.description }
      : { type: v.type === 'number' ? 'number' : v.type === 'boolean' ? 'boolean' : 'string', description: v.description };
  }
  return {
    name: cmd.name.toLowerCase(), description: cmd.focus || cmd.name,
    input_schema: { type: 'object', properties: props, required: cmd.variables.filter((v) => v.required).map((v) => v.name) },
  };
}

// ── harness: run a command against an OpenAI-compat engine, checker-gated ──
const HARNESS_PROVIDERS = {
  local: { base: 'http://127.0.0.1:8080/v1', keyEnv: null, model: 'local' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', model: 'gemini-3-flash-preview' },
  openai: { base: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', model: 'gpt-5.6-luna' },
  deepseek: { base: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' },
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export async function harnessRun({ commandId, vars = {}, engine = 'local', model, base = null }) {
  const cmd = commands.find((c) => c.id === commandId);
  if (!cmd) throw new Error('no such command');
  const missing = cmd.variables.filter((v) => v.required && !String(vars[v.name] ?? '').trim());
  if (missing.length) throw new Error(`missing required variables: ${missing.map((v) => v.name).join(', ')}`);
  let p = HARNESS_PROVIDERS[engine];
  if (!p) throw new Error('unknown harness engine');
  if (base) {
    // Alt local engine port (second llama-server, test mock). Loopback ONLY —
    // anything else would let a POST body aim server-side fetches at the LAN.
    let u;
    try { u = new URL(String(base)); } catch { throw new Error('bad base url'); }
    if (u.protocol !== 'http:' || !LOOPBACK.has(u.hostname)) throw new Error('base override must be http on loopback');
    p = { ...p, base: u.origin + '/v1', keyEnv: null };
  }
  const key = p.keyEnv ? (process.env[p.keyEnv] || getStoredKey(p.keyEnv)) : null;
  if (p.keyEnv && !key) throw new Error(`${engine} needs a key (Doctor → Engine keys)`);

  const persona = personas.find((x) => x.id === cmd.personaId);
  const messages = [
    { role: 'system', content: (persona ? compilePersona(persona) + '\n\n' : '') + 'You execute one structured command and reply with ONLY the JSON object the template demands. No prose, no markdown fences.' },
    { role: 'user', content: compileCommand(cmd, vars) },
  ];
  const schema = templateSchema(cmd);
  const t0 = Date.now();
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: model || p.model, messages, stream: false, temperature: 0.1,
      // json_schema constrained decoding where supported (llama-server, OpenAI,
      // DeepSeek); engines that ignore it still get the prompt-level contract.
      response_format: { type: 'json_schema', json_schema: { name: 'template', schema, strict: true } },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`${engine} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? '';
  let parsed = null, parseError = null;
  try { parsed = JSON.parse(raw.replace(/^```(json)?\s*|\s*```$/g, '')); } catch (e) { parseError = 'output is not valid JSON (tier-1 format failure)'; }
  const verdict = parsed ? runCheckers(cmd, parsed, vars) : { results: [], passed: false, tier3: null };
  return {
    engine, model: model || p.model, ms: Date.now() - t0,
    tokens: json.usage?.total_tokens ?? null,
    raw: raw.slice(0, 6000), parsed, parseError,
    ...verdict,
    // On fail the UI offers escalation: same persona+command to a Claude fleet
    // run — the M5d ladder (local executes, frontier picks up the hard 5%).
    escalatePrompt: verdict.passed ? null
      : `${persona ? compilePersona(persona) + '\n\n' : ''}${compileCommand(cmd, vars)}\n\n[Escalated: a local model failed deterministic checks${parseError ? ` (${parseError})` : ''}. Produce the JSON template correctly.]`,
  };
}
