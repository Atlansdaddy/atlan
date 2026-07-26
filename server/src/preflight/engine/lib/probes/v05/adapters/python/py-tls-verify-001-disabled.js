// src/lib/probes/v05/adapters/python/py-tls-verify-001-disabled.js
//
// XL-004 adapter for Python. RX-based. Catches requests/httpx verify=False
// and urllib3.disable_warnings(). A CA-bundle path on the same line is a
// false-positive gate (verify="/path/to/ca.pem" is the correct fix, not the bug).

import { pythonFiles, isPythonCommentLine } from '../../shared-detectors/python-scope.js';

const PROBE_NAME = 'Python TLS Verification Disabled';

const VERIFY_FALSE_RE = /\bverify\s*=\s*False\b/;
const DISABLE_WARNINGS_RE = /\burllib3\.disable_warnings\s*\(/;
// If verify is set to a string path, that's the remediation, not the bug.
const VERIFY_PATH_RE = /\bverify\s*=\s*["'][^"']+["']/;

export const PY_TLS_VERIFY_001 = {
  probe_id: 'PY-TLS-VERIFY-001',
  xl_family: 'XL-004',
  language: 'python',
  name: PROBE_NAME,
  category: 'transport',
  severity: 'high',
  confidence: 'high',
  cwe: 'CWE-295',
  owasp_web: 'A02',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.py',
  what_it_catches:
    'requests.*(verify=False), httpx.Client(verify=False), or urllib3.disable_warnings(). TLS verification off means a network attacker can man-in-the-middle every HTTPS call.',
  why_ai_v05:
    'A self-signed cert or corporate proxy breaks the request and the corpus answer is verify=False, not a CA bundle. The model learned from "fix my SSL error" answers.',
  vibe_v05: '"It works when I turn off the cert check, so the cert check was the problem."',
  detection_approach:
    'RX per line: verify=False as a kwarg, or urllib3.disable_warnings(). Gate: a verify="..." string path on the line is the fix, not the bug.',
  fp_gates_v05: [
    'comment-only lines',
    'verify set to a CA bundle path string on the same line',
    'test files / scanner self-source (handled by pythonFiles())',
  ],
  remediation:
    'Point verify at the CA bundle: requests.get(url, verify="/etc/ssl/certs/ca.pem"). Fix the cert chain instead of disabling validation. Never ship verify=False.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/PY-TLS-VERIFY-001/positive.py',
    negative: 'src/lib/probes/v05/fixtures/PY-TLS-VERIFY-001/negative.py',
  },
  known_incidents: 'CWE-295; OWASP A02',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of pythonFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isPythonCommentLine(line)) return;
        const verifyFalse = VERIFY_FALSE_RE.test(line) && !VERIFY_PATH_RE.test(line);
        const disableWarnings = DISABLE_WARNINGS_RE.test(line);
        if (!verifyFalse && !disableWarnings) return;
        findings.push({
          id: `py-tls-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: verifyFalse
            ? 'TLS certificate verification disabled (verify=False)'
            : 'TLS warnings suppressed (urllib3.disable_warnings)',
          severity: 'high',
          category: 'Transport',
          cwe: 'CWE-295',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Supply a CA bundle path to verify= or fix the cert chain. Disabling verification exposes every HTTPS call to a man-in-the-middle.',
        });
      });
    }
    return findings;
  },
};
