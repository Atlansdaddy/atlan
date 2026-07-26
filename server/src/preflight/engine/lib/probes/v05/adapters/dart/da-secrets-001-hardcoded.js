// src/lib/probes/v05/adapters/dart/da-secrets-001-hardcoded.js
//
// XL-006 adapter for Dart. RX-based. Provider-key-shaped literals or a
// credential-named const/final bound to a 20+ char literal, rather than
// read from Platform.environment / String.fromEnvironment / dotenv.

import { dartFiles, isDartCommentLine } from '../../shared-detectors/dart-scope.js';

const PROBE_NAME = 'Dart Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// (static) const apiKey = "literal"  /  final String secret = 'literal'
const ASSIGN_LITERAL_RE =
  /\b(?:static\s+|final\s+|const\s+)+(?:String\s+)?\w*(?:[Kk]ey|[Ss]ecret|[Tt]oken|[Pp]assword|[Aa]pi|API|KEY|SECRET|TOKEN)\w*\s*=\s*['"][^'"]{20,}['"]/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE =
  /Platform\.environment|String\.fromEnvironment|dotenv\.env|bool\.fromEnvironment|--dart-define/;

export const DA_SECRETS_001 = {
  probe_id: 'DA-SECRETS-001',
  xl_family: 'XL-006',
  language: 'dart',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.dart',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named const/final bound to a 20+ char string literal, in Dart source rather than read from Platform.environment / String.fromEnvironment / dotenv.',
  why_ai_v05:
    'AI inlines a placeholder key so the Flutter app builds; it ships inside the APK/IPA/web bundle and is extractable.',
  vibe_v05: '"const apiKey = \'...\' for now." It ends up in the shipped bundle.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named const/final = "<20+ chars>". Gates: placeholder substrings, Platform.environment / String.fromEnvironment / dotenv references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'String.fromEnvironment / Platform.environment / dotenv.env references',
    '_test.dart / test dir / scanner self-source / fixture tree (dartFiles())',
  ],
  remediation:
    'Use String.fromEnvironment with --dart-define, or a backend proxy for privileged APIs (never ship the key in a Flutter Web bundle). Rotate any key ever shipped.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/DA-SECRETS-001/positive.dart',
    negative: 'src/lib/probes/v05/fixtures/DA-SECRETS-001/negative.dart',
  },
  known_incidents: 'CWE-798; OWASP A07 / Mobile M1; routine APK/bundle secret extraction',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of dartFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isDartCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `da-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Dart source',
          severity: 'critical',
          category: 'Crypto',
          cwe: 'CWE-798',
          file: f.path,
          line: i + 1,
          evidence: line
            .trim()
            .replace(/['"][^'"]{12,}['"]/g, '"<redacted>"')
            .slice(0, 200),
          remediation:
            'Use String.fromEnvironment / --dart-define or a backend proxy. Rotate any key ever shipped in a bundle.',
        });
      });
    }
    return findings;
  },
};
