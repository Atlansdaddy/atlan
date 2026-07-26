// src/lib/probes/v05/adapters/kotlin/kt-sql-raw-001-room.js
//
// XL-002 adapter for Kotlin. RX-based. Room @RawQuery with a
// SimpleSQLiteQuery built by concatenation, or a @Query annotation whose
// string interpolates a Kotlin template (${...}) instead of a :named
// binding. Corpus: "Room @Dao @Query with raw SQL using string template".

import { kotlinFiles, isKtCommentLine } from '../../shared-detectors/kotlin-scope.js';

const PROBE_NAME = 'Kotlin Raw SQL Interpolation';

const SIMPLE_SQLITE_CONCAT_RE = /\bSimpleSQLiteQuery\s*\(\s*[^)]*(?:"\s*\+|\+\s*"|\$\{|\$\w)/;
const QUERY_TEMPLATE_RE = /@Query\s*\(\s*"[^"]*\$\{?[A-Za-z_]/;

export const KT_SQL_RAW_001 = {
  probe_id: 'KT-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'kotlin',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.kt',
  what_it_catches:
    'Room @RawQuery fed a SimpleSQLiteQuery built with + / Kotlin string template, or a @Query annotation that interpolates ${...} instead of using a :named binding.',
  why_ai_v05:
    'Kotlin string templates make "${name}" look like a safe substitution, so the model drops it into @Query / SimpleSQLiteQuery instead of a :name binding.',
  vibe_v05:
    '"It is a Kotlin template, the framework will handle it." Room only parameterizes :named bindings.',
  detection_approach:
    'RX per line: SimpleSQLiteQuery(...) with a +/${} concat, or @Query("...${...}...").',
  fp_gates_v05: [
    'comment lines',
    '@Query with :named bindings and no ${} template',
    'SimpleSQLiteQuery with a bind-args array and a literal SQL string',
    '*Test.kt / src/test / scanner self-source / fixture tree (kotlinFiles())',
  ],
  remediation:
    'Use @Query("SELECT ... WHERE name = :name") with a :named parameter, or SimpleSQLiteQuery("... ?", arrayOf(value)). Never concatenate / template user input into the SQL.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/KT-SQL-RAW-001/positive.kt',
    negative: 'src/lib/probes/v05/fixtures/KT-SQL-RAW-001/negative.kt',
  },
  known_incidents: 'CWE-89; OWASP A03; Room @RawQuery / SimpleSQLiteQuery guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of kotlinFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isKtCommentLine(line)) return;
        if (!SIMPLE_SQLITE_CONCAT_RE.test(line) && !QUERY_TEMPLATE_RE.test(line)) return;
        findings.push({
          id: `kt-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with string template / concatenation (Room)',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use :named bindings in @Query, or SimpleSQLiteQuery("... ?", arrayOf(value)). Never template user input into SQL.',
        });
      });
    }
    return findings;
  },
};
