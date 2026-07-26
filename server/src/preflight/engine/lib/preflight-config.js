// src/lib/preflight-config.js
//
// Repo-local scanner configuration: parses `.preflight.yml` (or `.preflight.yaml` /
// `.preflight.json`) from the scanned project root.
//
// Schema (preflight/v1):
//
//   schema: preflight/v1
//   self_domains:
//     - preflight.midatlantic.ai
//     - midatlantic.ai
//   suppress:
//     # 1. Match by stableId (exact):
//     - id: f9q3x2
//       reason: 'Documentation copy describing the probe, not real usage'
//
//     # 2. Match by triple (probe + file + title); file/title support * glob:
//     - probe: AI Code Smells
//       file: src/**/*.js
//       title-pattern: 'empty catch block'
//       reason: 'Intentional silent fallback for storage failures'
//
//     # 3. Time-boxed expiry (ISO date or `~` for never):
//     - probe: Code Quality
//       file: src/App.jsx
//       title-pattern: 'File is *lines'
//       reason: 'Tracked in issue #N — splitting in next refactor'
//       expires: '2026-09-01'
//
// We support YAML (preferred, hand-friendly) AND JSON. The YAML parser is a tiny
// purpose-built subset reader — no dependency, ~80 lines, only handles the constructs
// our schema uses (top-level scalars, lists of scalars, lists of objects, # comments,
// quoted-or-unquoted string values). It's NOT a general YAML parser.

const PREFLIGHT_FILENAMES = /(^|\/)\.preflight\.(ya?ml|json)$/i;

export function findPreflightConfigFile(files) {
  return files.find((f) => PREFLIGHT_FILENAMES.test(f.path));
}

// Tiny YAML-subset parser. Handles:
//   - # comments (anywhere a line starts with #, or trailing on a value line)
//   - key: scalar
//   - key:                 (followed by indented list or nested keys)
//   -   - scalar           (list of scalars under a key)
//   -   - key: value       (list of objects: each entry's first key sits on the `-` line
//                           or on the next indented line)
// Quoted scalars: 'foo' or "foo". Unquoted: foo bar baz.
// Returns a plain JS object or throws on malformed structure.
export function parsePreflightYaml(text) {
  const lines = text
    .split('\n')
    .map((l, i) => ({ raw: l, n: i + 1 }))
    .filter((l) => l.raw.trim() !== '' && !/^\s*#/.test(l.raw));

  const root = {};
  let i = 0;

  const parseScalar = (s) => {
    s = s.trim();
    if (s === '~' || s === 'null' || s === '') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^'([^']*)'$/.test(s)) return s.slice(1, -1);
    if (/^"([^"]*)"$/.test(s)) return s.slice(1, -1);
    return s.replace(/\s+#.*$/, '').trim();
  };
  const indentOf = (l) => l.match(/^(\s*)/)[1].length;

  // Parse a list whose entries are at the given indent level.
  const parseList = (indent) => {
    const out = [];
    while (i < lines.length) {
      const line = lines[i];
      const lineIndent = indentOf(line.raw);
      if (lineIndent < indent) break;
      if (lineIndent > indent) throw new Error(`unexpected indent on line ${line.n}`);
      const trimmed = line.raw.trim();
      if (!trimmed.startsWith('- ') && trimmed !== '-') break;
      const after = trimmed === '-' ? '' : trimmed.slice(2).trim();
      i++;
      // Object entry: starts with `key: value` or `key:`
      if (/^[A-Za-z_][\w-]*\s*:/.test(after)) {
        const obj = {};
        const colonIdx = after.indexOf(':');
        const k = after.slice(0, colonIdx).trim();
        const v = after.slice(colonIdx + 1).trim();
        if (v) {
          obj[k] = parseScalar(v);
        } else {
          // value on the next indented lines (rare for our schema, but support it)
          obj[k] = parseObjectBody(indent + 2);
        }
        // Parse remaining keys at indent+2 belonging to this list entry
        while (i < lines.length) {
          const next = lines[i];
          const nIndent = indentOf(next.raw);
          if (nIndent < indent + 2) break;
          const nTrim = next.raw.trim();
          if (nTrim.startsWith('- ')) break; // next list entry
          const cIdx = nTrim.indexOf(':');
          if (cIdx < 0) throw new Error(`expected key:value on line ${next.n}`);
          obj[nTrim.slice(0, cIdx).trim()] = parseScalar(nTrim.slice(cIdx + 1));
          i++;
        }
        out.push(obj);
      } else if (after.length > 0) {
        // Scalar entry
        out.push(parseScalar(after));
      } else {
        // empty `- ` — treat as empty object
        out.push({});
      }
    }
    return out;
  };

  const parseObjectBody = (indent) => {
    const out = {};
    while (i < lines.length) {
      const line = lines[i];
      const lineIndent = indentOf(line.raw);
      if (lineIndent < indent) break;
      if (lineIndent > indent) throw new Error(`unexpected indent on line ${line.n}`);
      const trimmed = line.raw.trim();
      const cIdx = trimmed.indexOf(':');
      if (cIdx < 0) throw new Error(`expected key:value on line ${line.n}`);
      const k = trimmed.slice(0, cIdx).trim();
      const v = trimmed.slice(cIdx + 1).trim();
      i++;
      if (v) {
        out[k] = parseScalar(v);
      } else if (i < lines.length && indentOf(lines[i].raw) > indent) {
        const nextLineTrim = lines[i].raw.trim();
        if (nextLineTrim.startsWith('- ') || nextLineTrim === '-') {
          out[k] = parseList(indentOf(lines[i].raw));
        } else {
          out[k] = parseObjectBody(indentOf(lines[i].raw));
        }
      } else {
        out[k] = null;
      }
    }
    return out;
  };

  // Top-level is always an object.
  while (i < lines.length) {
    const line = lines[i];
    const cIdx = line.raw.indexOf(':');
    if (cIdx < 0) throw new Error(`expected top-level key:value on line ${line.n}`);
    const k = line.raw.slice(0, cIdx).trim();
    const v = line.raw.slice(cIdx + 1).trim();
    i++;
    if (v) {
      root[k] = parseScalar(v);
    } else if (i < lines.length && indentOf(lines[i].raw) > 0) {
      const nextLineTrim = lines[i].raw.trim();
      if (nextLineTrim.startsWith('- ') || nextLineTrim === '-') {
        root[k] = parseList(indentOf(lines[i].raw));
      } else {
        root[k] = parseObjectBody(indentOf(lines[i].raw));
      }
    } else {
      root[k] = null;
    }
  }

  return root;
}

