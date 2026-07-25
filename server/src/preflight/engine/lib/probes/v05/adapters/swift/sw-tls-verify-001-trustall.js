// src/lib/probes/v05/adapters/swift/sw-tls-verify-001-trustall.js
//
// XL-004 adapter for Swift. RX-based. A URLSession auth-challenge
// delegate that unconditionally trusts the server: completionHandler(
// .useCredential, URLCredential(trust: serverTrust)). Corpus: "URLSession
// ... didReceive challenge returning .useCredential with URLCredential
// (trust:)".

import { swiftFiles, isSwiftCommentLine } from '../../shared-detectors/swift-scope.js';

const PROBE_NAME = 'Swift TLS Verification Disabled';

// URLCredential(trust: ...) handed to the completion handler / returned.
const TRUST_CREDENTIAL_RE = /\bURLCredential\s*\(\s*trust\s*:/;
// .serverTrust force-unwrap fed straight to the credential is the classic shape.
const USE_CREDENTIAL_TRUST_RE = /\.useCredential\s*,\s*URLCredential\s*\(\s*trust\s*:/;

export const SW_TLS_VERIFY_001 = {
  probe_id: 'SW-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'swift',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.swift',
  what_it_catches:
    'A URLSession auth-challenge delegate that builds URLCredential(trust: serverTrust) and returns it via .useCredential without evaluating the trust — accepts any server certificate.',
  why_ai_v05:
    'A self-signed dev cert fails the handshake; the corpus fix is the trust-all delegate, not a pinned certificate / evaluated SecTrust.',
  vibe_v05:
    '"Return the server trust as a credential so the request succeeds." That skips evaluation.',
  detection_approach:
    'RX per line: URLCredential(trust:) — especially handed to completionHandler with .useCredential.',
  fp_gates_v05: [
    'comment lines',
    'SecTrustEvaluateWithError / pinned-cert comparison before building the credential',
    '*Tests.swift / src/test / scanner self-source / fixture tree (swiftFiles())',
  ],
  remediation:
    'Evaluate the trust: SecTrustEvaluateWithError(serverTrust, &err) and/or pin the expected certificate/public key. Only then build URLCredential(trust:). Otherwise call completionHandler(.performDefaultHandling, nil).',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/SW-TLS-VERIFY-001/positive.swift',
    negative: 'src/lib/probes/v05/fixtures/SW-TLS-VERIFY-001/negative.swift',
  },
  known_incidents: 'CWE-295; OWASP A02 / MASVS-NETWORK-2; iOS trust-all MitM advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of swiftFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isSwiftCommentLine(line)) return;
        if (!TRUST_CREDENTIAL_RE.test(line) && !USE_CREDENTIAL_TRUST_RE.test(line)) return;
        findings.push({
          id: `sw-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification skipped (URLCredential(trust:) without evaluation)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Evaluate SecTrust (SecTrustEvaluateWithError) and/or pin the cert before building URLCredential(trust:). Otherwise use .performDefaultHandling.',
        });
      });
    }
    return findings;
  },
};
