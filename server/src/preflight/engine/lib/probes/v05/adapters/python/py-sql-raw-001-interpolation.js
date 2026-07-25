// src/lib/probes/v05/adapters/python/py-sql-raw-001-interpolation.js
//
// XL-002 adapter for Python. RX-based. Catches an f-string (or %-format /
// .format() / concat) feeding a raw-SQL surface: Django .extra(where=),
// RawSQL(), Model.objects.raw(), cursor.execute(), SQLAlchemy text().

import { pythonFiles, isPythonCommentLine } from '../../shared-detectors/python-scope.js';

const PROBE_NAME = 'Python Raw SQL Interpolation';

// Raw-SQL surfaces. If an interpolated string reaches one of these, it's a
// parse-time injection.
const SQL_SURFACE_RE =
  /\.extra\s*\(|\bRawSQL\s*\(|\.objects\.raw\s*\(|\bcursor\s*\(\s*\)\s*\.execute\s*\(|\.cursor\(\)\.execute\s*\(|\bcursor\.execute\s*\(|\b(?:session|conn|connection|engine|db)\.execute\s*\(\s*text\s*\(|\btext\s*\(/;

// Interpolation forms: f-string with a substitution, %-format, .format(),
// or string concatenation of a non-literal into the SQL.
const FSTRING_INTERP_RE = /\bf["'][^"']*\{[^}]+\}/;
const PERCENT_FORMAT_RE = /["'][^"']*%[sd][^"']*["']\s*%/;
const DOTFORMAT_RE = /["'][^"']*\{[^}]*\}[^"']*["']\s*\.format\s*\(/;
const CONCAT_RE = /["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)[^"']*["']\s*\+\s*\w/i;

function hasInterpolation(line) {
  return (
    FSTRING_INTERP_RE.test(line) ||
    PERCENT_FORMAT_RE.test(line) ||
    DOTFORMAT_RE.test(line) ||
    CONCAT_RE.test(line)
  );
}

export const PY_SQL_RAW_001 = {
  probe_id: 'PY-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'python',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.py',
  what_it_catches:
    'An f-string / %-format / .format() / concat feeding Django .extra(where=), RawSQL(), Model.objects.raw(), cursor.execute(), or SQLAlchemy text(). The user value is parsed as SQL, not bound as data.',
  why_ai_v05:
    'Asked to "filter where the column equals a user value with a complex condition," the model bypasses the parameterized API because the templating is shorter.',
  vibe_v05: '"The query is just a string and the value goes in the string."',
  detection_approach:
    'RX per line: a raw-SQL surface call AND an interpolation form (f-string with {expr}, %-format, .format(), or SQL-keyword string + concat) on the same line.',
  fp_gates_v05: [
    'comment-only lines',
    'literal-only queries with no interpolation',
    'parameterized calls using params=[...] or .bindparams()',
    'test files / scanner self-source (handled by pythonFiles())',
  ],
  remediation:
    'Use the parameterized form: Model.objects.raw("... WHERE x = %s", [val]); cursor.execute(sql, params); text("... :id").bindparams(id=val). Never format the value into the SQL string.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/PY-SQL-RAW-001/positive.py',
    negative: 'src/lib/probes/v05/fixtures/PY-SQL-RAW-001/negative.py',
  },
  known_incidents: 'CWE-89; OWASP A03; Django ORM injection advisories; SQLAlchemy security guide',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of pythonFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isPythonCommentLine(line)) return;
        if (!SQL_SURFACE_RE.test(line)) return;
        if (!hasInterpolation(line)) return;
        findings.push({
          id: `py-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with string interpolation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Bind the value as a parameter. Django: .raw("... %s", [v]). DB-API: cursor.execute(sql, params). SQLAlchemy: text("... :v").bindparams(v=val).',
        });
      });
    }
    return findings;
  },
};
