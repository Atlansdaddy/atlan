// Token optimization experiment harness (docs/TOKEN-OPTIMIZATION.md).
// Measures OUR real cache behavior — vendor numbers are hypotheses, this is
// the ground truth. Runs a fixed task cold, then again resumed (warm), and
// reports the input / cache-write / cache-read breakdown per turn.
//
// PAID: makes 2 real Claude runs. Opt in with RUN_PAID=1.
//   RUN_PAID=1 node test/token-bench.mjs
import { query } from '@anthropic-ai/claude-agent-sdk';

if (!process.env.RUN_PAID) {
  console.log('token-bench is a PAID experiment (2 real Claude runs). Re-run with RUN_PAID=1.');
  process.exit(0);
}

const MODEL = process.env.BENCH_MODEL || 'claude-haiku-4-5-20251001';
const CWD = '/root/atlan';
// Fixed, deterministic task so cold and warm runs share the same cacheable prefix.
const TASK = 'Reply with ONLY the number of top-level keys in package.json at the project root. Read it first.';

function usageOf(m) {
  const u = m.message?.usage ?? {};
  return {
    in: u.input_tokens ?? 0,
    out: u.output_tokens ?? 0,
    cw: u.cache_creation_input_tokens ?? 0,
    cr: u.cache_read_input_tokens ?? 0,
  };
}

async function runOnce(label, resume) {
  const opts = {
    cwd: CWD, model: MODEL, maxTurns: 6, settingSources: [],
    systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true },
    disallowedTools: ['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit'],
    ...(resume ? { resume } : {}),
  };
  const q = query({ prompt: TASK, options: opts });
  const agg = { in: 0, out: 0, cw: 0, cr: 0 };
  let sessionId = resume ?? null, cost = 0;
  for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') sessionId = m.session_id;
    else if (m.type === 'assistant') { const u = usageOf(m); agg.in += u.in; agg.out += u.out; agg.cw += u.cw; agg.cr += u.cr; }
    else if (m.type === 'result' && m.total_cost_usd != null) cost = m.total_cost_usd;
  }
  const fresh = agg.in + agg.out + agg.cw; // cache reads excluded (≈free) — our budget metric
  console.log(`\n[${label}]`);
  console.log(`  input=${agg.in}  output=${agg.out}  cache_write=${agg.cw}  cache_read=${agg.cr}`);
  console.log(`  fresh (billed-ish)=${fresh}  cost=$${cost.toFixed(4)}`);
  return { ...agg, fresh, cost, sessionId };
}

console.log('TOKEN BENCH — cache behaviour (L1 verification)');
console.log('model:', MODEL);
const cold = await runOnce('COLD (turn 1 — expect big cache_write, ~0 cache_read)');
const warm = await runOnce('WARM (resume — expect big cache_read, small cache_write)', cold.sessionId);

console.log('\n─────────── VERDICT ───────────');
const readShare = warm.cr / Math.max(1, warm.cr + warm.cw + warm.in);
console.log(`warm-run cache_read share of input: ${(readShare * 100).toFixed(1)}%`);
const pass = warm.cr > warm.cw && warm.cr > 0;
console.log(pass
  ? `✅ CACHING WORKS: the warm run reads from cache (${warm.cr}) more than it writes (${warm.cw}). L1 is live.`
  : `⚠️  caching not reused on the warm run (read=${warm.cr}, write=${warm.cw}) — investigate cache-busting.`);
console.log(`fresh-token delta cold→warm: ${cold.fresh} → ${warm.fresh} (${warm.fresh < cold.fresh ? 'warm cheaper ✓' : 'no improvement'})`);
process.exit(pass ? 0 : 1);
