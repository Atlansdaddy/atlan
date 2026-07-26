// src/lib/probes/taint-engine.js
//
// Lightweight intra-procedural taint analyzer for JS/TS.
//
// This is the first piece of TRUE dataflow analysis in PreFlight, complementing
// the regex-list probes. The goal is not to replace CodeQL — that is a many-
// person-year effort with proprietary call-graph + IR infrastructure — but to
// raise the floor on JS/TS detection from "literal regex on a single line" to
// "track a tainted value through assignments and returns inside one function".
//
// Architecture
// ------------
// 1. Parse the file with acorn-loose (tolerates JSX, partial TS via type strip,
//    and broken code that real-world repos ship anyway).
// 2. Walk the AST function by function. Inside each function, build a per-block
//    map of identifier -> taint-state. Taint-state is { source: { type, line } }
//    when the identifier holds a value that originated from a SOURCE pattern,
//    and undefined otherwise.
// 3. On every assignment and var/let/const declaration, evaluate the RHS for
//    taint: a member expression `req.url`, a call to a known taint-yielding
//    function (`req.json()`, `localStorage.getItem(...)`, etc), or any
//    expression that READS an already-tainted identifier propagates taint to
//    the LHS.
// 4. On every CALL, check if the callee matches a SINK pattern and any
//    argument expression evaluates to a tainted identifier. If yes, emit a
//    finding tagged with the source AND sink AND the line numbers of both.
// 5. Sanitizer calls (a known-allowlisted function applied to a tainted
//    value before it reaches a sink) clear the taint on that intermediate
//    binding.
//
// Scope limits (intentional, kept tight for the first cut):
// - Intra-procedural only. We track taint within ONE function; we do not
//   follow the value across a function boundary except for the simple case
//   where a tainted value is returned and immediately assigned at the call
//   site within the same function.
// - No alias-of-alias analysis. `a = b; c = a;` correctly propagates b's
//   taint to c, but `obj.foo = x; const y = obj.foo;` does not — we treat
//   object property tracking as out of scope here.
// - Single file only. Imports are treated as untainted unless explicitly
//   modeled in the source/sink registries below.
//
// This file is the FOUNDATION. Each source/sink/sanitizer pair lands in the
// registries below, and a NEW probe (`probeTaintFlow`) consumes the analyzer
// output and emits findings. Adding coverage = adding a registry entry. The
// engine code itself does not change as the registry grows.

import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import * as acornLoose from 'acorn-loose';
import { isTestFile, isScannerSelfSource } from '../file-filter.js';

// JSX-aware tolerant parser. acorn-loose is the resilience layer (recovers
// from syntax errors); jsx adds the JSX grammar. Order matters: jsx must
// extend the BASE acorn parser, then loose wraps results from acorn directly.
// For files that fail strict parse, we fall back to acorn-loose alone (loses
// JSX but keeps something analyzable for .js / .ts).
const JsxParser = Parser.extend(jsx());