// Parse the config file (YAML or JSON). Returns a normalized shape:
//   { schema, self_domains: string[], suppress: SuppressRule[] }
// On parse failure, returns { error: '...message...' } so callers can surface it
// (we don't want a malformed config to crash a scan).
export function parsePreflightConfig(filePath, content) {
  if (typeof content !== 'string') return { error: 'empty content' };
  try {
    const parsed = /\.json$/i.test(filePath) ? JSON.parse(content) : parsePreflightYaml(content);
    return normalize(parsed);
  } catch (e) {
    return { error: e?.message || 'parse failed' };
  }
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'config is not an object' };
  const schema = String(raw.schema || '').toLowerCase();
  if (schema && schema !== 'preflight/v1') {
    return { error: `unknown schema "${raw.schema}" (expected preflight/v1)` };
  }
  const self_domains = Array.isArray(raw.self_domains)
    ? raw.self_domains.filter((s) => typeof s === 'string')
    : [];
  const suppress = Array.isArray(raw.suppress)
    ? raw.suppress.filter((s) => s && typeof s === 'object')
    : [];
  return { schema: 'preflight/v1', self_domains, suppress };
}

// Convert a glob with `*` and `**` wildcards into a RegExp anchored at start/end.
// `*`  → matches zero+ characters that are not `/` (single path segment)
// `**` → matches zero+ characters including `/` and consumes an optional adjacent `/`,
//        so `src/**/*.jsx` matches both `src/App.jsx` and `src/lib/x/App.jsx`.
function globToRegExp(glob) {
  if (typeof glob !== 'string') return null;
  // Escape special chars except the wildcards we'll handle below.
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Order matters: `/**/` must convert to "(/.*)?/" so it can swallow itself when empty.
  // Then standalone `**` → `.*`, then `*` → `[^/]*`.
  const withGlobs = escaped
    .replace(/\/\*\*\//g, '(?:/.*)?/')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp('^' + withGlobs + '$');
}

// Check whether a single finding matches a single suppress rule.
export function findingMatchesRule(finding, rule) {
  if (!rule) return false;

  // Expiry check first — a past-expiry rule never matches anything.
  if (rule.expires && rule.expires !== '~' && rule.expires !== 'null') {
    const exp = new Date(rule.expires);
    if (!isNaN(exp) && exp.getTime() < Date.now()) return false;
  }

  // 1. If `id` is set, it MUST match — no fall-through to triple. Otherwise a rule for one
  //    finding could suppress another by accident.
  if (rule.id) {
    return finding.stableId === rule.id;
  }

  // 2. Triple-match: probe is required, file + title-pattern act as filters.
  if (!rule.probe) return false;
  if (finding.probe !== rule.probe) return false;
  if (rule.file) {
    const fileRe = globToRegExp(rule.file);
    if (!fileRe || !fileRe.test(finding.file || '')) return false;
  }
  if (rule['title-pattern']) {
    // title-pattern: substring match when no wildcards, glob match when * is used.
    const pattern = rule['title-pattern'];
    const titleRe = pattern.includes('*')
      ? globToRegExp(pattern)
      : new RegExp('.*' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&') + '.*');
    if (!titleRe || !titleRe.test(finding.title || '')) return false;
  }
  if (rule.title && rule.title !== finding.title) return false;

  return true;
}

// Apply a parsed config to a set of findings. Returns the same shape the in-app
// suppression store uses ({ [stableId]: { disposition, note, at, source } }) so it
// merges with localStorage suppressions transparently.
export function configToSuppressions(config, findings) {
  if (!config || config.error || !Array.isArray(config.suppress)) return {};
  const out = {};
  for (const finding of findings) {
    if (!finding.stableId) continue;
    for (const rule of config.suppress) {
      if (findingMatchesRule(finding, rule)) {
        out[finding.stableId] = {
          disposition: rule.disposition || 'wont-fix',
          note: rule.reason || '',
          at: rule.added || new Date().toISOString().slice(0, 10),
          source: '.preflight config',
        };
        break;
      }
    }
  }
  return out;
}
