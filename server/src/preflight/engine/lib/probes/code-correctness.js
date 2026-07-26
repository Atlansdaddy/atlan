// src/lib/probes/code-correctness.js
// AST-based correctness probe. Closes the gap that let an undefined-ref bug ship past
// PreFlight during the v0.4 routing refactor: regex probes can't model scope, so a
// reference to `urlHighlight` (a name never declared anywhere) parsed as "just a word."
//
// Defensive framing per PreFlight policy: this probe detects ABSENCE of a defensive
// pattern (an identifier with a binding). We are not building an exploit inventory;
// we are building a scope-validity check. The output is "no binding found for X,"
// not "here's how to confuse the parser."
//
// v1 scope (kept tight on purpose):
//   1. Parse .js / .jsx files with acorn + acorn-jsx (loose-parser fallback for
//      malformed source so one broken file doesn't abort the scan).
//   2. Walk the AST once, building a flat set of names that have a binding somewhere
//      in the file: imports, var/let/const declarations, function & class declarations,
//      function & arrow-function parameters, destructuring patterns, catch clauses,
//      JSX-context bindings (none in JSX itself, but the React identifier when classic
//      runtime is used).
//   3. Walk a second time, collecting every Identifier in a "use" position. Filter out
//      the ones that have a binding in step 2 OR are in the globals allowlist.
//   4. Each remaining identifier becomes a finding at the first source location where
//      it appears.
//
// v1 explicitly skips TypeScript (.ts / .tsx) because acorn doesn't parse TS type
// syntax. v0.5 may add @typescript-eslint/parser if the value justifies the dep.
// v1 also skips: unused-import detection, typo detection (will catch most common ones
// via the undeclared check anyway — `concole.log` reads as `concole is undeclared`),
// full scope tracking across function boundaries (a flat per-file set is sufficient
// for the common bug class).

import { Parser } from 'acorn';
import jsx from 'acorn-jsx';
import { parse as looseParse } from 'acorn-loose';
import { isTestFile, isScannerSelfSource } from '../file-filter.js';

const JSXParser = Parser.extend(jsx());

