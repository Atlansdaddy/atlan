// src/lib/probes/v05/adapters/rust/rs-tls-verify-001-danger.js
//
// XL-004 adapter for Rust. RX-based. reqwest ClientBuilder with
// danger_accept_invalid_certs(true) / danger_accept_invalid_hostnames(true).
// Corpus: "reqwest::ClientBuilder::danger_accept_invalid_certs(true)" —
// the Rust analogue of Python verify=False.

import { rustFiles, isRustCommentLine } from '../../shared-detectors/rust-scope.js';

const PROBE_NAME = 'Rust TLS Verification Disabled';

const DANGER_RE = /\bdanger_accept_invalid_(?:certs|hostnames)\s*\(\s*true\s*\)/;

export const RS_TLS_VERIFY_001 = {
  probe_id: 'RS-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'rust',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.rs',
  what_it_catches:
    'A reqwest ClientBuilder with danger_accept_invalid_certs(true) or danger_accept_invalid_hostnames(true), which turns off certificate / hostname verification for every request the client makes.',
  why_ai_v05:
    'A self-signed or proxy cert breaks the request; the first fix in the corpus is the danger_ toggle, not a Certificate::from_pem root.',
  vibe_v05: '"It works when I accept invalid certs, so the cert check was the problem."',
  detection_approach:
    'RX per line: danger_accept_invalid_certs(true) or danger_accept_invalid_hostnames(true).',
  fp_gates_v05: [
    'comment lines',
    'value is false / a variable rather than the literal true',
    'test files / scanner self-source / fixture tree (rustFiles())',
  ],
  remediation:
    'Remove the danger_ toggle. For a private CA, add the root with Certificate::from_pem and .add_root_certificate(). For local dev only, gate it behind a non-release cfg.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RS-TLS-VERIFY-001/positive.rs',
    negative: 'src/lib/probes/v05/fixtures/RS-TLS-VERIFY-001/negative.rs',
  },
  known_incidents: 'CWE-295; OWASP A02; reqwest danger_accept_invalid_certs docs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of rustFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isRustCommentLine(line)) return;
        if (!DANGER_RE.test(line)) return;
        findings.push({
          id: `rs-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS certificate verification disabled (danger_accept_invalid_*)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Remove the toggle. Add a private CA via Certificate::from_pem + add_root_certificate, or gate the relaxation behind a dev-only cfg that cannot reach release.',
        });
      });
    }
    return findings;
  },
};
