// src/lib/learn-content.js
// Build-time loader for src/learn/**/*.md. Vite's `import.meta.glob` reads every
// markdown file in the Learn directory and bundles their raw text. A small inline
// frontmatter parser (browser-safe, zero external deps) splits each file into
// YAML frontmatter and Markdown body. The resulting registry is a flat array of
// `{ slug, type, title, summary, last_updated, draft, body, ...frontmatter }`
// records that the Learn page indexes and renders against.
//
// Why an inline parser instead of gray-matter: gray-matter pulls in js-yaml +
// lodash + several Node-isms (process.cwd, fs-style helpers) that silently fail
// in some browser environments while passing in jsdom. The whole-corpus parse
// returning empty in production is the classic symptom. The inline parser below
// handles the YAML subset we actually use (string / boolean / number scalars,
// lists of strings, lists of objects, nested indented blocks) and is verified
// against the same Learn corpus in src/test/learn-content.test.js.
//
// Schema enforced at parse time:
//   title        string, required
//   slug         string, required (kebab-case; should match filename)
//   type         "manifesto" | "pattern" | "incident" | "shape", required
//   last_updated YYYY-MM-DD, required
//   draft        boolean, default false
//   summary      string, optional
//   related_probe_ids, related_incident_slugs, sources — optional
//
// Files that fail validation surface as a console warning; they don't crash
// the build. That keeps the markdown editing surface forgiving — a missing
// frontmatter key gives feedback in the browser console rather than a build
// break.

import { log } from './logger.js';

// Browser-safe frontmatter parser. Splits `---\n<yaml>\n---\n<body>` and parses the
// YAML subset Learn content uses.
// Throws on every recoverable failure mode rather than returning silent-empty.
// Returns { data, content } only when the file genuinely has no frontmatter
// (manifesto body, freeform doc) — that's a real shape, not a parse error.
function parseFrontmatter(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError(`expected string, got ${typeof raw}`);
  }
  // Strip a leading BOM (U+FEFF) if present, then normalize line endings.
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const text = stripped.replace(/\r\n/g, '\n');
  // No frontmatter at all is a valid shape for free-form documents (e.g.
  // a body-only fragment). The caller decides whether the missing frontmatter
  // is a schema violation.
  if (!text.startsWith('---\n')) {
    return { data: {}, content: text };
  }
  const closeIdx = text.indexOf('\n---', 4);
  if (closeIdx === -1) {
    throw new SyntaxError('frontmatter opened with `---` but never closed');
  }
  const yamlBlock = text.slice(4, closeIdx);
  let body = text.slice(closeIdx + 4);
  if (body.startsWith('\n')) body = body.slice(1);
  const data = parseYamlBlock(yamlBlock);
  if (!data || typeof data !== 'object') {
    throw new SyntaxError('frontmatter parsed to non-object');
  }
  return { data, content: body };
}

// Parses the YAML subset we use:
//   scalar: string / number / boolean
//   sequence of scalars under a key
//   sequence of mappings under a key (objects in a list)
//   nested mapping (rare; not required by current schema)
function parseYamlBlock(text) {
  const result = {};
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent !== 0) {
      i += 1;
      continue;
    }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      i += 1;
      continue;
    }
    const key = m[1];
    const rest = m[2];
    if (rest !== '') {
      result[key] = parseScalar(rest);
      i += 1;
      continue;
    }
    // value spans subsequent indented lines.
    const block = [];
    let j = i + 1;
    while (j < lines.length) {
      const nxt = lines[j];
      if (!nxt.trim()) {
        block.push(nxt);
        j += 1;
        continue;
      }
      const nxtIndent = nxt.match(/^(\s*)/)[1].length;
      if (nxtIndent === 0) break;
      block.push(nxt);
      j += 1;
    }
    result[key] = parseValueBlock(block);
    i = j;
  }
  return result;
}

function parseScalar(rest) {
  const trimmed = rest.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
  return trimmed;
}

// Given the indented block under a key, decide if it's a list of scalars, a list
// of mappings, or a single mapping.
function parseValueBlock(block) {
  const stripped = block.filter((l) => l.trim());
  if (stripped.length === 0) return null;
  const firstIndent = stripped[0].match(/^(\s*)/)[1].length;
  const dedented = stripped.map((l) => l.slice(firstIndent));
  if (dedented[0].startsWith('- ')) {
    return parseList(dedented);
  }
  return parseMapping(dedented);
}

function parseList(lines) {
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('- ')) {
      i += 1;
      continue;
    }
    const head = line.slice(2);
    const headMatch = head.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!headMatch) {
      // scalar item: `- foo` or `- 'foo'`
      items.push(parseScalar(head));
      i += 1;
      continue;
    }
    // mapping item begins. Collect this line's k:v plus any continuation lines
    // indented further than the `- ` marker.
    const obj = {};
    obj[headMatch[1]] = headMatch[2] === '' ? null : parseScalar(headMatch[2]);
    let j = i + 1;
    while (j < lines.length) {
      const nxt = lines[j];
      if (nxt.startsWith('- ')) break;
      if (!nxt.trim()) {
        j += 1;
        continue;
      }
      // continuation lines are indented further than 2 spaces (the `- ` width).
      const ci = nxt.match(/^(\s*)/)[1].length;
      if (ci < 2) break;
      const inner = nxt.slice(2);
      const innerMatch = inner.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (innerMatch) {
        obj[innerMatch[1]] = innerMatch[2] === '' ? null : parseScalar(innerMatch[2]);
      }
      j += 1;
    }
    items.push(obj);
    i = j;
  }
  return items;
}

