// src/lib/probes/v05/adapters/c/c-secrets-001-hardcoded.js
//
// XL-006 adapter for C. RX-based. Provider-key-shaped literals or a
// credential-named char* / #define assigned a 20+ char literal, rather
// than read from getenv. Mirrors the other secrets adapters.

import { cFiles, isCFamilyCommentLine } from '../../shared-detectors/c-family-scope.js';

const PROBE_NAME = 'C Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// const char *api_key = "literal";  /  #define API_KEY "literal"
const ASSIGN_LITERAL_RE =
  /\b(?:const\s+)?char\s*\*?\s*\w*(?:key|secret|token|password|api)\w*\s*=\s*"[^"]{20,}"|#define\s+\w*(?:KEY|SECRET|TOKEN|PASSWORD|API)\w*\s+"[^"]{20,}"/i;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE = /\bgetenv\s*\(|secure_getenv\s*\(/;

export const C_SECRETS_001 = {
  probe_id: 'CC-SECRETS-001',
  xl_family: 'XL-006',
  language: 'c',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.{c,h}',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named char* / #define bound to a 20+ char string literal, in C source rather than read from getenv.',
  why_ai_v05:
    'AI inlines a placeholder key so the program builds and runs; the placeholder is forgotten before rotation.',
  vibe_v05:
    '"Hard-code it for now." Later never arrives, and firmware/binaries ship with the literal.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named char* / #define = "<20+ chars>". Gates: placeholder substrings, getenv references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'getenv / secure_getenv references',
    '_test.c / scanner self-source / fixture tree (cFiles())',
  ],
  remediation:
    'Read the key from the environment (getenv) or a secrets store / secure element. Rotate any key that was ever committed or shipped in a binary.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CC-SECRETS-001/positive.c',
    negative: 'src/lib/probes/v05/fixtures/CC-SECRETS-001/negative.c',
  },
  known_incidents: 'CWE-798; OWASP A07; routine firmware/binary secret extraction',
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
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `c-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in C source',
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
            'Move the key to the environment / a secure element. Rotate it — anything shipped in a binary is extractable.',
        });
      });
    }
    return findings;
  },
};
