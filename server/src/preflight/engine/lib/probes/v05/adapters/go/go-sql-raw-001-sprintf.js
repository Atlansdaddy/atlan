// src/lib/probes/v05/adapters/go/go-sql-raw-001-sprintf.js
//
// XL-002 adapter for Go. RX-based. database/sql Query/Exec/QueryRow (and
// Context/Tx variants) or GORM Raw/Exec whose SQL string is built with
// fmt.Sprintf or string concat instead of placeholders. Corpus: "A03;
// database/sql Query/Exec with fmt.Sprintf" + "A03; GORM Raw / Exec".

import { goFiles, isGoCommentLine } from '../../shared-detectors/go-scope.js';

const PROBE_NAME = 'Go Raw SQL Interpolation';

const SQL_SURFACE_RE =
  /\b\w+\.(?:Query|QueryRow|Exec|QueryContext|QueryRowContext|ExecContext|Raw)\s*\(/;
const SPRINTF_RE = /\bfmt\.Sprintf\s*\(/;
const CONCAT_RE = /"[^"]*(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)[^"]*"\s*\+\s*\w/i;

export const GO_SQL_RAW_001 = {
  probe_id: 'GO-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'go',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.go',
  what_it_catches:
    'A database/sql Query/Exec/QueryRow (or Context/Tx variant) or GORM Raw/Exec whose SQL string is produced by fmt.Sprintf or string concatenation rather than a $1/? placeholder.',
  why_ai_v05:
    'fmt.Sprintf reads naturally and compiles; the placeholder API needs the value passed as a separate variadic arg, which the model treats as optional.',
  vibe_v05:
    '"Build the query string, then run it." No model of placeholder binding versus string building.',
  detection_approach:
    'RX per line: a Query/Exec/QueryRow/Raw surface call AND fmt.Sprintf or a SQL-keyword string concatenated with a variable on the same line.',
  fp_gates_v05: [
    'comment lines',
    'literal query strings with placeholders and no Sprintf/concat',
    'test files (_test.go) / scanner self-source / fixture tree (goFiles())',
  ],
  remediation:
    'Pass values as parameters: db.Query("SELECT ... WHERE id = $1", id). GORM: db.Where("id = ?", id) or db.Raw("... ?", id). Never fmt.Sprintf user input into SQL.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/GO-SQL-RAW-001/positive.go',
    negative: 'src/lib/probes/v05/fixtures/GO-SQL-RAW-001/negative.go',
  },
  known_incidents: 'CWE-89; OWASP A03; database/sql parameter docs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of goFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isGoCommentLine(line)) return;
        if (!SQL_SURFACE_RE.test(line)) return;
        if (!SPRINTF_RE.test(line) && !CONCAT_RE.test(line)) return;
        findings.push({
          id: `go-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with fmt.Sprintf / concatenation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use placeholders: db.Query("... $1", v) or GORM db.Where("col = ?", v). Never fmt.Sprintf the value into the SQL text.',
        });
      });
    }
    return findings;
  },
};
