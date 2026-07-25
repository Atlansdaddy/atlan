// src/lib/probes/v05/adapters/dart/da-sql-raw-001-rawquery.js
//
// XL-002 adapter for Dart. RX-based. sqflite/drift rawQuery / rawInsert /
// rawUpdate / rawDelete given a Dart-interpolated ($var / ${...}) or
// concatenated SQL string. Corpus: docs/v05-research/preflight_v05_probe_
// inventory.md "14. Dart" (sqflite/drift rawQuery with interpolation).

import { dartFiles, isDartCommentLine } from '../../shared-detectors/dart-scope.js';

const PROBE_NAME = 'Dart Raw SQL Interpolation';

const RAW_INTERP_RE =
  /\.\s*raw(?:Query|Insert|Update|Delete)\s*\(\s*(?:'[^']*\$|"[^"]*\$|'[^']*'\s*\+|"[^"]*"\s*\+)/;

export const DA_SQL_RAW_001 = {
  probe_id: 'DA-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'dart',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.dart',
  what_it_catches:
    'sqflite/drift rawQuery / rawInsert / rawUpdate / rawDelete given a Dart-interpolated ($x / ${x}) or concatenated SQL string instead of ? placeholders + an args list.',
  why_ai_v05:
    "Dart string interpolation is so natural the model writes rawQuery('... \"$name\"') instead of rawQuery('... ?', [name]).",
  vibe_v05: '"$name in the string is how Dart strings work." It is also how the injection works.',
  detection_approach:
    'RX per line: rawQuery/rawInsert/rawUpdate/rawDelete whose string argument contains $ interpolation or + concatenation.',
  fp_gates_v05: [
    'comment lines',
    "rawQuery('... ?', [value]) placeholder + args form",
    "drift's typed query DSL (not a raw* call)",
    '_test.dart / test dir / scanner self-source / fixture tree (dartFiles())',
  ],
  remediation:
    "Use ? placeholders with an args list: db.rawQuery('SELECT * FROM users WHERE name = ?', [name]); or drift's typed query API.",
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/DA-SQL-RAW-001/positive.dart',
    negative: 'src/lib/probes/v05/fixtures/DA-SQL-RAW-001/negative.dart',
  },
  known_incidents: 'CWE-89; OWASP A03; sqflite rawQuery args guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of dartFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isDartCommentLine(line)) return;
        if (!RAW_INTERP_RE.test(line)) return;
        findings.push({
          id: `da-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with Dart interpolation / concatenation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            "Use ? placeholders + an args list: db.rawQuery('... ?', [value]); or drift's typed query DSL.",
        });
      });
    }
    return findings;
  },
};
