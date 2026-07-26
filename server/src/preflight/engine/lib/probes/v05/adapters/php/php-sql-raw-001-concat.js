// src/lib/probes/v05/adapters/php/php-sql-raw-001-concat.js
//
// XL-002 adapter for PHP. RX-based. mysqli_query / mysql_query /
// PDO->query / ->exec with a string concatenating a superglobal, or
// Laravel whereRaw / DB::raw / selectRaw / orderByRaw / havingRaw with a
// $variable. Corpus: "mysql_query/mysqli_query/PDO::query with
// concatenation" + "Laravel DB::raw / whereRaw with user input".

import { phpFiles, isPhpCommentLine } from '../../shared-detectors/php-scope.js';

const PROBE_NAME = 'PHP Raw SQL Interpolation';

// query/exec surface whose string concatenates a superglobal or variable.
const QUERY_CONCAT_RE =
  /\b(?:mysqli_query|mysql_query|pg_query)\s*\([^;]*\.\s*\$|->\s*(?:query|exec)\s*\(\s*"[^"]*(?:\.\s*\$|\$_(?:GET|POST|REQUEST|COOKIE)|\{\s*\$)/;
// Laravel raw builders with a $ inside the string.
const LARAVEL_RAW_RE =
  /\b(?:whereRaw|orWhereRaw|selectRaw|havingRaw|orderByRaw|DB::raw|DB::select|DB::statement)\s*\(\s*"[^"]*\$/;

export const PHP_SQL_RAW_001 = {
  probe_id: 'PHP-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'php',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.php',
  what_it_catches:
    'mysqli_query / mysql_query / PDO->query / ->exec whose SQL concatenates a superglobal or variable, or Laravel whereRaw / DB::raw / selectRaw / orderByRaw with a $variable inside the string.',
  why_ai_v05:
    'Concatenating $_GET into the SQL parallels the SQL in the training data; prepared statements / bindings are extra ceremony the model skips.',
  vibe_v05: '"Build the query string with the value in it, then run it."',
  detection_approach:
    'RX per line: a mysqli/PDO query surface concatenating a superglobal/variable, or a Laravel *Raw builder whose string contains $.',
  fp_gates_v05: [
    'comment lines',
    'prepared statements (prepare + bind_param / execute([...]))',
    'whereRaw("col = ?", [$v]) bind form (the $ is in the bindings array, not the SQL)',
    '*Test.php / tests dir / scanner self-source / fixture tree (phpFiles())',
  ],
  remediation:
    'Use prepared statements: mysqli_prepare + bind_param, PDO prepare + execute([$v]). Laravel: where("col", $v) or whereRaw("col = ?", [$v]).',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/PHP-SQL-RAW-001/positive.php',
    negative: 'src/lib/probes/v05/fixtures/PHP-SQL-RAW-001/negative.php',
  },
  known_incidents: 'CWE-89; OWASP A03 (perennial #1 for PHP)',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of phpFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isPhpCommentLine(line)) return;
        if (!QUERY_CONCAT_RE.test(line) && !LARAVEL_RAW_RE.test(line)) return;
        findings.push({
          id: `php-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with concatenation / interpolation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use prepared statements (mysqli_prepare + bind_param, PDO prepare + execute) or Laravel where("col", $v).',
        });
      });
    }
    return findings;
  },
};
