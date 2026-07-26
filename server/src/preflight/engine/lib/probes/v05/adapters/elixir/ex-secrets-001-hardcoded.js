// src/lib/probes/v05/adapters/elixir/ex-secrets-001-hardcoded.js
//
// XL-006 adapter for Elixir. RX-based. Provider-key-shaped literals,
// Phoenix secret_key_base / signing_salt as a literal, or a
// credential-named module attribute / binding bound to a 20+ char
// literal, rather than read from System.get_env / System.fetch_env!.

import { elixirFiles, isElixirCommentLine } from '../../shared-detectors/elixir-scope.js';

const PROBE_NAME = 'Elixir Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// secret_key_base: "literal"  /  @api_key "literal"  /  api_key: "literal"
const ASSIGN_LITERAL_RE =
  /\b(?:secret_key_base|signing_salt|encryption_salt)\s*:\s*"[^"]{20,}"|@\w*(?:key|secret|token|password|api)\w*\s+"[^"]{20,}"|\b\w*(?:key|secret|token|password|api)\w*\s*:\s*"[^"]{20,}"/i;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE = /System\.get_env|System\.fetch_env!?|Application\.(?:get|fetch)_env/;

export const EX_SECRETS_001 = {
  probe_id: 'EX-SECRETS-001',
  xl_family: 'XL-006',
  language: 'elixir',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.ex',
  what_it_catches:
    'A provider-key-shaped literal, Phoenix secret_key_base / signing_salt as a string literal, or a credential-named attribute / keyword bound to a 20+ char literal, rather than read from System.get_env / System.fetch_env!.',
  why_ai_v05:
    'AI inlines secret_key_base / API keys directly in config/runtime so the app boots; it gets committed and never rotated.',
  vibe_v05: '"Put the secret in config for now." It gets committed and never rotated.',
  detection_approach:
    'RX per line: provider key prefix patterns OR secret_key_base/signing_salt/credential-keyword/@attr = "<20+ chars>". Gates: placeholder substrings, System.get_env/fetch_env references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'System.get_env / System.fetch_env! / Application.get_env references',
    '_test.exs / test dir / scanner self-source / fixture tree (elixirFiles())',
  ],
  remediation:
    'Read from System.fetch_env!("SECRET_KEY_BASE") in runtime.exs. Rotate any secret ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/EX-SECRETS-001/positive.ex',
    negative: 'src/lib/probes/v05/fixtures/EX-SECRETS-001/negative.ex',
  },
  known_incidents: 'CWE-798; OWASP A07; Phoenix secret_key_base leak advisories',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of elixirFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isElixirCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `ex-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Elixir source',
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
            'Read from System.fetch_env! in runtime.exs. Rotate any secret ever committed.',
        });
      });
    }
    return findings;
  },
};