// Globals that are always available without explicit import or declaration. Conservative
// list — we'd rather miss a finding than produce a false positive on a real built-in.
// Grouped by runtime so the comment stays maintainable.
const GLOBALS = new Set([
  // JS built-ins (ECMAScript)
  'globalThis',
  'undefined',
  'null',
  'true',
  'false',
  'NaN',
  'Infinity',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Symbol',
  'BigInt',
  'Date',
  'RegExp',
  'Math',
  'JSON',
  'Promise',
  'Set',
  'Map',
  'WeakSet',
  'WeakMap',
  'Function',
  'Reflect',
  'Proxy',
  'Atomics',
  'DataView',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
  'encodeURI',
  'encodeURIComponent',
  'decodeURI',
  'decodeURIComponent',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'eval',
  // Browser
  'window',
  'document',
  'navigator',
  'location',
  'history',
  'screen',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'crypto',
  'performance',
  'console',
  'alert',
  'confirm',
  'prompt',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'ServiceWorker',
  'SharedWorker',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'URL',
  'URLSearchParams',
  'FormData',
  'Blob',
  'File',
  'FileReader',
  'FileList',
  'DataTransfer',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'FocusEvent',
  'TouchEvent',
  'PointerEvent',
  'DragEvent',
  'WheelEvent',
  'InputEvent',
  'AbortController',
  'AbortSignal',
  'TextEncoder',
  'TextDecoder',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'queueMicrotask',
  'structuredClone',
  'atob',
  'btoa',
  'getComputedStyle',
  'matchMedia',
  'MediaQueryList',
  'ResizeObserver',
  'IntersectionObserver',
  'MutationObserver',
  'PerformanceObserver',
  'Notification',
  'Permissions',
  'HTMLElement',
  'Element',
  'Node',
  'NodeList',
  'HTMLCollection',
  'CSSStyleSheet',
  'CSSStyleDeclaration',
  'Headers',
  'Request',
  'Response',
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'CompressionStream',
  'DecompressionStream',
  // DOM type constructors / parsers — used in instanceof checks and `new` expressions
  // in vendored libs (htmx, marked, etc). All are standardized DOM globals.
  'Document',
  'DocumentFragment',
  'DOMParser',
  'ShadowRoot',
  'XPathEvaluator',
  'HTMLAnchorElement',
  'HTMLFormElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLImageElement',
  'HTMLScriptElement',
  'HTMLStyleElement',
  'HTMLLinkElement',
  'HTMLMetaElement',
  'HTMLIFrameElement',
  'HTMLTextAreaElement',
  'HTMLLabelElement',
  'HTMLDivElement',
  'HTMLSpanElement',
  'HTMLOptionElement',
  'HTMLOptGroupElement',
  'HTMLCanvasElement',
  'HTMLVideoElement',
  'HTMLAudioElement',
  'HTMLDialogElement',
  'HTMLTemplateElement',
  'HTMLTableElement',
  'HTMLTableRowElement',
  'HTMLTableCellElement',
  'SVGElement',
  // Implicit globals legal in browser contexts (older code, event handler attributes,
  // worker globals, AMD module loader exposed by RequireJS-shaped bundles).
  'event',
  'self',
  'define',
  // Node.js
  'process',
  'Buffer',
  '__dirname',
  '__filename',
  'require',
  'module',
  'exports',
  'global',
  // Test runners (vitest/jest)
  'describe',
  'it',
  'test',
  'expect',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'vi',
  'vitest',
  'jest',
  // React 17+ JSX runtime makes React available without explicit import; the runtime
  // is per-build-config so we trust either presence-of-import OR the global.
  'React',
  'arguments',
  'this',
  'super',
  // Service Worker scope globals (file detection is unnecessary; these names
  // are unlikely to collide with user identifiers in non-SW code).
  // canonical real-world FP source: probeCodeCorrectness firing on `caches`
  // in `sw.js` even though `caches` is the CacheStorage interface globally
  // available in service workers.
  'caches',
  'clients',
  'registration',
  'skipWaiting',
  'importScripts',
  'onmessage',
  'onerror',
  'onfetch',
  'oninstall',
  'onactivate',
  'onpush',
  'onsync',
  'addEventListener',
  'removeEventListener',
  'postMessage',
  'CacheStorage',
  'Cache',
  'Client',
  'Clients',
  'WindowClient',
  'ExtendableEvent',
  'ExtendableMessageEvent',
  'FetchEvent',
  'InstallEvent',
  'ActivateEvent',
  'PushEvent',
  'SyncEvent',
  'NotificationEvent',
  'ServiceWorkerRegistration',
  'ServiceWorkerGlobalScope',
  'WorkerGlobalScope',
  'DedicatedWorkerGlobalScope',
  'SharedWorkerGlobalScope',
  // Deno runtime
  'Deno',
  // Speech, audio and error-reporting globals. Real-scan finding 2026-07
  // (Atlan cockpit): a voice UI reported speechSynthesis and friends as
  // undeclared identifiers, which is the probe's worst failure mode — a
  // confident correctness claim about code that is correct.
  'Audio',
  'Image',
  'FileReader',
  'DOMParser',
  'XMLSerializer',
  'Notification',
  'speechSynthesis',
  'SpeechSynthesisUtterance',
  'SpeechSynthesisVoice',
  'SpeechRecognition',
  'webkitSpeechRecognition',
  'SpeechGrammarList',
  'webkitSpeechGrammarList',
  'AudioContext',
  'webkitAudioContext',
  'OfflineAudioContext',
  'AudioWorkletNode',
  'AnalyserNode',
  'GainNode',
  'reportError',
  // Globals a <script src> tag puts on window. A file that uses `Terminal` or
  // `CodeMirror` is not making the mistake this probe exists to catch — a
  // dangling reference left by a refactor — it is using a library loaded in
  // the HTML. The probe cannot see that definition because vendored library
  // files are (correctly) out of scope, so the names are listed here instead.
  // Real-scan finding 2026-07: a cockpit had four of these reported as
  // undeclared identifiers, and the tempting "fix" was to add fake
  // declarations to satisfy the scanner.
  'CodeMirror',
  'Terminal',
  'FitAddon',
  'WebLinksAddon',
  'SearchAddon',
  'jQuery',
  'THREE',
  'Chart',
  'moment',
  'marked',
  'hljs',
  'Prism',
  'html2canvas',
  'Sortable',
  'flatpickr',
  'io',
  // Modern browser APIs the original allowlist didn't cover
  'Intl',
  'WebAssembly',
  'customElements',
  'OffscreenCanvas',
  'ClipboardItem',
  'Clipboard',
  'MediaRecorder',
  'MediaStream',
  'MediaStreamTrack',
  'MediaDevices',
  'RTCPeerConnection',
  'RTCSessionDescription',
  'RTCIceCandidate',
  'createImageBitmap',
  'ImageBitmap',
  'PushManager',
  'PushSubscription',
  'BackgroundSync',
  'PeriodicSyncManager',
  'PermissionStatus',
  'Animation',
  'AnimationEffect',
  'KeyframeEffect',
  'WebTransport',
  'Bluetooth',
  'BluetoothDevice',
  'USB',
  'HID',
  'Serial',
  'CSS',
  'CSSRule',
  'CSSKeyframesRule',
  'CSSKeyframeRule',
  'CSSMediaRule',
  'CSSSupportsRule',
  'getSelection',
  'scrollTo',
  'scrollBy',
  'scrollX',
  'scrollY',
  'innerWidth',
  'innerHeight',
  'outerWidth',
  'outerHeight',
  'print',
  'open',
  'close',
  'postMessage',
  // Node globals the original allowlist missed
  'setImmediate',
  'clearImmediate',
  // Vite/build-tool conventional injected globals (frequently emitted by
  // vite.config define options or webpack DefinePlugin). They're TypeScript-
  // typed via `vite-env.d.ts` or `webpack.d.ts` but are runtime-injected.
  '__APP_VERSION__',
  '__BUILD_TIME__',
  '__BUILD_HASH__',
  '__DEV__',
  '__PROD__',
]);

