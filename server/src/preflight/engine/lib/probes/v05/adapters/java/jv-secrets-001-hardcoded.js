// src/lib/probes/v05/adapters/java/jv-secrets-001-hardcoded.js
//
// XL-006 adapter for Java. RX-based. Provider-key-shaped literals or a
// credential-named String field/local assigned a 20+ char literal, rather
// than read from System.getenv / System.getProperty / @Value / Spring
// Environment. Mirrors PY/RS/GO secrets adapters.

import { javaFiles, isJavaCommentLine } from '../../shared-detectors/java-scope.js';

const PROBE_NAME = 'Java Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// String API_KEY = "literal"; / private final String secret = "literal";
const ASSIGN_LITERAL_RE =
  /\b(?:String|final\s+String|static\s+final\s+String)\s+\w*(?:KEY|SECRET|TOKEN|PASSWORD|API_KEY|ApiKey|apiKey|key|secret|token|password)\w*\s*=\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE =
  /System\.getenv|System\.getProperty|@Value|Environment\.getProperty|@ConfigProperty|dotenv/;

export const JV_SECRETS_001 = {
  probe_id: 'JV-SECRETS-001',
  xl_family: 'XL-006',
  language: 'java',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.java',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named String field/local assigned a 20+ char string literal, in Java source rather than read from System.getenv / @Value / Spring Environment.',
  why_ai_v05:
    'AI inlines a placeholder key so the app compiles and runs; the placeholder is forgotten before rotation.',
  vibe_v05: '"Hard-code it for now, move it to a config later." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a String/final String credential-named field = "<20+ chars>". Gates: placeholder substrings, and lines reading from System.getenv/@Value/Environment.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'env references (System.getenv, System.getProperty, @Value, Environment.getProperty)',
    '*Test.java / src/test / scanner self-source / fixture tree (javaFiles())',
  ],
  remediation:
    'Read the key from the environment / config: System.getenv("OPENAI_API_KEY") or @Value("${openai.api.key}"). Store it in a secret manager. Rotate any key ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/JV-SECRETS-001/positive.java',
    negative: 'src/lib/probes/v05/fixtures/JV-SECRETS-001/negative.java',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of javaFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isJavaCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `jv-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Java source',
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
            'Move the key to an environment variable / secret manager. Rotate it — anything committed to git is compromised even after deletion.',
        });
      });
    }
    return findings;
  },
};
