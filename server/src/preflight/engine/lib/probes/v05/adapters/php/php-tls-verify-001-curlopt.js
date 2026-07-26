// src/lib/probes/v05/adapters/php/php-tls-verify-001-curlopt.js
//
// XL-004 adapter for PHP. RX-based. curl_setopt CURLOPT_SSL_VERIFYPEER
// false/0, CURLOPT_SSL_VERIFYHOST 0, or a Guzzle client with
// 'verify' => false. Corpus: PHP "CURLOPT_SSL_VERIFYPEER false".

import { phpFiles, isPhpCommentLine } from '../../shared-detectors/php-scope.js';

const PROBE_NAME = 'PHP TLS Verification Disabled';

const CURL_VERIFYPEER_OFF_RE = /CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)\b/i;
const CURL_VERIFYHOST_OFF_RE = /CURLOPT_SSL_VERIFYHOST\s*,\s*0\b/;
const GUZZLE_VERIFY_FALSE_RE = /['"]verify['"]\s*=>\s*false\b/;

export const PHP_TLS_VERIFY_001 = {
  probe_id: 'PHP-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'php',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.php',
  what_it_catches:
    "curl_setopt with CURLOPT_SSL_VERIFYPEER false/0, CURLOPT_SSL_VERIFYHOST 0, or a Guzzle request configured with 'verify' => false.",
  why_ai_v05:
    'A self-signed / proxy cert breaks the curl call; the corpus fix is VERIFYPEER false, not CURLOPT_CAINFO.',
  vibe_v05: '"Set VERIFYPEER to false and the curl error goes away."',
  detection_approach:
    "RX per line: CURLOPT_SSL_VERIFYPEER , false/0; CURLOPT_SSL_VERIFYHOST , 0; 'verify' => false.",
  fp_gates_v05: [
    'comment lines',
    'CURLOPT_SSL_VERIFYPEER , true / 1',
    "'verify' => true / a CA bundle path string",
    '*Test.php / tests dir / scanner self-source / fixture tree (phpFiles())',
  ],
  remediation:
    "Leave CURLOPT_SSL_VERIFYPEER true and CURLOPT_SSL_VERIFYHOST 2; set CURLOPT_CAINFO for a private CA. Guzzle: 'verify' => true or a CA bundle path.",
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/PHP-TLS-VERIFY-001/positive.php',
    negative: 'src/lib/probes/v05/fixtures/PHP-TLS-VERIFY-001/negative.php',
  },
  known_incidents: 'CWE-295; OWASP A02; PHP curl SSL verification advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of phpFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isPhpCommentLine(line)) return;
        if (
          !CURL_VERIFYPEER_OFF_RE.test(line) &&
          !CURL_VERIFYHOST_OFF_RE.test(line) &&
          !GUZZLE_VERIFY_FALSE_RE.test(line)
        )
          return;
        findings.push({
          id: `php-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'TLS verification disabled (CURLOPT_SSL_VERIFYPEER false / verify => false)',
          severity: 'critical',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Keep CURLOPT_SSL_VERIFYPEER true / VERIFYHOST 2 and set CURLOPT_CAINFO. Guzzle: verify => true / CA path.',
        });
      });
    }
    return findings;
  },
};