// Parse `/* global X, Y, Z */` and `/* global X:readonly */` directive comments
// to extract additional file-local globals. This is the standard ESLint
// mechanism for declaring runtime-provided globals (script-tag libraries,
// build-time DefinePlugin injections, Cloudflare Worker env bindings, etc.).
// Returns a Set of identifier names.
function parseGlobalDirectives(content) {
  const result = new Set();
  if (!content || typeof content !== 'string') return result;
  // Match block-comment global directives anywhere in the file.
  const re = /\/\*\s*globals?\s+([^*]+)\*\//g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const list = m[1];
    for (const entry of list.split(',')) {
      const cleaned = entry.trim().split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(cleaned)) result.add(cleaned);
    }
  }
  return result;
}

// Recursively walk an AST node, calling `visitor` for each node and recursing into all
// child nodes. We could pull in acorn-walk but adding a dep for a 30-line walker isn't
// worth it — acorn's AST is well-typed, the recursion is straightforward, and we keep
// the dep surface small.
function walk(node, visitor, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visitor, parent);
    return;
  }
  if (typeof node.type === 'string') {
    visitor(node, parent);
    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') {
        continue;
      }
      walk(node[key], visitor, node);
    }
  }
}

// Collect every name that gets a binding in this file. Flat set per-file (no
// inner-scope shadowing tracking) because the common bug class — "I never declared
// this anywhere" — is caught either way, and inner-scope shadowing isn't a defect
// our user base needs us to flag.
function collectBindings(ast) {
  const bindings = new Set();
  const visit = (node) => {
    switch (node.type) {
      // import { Foo } from '...'  /  import Foo from '...'  /  import * as Foo
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        if (node.local && node.local.name) bindings.add(node.local.name);
        break;
      // export { foo } from './x'  /  export { foo as bar } from './x'  —  re-exports.
      // The names are forwarded through; they aren't bound in this file's scope, but
      // they're not "undeclared references" either — they're labels handed from the
      // source module to the consuming module. Treat both `local` and `exported` as
      // bindings so the reference walker doesn't flag them.
      case 'ExportNamedDeclaration':
        if (node.source && Array.isArray(node.specifiers)) {
          for (const spec of node.specifiers) {
            if (spec.local && spec.local.name) bindings.add(spec.local.name);
            if (spec.exported && spec.exported.name) bindings.add(spec.exported.name);
          }
        }
        break;
      // var/let/const + function params via the Pattern walk below
      case 'VariableDeclarator':
        collectPatternNames(node.id, bindings);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id && node.id.name) bindings.add(node.id.name);
        for (const p of node.params || []) collectPatternNames(p, bindings);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id && node.id.name) bindings.add(node.id.name);
        break;
      case 'CatchClause':
        if (node.param) collectPatternNames(node.param, bindings);
        break;
      default:
        break;
    }
  };
  walk(ast, visit);
  return bindings;
}

