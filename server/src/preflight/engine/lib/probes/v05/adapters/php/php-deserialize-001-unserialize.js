// src/lib/probes/v05/adapters/php/php-deserialize-001-unserialize.js
//
// XL-001 adapter for PHP. RX-based. unserialize() of a non-literal
// (request superglobal / variable) without ['allowed_classes' => false]
// — PHP object injection / POP-chain RCE. Corpus: docs/v05-research/
// preflight_v05_probe_inventory.md "11. PHP" (unserialize on untrusted).

import { phpFiles, isPhpCommentLine } from '../../shared-detectors/php-scope.js';

const PROBE_NAME = 'PHP Unsafe Deserialization';

const UNSERIALIZE_RE = /\bunserialize\s*\(\s*([^;]*)/;
const LITERAL_ARG_RE = /^\s*(['"])/;
const ALLOWED_CLASSES_FALSE_RE = /allowed_classes['"]?\s*=>\s*false/;

export const PHP_DESERIALIZE_001 = {
  probe_id: 'PHP-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'php',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.php',
  what_it_catches:
    "unserialize() given a non-literal (a $_GET/$_POST/$_COOKIE superglobal or variable) without an ['allowed_classes' => false] option — PHP object injection / POP-chain RCE.",
  why_ai_v05:
    'unserialize is the "obvious" inverse of serialize; the allowed_classes option arrived late and the corpus rarely shows it.',
  vibe_v05:
    '"serialize then unserialize round-trips my data." It also round-trips an attacker class graph.',
  detection_approach:
    'RX per line: unserialize(...) whose argument is not a string literal and the call does not pass allowed_classes => false.',
  fp_gates_v05: [
    'comment lines',
    "unserialize(..., ['allowed_classes' => false])",
    'unserialize of a string literal constant',
    '*Test.php / tests dir / scanner self-source / fixture tree (phpFiles())',
  ],
  remediation:
    "Use JSON (json_decode) for untrusted data. If unserialize is unavoidable, pass ['allowed_classes' => false] (or an explicit allowlist).",
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/PHP-DESERIALIZE-001/positive.php',
    negative: 'src/lib/probes/v05/fixtures/PHP-DESERIALIZE-001/negative.php',
  },
  known_incidents: 'CWE-502; OWASP A08; PHP object-injection / POP-chain CVE class',
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
        const m = UNSERIALIZE_RE.exec(line);
        if (!m) return;
        if (LITERAL_ARG_RE.test(m[1])) return;
        if (ALLOWED_CLASSES_FALSE_RE.test(line)) return;
        findings.push({
          id: `php-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Unsafe unserialize() of untrusted input',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            "Use json_decode for untrusted data. If unserialize is required, pass ['allowed_classes' => false].",
        });
      });
    }
    return findings;
  },
};
