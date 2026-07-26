// src/lib/probes/v05/adapters/scala/sc-tls-verify-001-trustall.js
//
// XL-004 adapter for Scala. RX-based. JVM trust-all reachable from
// Scala: an empty-bodied X509TrustManager checkServerTrusted, or an
// allow-all hostname verifier (NoopHostnameVerifier / lambda -> true).

import { scalaFiles, isScalaCommentLine } from '../../shared-detectors/scala-scope.js';

const PROBE_NAME = 'Scala TLS Verification Disabled';

// Scala: def checkServerTrusted(...): Unit = {}  /  override def ... {}
const EMPTY_TRUST_RE =
  /\bdef\s+check(?:Server|Client)Trusted\s*\([^)]*\)\s*(?::\s*Unit\s*)?=?\s*\{\s*\}/;
const NOOP_HOSTNAME_RE =
  /\bNoopHostnameVerifier\.INSTANCE\b|\bALLOW_ALL_HOSTNAME_VERIFIER\b|setHostnameVerifier\s*\(\s*\([^)]*\)\s*=>\s*true\s*\)/;

export const SC_TLS_VERIFY_001 = {
  probe_id: 'SC-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'scala',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.scala',
  what_it_catches:
    'An X509TrustManager whose checkServerTrusted/checkClientTrusted body is empty, or an allow-all hostname verifier (NoopHostnameVerifier.INSTANCE / a (..) => true lambda), reachable from Scala.',
  why_ai_v05:
    'Scala uses the JVM TLS stack; the corpus fix for a self-signed cert is a trust-all manager rather than a configured trust store.',
  vibe_v05: '"Trust everything so the sttp/akka-http client connects."',
  detection_approach:
    'RX per line: empty def checkServerTrusted/checkClientTrusted, or NoopHostnameVerifier.INSTANCE / setHostnameVerifier((..)=>true).',
  fp_gates_v05: [
    'comment lines',
    'a checkServerTrusted with a real validation body',
    'a verifier that compares against a pinned host/cert',
    '*Test/*Spec.scala / src/test / scanner self-source / fixture tree (scalaFiles())',
  ],
  remediation:
    'Use the default SSLContext / a pinned-CA TrustManager. Never an empty checkServerTrusted or a true-returning verifier.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/SC-TLS-VERIFY-001/positive.scala',
    negative: 'src/lib/probes/v05/fixtures/SC-TLS-VERIFY-001/negative.scala',
  },
  known_incidents: 'CWE-295; OWASP A02; JVM trust-all MitM advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of scalaFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isScalaCommentLine(line)) return;
        if (!EMPTY_TRUST_RE.test(line) && !NOOP_HOSTNAME_RE.test(line)) return;
        findings.push({
          id: `sc-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (empty trust manager / allow-all hostname)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use the default SSLContext or a pinned-CA TrustManager. Never an empty checkServerTrusted or true-returning verifier.',
        });
      });
    }
    return findings;
  },
};