// Destructuring patterns: { a, b: c, d = 1, ...rest } / [x, , y] / object-rest etc.
// Recursively extract every binding name a pattern introduces.
function collectPatternNames(node, set) {
  if (!node || typeof node !== 'object') return;
  switch (node.type) {
    case 'Identifier':
      set.add(node.name);
      break;
    case 'ObjectPattern':
      for (const prop of node.properties) {
        if (prop.type === 'Property') collectPatternNames(prop.value, set);
        else if (prop.type === 'RestElement') collectPatternNames(prop.argument, set);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) {
        if (el) collectPatternNames(el, set);
      }
      break;
    case 'RestElement':
      collectPatternNames(node.argument, set);
      break;
    case 'AssignmentPattern':
      collectPatternNames(node.left, set);
      break;
    default:
      break;
  }
}

// Returns true if this Identifier node is in a position that REFERENCES rather than
// DECLARES the name. We use the parent-node type to filter out declaration contexts,
// property keys, JSX attribute names, type contexts, and labels.
function isReferenceUse(node, parent) {
  if (!parent) return true;
  switch (parent.type) {
    case 'VariableDeclarator':
      // const x = y  → x is decl (id), y is reference (init)
      return parent.id !== node;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
      return parent.id !== node && !(parent.params || []).includes(node);
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return false; // imported/local name = declaration
    case 'ExportSpecifier':
      // export { local as exported } — `exported` is an export NAME, never an
      // identifier reference. `local` IS a reference (must resolve to a
      // binding) and is validated as one. Without this case the alias falls
      // through to default:true and gets flagged as an undeclared identifier.
      return parent.exported !== node;
    case 'ImportDeclaration':
    case 'ExportNamedDeclaration':
    case 'ExportDefaultDeclaration':
    case 'ExportAllDeclaration':
      return false;
    case 'MemberExpression':
      // obj.prop — `prop` is a property name not a reference (unless computed)
      return parent.computed || parent.object === node;
    case 'MetaProperty':
      // `import.meta` and `new.target` are language-level meta-properties.
      // Both children are syntactic markers, NOT identifier references.
      // Without this case, the AST walker would flag `import` and `meta` as
      // undeclared globals when it sees `import.meta.url`.
      return false;
    case 'Property':
      // { key: value } — key isn't a reference (unless computed), value is
      return parent.computed || parent.value === node;
    case 'MethodDefinition':
    case 'PropertyDefinition':
      return parent.computed || parent.value === node;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return parent.label !== node;
    case 'JSXAttribute':
      // <Foo bar="baz" /> — `bar` is attribute name, not reference
      return parent.name !== node;
    case 'JSXOpeningElement':
    case 'JSXClosingElement':
      // <Foo> — `Foo` IS a reference (the component identifier)
      return true;
    case 'CatchClause':
      return parent.param !== node;
    case 'ObjectPattern':
    case 'ArrayPattern':
    case 'AssignmentPattern':
    case 'RestElement':
      // these are pattern positions, handled in collectPatternNames; if we see an
      // Identifier here as a child it's a declaration
      return false;
    default:
      return true;
  }
}

