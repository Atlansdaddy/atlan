// src/lib/probes/v05/adapters/dart/da-tls-verify-001-badcert.js
//
// XL-004 adapter for Dart. RX-based. HttpClient.badCertificateCallback
// assigned a callback that returns true unconditionally — accepts any
// server certificate. Corpus: "HTTP package with badCertificateCallback
// returning true" + "dio Interceptor disabling TLS".

import { dartFiles, isDartCommentLine } from '../../shared-detectors/dart-scope.js';

const PROBE_NAME = 'Dart TLS Verification Disabled';

// badCertificateCallback = (cert, host, port) => true
const BADCERT_TRUE_RE = /badCertificateCallback\s*=\s*\([^)]*\)\s*(?:async\s*)?=>\s*true\b/;
// badCertificateCallback = (c, h, p) { return true; }
const BADCERT_BLOCK_TRUE_RE =
  /badCertificateCallback\s*=\s*\([^)]*\)\s*(?:async\s*)?\{\s*return\s+true\s*;?\s*\}/;

export const DA_TLS_VERIFY_001 = {
  probe_id: 'DA-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'dart',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.dart',
  what_it_catches:
    'HttpClient.badCertificateCallback (or a dio HttpClientAdapter) assigned a callback that returns true unconditionally — every server certificate is accepted.',
  why_ai_v05:
    'A self-signed dev cert fails the handshake; the corpus fix is badCertificateCallback => true, not a SecurityContext with the real CA.',
  vibe_v05: '"Return true from the cert callback so the request stops failing."',
  detection_approach:
    'RX per line: badCertificateCallback = (..) => true, or = (..) { return true; }.',
  fp_gates_v05: [
    'comment lines',
    'a callback that compares cert.sha1 / pins the expected certificate',
    '_test.dart / test dir / scanner self-source / fixture tree (dartFiles())',
  ],
  remediation:
    'Remove the callback and use a SecurityContext with the real CA (setTrustedCertificates), or pin and compare the expected certificate fingerprint. Never return true unconditionally.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/DA-TLS-VERIFY-001/positive.dart',
    negative: 'src/lib/probes/v05/fixtures/DA-TLS-VERIFY-001/negative.dart',
  },
  known_incidents: 'CWE-295; OWASP A02 / Mobile M5; Flutter badCertificateCallback advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of dartFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isDartCommentLine(line)) return;
        if (!BADCERT_TRUE_RE.test(line) && !BADCERT_BLOCK_TRUE_RE.test(line)) return;
        findings.push({
          id: `da-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (badCertificateCallback returns true)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use a SecurityContext with the real CA, or pin the certificate. Never return true from badCertificateCallback.',
        });
      });
    }
    return findings;
  },
};