function parseFile(content, ext) {
  const isJsx = /\.(?:jsx|tsx)$/.test(ext);
  try {
    return JsxParser.parse(content, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
    });
  } catch {
    if (isJsx) {
      // For JSX, partial parse is better than nothing — but acorn-loose
      // doesn't speak JSX. Skip the file in that fallback.
      return null;
    }
    try {
      return acornLoose.parse(content, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
      });
    } catch {
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// A source produces a tainted value. Each source has a `matches(node)`
// predicate that returns truthy when the AST node represents a read of that
// source. Returns a `Source` object describing what was matched.

const SOURCES = [
  // req.url, req.originalUrl, req.path, req.baseUrl, req.body, req.body.x,
  // req.query, req.query.x, req.params, req.params.id, req.headers,
  // req.headers.host, req.cookies, req.searchParams.get(...)
  // Equivalents on `request`, `ctx`, `event`, `c.req`.
  {
    id: 'http-request-input',
    label: 'HTTP request input',
    matches(node) {
      if (node.type !== 'MemberExpression') return null;
      const objectName = readDottedName(node);
      if (!objectName) return null;
      const reqRe =
        /^(?:req|request|ctx|context|event|c\.req)\.(?:body|query|params|headers|cookies|searchParams|url|originalUrl|path|baseUrl|queryStringParameters)(?:\.[A-Za-z_$][\w$]*)*$/;
      if (reqRe.test(objectName)) {
        return { kind: 'http-request-input', detail: objectName };
      }
      return null;
    },
  },
  // localStorage.getItem('x'), sessionStorage.getItem('x'), document.cookie reads,
  // location.hash / location.search / window.name.
  {
    id: 'browser-storage-input',
    label: 'Browser storage / location input',
    matches(node) {
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        const name = readDottedName(node.callee);
        if (name === 'localStorage.getItem' || name === 'sessionStorage.getItem') {
          return { kind: 'browser-storage-input', detail: name };
        }
      }
      if (node.type === 'MemberExpression') {
        const name = readDottedName(node);
        if (
          name === 'document.cookie' ||
          name === 'location.hash' ||
          name === 'location.search' ||
          name === 'location.pathname' ||
          name === 'window.name'
        ) {
          return { kind: 'browser-storage-input', detail: name };
        }
      }
      return null;
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SINK REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// A sink is a function call (or assignment target) that does something
// dangerous with a tainted value. Each sink has a `matches(node)` predicate
// and a `cwe`/`severity`/`title`/`remediation`.

const SINKS = [
  // fs.readFile / fs.createReadStream / fs.writeFile / fsp.* / path.join /
  // path.resolve when called with a tainted argument.
  {
    id: 'fs-call',
    cwe: 'CWE-22',
    severity: 'high',
    title: 'Filesystem call built from user-controlled value (taint flow)',
    matches(node) {
      if (node.type !== 'CallExpression') return null;
      if (node.callee.type !== 'MemberExpression') return null;
      const name = readDottedName(node.callee);
      if (!name) return null;
      if (
        /^(?:fs|fsPromises|fsp|node:fs)\.(?:read|write|append|create(?:Read|Write)Stream|stat|lstat|access|unlink|rmdir|readdir|opendir|cp|copy)(?:File|Sync)?$/.test(
          name
        ) ||
        /^path\.(?:join|resolve)$/.test(name)
      ) {
        return { detail: name };
      }
      return null;
    },
    remediation:
      'A request-derived value reaches a filesystem call. Validate the path: resolve against a fixed base directory then assert the resolution still starts with that base, or use an allowlist of known filenames.',
  },
  // eval / new Function / Function.constructor.constructor (indirect eval).
  {
    id: 'code-eval',
    cwe: 'CWE-95',
    severity: 'critical',
    title: 'Dynamic code execution built from user-controlled value (taint flow)',
    matches(node) {
      if (node.type !== 'CallExpression') return null;
      if (node.callee.type === 'Identifier' && node.callee.name === 'eval')
        return { detail: 'eval' };
      if (node.callee.type === 'NewExpression' && node.callee.callee?.name === 'Function')
        return { detail: 'new Function' };
      if (node.callee.type === 'Identifier' && node.callee.name === 'setTimeout') {
        // setTimeout with a STRING first arg is the eval shape.
        return { detail: 'setTimeout(string)' };
      }
      if (node.callee.type === 'Identifier' && node.callee.name === 'setInterval') {
        return { detail: 'setInterval(string)' };
      }
      return null;
    },
    remediation:
      'A request-derived value reaches dynamic code execution. Never eval() / new Function() / setTimeout(string) with user-controlled content — this is direct RCE. Refactor to a switch / dispatch table over known safe operations.',
  },
  // child_process.exec / execSync / spawn with shell:true.
  {
    id: 'shell-exec',
    cwe: 'CWE-78',
    severity: 'critical',
    title: 'Shell command built from user-controlled value (taint flow)',
    matches(node) {
      if (node.type !== 'CallExpression') return null;
      // Resolve through import/require aliases so the destructured and
      // namespaced spellings match, not just a literal `child_process.exec`.
      const name = resolveDottedName(node.callee);
      if (!name) return null;
      if (/^child_process\.(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)$/.test(name)) {
        return { detail: name };
      }
      return null;
    },
    remediation:
      'A request-derived value reaches a shell-spawning call. exec/spawn pass through the shell when given a string — switch to execFile with an arg array, validate the value against an allowlist, or use a non-shell API.',
  },
  {
    id: 'ssrf-outbound',
    cwe: 'CWE-918',
    severity: 'high',
    title: 'Outbound request built from user-controlled URL (taint flow)',
    // Verified round 2026-07: the engine had no outbound-request sink at all,
    // so `const u = req.query.url; fetch(u)` produced nothing. The regex SSRF
    // probe only sees a single line, so the moment the URL passes through a
    // variable the flow was invisible to both.
    matches(node) {
      if (node.type !== 'CallExpression') return null;
      // Global fetch, and any local binding aliased to a fetch implementation.
      if (node.callee?.type === 'Identifier') {
        const n = node.callee.name;
        if (n === 'fetch') return { detail: 'fetch' };
        const aliased = currentAliases.get(n);
        if (aliased && /^(?:node-fetch|axios|got|superagent|undici|request)$/.test(aliased)) {
          return { detail: `${n} (${aliased})` };
        }
        return null;
      }
      const name = resolveDottedName(node.callee);
      if (!name) return null;
      if (
        /^(?:axios|got|superagent|needle|undici)\.(?:get|post|put|patch|delete|head|request|fetch)$/.test(
          name
        ) ||
        /^https?\.(?:get|request)$/.test(name) ||
        /^undici\.fetch$/.test(name)
      ) {
        return { detail: name };
      }
      return null;
    },
    remediation:
      'A request-derived value becomes the URL of an outbound request, which is server-side request forgery: the caller chooses what your server connects to, including cloud metadata endpoints and internal hosts. Resolve the value against an allowlist of permitted hosts before the call, reject non-http(s) schemes, and block link-local and private address ranges.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SANITIZER REGISTRY
// ─────────────────────────────────────────────────────────────────────────────
//
// When a sanitizer is applied to a tainted value, the result is no longer
// tainted. Sanitizers are matched as call expressions: the LHS that receives
// the result is the binding that gets cleared.

const SANITIZERS = [
  // path.normalize / path.resolve(BASE, x) when BASE is a literal — the
  // canonical traversal mitigation.
  {
    matches(node) {
      if (node.type !== 'CallExpression') return false;
      const name = node.callee.type === 'MemberExpression' ? readDottedName(node.callee) : null;
      if (name === 'path.normalize') return true;
      if (
        name === 'path.resolve' &&
        node.arguments[0] &&
        node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'string'
      )
        return true;
      return false;
    },
  },
  // DOMPurify.sanitize / sanitizeHtml / xss / he.encode / escape.
  {
    matches(node) {
      if (node.type !== 'CallExpression') return false;
      const name =
        node.callee.type === 'MemberExpression' ? readDottedName(node.callee) : node.callee.name;
      if (!name) return false;
      return /^(?:DOMPurify\.sanitize|sanitizeHtml|xss|he\.encode|escapeHtml|escape|validator\.escape)$/.test(
        name
      );
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

// Read a chain of MemberExpression / Identifier and return the dotted name.
// Returns null when computed properties (`obj[expr]`) interrupt the chain.
function readDottedName(node) {
  const parts = [];
  let cur = node;
  while (
    cur &&
    (cur.type === 'MemberExpression' || cur.type === 'Identifier' || cur.type === 'ThisExpression')
  ) {
    if (cur.type === 'Identifier') {
      parts.unshift(cur.name);
      break;
    }
    if (cur.type === 'ThisExpression') {
      parts.unshift('this');
      break;
    }
    // MemberExpression
    if (cur.computed) return null;
    if (cur.property.type !== 'Identifier') return null;
    parts.unshift(cur.property.name);
    cur = cur.object;
  }
  return parts.length ? parts.join('.') : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE ALIAS RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────
//
// Sinks are written against canonical module paths (`child_process.exec`), but
// almost nobody writes that. They write one of:
//
//   const cp = require('child_process');        cp.exec(x)
//   const { exec } = require('child_process');  exec(x)
//   import { exec } from 'node:child_process';  exec(x)
//   import cp from 'child_process';             cp.exec(x)
//
// Verified round 2026-07: none of those were detected, because the sink
// matched on the literal dotted text. The engine had the taint propagation
// right and was simply looking for a spelling that real code does not use.
//
// The map is rebuilt per file and consulted when resolving a callee's name.
let currentAliases = new Map();

// `node:child_process` and `child_process` are the same module.
const stripNodePrefix = (m) => String(m || '').replace(/^node:/, '');

function collectModuleAliases(ast) {
  const map = new Map();
  const add = (local, canonical) => {
    if (local && canonical) map.set(local, canonical);
  };
  for (const node of ast.body || []) {
    // ESM: import cp from 'x' / import * as cp from 'x' / import { exec } from 'x'
    if (node.type === 'ImportDeclaration' && typeof node.source?.value === 'string') {
      const mod = stripNodePrefix(node.source.value);
      for (const spec of node.specifiers || []) {
        if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
          add(spec.local?.name, mod);
        } else if (spec.type === 'ImportSpecifier') {
          add(spec.local?.name, `${mod}.${spec.imported?.name || spec.local?.name}`);
        }
      }
      continue;
    }
    // CJS: const cp = require('x') / const { exec } = require('x')
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations || []) {
      const init = d.init;
      if (init?.type !== 'CallExpression') continue;
      if (init.callee?.type !== 'Identifier' || init.callee.name !== 'require') continue;
      const mod = init.arguments?.[0]?.value;
      if (typeof mod !== 'string') continue;
      const canonical = stripNodePrefix(mod);
      if (d.id?.type === 'Identifier') {
        add(d.id.name, canonical);
      } else if (d.id?.type === 'ObjectPattern') {
        for (const p of d.id.properties || []) {
          if (p.type !== 'Property' || p.key?.type !== 'Identifier') continue;
          const localName = p.value?.type === 'Identifier' ? p.value.name : p.key.name;
          add(localName, `${canonical}.${p.key.name}`);
        }
      }
    }
  }
  return map;
}

// Dotted name with the head segment rewritten through the alias map, so a sink
// written as `child_process.exec` matches however the author imported it.
function resolveDottedName(node) {
  const raw = readDottedName(node);
  if (!raw) return raw;
  const parts = raw.split('.');
  const mapped = currentAliases.get(parts[0]);
  if (!mapped) return raw;
  return [mapped, ...parts.slice(1)].join('.');
}

// Evaluate an expression node and decide whether it is tainted.
// `scope` is a Map<name, TaintTag>. Returns either the TaintTag or null.
function evaluateExpression(node, scope) {
  if (!node) return null;
  // Direct source pattern (e.g. req.url is a MemberExpression that matches).
  for (const src of SOURCES) {
    const hit = src.matches(node);
    if (hit) return { source: hit, originLine: node.loc?.start?.line };
  }
  // Identifier — look it up in scope.
  if (node.type === 'Identifier') {
    return scope.get(node.name) || null;
  }
  // ThisExpression — ignore.
  if (node.type === 'ThisExpression') return null;
  // Member expression — recurse into object.
  if (node.type === 'MemberExpression') {
    return evaluateExpression(node.object, scope);
  }
  // Call expression — if it's a sanitizer, the result is clean even if the
  // argument was tainted. Otherwise, propagate taint from EITHER the callee's
  // receiver (e.g. `location.hash.slice(1)` — the source is `location.hash`,
  // arguments are clean) OR any argument.
  if (node.type === 'CallExpression') {
    if (SANITIZERS.some((s) => s.matches(node))) return null;
    // Body-read calls that return user input: req.json(), req.text(),
    // req.formData(), request.json(), etc.
    if (node.callee.type === 'MemberExpression') {
      const name = readDottedName(node.callee);
      if (
        /^(?:req|request|ctx|context|event|c\.req)\.(?:json|text|formData|arrayBuffer|blob)$/.test(
          name
        )
      ) {
        return {
          source: { kind: 'http-request-body', detail: name + '()' },
          originLine: node.loc?.start?.line,
        };
      }
      // Receiver may itself be tainted: location.hash.slice(...) flows from
      // location.hash.
      const recvTaint = evaluateExpression(node.callee.object, scope);
      if (recvTaint) return recvTaint;
    }
    for (const arg of node.arguments) {
      const t = evaluateExpression(arg, scope);
      if (t) return t;
    }
    return null;
  }
  // Template literal — taint flows from any interpolation.
  if (node.type === 'TemplateLiteral') {
    for (const ex of node.expressions) {
      const t = evaluateExpression(ex, scope);
      if (t) return t;
    }
    return null;
  }
  // Binary plus — concatenation propagates taint.
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return evaluateExpression(node.left, scope) || evaluateExpression(node.right, scope);
  }
  // Logical (||, ??) — propagate taint from either side (defensive).
  if (node.type === 'LogicalExpression') {
    return evaluateExpression(node.left, scope) || evaluateExpression(node.right, scope);
  }
  // Conditional — propagate taint from either branch.
  if (node.type === 'ConditionalExpression') {
    return evaluateExpression(node.consequent, scope) || evaluateExpression(node.alternate, scope);
  }
  // Await unwraps the value.
  if (node.type === 'AwaitExpression') {
    return evaluateExpression(node.argument, scope);
  }
  // Sequence — last expression wins.
  if (node.type === 'SequenceExpression') {
    return evaluateExpression(node.expressions[node.expressions.length - 1], scope);
  }
  return null;
}

// Walk a function body, tracking taint in `scope`. Emits `findings` array as
// new entries are discovered.
function analyzeFunctionBody(body, scope, findings, file) {
  if (!body) return;
  walk(body, scope, findings, file);
}

function walk(node, scope, findings, file) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      if (d.id?.type === 'Identifier' && d.init) {
        const t = evaluateExpression(d.init, scope);
        if (t) scope.set(d.id.name, t);
      }
    }
  } else if (node.type === 'AssignmentExpression') {
    if (node.left.type === 'Identifier') {
      const t = evaluateExpression(node.right, scope);
      if (t) scope.set(node.left.name, t);
      else if (scope.has(node.left.name)) scope.delete(node.left.name);
    }
  } else if (node.type === 'CallExpression') {
    // If the call ITSELF is a sanitizer (e.g. `path.resolve(LITERAL, x)`),
    // it is intended to neutralize the taint, not propagate it. Skip the
    // sink check on the same node so a path-sink AND a path-sanitizer don't
    // conflict.
    const isSanitizer = SANITIZERS.some((s) => s.matches(node));
    // If the callee is a NewExpression (e.g. `new Function(code)()`), the
    // tainted args live on the NewExpression, not on the outer call. Check
    // both arg lists.
    const argSources = [];
    argSources.push(node.arguments);
    if (node.callee?.type === 'NewExpression' && Array.isArray(node.callee.arguments)) {
      argSources.push(node.callee.arguments);
    }
    if (!isSanitizer) {
      for (const sink of SINKS) {
        const sinkHit = sink.matches(node);
        if (!sinkHit) continue;
        let emitted = false;
        for (const argList of argSources) {
          if (emitted) break;
          for (const arg of argList) {
            const t = evaluateExpression(arg, scope);
            if (t) {
              emitted = true;
              findings.push({
                id: `taint-${sink.id}-${file.path}-${node.loc?.start?.line}`,
                probe: 'Taint Flow',
                title: sink.title,
                severity: sink.severity,
                category: 'Injection',
                cwe: sink.cwe,
                file: file.path,
                line: node.loc?.start?.line || 1,
                evidence: `Source: ${t.source.kind} (${t.source.detail}) at line ${t.originLine} → Sink: ${sinkHit.detail} at line ${node.loc?.start?.line}`,
                remediation: sink.remediation,
                taintPath: {
                  sourceLine: t.originLine,
                  sinkLine: node.loc?.start?.line,
                  sink: sinkHit.detail,
                  source: t.source.detail,
                },
              });
              break;
            }
          }
        }
      }
    }
  }
  // Recurse into child nodes EXCEPT into nested function bodies (those get
  // their own scope; we keep this analysis intra-procedural).
  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
    if (Array.isArray(val)) {
      for (const child of val) {
        if (
          child &&
          (child.type === 'FunctionDeclaration' ||
            child.type === 'FunctionExpression' ||
            child.type === 'ArrowFunctionExpression')
        ) {
          // Nested function — analyze with its own scope, parameters inherit
          // the http-input source if they look like (req, res) handler params.
          analyzeNestedFunction(child, findings, file);
          continue;
        }
        walk(child, scope, findings, file);
      }
    } else if (val && typeof val === 'object') {
      if (
        val.type === 'FunctionDeclaration' ||
        val.type === 'FunctionExpression' ||
        val.type === 'ArrowFunctionExpression'
      ) {
        analyzeNestedFunction(val, findings, file);
      } else {
        walk(val, scope, findings, file);
      }
    }
  }
}

function analyzeNestedFunction(fn, findings, file) {
  const scope = new Map();
  // Parameters named `req`, `request`, `ctx`, `event` are treated as tainted
  // sources directly — the value itself IS user input.
  for (const p of fn.params || []) {
    if (p.type === 'Identifier' && /^(?:req|request|ctx|event)$/.test(p.name)) {
      scope.set(p.name, {
        source: { kind: 'http-handler-param', detail: p.name },
        originLine: p.loc?.start?.line,
      });
    }
  }
  analyzeFunctionBody(fn.body, scope, findings, file);
}

export function probeTaintFlow(files) {
  const findings = [];
  for (const file of files) {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) continue;
    if (!/\.[jt]sx?$/.test(file.path)) continue;
    const ast = parseFile(file.content, file.path.match(/\.[jt]sx?$/)?.[0] || '.js');
    if (!ast) continue;
    // Rebuilt per file; sinks resolve callee names through it.
    currentAliases = collectModuleAliases(ast);
    // Top-level: still apply the analyzer (CommonJS scripts and Node entry
    // points often run handler code at module scope before defining a
    // function).
    const scope = new Map();
    analyzeFunctionBody(ast, scope, findings, file);
  }
  return findings;
}
