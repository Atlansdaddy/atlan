// src/lib/probes/v2/context.js
//
// F0: cross-cutting context detectors for the v2 probe families (spec §1.10,
// docs/preflight-v2-spec.md). Four detectors route every downstream family:
//
//   - detectFrameworks(files)   which UI framework(s) the project uses; the
//                               same syntax means different things across them
//                               (consumed by F1, F4, F6, F8)
//   - detectHost(files)         which AI build tool produced the project;
//                               routes UX copy, not detection logic
//   - getHookContextRanges()    where React hooks rules apply: inside
//                               components and custom hooks (F1, F4)
//   - getAsyncContextRanges()   async function bodies + async-callback
//                               hazards like `forEach(async ...)` (F2, F3, F11)
//
// All detectors are pure functions over the standard scan-file shape
// ({ path, content }) or a single file's content string. AST work uses the
// same acorn + acorn-jsx + acorn-loose stack as code-correctness.js.

import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { parse as looseParse } from 'acorn-loose';

const JSXParser = Parser.extend(jsx());

// Shared parse helper for the v2 families. Returns null when the file cannot
// be parsed even loosely — callers skip rather than crash the scan.
export function parseModule(content) {
  if (!content || !content.trim()) return null;
  try {
    return JSXParser.parse(content, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    });
  } catch {
    try {
      return looseParse(content, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch {
      return null;
    }
  }
}

// Minimal AST walker with parent tracking (same trade-off as
// code-correctness.js: a dependency isn't worth 20 lines).
export function walk(node, cb, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  cb(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') walk(child, cb, node);
      }
    } else if (value && typeof value.type === 'string') {
      walk(value, cb, node);
    }
  }
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

// Collect dependency names from every non-node_modules package.json in the
// scan set (dependencies + devDependencies + peerDependencies).
function collectDeps(files) {
  const deps = new Set();
  for (const f of files) {
    if (!/(^|\/)package\.json$/.test(f.path) || /node_modules/.test(f.path)) continue;
    let pkg;
    try {
      pkg = JSON.parse(f.content);
    } catch {
      continue;
    }
    for (const bucket of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
      if (bucket && typeof bucket === 'object') {
        for (const name of Object.keys(bucket)) deps.add(name);
      }
    }
  }
  return deps;
}

// Framework identity: dependency name, config file, or source extension.
// Meta-frameworks (next, astro) imply their UI library, so `all` can contain
// both 'next' and 'react'. `primary` prefers the meta-framework because it is
// the one that changes probe semantics (server components, route conventions).
const FRAMEWORK_SIGNALS = [
  { id: 'next', dep: 'next', config: /(^|\/)next\.config\.[mc]?[jt]s$/i },
  { id: 'astro', dep: 'astro', config: /(^|\/)astro\.config\.[mc]?[jt]s$/i, ext: /\.astro$/i },
  { id: 'svelte', dep: 'svelte', config: /(^|\/)svelte\.config\.[mc]?[jt]s$/i, ext: /\.svelte$/i },
  { id: 'vue', dep: 'vue', ext: /\.vue$/i },
  { id: 'solid', dep: 'solid-js' },
  { id: 'react', dep: 'react' },
];
const PRIMARY_ORDER = ['next', 'astro', 'svelte', 'vue', 'solid', 'react', 'none'];

export function detectFrameworks(files) {
  const deps = collectDeps(files);
  const all = new Set();
  const signals = [];

  for (const fw of FRAMEWORK_SIGNALS) {
    if (fw.dep && deps.has(fw.dep)) {
      all.add(fw.id);
      signals.push(`dependency "${fw.dep}"`);
      continue;
    }
    if (fw.config && files.some((f) => fw.config.test(f.path))) {
      all.add(fw.id);
      signals.push(`${fw.id} config file`);
      continue;
    }
    if (fw.ext && files.some((f) => fw.ext.test(f.path))) {
      all.add(fw.id);
      signals.push(`${fw.id} source files`);
    }
  }

  // JSX source without an explicit react dep (partial scans, CDN React).
  if (!all.has('react') && files.some((f) => /\.[jt]sx$/i.test(f.path))) {
    all.add('react');
    signals.push('jsx/tsx source files');
  }
  if (all.has('next')) all.add('react');

  const primary = PRIMARY_ORDER.find((id) => all.has(id)) || 'none';
  return { primary, all: [...all], signals };
}

