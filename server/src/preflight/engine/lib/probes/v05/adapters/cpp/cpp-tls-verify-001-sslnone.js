// src/lib/probes/v05/adapters/cpp/cpp-tls-verify-001-sslnone.js
//
// XL-004 adapter for C++. RX-based. OpenSSL SSL_VERIFY_NONE, libcurl
// CURLOPT_SSL_VERIFY* 0, or Boost.Asio / standalone Asio
// set_verify_mode(verify_none). Corpus: C TLS section (shared) + Asio.

import { cppFiles, isCFamilyCommentLine } from '../../shared-detectors/c-family-scope.js';

const PROBE_NAME = 'C++ TLS Verification Disabled';

const SSL_NONE_RE = /\bSSL_VERIFY_NONE\b/;
const CURL_OFF_RE = /\bCURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*0L?\b/;
const ASIO_NONE_RE =
  /set_verify_mode\s*\(\s*(?:boost::asio::ssl::|asio::ssl::)?(?:context::)?verify_none\s*\)/;

export const CPP_TLS_VERIFY_001 = {
  probe_id: 'CPP-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'cpp',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.{cpp,cc,cxx,hpp,hh}',
  what_it_catches:
    'OpenSSL SSL_VERIFY_NONE, libcurl CURLOPT_SSL_VERIFYPEER/VERIFYHOST set to 0, or Asio set_verify_mode(verify_none) — peer verification disabled.',
  why_ai_v05:
    'Same shortcut as every other language: the cert error is "fixed" by turning verification off rather than configuring a trust store.',
  vibe_v05: '"verify_none makes the TLS error go away."',
  detection_approach:
    'RX per line: SSL_VERIFY_NONE; CURLOPT_SSL_VERIFYPEER/HOST , 0; set_verify_mode(verify_none).',
  fp_gates_v05: [
    'comment lines',
    'set_verify_mode(verify_peer) / SSL_VERIFY_PEER',
    'CURLOPT_SSL_VERIFYPEER set to 1L',
    '_test.cpp / scanner self-source / fixture tree (cppFiles())',
  ],
  remediation:
    'Use verify_peer with a loaded CA store (set_default_verify_paths / load_verify_file). For OpenSSL: SSL_VERIFY_PEER + CA bundle. For curl: keep the secure defaults.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CPP-TLS-VERIFY-001/positive.cpp',
    negative: 'src/lib/probes/v05/fixtures/CPP-TLS-VERIFY-001/negative.cpp',
  },
  known_incidents: 'CWE-295; OWASP A02; OpenSSL / libcurl / Asio verification docs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of cppFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCFamilyCommentLine(line)) return;
        if (!SSL_NONE_RE.test(line) && !CURL_OFF_RE.test(line) && !ASIO_NONE_RE.test(line)) return;
        findings.push({
          id: `cpp-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (SSL_VERIFY_NONE / verify_none / CURLOPT 0)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use verify_peer with a CA store, SSL_VERIFY_PEER + CA bundle, or libcurl secure defaults.',
        });
      });
    }
    return findings;
  },
};