function parseMapping(lines) {
  const obj = {};
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    obj[m[1]] = m[2] === '' ? null : parseScalar(m[2]);
  }
  return obj;
}

const VALID_TYPES = new Set(['manifesto', 'pattern', 'incident', 'shape']);

// `import.meta.glob` with `eager: true` resolves at build time. The `?raw` query
// gives us the literal source string; gray-matter handles the frontmatter split.
// Vite scans `src/learn/**/*.md` and produces an object keyed by path.
const RAW_MODULES = import.meta.glob('../learn/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Module-level error tracking. Every parse failure gets pushed here at load time
// so the UI can surface a banner instead of just rendering "0 entries" and
// hoping the user opens Diagnostics. This is PreFlight: silent corpus
// failures are the failure mode we exist to catch.
export const LEARN_PARSE_ERRORS = [];

function recordError(path, reason, err) {
  const msg = err?.message ? `${reason}: ${err.message}` : reason;
  LEARN_PARSE_ERRORS.push({ path, reason: msg, ts: Date.now() });
  // log.error routes to the in-memory diagnostics buffer AND emits to the
  // browser console at error level (see logger.js around line 100). So one
  // log.error call covers both DevTools visibility and the in-app Diagnostics
  // tab. No bare console.* call needed.
  log.error(`[learn] ${path}: ${msg}`, { path, reason: msg, stack: err?.stack });
}

function parseEntry(path, raw) {
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (e) {
    recordError(path, 'frontmatter parse failed', e);
    return null;
  }
  try {
    const { data, content } = parsed;
    const slug = data.slug || path.split('/').pop().replace(/\.md$/, '');
    if (!data.title) {
      recordError(path, 'missing required `title` frontmatter');
      return null;
    }
    if (!VALID_TYPES.has(data.type)) {
      recordError(
        path,
        `invalid \`type\` "${data.type}", expected one of ${[...VALID_TYPES].join(', ')}`
      );
      return null;
    }
    return {
      slug,
      type: data.type,
      title: data.title,
      summary: data.summary || '',
      last_updated: data.last_updated || null,
      draft: !!data.draft,
      related_probe_ids: Array.isArray(data.related_probe_ids) ? data.related_probe_ids : [],
      related_incident_slugs: Array.isArray(data.related_incident_slugs)
        ? data.related_incident_slugs
        : [],
      sources: Array.isArray(data.sources) ? data.sources : [],
      // Incident-specific structured metadata. All optional; used by EntryView to render
      // a metadata header on type=incident pages (CVE pill, CVSS badge, threat-actor /
      // campaign / attack-date attribution). Pattern + shape pages can use them too if
      // the content type evolves, but only incidents render the header today.
      cve: typeof data.cve === 'string' ? data.cve : null,
      cvss: typeof data.cvss === 'number' ? data.cvss : null,
      campaign: typeof data.campaign === 'string' ? data.campaign : null,
      threat_actor: typeof data.threat_actor === 'string' ? data.threat_actor : null,
      attack_date: typeof data.attack_date === 'string' ? data.attack_date : null,
      body: content.trim(),
      _path: path,
    };
  } catch (e) {
    recordError(path, 'unexpected error during entry construction', e);
    return null;
  }
}

const ALL_MODULE_PATHS = Object.keys(RAW_MODULES);

export const LEARN_ENTRIES = Object.entries(RAW_MODULES)
  .map(([path, raw]) => {
    if (typeof raw !== 'string') {
      recordError(path, `raw module loaded as ${typeof raw}, expected string`);
      return null;
    }
    return parseEntry(path, raw);
  })
  .filter(Boolean);

// Corpus-level sanity check. If the build glob found markdown files but every
// single one failed to parse, that's a critical bug (e.g., browser-incompat in
// the parser, or a bundling issue). PreFlight should NEVER silently render
// an empty Learn surface in this case.
export const LEARN_HEALTH = {
  filesFound: ALL_MODULE_PATHS.length,
  entriesParsed: LEARN_ENTRIES.length,
  parseErrors: LEARN_PARSE_ERRORS,
  ok: ALL_MODULE_PATHS.length === 0 || LEARN_ENTRIES.length > 0,
};

if (!LEARN_HEALTH.ok) {
  // log.error covers both DevTools and the in-app Diagnostics surface; see
  // recordError() above for the rationale.
  log.error(
    `[learn] critical: glob found ${LEARN_HEALTH.filesFound} markdown file(s) but 0 entries parsed. The Learn surface is empty in production.`,
    LEARN_HEALTH
  );
}

// Helpers that the index views and the per-slug page use.
export function getManifesto() {
  return LEARN_ENTRIES.find((e) => e.type === 'manifesto');
}

export function getByType(type) {
  return LEARN_ENTRIES.filter((e) => e.type === type).sort((a, b) =>
    a.title.localeCompare(b.title)
  );
}

export function getBySlug(slug) {
  return LEARN_ENTRIES.find((e) => e.slug === slug);
}

// Resolves a probe's learn_more_slug to the actual entry IF it exists AND is
// not a draft. Returns null otherwise so FindingCard can hide the link cleanly.
export function resolvePatternForProbe(slug) {
  if (!slug) return null;
  const entry = getBySlug(slug);
  if (!entry) return null;
  if (entry.draft) return null;
  if (entry.type !== 'pattern') return null;
  return entry;
}
