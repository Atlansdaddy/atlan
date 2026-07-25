// src/lib/probes/v05/adapters/java/jv-sql-raw-001-concat.js
//
// XL-002 adapter for Java. RX-based. JPA/Hibernate createQuery /
// createNativeQuery / Session.createQuery, or Spring JdbcTemplate
// queryForList/query/update, whose SQL/JPQL string is built with string
// concatenation. Corpus: "Hibernate / JPA Query with string concatenation"
// + "A03; JdbcTemplate.queryForList with string concatenation".

import { javaFiles, isJavaCommentLine } from '../../shared-detectors/java-scope.js';

const PROBE_NAME = 'Java Raw SQL Interpolation';

const SQL_SURFACE_RE =
  /\.\s*(?:createQuery|createNativeQuery|createSQLQuery|queryForList|queryForObject|queryForMap|query|update|execute|batchUpdate)\s*\(/;
// A string literal adjacent to a + concatenation (the value spliced in).
const CONCAT_RE = /"\s*\+|\+\s*"|"\s*\+\s*\w|\w\s*\+\s*"/;

export const JV_SQL_RAW_001 = {
  probe_id: 'JV-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'java',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.java',
  what_it_catches:
    'EntityManager/Session createQuery / createNativeQuery, or Spring JdbcTemplate queryForList/query/update, where the SQL or JPQL string is built with + concatenation rather than a bound parameter.',
  why_ai_v05:
    'String concatenation is the shortest way to "put the value in the WHERE clause"; setParameter / ? placeholders are extra ceremony the model skips.',
  vibe_v05:
    '"Build the query string, hand it to the EntityManager." No model of JPQL/SQL parsing vs parameter binding.',
  detection_approach:
    'RX per line: a JPA/Hibernate/JdbcTemplate query surface call AND a string-literal + concatenation on the same line.',
  fp_gates_v05: [
    'comment lines',
    'fully literal query strings with setParameter()/? placeholders and no concat',
    'concatenation of compile-time constants only (manual review)',
    '*Test.java / src/test / scanner self-source / fixture tree (javaFiles())',
  ],
  remediation:
    'Use bound parameters: createQuery("... WHERE name = :name").setParameter("name", name); JdbcTemplate.queryForList("... WHERE id = ?", id). Never concatenate user input into the query string.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/JV-SQL-RAW-001/positive.java',
    negative: 'src/lib/probes/v05/fixtures/JV-SQL-RAW-001/negative.java',
  },
  known_incidents: 'CWE-89; OWASP A03; Hibernate/JPA + Spring JDBC injection advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of javaFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isJavaCommentLine(line)) return;
        if (!SQL_SURFACE_RE.test(line)) return;
        if (!CONCAT_RE.test(line)) return;
        findings.push({
          id: `jv-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL/JPQL built with string concatenation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Bind the value: createQuery("... = :p").setParameter("p", v) or JdbcTemplate "... = ?" with args. Never concatenate input into the query.',
        });
      });
    }
    return findings;
  },
};
