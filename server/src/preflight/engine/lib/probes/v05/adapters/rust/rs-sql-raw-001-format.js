// src/lib/probes/v05/adapters/rust/rs-sql-raw-001-format.js
//
// XL-002 adapter for Rust. RX-based. SQLx query()/query_as() or Diesel
// sql_query() whose argument is a format! / concat rather than a bound
// parameter. Corpus: "SQLx query! macro vs runtime query() without
// parameter binding" + "Diesel SQL with sql_query and format!".

import { rustFiles, isRustCommentLine } from '../../shared-detectors/rust-scope.js';

const PROBE_NAME = 'Rust Raw SQL Interpolation';

// Raw-SQL surface call.
const SQL_SURFACE_RE = /\b(?:sqlx::query(?:_as|_scalar)?|diesel::sql_query|sql_query)\s*\(/;
// Interpolation forms reaching that surface: format! macro, or a string
// literal concatenated with a non-literal.
const FORMAT_RE = /\bformat\s*!\s*\(/;
const CONCAT_RE = /"[^"]*"\s*\.to_(?:string|owned)\s*\(\s*\)\s*\+|"[^"]*"\s*\+\s*&?\w/;

export const RS_SQL_RAW_001 = {
  probe_id: 'RS-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'rust',
  name: PROBE_NAME,
  category: 'security',
  severity: 'high',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.rs',
  what_it_catches:
    'sqlx::query / query_as / query_scalar or diesel::sql_query whose SQL string is built with format! or string concatenation instead of bound parameters.',
  why_ai_v05:
    'The compile-time-checked query! macro needs DATABASE_URL at build time; without it the model falls back to the runtime query() and forgets .bind().',
  vibe_v05:
    '"sqlx is a safe library, so any sqlx call is safe." The macro vs runtime distinction is invisible.',
  detection_approach:
    'RX per line: a SQLx/Diesel raw-query surface call AND a format! macro or a string-concat form on the same line.',
  fp_gates_v05: [
    'comment lines',
    'the query! / query_as! compile-time macros (different token, not matched)',
    'literal-only query strings with no format! / concat',
    'test files / scanner self-source / fixture tree (rustFiles())',
  ],
  remediation:
    'Use the compile-time macros query!/query_as!, or bind parameters: sqlx::query("... WHERE id = $1").bind(id). Diesel: use the typed DSL or sql_query with .bind().',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RS-SQL-RAW-001/positive.rs',
    negative: 'src/lib/probes/v05/fixtures/RS-SQL-RAW-001/negative.rs',
  },
  known_incidents: 'CWE-89; OWASP A03; SQLx parameter-binding guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of rustFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isRustCommentLine(line)) return;
        if (!SQL_SURFACE_RE.test(line)) return;
        if (!FORMAT_RE.test(line) && !CONCAT_RE.test(line)) return;
        findings.push({
          id: `rs-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with format! / concatenation',
          severity: 'high',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use query!/query_as! (compile-time checked) or bind values: query("... $1").bind(val). Never format! user input into the SQL string.',
        });
      });
    }
    return findings;
  },
};
