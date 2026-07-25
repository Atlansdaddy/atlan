// src/lib/probes/v05/adapters/java/jv-tls-verify-001-trustall.js
//
// XL-004 adapter for Java. RX-based. The two classic Java MitM enablers:
// a HostnameVerifier that always returns true (or NoopHostnameVerifier /
// ALLOW_ALL), and an X509TrustManager whose checkServerTrusted body is
// empty. Corpus: "TrustManager that accepts all certs" + "HostnameVerifier
// returning true".

import { javaFiles, isJavaCommentLine } from '../../shared-detectors/java-scope.js';

const PROBE_NAME = 'Java TLS Verification Disabled';

// Allow-all hostname verification, single-line forms.
const NOOP_HOSTNAME_RE =
  /\bNoopHostnameVerifier\.INSTANCE\b|\bALLOW_ALL_HOSTNAME_VERIFIER\b|setHostnameVerifier\s*\(\s*\([^)]*\)\s*->\s*true\s*\)/;
// X509TrustManager checkServerTrusted / checkClientTrusted with an empty body.
const EMPTY_TRUST_RE =
  /\bpublic\s+void\s+check(?:Server|Client)Trusted\s*\([^)]*\)\s*(?:throws\s+[\w.]+\s*)?\{\s*\}/;

export const JV_TLS_VERIFY_001 = {
  probe_id: 'JV-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'java',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.java',
  what_it_catches:
    'A HostnameVerifier that always returns true (lambda, NoopHostnameVerifier.INSTANCE, ALLOW_ALL_HOSTNAME_VERIFIER) or an X509TrustManager whose checkServerTrusted/checkClientTrusted body is empty.',
  why_ai_v05:
    'A self-signed or corporate cert breaks the call; the corpus answer is a trust-all manager or a true-returning verifier, not a pinned CA.',
  vibe_v05: '"Trust everything so the HTTPS call stops throwing."',
  detection_approach:
    'RX per line: NoopHostnameVerifier.INSTANCE / ALLOW_ALL_HOSTNAME_VERIFIER / setHostnameVerifier((..)->true), or an empty-bodied checkServerTrusted/checkClientTrusted.',
  fp_gates_v05: [
    'comment lines',
    'a checkServerTrusted with a real body (chain validation present)',
    'pinned-cert verifiers that compare a known fingerprint',
    '*Test.java / src/test / scanner self-source / fixture tree (javaFiles())',
  ],
  remediation:
    'Remove the trust-all manager / true verifier. Use the default SSLContext, or a custom TrustManager that validates against a pinned CA. Never ship an empty checkServerTrusted.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/JV-TLS-VERIFY-001/positive.java',
    negative: 'src/lib/probes/v05/fixtures/JV-TLS-VERIFY-001/negative.java',
  },
  known_incidents: 'CWE-295; OWASP A02; large body of Android/Java MitM CVEs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of javaFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isJavaCommentLine(line)) return;
        if (!NOOP_HOSTNAME_RE.test(line) && !EMPTY_TRUST_RE.test(line)) return;
        findings.push({
          id: `jv-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (trust-all manager / allow-all hostname)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use the default SSLContext or a pinned-CA TrustManager. Never an empty checkServerTrusted or a true-returning HostnameVerifier.',
        });
      });
    }
    return findings;
  },
};
