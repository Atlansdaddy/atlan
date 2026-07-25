// src/lib/probes/v05/adapters/go/go-tls-verify-001-insecure.js
//
// XL-004 adapter for Go. RX-based. tls.Config{ InsecureSkipVerify: true }.
// Corpus: "tls.Config InsecureSkipVerify: true" — the Go analogue of
// Python verify=False / reqwest danger_accept_invalid_certs.

import { goFiles, isGoCommentLine } from '../../shared-detectors/go-scope.js';

const PROBE_NAME = 'Go TLS Verification Disabled';

const INSECURE_RE = /\bInsecureSkipVerify\s*:\s*true\b/;

export const GO_TLS_VERIFY_001 = {
  probe_id: 'GO-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'go',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.go',
  what_it_catches:
    'A tls.Config literal (or any struct) with InsecureSkipVerify: true, which disables certificate and hostname verification for that TLS client/transport.',
  why_ai_v05:
    "Go's strict cert validation breaks on self-signed / proxy certs; the corpus's first fix is InsecureSkipVerify, not a RootCAs pool.",
  vibe_v05: '"Skipping the verify made the error go away, so the verify was the problem."',
  detection_approach: 'RX per line: InsecureSkipVerify: true.',
  fp_gates_v05: [
    'comment lines',
    'InsecureSkipVerify: false / set from a variable rather than the literal true',
    'test files (_test.go) / scanner self-source / fixture tree (goFiles())',
  ],
  remediation:
    'Remove InsecureSkipVerify. Supply a CA pool: tls.Config{RootCAs: pool}. For local dev only, gate the relaxation behind a build tag / env that cannot reach production.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/GO-TLS-VERIFY-001/positive.go',
    negative: 'src/lib/probes/v05/fixtures/GO-TLS-VERIFY-001/negative.go',
  },
  known_incidents: 'CWE-295; OWASP A02; crypto/tls Config docs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of goFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isGoCommentLine(line)) return;
        if (!INSECURE_RE.test(line)) return;
        findings.push({
          id: `go-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS certificate verification disabled (InsecureSkipVerify: true)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Remove InsecureSkipVerify. Use tls.Config{RootCAs: pool} with the private CA, or a dev-only build tag that cannot ship to production.',
        });
      });
    }
    return findings;
  },
};
