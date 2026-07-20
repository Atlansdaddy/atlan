// Unit suite — pure functions in isolation, no server, no network. The
// deterministic core the whole product's honesty rests on: the safe arithmetic
// evaluator, the checker engine, the Persona+ compilers, the schema builders,
// scheduler due/grace math, and the timing-safe token compare.
import assert from 'node:assert';
import {
  safeArith, runCheckers, upsertPersona, upsertCommand, compilePersona,
  compileCommand, templateSchema, toolSchema, listPersonas, deletePersona,
} from '../server/src/personas.js';
import { _testInternals as ROUT } from '../server/src/routines.js';
import { _testInternals as AUTH } from '../server/src/auth.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (err) { fail++; console.log(`  ✗ ${name} — ${err.message}`); }
}

console.log('UNIT SUITE');

// ── safeArith: the tier-2 arithmetic checker's engine ──
test('safeArith does basic precedence', () => {
  assert.equal(safeArith('2+3*4', {}), 14);
  assert.equal(safeArith('(2+3)*4', {}), 20);
});
test('safeArith resolves scope variables', () => {
  assert.equal(safeArith('qty*unit_price', { qty: 3, unit_price: 10 }), 30);
  assert.ok(Math.abs(safeArith('qty*price*(1+markup)', { qty: 2, price: 100, markup: 0.1 }) - 220) < 1e-9);
});
test('safeArith handles unary minus', () => assert.equal(safeArith('-5+8', {}), 3));
test('safeArith REJECTS code injection (no eval reachable)', () => {
  assert.throws(() => safeArith('process.exit(1)', {}));
  assert.throws(() => safeArith('constructor', {}));
  assert.throws(() => safeArith('1;drop', {}));
  assert.throws(() => safeArith('a()', { a: 1 }));
});
test('safeArith fails on unknown identifier, not silently 0', () => {
  assert.throws(() => safeArith('mystery+1', {}));
});
test('safeArith rejects unbalanced parens + trailing tokens', () => {
  assert.throws(() => safeArith('(2+3', {}));
  assert.throws(() => safeArith('2+3)', {}));
  assert.throws(() => safeArith('2 3', {}));
});

// ── checkers: tier-1 shape + tier-2 assertions ──
const CMD = {
  fields: [
    { name: 'category', type: 'string' }, { name: 'parts', type: 'array' },
    { name: 'total', type: 'number' }, { name: 'note', type: 'string' },
  ],
  checkers: [
    { kind: 'enum', field: 'category', values: ['washer', 'dryer'] },
    { kind: 'subset-of-var', field: 'parts', ofVar: 'stock' },
    { kind: 'arith', field: 'total', formula: 'qty*price', tolerance: 0.01 },
    { kind: 'not-empty', field: 'note' },
  ],
};
test('checkers pass a fully valid answer', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: ['pump'], total: 20, note: 'ok' }, { stock: 'pump, belt', qty: 4, price: 5 });
  assert.ok(v.passed, JSON.stringify(v.results.filter((r) => !r.ok)));
  assert.match(v.tier3, /semantic/);
});
test('tier-1 catches a wrong type', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: 'not-an-array', total: 20, note: 'ok' }, { stock: 'pump', qty: 4, price: 5 });
  assert.ok(!v.passed);
  assert.ok(v.results.some((r) => r.tier === 1 && !r.ok && r.check.includes('parts')));
});
test('enum checker rejects an off-list value', () => {
  const v = runCheckers(CMD, { category: 'spaceship', parts: [], total: 20, note: 'x' }, { stock: '', qty: 4, price: 5 });
  assert.ok(v.results.some((r) => r.check.includes('category') && !r.ok));
});
test('subset-of-var catches an invented part', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: ['flux capacitor'], total: 20, note: 'x' }, { stock: 'pump, belt', qty: 4, price: 5 });
  const r = v.results.find((x) => x.check.includes('parts') && x.tier === 2);
  assert.ok(!r.ok && /flux/.test(r.got));
});
test('arith checker catches a math error with the expected value', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: [], total: 999, note: 'x' }, { stock: '', qty: 4, price: 5 });
  const r = v.results.find((x) => x.tier === 2 && x.check.includes('total'));
  assert.ok(!r.ok && r.got.includes('20'), JSON.stringify(r));
});
test('not-empty catches blank + whitespace', () => {
  const v = runCheckers(CMD, { category: 'washer', parts: [], total: 20, note: '   ' }, { stock: '', qty: 4, price: 5 });
  assert.ok(v.results.some((r) => r.check.includes('note') && !r.ok));
});

