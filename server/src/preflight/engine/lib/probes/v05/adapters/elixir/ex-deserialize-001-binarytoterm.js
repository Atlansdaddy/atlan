// src/lib/probes/v05/adapters/elixir/ex-deserialize-001-binarytoterm.js
//
// XL-001 adapter for Elixir. RX-based. :erlang.binary_to_term/1 (or with
// an options list lacking :safe) — Erlang's pickle equivalent: arbitrary
// term construction including reference forging. Corpus: docs/v05-
// research/preflight_v05_probe_inventory.md "13. Elixir".

import { elixirFiles, isElixirCommentLine } from '../../shared-detectors/elixir-scope.js';

const PROBE_NAME = 'Elixir Unsafe Deserialization';

const BTT_RE = /:erlang\.binary_to_term\s*\(/;
const SAFE_OPT_RE = /:safe\b/;

export const EX_DESERIALIZE_001 = {
  probe_id: 'EX-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'elixir',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.ex',
  what_it_catches:
    ':erlang.binary_to_term(payload) called without the [:safe] option — arbitrary term construction (atom exhaustion, reference forging) from untrusted bytes.',
  why_ai_v05:
    'binary_to_term is the obvious inverse of term_to_binary; the [:safe] option and Plug.Crypto wrapping are rarely shown in the corpus.',
  vibe_v05:
    '"Encode the term, decode it back." No model of the bytes constructing arbitrary terms.',
  detection_approach: 'RX per line: :erlang.binary_to_term( without :safe present on the line.',
  fp_gates_v05: [
    'comment lines',
    ':erlang.binary_to_term(payload, [:safe])',
    'Plug.Crypto.non_executable_binary_to_term (the safe wrapper)',
    '_test.exs / test dir / scanner self-source / fixture tree (elixirFiles())',
  ],
  remediation:
    'Pass [:safe]: :erlang.binary_to_term(payload, [:safe]). Better, use Plug.Crypto.non_executable_binary_to_term/2, or a signed token (Phoenix.Token).',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/EX-DESERIALIZE-001/positive.ex',
    negative: 'src/lib/probes/v05/fixtures/EX-DESERIALIZE-001/negative.ex',
  },
  known_incidents: 'CWE-502; OWASP A08; Erlang binary_to_term :safe guidance',
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
        if (!BTT_RE.test(line) || SAFE_OPT_RE.test(line)) return;
        findings.push({
          id: `ex-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Unsafe :erlang.binary_to_term (no [:safe])',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Pass [:safe], or use Plug.Crypto.non_executable_binary_to_term/2, or a signed Phoenix.Token.',
        });
      });
    }
    return findings;
  },
};