// ---------------------------------------------------------------------------
// Host detection
// ---------------------------------------------------------------------------

// Host identity: the AI build tool that produced (or is editing) the project.
// File markers are the strong signals; content markers back them up. Multiple
// hosts routinely co-exist (a Lovable export opened in Cursor); `all` keeps
// every match, `primary` prefers the generator over the editor because the
// generator determines the project's shape.
const HOST_SIGNALS = [
  {
    id: 'lovable',
    paths: /(^|\/)(lovable\.config\.\w+)$/i,
    dep: 'lovable-tagger',
    content: { file: /\.html?$/i, re: /cdn\.gpteng\.co|gptengineer\.js|lovable\.dev/i },
  },
  { id: 'bolt', paths: /(^|\/)\.bolt\//i },
  { id: 'v0', content: { file: /\.(md|tsx?|jsx?)$/i, re: /\bv0\.dev\b|Generated by v0\b/i } },
  { id: 'replit', paths: /(^|\/)(\.replit|replit\.nix|replit\.md)$/i },
  // File markers are $-anchored: `.cursorrules.bak`, `CLAUDE.md.txt`, and
  // `GEMINI.md5` are not live markers (adversarial precision round 2026-07).
  { id: 'windsurf', paths: /(^|\/)(\.windsurfrules$|\.windsurf\/)/i },
  { id: 'cursor', paths: /(^|\/)(\.cursorrules$|\.cursor\/)/i },
  { id: 'claude-code', paths: /(^|\/)(CLAUDE\.md$|\.claude\/)/ },
  { id: 'gemini-cli', paths: /(^|\/)(GEMINI\.md$|\.gemini\/)/ },
  { id: 'codex', paths: /(^|\/)AGENTS\.md$/ },
];
const HOST_PRIMARY_ORDER = [
  'lovable',
  'bolt',
  'v0',
  'replit',
  'windsurf',
  'cursor',
  'claude-code',
  'gemini-cli',
  'codex',
];

export function detectHost(files) {
  const all = new Set();
  const signals = [];

  for (const host of HOST_SIGNALS) {
    if (host.paths) {
      const hit = files.find((f) => host.paths.test(f.path));
      if (hit) {
        all.add(host.id);
        signals.push(`${host.id}: ${hit.path}`);
        continue;
      }
    }
    if (host.dep) {
      const deps = collectDeps(files);
      if (deps.has(host.dep)) {
        all.add(host.id);
        signals.push(`${host.id}: dependency "${host.dep}"`);
        continue;
      }
    }
    if (host.content) {
      const hit = files.find(
        (f) => host.content.file.test(f.path) && host.content.re.test(f.content || '')
      );
      if (hit) {
        all.add(host.id);
        signals.push(`${host.id}: marker in ${hit.path}`);
      }
    }
  }

  const primary = HOST_PRIMARY_ORDER.find((id) => all.has(id)) || 'unknown';
  return { primary, all: [...all], signals };
}

// ---------------------------------------------------------------------------
// Hook-context detection (React)
// ---------------------------------------------------------------------------

// Resolve the "name" of a function node from its declaration context, the
// same way eslint-plugin-react-hooks does: declaration id, variable
// declarator, assignment target, or object property key.
function functionName(node, parent) {
  if (node.id && node.id.name) return node.id.name;
  if (!parent) return null;
  if (parent.type === 'VariableDeclarator' && parent.id && parent.id.name) return parent.id.name;
  if (parent.type === 'AssignmentExpression' && parent.left) {
    if (parent.left.type === 'Identifier') return parent.left.name;
    if (parent.left.type === 'MemberExpression' && parent.left.property?.name)
      return parent.left.property.name;
  }
  if (parent.type === 'Property' && parent.key?.name) return parent.key.name;
  if (parent.type === 'ExportDefaultDeclaration') return 'default';
  return null;
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

// Ranges where React hooks rules apply: component bodies (PascalCase name)
// and custom hook bodies (useXxx name). Name-based heuristic, identical to
// the official rules-of-hooks plugin — components without PascalCase names
// are invisible to it there too.
export function getHookContextRanges(content, ast = null) {
  const tree = ast || parseModule(content);
  if (!tree) return [];
  const ranges = [];
  walk(tree, (node, parent) => {
    if (!FUNCTION_TYPES.has(node.type)) return;
    const name = functionName(node, parent);
    if (!name) return;
    if (/^use[A-Z0-9]/.test(name)) {
      ranges.push({ start: node.start, end: node.end, kind: 'hook', name });
    } else if (/^[A-Z]/.test(name)) {
      ranges.push({ start: node.start, end: node.end, kind: 'component', name });
    }
  });
  return ranges;
}

// The innermost hook-context range containing `index`, or null. Innermost
// wins so a helper closure named lowercase inside a component still reports
// the component context it sits in.
export function hookContextAt(ranges, index) {
  let best = null;
  for (const r of ranges) {
    if (index < r.start || index > r.end) continue;
    if (!best || r.end - r.start < best.end - best.start) best = r;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Async-context detection
// ---------------------------------------------------------------------------

// Async function body ranges plus the async-callback hazards downstream
// probes assert on. The defining F2 hazard: `arr.forEach(async (x) => ...)` —
// forEach discards the returned promises, so the awaits neither serialize
// nor propagate rejections.
const CALLBACK_SINKS_NO_AWAIT = new Set(['forEach']);

export function getAsyncContextRanges(content, ast = null) {
  const tree = ast || parseModule(content);
  if (!tree) return { asyncRanges: [], hazards: [] };
  const asyncRanges = [];
  const hazards = [];
  walk(tree, (node, parent) => {
    if (FUNCTION_TYPES.has(node.type) && node.async) {
      asyncRanges.push({
        start: node.start,
        end: node.end,
        name: functionName(node, parent) || '(anonymous)',
      });
    }
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      CALLBACK_SINKS_NO_AWAIT.has(node.callee.property?.name) &&
      node.arguments?.[0] &&
      FUNCTION_TYPES.has(node.arguments[0].type) &&
      node.arguments[0].async
    ) {
      hazards.push({
        kind: 'async-forEach-callback',
        start: node.start,
        line: node.loc?.start?.line ?? null,
      });
    }
  });
  return { asyncRanges, hazards };
}

// ---------------------------------------------------------------------------
// F0 probe: host detection surfaced as an info finding
// ---------------------------------------------------------------------------

// The one user-visible output of F0: tell the user what PreFlight detected so
// downstream copy routing is inspectable (same transparency contract as the
// architecture classifier).
export function probeHostDetection(files) {
  const findings = [];
  const { primary, all, signals } = detectHost(files);
  if (primary === 'unknown') return findings;
  const label = {
    lovable: 'Lovable',
    bolt: 'Bolt',
    v0: 'v0',
    replit: 'Replit',
    windsurf: 'Windsurf',
    cursor: 'Cursor',
    'claude-code': 'Claude Code',
    'gemini-cli': 'Gemini CLI',
    codex: 'Codex',
  };
  findings.push({
    id: 'host-detection',
    probe: 'Host Detection',
    title: `Detected: built with ${label[primary] || primary}`,
    severity: 'info',
    category: 'Architecture',
    cwe: 'inventory',
    file: 'project root',
    line: 1,
    evidence: `signals: ${signals.join(' · ')}${all.length > 1 ? ` · all detected: ${all.map((h) => label[h] || h).join(', ')}` : ''}`,
    remediation:
      'Nothing to fix. PreFlight uses the detected build tool to tailor guidance: the same finding reads differently for a Lovable export than for a Cursor workspace. If the detection is wrong, the signals listed in the evidence show exactly what triggered it.',
  });
  return findings;
}
