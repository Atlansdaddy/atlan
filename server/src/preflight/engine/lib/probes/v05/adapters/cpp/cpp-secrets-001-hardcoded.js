// src/lib/probes/v05/adapters/cpp/cpp-secrets-001-hardcoded.js
//
// XL-006 adapter for C++. RX-based. Provider-key-shaped literals or a
// credential-named std::string / const char* / constexpr / #define bound
// to a 20+ char literal, rather than read from getenv / std::getenv.

import { cppFiles, isCFamilyCommentLine } from '../../shared-detectors/c-family-scope.js';

const PROBE_NAME = 'C++ Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// const std::string apiKey = "literal"; / constexpr char* SECRET = "literal";
const ASSIGN_LITERAL_RE =
  /\b(?:const|constexpr|static)?\s*(?:std::string|char\s*\*|auto)\s+\w*(?:key|secret|token|password|api)\w*\s*=\s*"[^"]{20,}"|#define\s+\w*(?:KEY|SECRET|TOKEN|PASSWORD|API)\w*\s+"[^"]{20,}"/i;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE = /\b(?:std::)?getenv\s*\(|secure_getenv\s*\(/;

export const CPP_SECRETS_001 = {
  probe_id: 'CPP-SECRETS-001',
  xl_family: 'XL-006',
  language: 'cpp',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.{cpp,cc,cxx,hpp,hh}',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named std::string / const char* / #define bound to a 20+ char string literal, in C++ source rather than read from std::getenv.',
  why_ai_v05:
    'AI inlines a placeholder key so the build runs; it ships in the binary and is trivially extractable.',
  vibe_v05: '"Hard-code it for now." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named std::string/char*/#define = "<20+ chars>". Gates: placeholder substrings, std::getenv references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'std::getenv / getenv references',
    '_test.cpp / scanner self-source / fixture tree (cppFiles())',
  ],
  remediation:
    'Read the key from the environment (std::getenv) or a secrets store. Rotate any key shipped in a binary.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CPP-SECRETS-001/positive.cpp',
    negative: 'src/lib/probes/v05/fixtures/CPP-SECRETS-001/negative.cpp',
  },
  known_incidents: 'CWE-798; OWASP A07; routine binary secret extraction',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of cppFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCFamilyCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `cpp-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in C++ source',
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
            'Move the key to the environment / a secrets store. Rotate it — anything shipped in a binary is extractable.',
        });
      });
    }
    return findings;
  },
};
