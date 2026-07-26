// src/lib/probes/v05/adapters/kotlin/kt-secrets-001-hardcoded.js
//
// XL-006 adapter for Kotlin. RX-based. Provider-key-shaped literals or a
// credential-named val/const val bound to a 20+ char literal, rather than
// read from System.getenv / BuildConfig-from-env. Corpus M1: hardcoded
// API keys shipped in the APK.

import { kotlinFiles, isKtCommentLine } from '../../shared-detectors/kotlin-scope.js';

const PROBE_NAME = 'Kotlin Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// (const) val apiKey = "literal"  /  private val SECRET = "literal"
const ASSIGN_LITERAL_RE =
  /\b(?:const\s+|private\s+|internal\s+|public\s+)*val\s+\w*(?:[Kk]ey|[Ss]ecret|[Tt]oken|[Pp]assword|[Aa]pi|API|KEY|SECRET|TOKEN)\w*\s*(?::\s*String)?\s*=\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE = /System\.getenv|getenv\s*\(|BuildConfig\.|System\.getProperty/;

export const KT_SECRETS_001 = {
  probe_id: 'KT-SECRETS-001',
  xl_family: 'XL-006',
  language: 'kotlin',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.kt',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named val/const val bound to a 20+ char string literal, in Kotlin source rather than read from System.getenv / a build-time secret.',
  why_ai_v05:
    'AI inlines a placeholder key so the app builds; on Android it ships inside the APK and is trivially extractable.',
  vibe_v05: '"Hard-code it for now." It ends up in the shipped APK.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named val/const val = "<20+ chars>". Gates: placeholder substrings, System.getenv/BuildConfig references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'env / build references (System.getenv, BuildConfig.)',
    '*Test.kt / src/test / scanner self-source / fixture tree (kotlinFiles())',
  ],
  remediation:
    'Read the key from the environment or an injected build secret kept out of VCS / the APK. Rotate any key ever committed or shipped.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/KT-SECRETS-001/positive.kt',
    negative: 'src/lib/probes/v05/fixtures/KT-SECRETS-001/negative.kt',
  },
  known_incidents: 'CWE-798; OWASP A07 / Mobile M1; routine APK secret extraction',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of kotlinFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isKtCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `kt-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Kotlin source',
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
            'Move the key out of source / the APK into an injected secret. Rotate it — anything shipped is extractable.',
        });
      });
    }
    return findings;
  },
};
