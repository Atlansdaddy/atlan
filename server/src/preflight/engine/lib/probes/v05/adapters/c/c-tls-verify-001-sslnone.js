// src/lib/probes/v05/adapters/c/c-tls-verify-001-sslnone.js
//
// XL-004 adapter for C. RX-based. OpenSSL SSL_VERIFY_NONE, or libcurl
// CURLOPT_SSL_VERIFYPEER / CURLOPT_SSL_VERIFYHOST set to 0. Corpus:
// "OpenSSL SSL_CTX with SSL_VERIFY_NONE", "libcurl CURLOPT_SSL_VERIFYPEER=0".

import { cFiles, isCFamilyCommentLine } from '../../shared-detectors/c-family-scope.js';

const PROBE_NAME = 'C TLS Verification Disabled';

const SSL_NONE_RE = /\bSSL_VERIFY_NONE\b/;
const CURL_OFF_RE = /\bCURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*0L?\b/;

export const C_TLS_VERIFY_001 = {
  probe_id: 'CC-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'c',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.{c,h}',
  what_it_catches:
    'SSL_CTX_set_verify(..., SSL_VERIFY_NONE, ...), or curl_easy_setopt with CURLOPT_SSL_VERIFYPEER / CURLOPT_SSL_VERIFYHOST set to 0 — certificate / hostname verification turned off.',
  why_ai_v05:
    'A self-signed or proxy cert breaks the handshake; the corpus fix is SSL_VERIFY_NONE / VERIFYPEER 0, not loading a CA bundle.',
  vibe_v05: '"Turn off the cert check so the connection succeeds."',
  detection_approach:
    'RX per line: SSL_VERIFY_NONE, or CURLOPT_SSL_VERIFYPEER/VERIFYHOST followed by , 0 / 0L.',
  fp_gates_v05: [
    'comment lines',
    'CURLOPT_SSL_VERIFYPEER set to 1L (verification on)',
    'SSL_VERIFY_PEER (the correct constant)',
    '_test.c / scanner self-source / fixture tree (cFiles())',
  ],
  remediation:
    'Use SSL_VERIFY_PEER and load a CA bundle (SSL_CTX_load_verify_locations). For curl, leave CURLOPT_SSL_VERIFYPEER/HOST at their defaults (1/2) and set CURLOPT_CAINFO if needed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CC-TLS-VERIFY-001/positive.c',
    negative: 'src/lib/probes/v05/fixtures/CC-TLS-VERIFY-001/negative.c',
  },
  known_incidents: 'CWE-295; OWASP A02; OpenSSL / libcurl verification docs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of cFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCFamilyCommentLine(line)) return;
        if (!SSL_NONE_RE.test(line) && !CURL_OFF_RE.test(line)) return;
        findings.push({
          id: `c-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (SSL_VERIFY_NONE / CURLOPT_SSL_VERIFY* 0)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use SSL_VERIFY_PEER + a CA bundle, or leave libcurl CURLOPT_SSL_VERIFYPEER/HOST at the secure defaults.',
        });
      });
    }
    return findings;
  },
};
