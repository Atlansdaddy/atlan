// src/lib/probes/v05/adapters/cpp/cpp-sql-raw-001-qstring.js
//
// XL-002 adapter for C++. RX-based. Qt QSqlQuery exec with a
// QString(...).arg(...) built query, or the shared C SQL surfaces
// (sqlite3_mprintf %s / exec + sprintf). Corpus: "Qt SQL: QSqlQuery exec
// with string concatenation" + cpp-httplib/Drogon raw SQL.

import { cppFiles, isCFamilyCommentLine } from '../../shared-detectors/c-family-scope.js';

const PROBE_NAME = 'C++ Raw SQL Interpolation';

// query.exec(QString("... %1 ...").arg(userInput))  /  q.exec(qstr + var)
const QT_ARG_RE = /\.\s*(?:exec|prepare)\s*\(\s*QString\s*\([^)]*\)\s*\.\s*arg\s*\(/;
const QT_CONCAT_RE = /\.\s*exec\s*\(\s*[^)]*\bQString\b[^)]*\+/;
const MPRINTF_UNSAFE_RE = /\bsqlite3_mprintf\s*\(\s*"[^"]*%[sd]/;
const SQL_SURFACE_RE = /\b(?:sqlite3_exec|mysql_query|PQexec)\s*\(/;
const FORMAT_BUILD_RE = /\b(?:sprintf|snprintf|asprintf|std::format)\s*\(/;

export const CPP_SQL_RAW_001 = {
  probe_id: 'CPP-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'cpp',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.{cpp,cc,cxx,hpp,hh}',
  what_it_catches:
    'Qt QSqlQuery exec/prepare given a QString(...).arg(...) or QString + concat query, or the C SQL surfaces (sqlite3_mprintf %s, sqlite3_exec/mysql_query/PQexec built with sprintf/std::format).',
  why_ai_v05:
    'QString("... %1").arg(x) reads like safe templating but is plain string building; bindValue is extra ceremony the model skips.',
  vibe_v05:
    '".arg() looks like a parameter, so it must be safe." It is not — it is string substitution.',
  detection_approach:
    'RX per line: QSqlQuery exec/prepare with QString(..).arg(..) or QString + concat; or a C SQL exec surface with sprintf/std::format; or sqlite3_mprintf with %s/%d.',
  fp_gates_v05: [
    'comment lines',
    'QSqlQuery::prepare with :placeholders + bindValue and no .arg()/concat',
    'sqlite3_mprintf using the safe %q escape',
    '_test.cpp / scanner self-source / fixture tree (cppFiles())',
  ],
  remediation:
    'Use QSqlQuery::prepare("... :id") + bindValue(":id", id). For sqlite/libpq use prepared statements with bound parameters. Never .arg() user input into SQL.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CPP-SQL-RAW-001/positive.cpp',
    negative: 'src/lib/probes/v05/fixtures/CPP-SQL-RAW-001/negative.cpp',
  },
  known_incidents: 'CWE-89; OWASP A03; Qt SQL bindValue guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of cppFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCFamilyCommentLine(line)) return;
        const hit =
          QT_ARG_RE.test(line) ||
          QT_CONCAT_RE.test(line) ||
          MPRINTF_UNSAFE_RE.test(line) ||
          (SQL_SURFACE_RE.test(line) && FORMAT_BUILD_RE.test(line));
        if (!hit) return;
        findings.push({
          id: `cpp-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with QString.arg / sprintf-family',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use prepared statements with bound parameters (QSqlQuery::prepare + bindValue, sqlite3_bind_*). Never .arg()/sprintf user input into SQL.',
        });
      });
    }
    return findings;
  },
};
