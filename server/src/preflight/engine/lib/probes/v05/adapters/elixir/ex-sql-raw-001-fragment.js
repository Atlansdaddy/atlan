// src/lib/probes/v05/adapters/elixir/ex-sql-raw-001-fragment.js
//
// XL-002 adapter for Elixir. RX-based. Ecto fragment("...#{...}...")
// (fragment/1 does NOT escape interpolation; ? + ^pin is required), or
// Ecto.Adapters.SQL.query! built with #{} / <> concat. Corpus: "Ecto
// fragment with string interpolation" + "Ecto raw query ... with concat".

import { elixirFiles, isElixirCommentLine } from '../../shared-detectors/elixir-scope.js';

const PROBE_NAME = 'Elixir Raw SQL Interpolation';

const FRAGMENT_INTERP_RE = /\bfragment\s*\(\s*"[^"]*#\{/;
const SQL_QUERY_INTERP_RE = /Ecto\.Adapters\.SQL\.query!?\s*\([^)]*(?:"[^"]*#\{|<>\s*\w)/;

export const EX_SQL_RAW_001 = {
  probe_id: 'EX-SQL-RAW-001',
  xl_family: 'XL-002',
  language: 'elixir',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-89',
  owasp_web: 'A03',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.ex',
  what_it_catches:
    'Ecto fragment("... #{value} ...") (fragment does not escape interpolation), or Ecto.Adapters.SQL.query! whose SQL is built with #{} / <> concatenation.',
  why_ai_v05:
    'fragment("name = \'#{name}\'") reads like a normal Elixir string; the ? + ^pin form is the safe one and is less obvious.',
  vibe_v05: '"fragment takes a SQL string, so I interpolate into it." fragment/1 does not escape.',
  detection_approach:
    'RX per line: fragment("...#{...}..."), or Ecto.Adapters.SQL.query! with #{} / <> concat.',
  fp_gates_v05: [
    'comment lines',
    'fragment("name = ?", ^name) — the pinned-parameter form',
    'Ecto.Adapters.SQL.query!(repo, "... $1", [value]) parameterised form',
    '_test.exs / test dir / scanner self-source / fixture tree (elixirFiles())',
  ],
  remediation:
    'Use fragment("name = ?", ^name) with a pinned parameter, or Ecto.Adapters.SQL.query!(repo, "... $1", [value]). Never #{} into SQL.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/EX-SQL-RAW-001/positive.ex',
    negative: 'src/lib/probes/v05/fixtures/EX-SQL-RAW-001/negative.ex',
  },
  known_incidents: 'CWE-89; OWASP A03; Ecto fragment/^pin guidance; Sobelow SQL checks',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of elixirFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isElixirCommentLine(line)) return;
        if (!FRAGMENT_INTERP_RE.test(line) && !SQL_QUERY_INTERP_RE.test(line)) return;
        findings.push({
          id: `ex-sqlraw-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Raw SQL built with #{} interpolation (Ecto fragment / raw query)',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-89',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use fragment("col = ?", ^value) or Ecto.Adapters.SQL.query!(repo, "... $1", [value]).',
        });
      });
    }
    return findings;
  },
};
