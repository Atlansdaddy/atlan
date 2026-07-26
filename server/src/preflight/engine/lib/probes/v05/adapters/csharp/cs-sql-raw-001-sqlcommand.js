// src/lib/probes/v05/adapters/csharp/cs-sql-raw-001-sqlcommand.js
//
// XL-002 adapter for C#. RX-based. new SqlCommand($"...{x}..."),
// CommandText = "..." + x, or EF Core FromSqlRaw($"..."). Corpus:
// "SqlCommand with string concatenation" + "EF Core FromSqlRaw with
// interpolated string" (FromSqlRaw does NOT parameterize; FromSqlInterpolated does).

import { csharpFiles, isCsCommentLine } from '../../shared-detectors/csharp-scope.js';

const PROBE_NAME = 'C# Raw SQL Interpolation';

const SQLCOMMAND_INTERP_RE = /\bnew\s+SqlCommand\s*\(\s*\$"/;
const COMMANDTEXT_CONCAT_RE = /\.\s*CommandText\s*=\s*[^;]*(?:"\s*\+|\+\s*"|\$")/;
const FROMSQLRAW_INTERP_RE = /\bFromSqlRaw\s*(?:<[^>]*>)?\s*\(\s*\$"/;
const EXECSQLRAW_INTERP_RE = /\bExecuteSqlRaw\s*(?:Async)?\s*\(\s*\$"/;

export const CS_SQL_RAW_001 = {
  probe_id: 'CS-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'csharp',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.cs',
  what_it_catches:
    'new SqlCommand($"...{x}..."), SqlCommand.CommandText built with + / $, or EF Core FromSqlRaw/ExecuteSqlRaw given an interpolated $"..." string (FromSqlRaw does NOT parameterize — only FromSqlInterpolated does).',
  why_ai_v05:
    'The $"..." interpolation reads exactly like the safe FromSqlInterpolated, so the model uses FromSqlRaw with an interpolated string and assumes it is parameterized.',
  vibe_v05: '"It is an interpolated string, EF must parameterize it." FromSqlRaw does not.',
  detection_approach:
    'RX per line: new SqlCommand($"..."), .CommandText = ...+/$, or FromSqlRaw/ExecuteSqlRaw($"...").',
  fp_gates_v05: [
    'comment lines',
    'FromSqlInterpolated($"...") — the safe parameterizing API',
    'SqlCommand with @param + Parameters.AddWithValue and no concat',
    '*Tests.cs / src/test / scanner self-source / fixture tree (csharpFiles())',
  ],
  remediation:
    'Use SqlCommand with @parameters + Parameters.AddWithValue, or EF Core FromSqlInterpolated($"... {value}") / FromSqlRaw("... {0}", value).',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CS-SQL-RAW-001/positive.cs',
    negative: 'src/lib/probes/v05/fixtures/CS-SQL-RAW-001/negative.cs',
  },
  known_incidents: 'CWE-89; OWASP A03; EF Core FromSqlRaw vs FromSqlInterpolated docs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of csharpFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCsCommentLine(line)) return;
        if (
          !SQLCOMMAND_INTERP_RE.test(line) &&
          !COMMANDTEXT_CONCAT_RE.test(line) &&
          !FROMSQLRAW_INTERP_RE.test(line) &&
          !EXECSQLRAW_INTERP_RE.test(line)
        )
          return;
        findings.push({
          id: `cs-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with interpolation / concatenation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use parameters (SqlCommand @p + AddWithValue) or EF Core FromSqlInterpolated. FromSqlRaw with $"..." does NOT parameterize.',
        });
      });
    }
    return findings;
  },
};