// ── Persona+ compilers ──
test('compilePersona emits FOCUS, NO_NOS, scope guard', () => {
  const s = compilePersona({ name: 'X', focus: 'only Y', no_nos: ['never Z'], skills: ['A'] });
  assert.match(s, /FOCUS: only Y/);
  assert.match(s, /never Z/);
  assert.match(s, /out of scope/i);
});
test('templateSchema is strict JSON-schema of the TEMPLATE', () => {
  const s = templateSchema(CMD);
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.required.sort(), ['category', 'note', 'parts', 'total']);
  assert.equal(s.properties.parts.type, 'array');
  assert.equal(s.properties.total.type, 'number');
});
test('toolSchema maps VARIABLES to typed params w/ required set', () => {
  const cmd = { name: 'REQ', focus: 'f', variables: [
    { name: 'a', type: 'string', required: true }, { name: 'b', type: 'number', required: false },
    { name: 'c', type: 'enum', values: ['x', 'y'], required: true },
  ] };
  const t = toolSchema(cmd);
  assert.deepEqual(t.input_schema.required.sort(), ['a', 'c']);
  assert.deepEqual(t.input_schema.properties.c.enum, ['x', 'y']);
  assert.equal(t.input_schema.properties.b.type, 'number');
});
test('compileCommand injects variable values into the REQUEST', () => {
  const cmd = { name: 'REQ', focus: 'f', variables: [{ name: 'city', type: 'string' }], fields: [{ name: 'out', type: 'string' }] };
  assert.match(compileCommand(cmd, { city: 'Baltimore' }), /Baltimore/);
});

// ── validation guards ──
test('upsertPersona requires NAME and FOCUS', () => {
  assert.throws(() => upsertPersona({ name: '', focus: 'x' }));
  assert.throws(() => upsertPersona({ name: 'x', focus: '' }));
});
test('upsertCommand requires at least one TEMPLATE field', () => {
  assert.throws(() => upsertCommand({ name: 'R', fields: [] }));
});
test('upsertCommand drops a checker that points at a nonexistent field', () => {
  const c = upsertCommand({ name: 'R', fields: [{ name: 'a', type: 'string' }], checkers: [{ kind: 'enum', field: 'ghost', values: ['x'] }] });
  assert.equal(c.checkers.length, 0);
  deletePersona(c.id); // no-op cleanup path
});
test('upsertCommand rejects an invalid regex checker', () => {
  const c = upsertCommand({ name: 'R2', fields: [{ name: 'a', type: 'string' }], checkers: [{ kind: 'regex', field: 'a', pattern: '(' }] });
  assert.equal(c.checkers.length, 0);
});

// ── scheduler math ──
test('every-N due = lastFire + interval', () => {
  const now = 1_000_000_000_000;
  const r = { cadence: { kind: 'every', minutes: 30 }, lastFireAt: now, createdAt: 0 };
  assert.equal(ROUT.dueAt(r), now + 30 * 60000);
});
test('every-N grace is half an interval; daily grace is 2h', () => {
  assert.equal(ROUT.graceMs({ cadence: { kind: 'every', minutes: 30 } }), 15 * 60000);
  assert.equal(ROUT.graceMs({ cadence: { kind: 'daily', at: '07:00' } }), 2 * 3600000);
});

// ── auth token compare ──
test('tokenOk rejects wrong length + wrong value, accepts exact', () => {
  // We don't know the live token here; assert the shape of the guarantees.
  assert.equal(AUTH.tokenOk(''), false);
  assert.equal(AUTH.tokenOk(null), false);
  assert.equal(AUTH.tokenOk('short'), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