// Special-case: JSX. acorn-jsx adds JSXIdentifier nodes. Lowercase JSX tags
// (`<div>`) are intrinsic HTML elements, NOT user identifiers; uppercase tags
// (`<Foo>`) ARE references to imported/declared components.
function isJSXIntrinsic(name) {
  return typeof name === 'string' && name.length > 0 && name[0] === name[0].toLowerCase();
}

export function probeCodeCorrectness(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    // v1 scope: .js and .jsx only. TypeScript needs its own parser.
    if (!/\.(?:jsx?|mjs|cjs)$/i.test(file.path)) return;
    // Skip minified / bundled vendor files. Minifiers rename and de-duplicate symbols,
    // so an undeclared-identifier check produces guaranteed false positives. The files
    // also tend to reference browser globals across every category (htmx hits ~12 of
    // them; marked hits AMD's `define`). If the user wrote it themselves, they'd ship
    // the unminified version.
    if (/\.min\.(?:js|jsx|mjs|cjs)$/i.test(file.path)) return;

    const content = file.content || '';
    if (!content.trim()) return;

    let ast;
    try {
      ast = JSXParser.parse(content, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
        allowImportExportEverywhere: true,
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
      });
    } catch {
      // Fallback to acorn-loose (no JSX support, but at least catches non-JSX files
      // with syntax errors). If both fail, skip the file rather than blow up the scan.
      try {
        ast = looseParse(content, { ecmaVersion: 'latest', sourceType: 'module' });
      } catch {
        return;
      }
    }

    const bindings = collectBindings(ast);
    const localGlobals = parseGlobalDirectives(content);

    // Second pass: collect references.
    const undeclaredFirstSeen = new Map(); // name -> first (line, col)

    walk(ast, (node, parent) => {
      // Plain JS Identifier reference
      if (node.type === 'Identifier' && isReferenceUse(node, parent)) {
        const name = node.name;
        if (!name) return;
        if (GLOBALS.has(name)) return;
        if (localGlobals.has(name)) return;
        if (bindings.has(name)) return;
        if (!undeclaredFirstSeen.has(name)) {
          undeclaredFirstSeen.set(name, {
            line: node.loc ? node.loc.start.line : 1,
            col: node.loc ? node.loc.start.column : 0,
          });
        }
      }
      // JSX element reference: <Foo> / <Foo.Bar>
      if (node.type === 'JSXIdentifier') {
        const inJSXElement =
          parent &&
          (parent.type === 'JSXOpeningElement' || parent.type === 'JSXClosingElement') &&
          parent.name === node;
        if (!inJSXElement) return;
        const name = node.name;
        if (isJSXIntrinsic(name)) return; // <div>, <span>, etc.
        if (GLOBALS.has(name)) return;
        if (localGlobals.has(name)) return;
        if (bindings.has(name)) return;
        if (!undeclaredFirstSeen.has(name)) {
          undeclaredFirstSeen.set(name, {
            line: node.loc ? node.loc.start.line : 1,
            col: node.loc ? node.loc.start.column : 0,
          });
        }
      }
    });

    undeclaredFirstSeen.forEach((loc, name) => {
      findings.push({
        id: `correctness-undeclared-${file.path}-${name}-${loc.line}`,
        probe: 'Code Correctness',
        title: `Reference to undeclared identifier "${name}"`,
        severity: 'low',
        category: 'Misconfiguration',
        cwe: 'CWE-1116',
        file: file.path,
        line: loc.line,
        evidence: `${name} is used but no binding (import, declaration, or known global) was found in this file`,
        remediation: `The identifier "${name}" is referenced on line ${loc.line} but never declared, imported, or destructured in this file. Three common causes: (1) you renamed the variable but missed this reference, (2) you forgot the import, (3) it's a typo for a name that does exist (e.g. concole.log → console.log). PreFlight uses a parser-based scope check rather than runtime, so a build / test run will fail the same way the moment this code path executes.`,
      });
    });
  });
  return findings;
}
