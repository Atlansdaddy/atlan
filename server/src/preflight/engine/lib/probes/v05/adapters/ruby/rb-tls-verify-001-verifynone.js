// src/lib/probes/v05/adapters/ruby/rb-tls-verify-001-verifynone.js
//
// XL-004 adapter for Ruby. RX-based. Net::HTTP verify_mode =
// OpenSSL::SSL::VERIFY_NONE, or an HTTP client (Faraday / HTTParty /
// RestClient) configured with ssl verify: false.

import { rubyFiles, isRubyCommentLine } from '../../shared-detectors/ruby-scope.js';

const PROBE_NAME = 'Ruby TLS Verification Disabled';

const VERIFY_NONE_RE = /\bOpenSSL::SSL::VERIFY_NONE\b/;
const SSL_VERIFY_FALSE_RE =
  /\bverify\s*:\s*false\b|\bssl_verify(?:peer)?\s*:\s*false\b|verify_ssl\s*=?\s*false\b|verify_mode\s*=\s*OpenSSL::SSL::VERIFY_NONE/;

export const RB_TLS_VERIFY_001 = {
  probe_id: 'RB-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'ruby',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.rb',
  what_it_catches:
    'Net::HTTP verify_mode = OpenSSL::SSL::VERIFY_NONE, or a Faraday / HTTParty / RestClient client configured with ssl verify: false / verify_ssl = false.',
  why_ai_v05:
    'A self-signed or corporate cert raises OpenSSL::SSL::SSLError; the corpus fix is VERIFY_NONE, not ca_file / cert_store.',
  vibe_v05: '"VERIFY_NONE makes the SSL error stop."',
  detection_approach:
    'RX per line: OpenSSL::SSL::VERIFY_NONE, verify_mode = VERIFY_NONE, or verify: false / verify_ssl = false in an HTTP client config.',
  fp_gates_v05: [
    'comment lines',
    'OpenSSL::SSL::VERIFY_PEER (the correct constant)',
    'verify: true / a ca_file / cert_store configured explicitly',
    '_spec.rb / spec|test dirs / scanner self-source / fixture tree (rubyFiles())',
  ],
  remediation:
    'Use OpenSSL::SSL::VERIFY_PEER (the default) and configure ca_file / cert_store for a private CA. For Faraday/HTTParty leave ssl verify at its secure default.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RB-TLS-VERIFY-001/positive.rb',
    negative: 'src/lib/probes/v05/fixtures/RB-TLS-VERIFY-001/negative.rb',
  },
  known_incidents: 'CWE-295; OWASP A02; Net::HTTP verify_mode advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of rubyFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isRubyCommentLine(line)) return;
        if (!VERIFY_NONE_RE.test(line) && !SSL_VERIFY_FALSE_RE.test(line)) return;
        findings.push({
          id: `rb-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (VERIFY_NONE / verify: false)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use OpenSSL::SSL::VERIFY_PEER + ca_file/cert_store, or leave the client ssl verify at its secure default.',
        });
      });
    }
    return findings;
  },
};
