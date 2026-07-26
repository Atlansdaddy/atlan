// src/lib/probes/v05/adapters/swift/sw-sql-raw-001-interpolation.js
//
// XL-002 adapter for Swift. RX-based. SQLite.swift / FMDB
// sqlite3_exec/db.execute, or Vapor SQLKit .raw, given a Swift
// string-interpolated SQL string (\(...)). Corpus: "SQLite raw query
// string concatenation" + "Vapor route handler with raw SQL via SQLKit".

import { swiftFiles, isSwiftCommentLine } from '../../shared-detectors/swift-scope.js';

const PROBE_NAME = 'Swift Raw SQL Interpolation';

// A SQL exec/raw surface whose string argument contains \( interpolation.
const SQL_INTERP_RE = /\b(?:sqlite3_exec|\.execute|\.raw|\.query)\s*\(\s*[^)]*"[^"]*\\\(/;

export const SW_SQL_RAW_001 = {
  probe_id: 'SW-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'swift',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.swift',
  what_it_catches:
    'sqlite3_exec / db.execute / Vapor .raw / .query given a Swift string with \\(...) interpolation — the user value is parsed as SQL, not bound.',
  why_ai_v05:
    'Swift string interpolation is so ergonomic the model writes db.execute("... \\(id)") instead of a bound parameter.',
  vibe_v05:
    '"\\(value) is just how you build strings in Swift." It is also how you build an injection.',
  detection_approach:
    'RX per line: a sqlite3_exec / .execute / .raw / .query call whose string argument contains \\( interpolation.',
  fp_gates_v05: [
    'comment lines',
    'SQLKit SQLQueryString bind parameters / ? placeholders with no \\( in the SQL',
    'interpolation of a compile-time constant (manual review)',
    '*Tests.swift / src/test / scanner self-source / fixture tree (swiftFiles())',
  ],
  remediation:
    'Use parameter binding: SQLite.swift statement binds, FMDB executeUpdate("... ?", values), Vapor SQLKit .raw with SQLBind / the query builder. Never interpolate into the SQL string.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/SW-SQL-RAW-001/positive.swift',
    negative: 'src/lib/probes/v05/fixtures/SW-SQL-RAW-001/negative.swift',
  },
  known_incidents: 'CWE-89; OWASP A03; SQLite.swift / Vapor SQLKit binding guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of swiftFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isSwiftCommentLine(line)) return;
        if (!SQL_INTERP_RE.test(line)) return;
        findings.push({
          id: `sw-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with Swift string interpolation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Bind parameters instead of interpolating: FMDB executeUpdate("... ?", v), SQLite.swift binds, Vapor SQLKit SQLBind / query builder.',
        });
      });
    }
    return findings;
  },
};
