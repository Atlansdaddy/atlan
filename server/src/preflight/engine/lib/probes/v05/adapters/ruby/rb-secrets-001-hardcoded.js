// src/lib/probes/v05/adapters/ruby/rb-secrets-001-hardcoded.js
//
// XL-006 adapter for Ruby. RX-based. Provider-key-shaped literals or a
// credential-named constant / assignment bound to a 20+ char literal,
// rather than read from ENV / Rails credentials.

import { rubyFiles, isRubyCommentLine } from '../../shared-detectors/ruby-scope.js';

const PROBE_NAME = 'Ruby Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// API_KEY = "literal"  /  api_key: "literal"  /  @secret = "literal"
const ASSIGN_LITERAL_RE =
  /\b@?\w*(?:KEY|SECRET|TOKEN|PASSWORD|api_key|secret|token|password|API_KEY)\w*\s*(?:=|:)\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE =
  /\bENV\s*[\[.]|\bENV\.fetch|Rails\.application\.credentials|Figaro|dotenv|credentials\./;

export const RB_SECRETS_001 = {
  probe_id: 'RB-SECRETS-001',
  xl_family: 'XL-006',
  language: 'ruby',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.rb',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named constant / ivar / hash key bound to a 20+ char string literal, in Ruby source rather than read from ENV / Rails credentials.',
  why_ai_v05:
    'AI inlines a placeholder key so the script runs; it is forgotten before rotation and often committed to a public repo.',
  vibe_v05: '"Set API_KEY = \'...\' for now, move it to ENV later." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named = / : "<20+ chars>". Gates: placeholder substrings, ENV / Rails.credentials references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'ENV[...] / ENV.fetch / Rails.application.credentials references',
    '_spec.rb / spec|test dirs / scanner self-source / fixture tree (rubyFiles())',
  ],
  remediation:
    'Read the key from ENV.fetch("OPENAI_API_KEY") or Rails.application.credentials. Rotate any key ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RB-SECRETS-001/positive.rb',
    negative: 'src/lib/probes/v05/fixtures/RB-SECRETS-001/negative.rb',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of rubyFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isRubyCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `rb-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Ruby source',
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
            'Move the key to ENV / Rails credentials. Rotate it — anything committed to git is compromised even after deletion.',
        });
      });
    }
    return findings;
  },
};
