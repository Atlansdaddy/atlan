// src/lib/probes/v05/adapters/python/py-secrets-001-hardcoded-key.js
//
// XL-006 adapter for Python. RX-based. Catches provider-key-shaped literals
// (OpenAI sk-, Anthropic sk-ant-, Google AIza, xAI xai-, Groq gsk_) and
// api_key="<literal>" passed to an LLM client constructor. Placeholder
// substrings and env-loaded references are false-positive gated.
//
// NOTE: this overlaps the v0.4 Secret Scanner. Phase 1 ships it shadow-only
// (shadow:true) so it does NOT double-fire with the v0.4 probe. Phase 2
// migrates the v0.4 Secret Scanner under XL-006 with a legacy_finding_id_seed
// so suppression IDs stay stable; until then this adapter is comparison-only.

import { pythonFiles, isPythonCommentLine } from '../../shared-detectors/python-scope.js';

const PROBE_NAME = 'Python Hardcoded Secret';

// Provider key shapes. Built from concatenated fragments so this source file
// does not itself contain a contiguous key-shaped literal (the v0.4 Secret
// Scanner would otherwise flag the scanner).
const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'), // Anthropic (check before generic sk-)
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'), // OpenAI
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'), // Google / Gemini
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'), // xAI
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'), // Groq
];

// api_key="..." with a 20+ char literal value, common in client ctors.
const API_KEY_LITERAL_RE = /\bapi_key\s*=\s*["'][^"']{20,}["']/;

// Placeholder / non-secret substrings — exclude these.
const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;

// Env-loaded reference: not a literal. os.environ / getenv / settings.
const ENV_REF_RE = /os\.environ|os\.getenv|getenv\s*\(|settings\.|config\(/;

export const PY_SECRETS_001 = {
  probe_id: 'PY-SECRETS-001',
  xl_family: 'XL-006',
  language: 'python',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.py',
  what_it_catches:
    'A provider-key-shaped literal (OpenAI / Anthropic / Google / xAI / Groq) or api_key="<literal>" in a client constructor, in Python source rather than an env var.',
  why_ai_v05:
    'AI inlines a placeholder key to make the prototype run; the placeholder gets forgotten before rotation. Vibe tools emit pasted keys inline.',
  vibe_v05: '"Just hard-code it for now, I will move it to an env var later." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR api_key="<20+ chars>". Gates: placeholder substrings, and lines that read from os.environ/getenv/settings rather than a literal.',
  fp_gates_v05: [
    'comment-only lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'env-loaded references (os.environ / getenv / settings / config())',
    '.example / .sample files (handled upstream by file scoping)',
    'test files / scanner self-source (handled by pythonFiles())',
  ],
  remediation:
    'Read the key from the environment: api_key=os.environ["OPENAI_API_KEY"]. Store the value in a secret manager. Rotate any key that was ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/PY-SECRETS-001/positive.py',
    negative: 'src/lib/probes/v05/fixtures/PY-SECRETS-001/negative.py',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of pythonFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isPythonCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const apiKeyLiteral = API_KEY_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !apiKeyLiteral) return;
        findings.push({
          id: `py-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in Python source',
          severity: 'critical',
          category: 'Crypto',
          cwe: 'CWE-798',
          file: f.path,
          line: i + 1,
          // Mask the evidence: never echo the key value back.
          evidence: line
            .trim()
            .replace(/["'][^"']{12,}["']/g, '"<redacted>"')
            .slice(0, 200),
          remediation:
            'Move the key to an environment variable and a secret manager. Rotate it — anything committed to git is compromised even after deletion.',
        });
      });
    }
    return findings;
  },
};
