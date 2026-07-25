// src/lib/probes/v05/adapters/php/php-secrets-001-hardcoded.js
//
// XL-006 adapter for PHP. RX-based. Provider-key-shaped literals or a
// credential-named $variable / define() bound to a 20+ char literal,
// rather than read from getenv / $_ENV / Laravel env().

import { phpFiles, isPhpCommentLine } from '../../shared-detectors/php-scope.js';

const PROBE_NAME = 'PHP Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// $apiKey = "literal";  /  define('API_KEY', "literal");  /  'api_key' => "literal"
const ASSIGN_LITERAL_RE =
  /\$\w*(?:key|secret|token|password|api)\w*\s*=\s*"[^"]{20,}"|define\s*\(\s*['"]\w*(?:KEY|SECRET|TOKEN|PASSWORD|API)\w*['"]\s*,\s*"[^"]{20,}"|['"]\w*(?:key|secret|token|password|api)\w*['"]\s*=>\s*"[^"]{20,}"/i;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE = /\bgetenv\s*\(|\$_ENV\[|\benv\s*\(|\$_SERVER\[/;

export const PHP_SECRETS_001 = {
  probe_id: 'PHP-SECRETS-001',
  xl_family: 'XL-006',
  language: 'php',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.php',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named $variable / define() / config array key bound to a 20+ char string literal, in PHP source rather than read from getenv / $_ENV / env().',
  why_ai_v05:
    'AI inlines a placeholder key so the script runs; WordPress/Laravel apps then commit it (wp-config.php / config arrays).',
  vibe_v05: '"Put the key in the config for now." It gets committed and never rotated.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named $var / define() / array-key = "<20+ chars>". Gates: placeholder substrings, getenv/$_ENV/env() references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'getenv / $_ENV / env() references',
    '*Test.php / tests dir / scanner self-source / fixture tree (phpFiles())',
  ],
  remediation:
    'Read the key from getenv() / $_ENV / Laravel env() with the value kept in an uncommitted .env. Rotate any key ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/PHP-SECRETS-001/positive.php',
    negative: 'src/lib/probes/v05/fixtures/PHP-SECRETS-001/negative.php',
  },
  known_incidents: 'CWE-798; OWASP A07; wp-config.php / Laravel .env credential leaks',
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
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `php-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in PHP source',
          severity: 'critical',
          category: 'Crypto',
          cwe: 'CWE-798',
          file: f.path,
          line: i + 1,
          evidence: line
            .trim()
            .replace(/"[^"]{12,}"/g, '"<redacted>"')
            .slice(0, 200),
          remediation:
            'Move the key to getenv / $_ENV / env() with an uncommitted .env. Rotate it — anything committed is compromised.',
        });
      });
    }
    return findings;
  },
};
