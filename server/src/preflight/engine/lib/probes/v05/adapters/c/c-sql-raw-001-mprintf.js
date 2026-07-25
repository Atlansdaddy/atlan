// src/lib/probes/v05/adapters/c/c-sql-raw-001-mprintf.js
//
// XL-002 adapter for C. RX-based. sqlite3_mprintf with %s/%d (not the safe
// %q), or a sqlite3_exec / mysql_query / PQexec call alongside an
// sprintf-family format build on the same line. Corpus: "A03;
// sqlite3_exec/sqlite3_mprintf concatenation".

import { cFiles, isCFamilyCommentLine } from '../../shared-detectors/c-family-scope.js';

const PROBE_NAME = 'C Raw SQL Interpolation';

// sqlite3_mprintf("...%s...") — %q is the safe escape; %s/%d are not.
const MPRINTF_UNSAFE_RE = /\bsqlite3_mprintf\s*\(\s*"[^"]*%[sd]/;
const SQL_SURFACE_RE = /\b(?:sqlite3_exec|mysql_query|mysql_real_query|PQexec)\s*\(/;
const FORMAT_BUILD_RE = /\b(?:sprintf|snprintf|asprintf|strcat|strcpy|strncat)\s*\(/;

export const C_SQL_RAW_001 = {
  probe_id: 'CC-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'c',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.{c,h}',
  what_it_catches:
    'sqlite3_mprintf with a %s/%d directive (not the safe %q), or a sqlite3_exec / mysql_query / PQexec call on a line that also builds the string with sprintf/snprintf/strcat.',
  why_ai_v05:
    'Building the query with sprintf then handing the buffer to exec is the shortest C path; prepared statements + bind are several extra calls the model skips.',
  vibe_v05:
    '"Format the SQL into a char buffer and run it." No model of bind parameters in C database APIs.',
  detection_approach:
    'RX per line: sqlite3_mprintf("...%s/%d..."), or a SQL exec surface (sqlite3_exec/mysql_query/PQexec) on the same line as an sprintf-family format build.',
  fp_gates_v05: [
    'comment lines',
    'sqlite3_mprintf using the safe %q escape',
    'exec of a fully literal query string with no sprintf-family build',
    '_test.c / scanner self-source / fixture tree (cFiles())',
  ],
  remediation:
    'Use sqlite3_prepare_v2 + sqlite3_bind_*; libpq PQexecParams; mysql_stmt_bind_param. For sqlite3_mprintf use %q (escaped), never %s, for SQL values.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CC-SQL-RAW-001/positive.c',
    negative: 'src/lib/probes/v05/fixtures/CC-SQL-RAW-001/negative.c',
  },
  known_incidents: 'CWE-89; OWASP A03; SQLite mprintf %q vs %s guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of cFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCFamilyCommentLine(line)) return;
        const hit =
          MPRINTF_UNSAFE_RE.test(line) || (SQL_SURFACE_RE.test(line) && FORMAT_BUILD_RE.test(line));
        if (!hit) return;
        findings.push({
          id: `c-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with sprintf-family / unsafe mprintf',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use prepared statements with bound parameters (sqlite3_prepare_v2 + bind, PQexecParams). For sqlite3_mprintf use %q, never %s, for values.',
        });
      });
    }
    return findings;
  },
};
