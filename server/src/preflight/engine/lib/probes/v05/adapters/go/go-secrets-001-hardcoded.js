// src/lib/probes/v05/adapters/go/go-secrets-001-hardcoded.js
//
// XL-006 adapter for Go. RX-based. Provider-key-shaped literals or a
// credential-named binding / struct field assigned a 20+ char literal, in
// Go source rather than read from os.Getenv / os.LookupEnv / viper /
// envconfig. Mirrors PY-SECRETS-001 / RS-SECRETS-001.

import { goFiles, isGoCommentLine } from '../../shared-detectors/go-scope.js';

const PROBE_NAME = 'Go Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// apiKey := "literal" / ApiKey: "literal" / const Secret = "literal"
const ASSIGN_LITERAL_RE =
  /\b[A-Za-z_]\w*(?:Key|Secret|Token|Password|API|ApiKey|key|secret|token|password)\b\s*(?::=|=|:)\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE = /os\.Getenv|os\.LookupEnv|viper\.|envconfig|kingpin|os\.Environ/;

export const GO_SECRETS_001 = {
  probe_id: 'GO-SECRETS-001',
  xl_family: 'XL-006',
  language: 'go',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.go',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named := / = / struct-field assignment bound to a 20+ char string literal, in Go source rather than read from os.Getenv / os.LookupEnv / viper.',
  why_ai_v05:
    'AI inlines a placeholder key so the binary builds and runs; the placeholder is forgotten before rotation.',
  vibe_v05: '"Hard-code it for now, move it to an env var later." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named assignment = "<20+ chars>". Gates: placeholder substrings, and lines that read from os.Getenv / os.LookupEnv / viper / envconfig.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'env references (os.Getenv, os.LookupEnv, viper, envconfig)',
    'test files (_test.go) / scanner self-source / fixture tree (goFiles())',
  ],
  remediation:
    'Read the key from the environment: os.Getenv("OPENAI_API_KEY"). Store it in a secret manager. Rotate any key that was ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/GO-SECRETS-001/positive.go',
    negative: 'src/lib/probes/v05/fixtures/GO-SECRETS-001/negative.go',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of goFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isGoCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `go-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Go source',
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
            'Move the key to an environment variable and a secret manager. Rotate it — anything committed to git is compromised even after deletion.',
        });
      });
    }
    return findings;
  },
};
