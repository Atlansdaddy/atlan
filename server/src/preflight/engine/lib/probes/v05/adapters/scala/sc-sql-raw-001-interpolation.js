// src/lib/probes/v05/adapters/scala/sc-sql-raw-001-interpolation.js
//
// XL-002 adapter for Scala. RX-based. Slick/Doobie #${...} literal
// interpolation inside sql"" / fr"" / sqlu"" (the ${...} form is a safe
// bind; #${...} is not), Anorm SQL("..." + var), or Spark spark.sql(s"
// ...$var..."). Corpus: "Slick / Doobie SQL with sql string
// interpolation" + Anorm + Spark sql.

import { scalaFiles, isScalaCommentLine } from '../../shared-detectors/scala-scope.js';

const PROBE_NAME = 'Scala Raw SQL Interpolation';

// #${ inside a sql/fr/sqlu interpolator = literal splice (injectable).
const HASH_INTERP_RE = /\b(?:sql|sqlu|fr|frraw)"[^"]*#\$\{/;
// Anorm SQL("..." + var)
const ANORM_CONCAT_RE = /\bSQL\s*\(\s*"[^"]*"\s*\+/;
// Spark spark.sql(s"...$x...")
const SPARK_SINTERP_RE = /\.\s*sql\s*\(\s*s"[^"]*\$/;

export const SC_SQL_RAW_001 = {
  probe_id: 'SC-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'scala',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.scala',
  what_it_catches:
    'Slick/Doobie #${...} literal interpolation inside sql""/fr""/sqlu"" (vs the safe ${...} bind), Anorm SQL("..." + var), or Spark spark.sql(s"...$var...").',
  why_ai_v05:
    'sql"... ${x}" and sql"... #${x}" look almost identical; the model uses the # form to splice column/table names and accidentally splices values.',
  vibe_v05: '"It is the sql interpolator, so it must be safe." Only ${...} binds; #${...} is raw.',
  detection_approach:
    'RX per line: #${ inside sql/fr/sqlu interpolator; Anorm SQL("..." + ...); spark.sql(s"...$...").',
  fp_gates_v05: [
    'comment lines',
    'the safe ${...} bind form with no # prefix',
    'Anorm SQL("... {name}").on("name" -> v)',
    '*Test/*Spec.scala / src/test / scanner self-source / fixture tree (scalaFiles())',
  ],
  remediation:
    'Use ${value} (bound) not #${value} in Slick/Doobie. Anorm: SQL("... {n}").on("n" -> v). Spark: parameterise / validate; never s"...$user..." into sql().',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/SC-SQL-RAW-001/positive.scala',
    negative: 'src/lib/probes/v05/fixtures/SC-SQL-RAW-001/negative.scala',
  },
  known_incidents: 'CWE-89; OWASP A03; Slick #$ interpolation guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of scalaFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isScalaCommentLine(line)) return;
        if (
          !HASH_INTERP_RE.test(line) &&
          !ANORM_CONCAT_RE.test(line) &&
          !SPARK_SINTERP_RE.test(line)
        )
          return;
        findings.push({
          id: `sc-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with #${} / concat / s-interpolation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use the bound ${value} form (no #), Anorm .on(), or parameterised Spark SQL. Never splice user input as a literal.',
        });
      });
    }
    return findings;
  },
};
