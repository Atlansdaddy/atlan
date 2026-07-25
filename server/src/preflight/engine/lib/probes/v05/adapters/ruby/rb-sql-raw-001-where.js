// src/lib/probes/v05/adapters/ruby/rb-sql-raw-001-where.js
//
// XL-002 adapter for Ruby. RX-based. ActiveRecord where / find_by_sql /
// order / group / having / pluck given a string with #{...}
// interpolation. Corpus: "Rails ActiveRecord where with string
// interpolation" (Brakeman's #1 Rails injection class for a decade).

import { rubyFiles, isRubyCommentLine } from '../../shared-detectors/ruby-scope.js';

const PROBE_NAME = 'Ruby Raw SQL Interpolation';

const AR_INTERP_RE =
  /\.\s*(?:where|find_by_sql|order|group|having|pluck|select|exists\?|joins|reorder)\s*\(\s*"[^"]*#\{/;
const EXEC_INTERP_RE = /\.\s*(?:execute|exec_query)\s*\(\s*"[^"]*#\{/;

export const RB_SQL_RAW_001 = {
  probe_id: 'RB-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'ruby',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.rb',
  what_it_catches:
    'ActiveRecord where / find_by_sql / order / group / having / pluck (or connection.execute) given a "..." string that contains #{...} interpolation — the user value is parsed as SQL.',
  why_ai_v05:
    'The string form parallels raw SQL in the training data, so the model writes where("name = \'#{x}\'") instead of the hash / bind form.',
  vibe_v05:
    '"where takes a SQL string, so I write the SQL string." No model of the hash / ? bind forms.',
  detection_approach:
    'RX per line: an ActiveRecord query method (or connection.execute) whose string argument contains #{ interpolation.',
  fp_gates_v05: [
    'comment lines',
    'where(name: value) hash form or where("name = ?", value) bind form',
    'interpolation of a constant / table name validated against an allowlist',
    '_spec.rb / spec|test dirs / scanner self-source / fixture tree (rubyFiles())',
  ],
  remediation:
    'Use the hash form where(name: value) or the bind form where("name = ?", value) / where("name = :n", n: value). Never interpolate #{params...} into the SQL string.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RB-SQL-RAW-001/positive.rb',
    negative: 'src/lib/probes/v05/fixtures/RB-SQL-RAW-001/negative.rb',
  },
  known_incidents: 'CWE-89; OWASP A03; Brakeman SQL-injection check; rails-sqli.org',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of rubyFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isRubyCommentLine(line)) return;
        if (!AR_INTERP_RE.test(line) && !EXEC_INTERP_RE.test(line)) return;
        findings.push({
          id: `rb-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with Ruby string interpolation',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use where(col: value) or where("col = ?", value). Never interpolate #{...} into the SQL.',
        });
      });
    }
    return findings;
  },
};
