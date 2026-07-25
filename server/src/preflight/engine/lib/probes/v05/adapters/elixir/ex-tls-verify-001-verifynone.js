// src/lib/probes/v05/adapters/elixir/ex-tls-verify-001-verifynone.js
//
// XL-004 adapter for Elixir. RX-based. HTTPoison / Req / Tesla / :httpc
// configured with ssl: [verify: :verify_none] or insecure: true. Corpus:
// "HTTPoison/Req/Tesla with insecure: true / verify: :verify_none".

import { elixirFiles, isElixirCommentLine } from '../../shared-detectors/elixir-scope.js';

const PROBE_NAME = 'Elixir TLS Verification Disabled';

const VERIFY_NONE_RE = /\bverify\s*:\s*:verify_none\b/;
const INSECURE_RE = /\binsecure\s*:\s*true\b/;

export const EX_TLS_VERIFY_001 = {
  probe_id: 'EX-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'elixir',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.ex',
  what_it_catches:
    'An HTTP client (HTTPoison / Req / Tesla / :httpc) configured with ssl: [verify: :verify_none] or insecure: true — peer certificate verification disabled.',
  why_ai_v05:
    'A self-signed / proxy cert raises a TLS error; the corpus fix is verify: :verify_none, not a configured :cacertfile.',
  vibe_v05: '":verify_none makes the TLS error stop."',
  detection_approach: 'RX per line: verify: :verify_none, or insecure: true.',
  fp_gates_v05: [
    'comment lines',
    'verify: :verify_peer with a :cacertfile / :cacerts configured',
    '_test.exs / test dir / scanner self-source / fixture tree (elixirFiles())',
  ],
  remediation:
    'Use verify: :verify_peer with :cacertfile (or :public_key.cacerts_get()/CAStore.file_path()). Never :verify_none / insecure: true in production.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/EX-TLS-VERIFY-001/positive.ex',
    negative: 'src/lib/probes/v05/fixtures/EX-TLS-VERIFY-001/negative.ex',
  },
  known_incidents: 'CWE-295; OWASP A02; Erlang/Elixir :ssl verify guidance',
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
        if (!VERIFY_NONE_RE.test(line) && !INSECURE_RE.test(line)) return;
        findings.push({
          id: `ex-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (verify: :verify_none / insecure: true)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use verify: :verify_peer with a :cacertfile / CAStore. Never :verify_none or insecure: true.',
        });
      });
    }
    return findings;
  },
};
