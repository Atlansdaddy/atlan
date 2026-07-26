// src/lib/probes/v05/adapters/scala/sc-secrets-001-hardcoded.js
//
// XL-006 adapter for Scala. RX-based. Provider-key-shaped literals or a
// credential-named val/var bound to a 20+ char literal, rather than read
// from sys.env / System.getenv / Typesafe Config.

import { scalaFiles, isScalaCommentLine } from '../../shared-detectors/scala-scope.js';

const PROBE_NAME = 'Scala Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// (private) val apiKey: String = "literal"
const ASSIGN_LITERAL_RE =
  /\b(?:private\s+|final\s+|lazy\s+)*va[lr]\s+\w*(?:[Kk]ey|[Ss]ecret|[Tt]oken|[Pp]assword|[Aa]pi|API|KEY|SECRET|TOKEN)\w*\s*(?::\s*String)?\s*=\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE =
  /\bsys\.env|System\.getenv|ConfigFactory|com\.typesafe\.config|scala\.util\.Properties\.env|Ciris|pureconfig/;

export const SC_SECRETS_001 = {
  probe_id: 'SC-SECRETS-001',
  xl_family: 'XL-006',
  language: 'scala',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.scala',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named val/var bound to a 20+ char string literal, in Scala source rather than read from sys.env / System.getenv / Typesafe Config.',
  why_ai_v05: 'AI inlines a placeholder key so the app runs; it gets committed and never rotated.',
  vibe_v05: '"val apiKey = \\"...\\" for now." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named val/var = "<20+ chars>". Gates: placeholder substrings, sys.env / ConfigFactory references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'sys.env / System.getenv / ConfigFactory / Ciris / pureconfig references',
    '*Test/*Spec.scala / src/test / scanner self-source / fixture tree (scalaFiles())',
  ],
  remediation:
    'Read the key from sys.env / ConfigFactory with the value kept out of VCS. Rotate any key ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/SC-SECRETS-001/positive.scala',
    negative: 'src/lib/probes/v05/fixtures/SC-SECRETS-001/negative.scala',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
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
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `sc-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Scala source',
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
            'Move the key to sys.env / ConfigFactory kept out of VCS. Rotate it — anything committed is compromised.',
        });
      });
    }
    return findings;
  },
};
