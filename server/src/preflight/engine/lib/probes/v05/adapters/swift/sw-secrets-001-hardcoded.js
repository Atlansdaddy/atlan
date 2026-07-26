// src/lib/probes/v05/adapters/swift/sw-secrets-001-hardcoded.js
//
// XL-006 adapter for Swift. RX-based. Provider-key-shaped literals or a
// credential-named let/var bound to a 20+ char literal, rather than read
// from ProcessInfo.environment / Keychain. Corpus: iOS/macOS apps ship
// secrets in Info.plist or as Swift String literals.

import { swiftFiles, isSwiftCommentLine } from '../../shared-detectors/swift-scope.js';

const PROBE_NAME = 'Swift Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// let apiKey = "literal"  /  static let SECRET: String = "literal"
const ASSIGN_LITERAL_RE =
  /\b(?:static\s+|private\s+|public\s+|fileprivate\s+)*(?:let|var)\s+\w*(?:[Kk]ey|[Ss]ecret|[Tt]oken|[Pp]assword|[Aa]pi|API|KEY|SECRET|TOKEN)\w*\s*(?::\s*String)?\s*=\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE = /ProcessInfo\.processInfo\.environment|Keychain|SecItem(?:Copy|Add)|getenv\s*\(/;

export const SW_SECRETS_001 = {
  probe_id: 'SW-SECRETS-001',
  xl_family: 'XL-006',
  language: 'swift',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.swift',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named let/var bound to a 20+ char string literal, in Swift source rather than read from ProcessInfo.environment / Keychain.',
  why_ai_v05:
    'AI inlines a placeholder key so the app builds; it ships inside the .ipa and is extractable with strings(1).',
  vibe_v05: '"Hard-code it for now." It ends up in the shipped app bundle.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named let/var = "<20+ chars>". Gates: placeholder substrings, ProcessInfo.environment / Keychain references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'env / Keychain references (ProcessInfo.environment, Keychain, SecItem)',
    '*Tests.swift / src/test / scanner self-source / fixture tree (swiftFiles())',
  ],
  remediation:
    'Read the key from the environment / Keychain / a build-time secret kept out of the bundle. Rotate any key ever committed or shipped.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/SW-SECRETS-001/positive.swift',
    negative: 'src/lib/probes/v05/fixtures/SW-SECRETS-001/negative.swift',
  },
  known_incidents: 'CWE-798; OWASP A07 / MASVS-CRYPTO; routine .ipa secret extraction',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of swiftFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isSwiftCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `sw-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Swift source',
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
            'Move the key out of source / the app bundle into the environment or Keychain. Rotate it — anything shipped is extractable.',
        });
      });
    }
    return findings;
  },
};
