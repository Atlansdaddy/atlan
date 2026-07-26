// src/lib/probes/v05/adapters/kotlin/kt-tls-verify-001-trustall.js
//
// XL-004 adapter for Kotlin. RX-based. An empty-bodied X509TrustManager
// override, or an OkHttp/Ktor allow-all HostnameVerifier lambda. Corpus:
// "Ktor client HttpClient { ... sslContext = trust-all }" + Android
// trust-all MitM patterns.

import { kotlinFiles, isKtCommentLine } from '../../shared-detectors/kotlin-scope.js';

const PROBE_NAME = 'Kotlin TLS Verification Disabled';

// override fun checkServerTrusted(...) {}  (empty body, Kotlin syntax)
const EMPTY_TRUST_RE = /\boverride\s+fun\s+check(?:Server|Client)Trusted\s*\([^)]*\)\s*\{\s*\}/;
// hostnameVerifier { _, _ -> true }  /  HostnameVerifier { _, _ -> true }
const HOSTNAME_TRUE_RE = /\bhostname[Vv]erifier\s*(?:\([^)]*\))?\s*\{[^}]*->\s*true\s*\}/;
const HOSTNAME_VERIFIER_CLASS_RE = /\bHostnameVerifier\s*\{[^}]*->\s*true\s*\}/;

export const KT_TLS_VERIFY_001 = {
  probe_id: 'KT-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'kotlin',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.kt',
  what_it_catches:
    'An X509TrustManager override whose checkServerTrusted/checkClientTrusted body is empty, or an OkHttp/Ktor hostnameVerifier lambda that always returns true.',
  why_ai_v05:
    'A self-signed dev cert breaks the Android/Ktor client; the corpus fix is a trust-all manager / true hostname verifier rather than a pinned cert.',
  vibe_v05: '"Trust all certs so the app talks to my dev server."',
  detection_approach:
    'RX per line: empty override checkServerTrusted/checkClientTrusted, or a hostnameVerifier { .. -> true } lambda.',
  fp_gates_v05: [
    'comment lines',
    'a checkServerTrusted with a real validation body',
    'a hostname verifier that compares against an expected host / pin',
    '*Test.kt / src/test / scanner self-source / fixture tree (kotlinFiles())',
  ],
  remediation:
    'Use the platform trust store. For a private CA use a network-security-config / a TrustManager that validates against a pinned CA. Never an empty checkServerTrusted or a true-returning verifier.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/KT-TLS-VERIFY-001/positive.kt',
    negative: 'src/lib/probes/v05/fixtures/KT-TLS-VERIFY-001/negative.kt',
  },
  known_incidents: 'CWE-295; OWASP A02; Android/Ktor trust-all MitM advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of kotlinFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isKtCommentLine(line)) return;
        if (
          !EMPTY_TRUST_RE.test(line) &&
          !HOSTNAME_TRUE_RE.test(line) &&
          !HOSTNAME_VERIFIER_CLASS_RE.test(line)
        )
          return;
        findings.push({
          id: `kt-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (empty trust manager / allow-all hostname)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use the platform trust store / a pinned-CA TrustManager. Never an empty checkServerTrusted or a true-returning hostname verifier.',
        });
      });
    }
    return findings;
  },
};
