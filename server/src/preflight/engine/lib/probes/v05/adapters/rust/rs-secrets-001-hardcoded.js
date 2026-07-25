// src/lib/probes/v05/adapters/rust/rs-secrets-001-hardcoded.js
//
// XL-006 adapter for Rust. RX-based. Provider-key-shaped literals
// (OpenAI sk-, Anthropic sk-ant-, Google AIza, xAI xai-, Groq gsk_) or a
// let-binding named like a credential assigned a 20+ char literal, in Rust
// source rather than read from std::env / dotenvy. Mirrors PY-SECRETS-001.

import { rustFiles, isRustCommentLine } from '../../shared-detectors/rust-scope.js';

const PROBE_NAME = 'Rust Hardcoded Secret';

// Built from concatenated fragments so this source file does not itself
// contain a contiguous key-shaped literal.
const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// let api_key = "literal"; / const SECRET: &str = "literal";
const LET_LITERAL_RE =
  /\b(?:let|const|static)\s+(?:mut\s+)?[A-Za-z_][A-Za-z0-9_]*(?:_(?:key|secret|token|password|api)|(?:KEY|SECRET|TOKEN|PASSWORD|API))\b[^=]*=\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;

// Env-loaded / build-time references: not a literal.
const ENV_REF_RE = /std::env::var|env!\s*\(|dotenvy|std::env::var_os|envy::|figment::|config::/;

export const RS_SECRETS_001 = {
  probe_id: 'RS-SECRETS-001',
  xl_family: 'XL-006',
  language: 'rust',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.rs',
  what_it_catches:
    'A provider-key-shaped literal, or a let/const/static named like a credential bound to a 20+ char string literal, in Rust source rather than read from std::env / dotenvy / env!.',
  why_ai_v05:
    'AI inlines a placeholder key so the prototype compiles and runs; the placeholder is forgotten before rotation.',
  vibe_v05: '"Hard-code it for now, move it to an env var later." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named let/const/static = "<20+ chars>". Gates: placeholder substrings, and lines that read from std::env / env! / dotenvy / config crates.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'env / build-time references (std::env::var, env!, dotenvy, figment, config)',
    'test files / scanner self-source / fixture tree (rustFiles())',
  ],
  remediation:
    'Read the key from the environment: std::env::var("OPENAI_API_KEY")?. Store it in a secret manager. Rotate any key that was ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RS-SECRETS-001/positive.rs',
    negative: 'src/lib/probes/v05/fixtures/RS-SECRETS-001/negative.rs',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of rustFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isRustCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const letLiteral = LET_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !letLiteral) return;
        findings.push({
          id: `rs-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Rust source',
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
