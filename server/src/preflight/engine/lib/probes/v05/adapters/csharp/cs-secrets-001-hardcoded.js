// src/lib/probes/v05/adapters/csharp/cs-secrets-001-hardcoded.js
//
// XL-006 adapter for C#. RX-based. Provider-key-shaped literals or a
// credential-named string/const bound to a 20+ char literal, rather than
// read from Environment.GetEnvironmentVariable / IConfiguration.

import { csharpFiles, isCsCommentLine } from '../../shared-detectors/csharp-scope.js';

const PROBE_NAME = 'C# Hardcoded Secret';

const KEY_PATTERNS = [
  new RegExp('\\bsk-' + 'ant-' + '[a-zA-Z0-9_-]{40,}'),
  new RegExp('\\bsk-' + '(?:proj-)?' + '[a-zA-Z0-9_-]{20,}'),
  new RegExp('\\bAIza' + '[0-9A-Za-z_-]{35}\\b'),
  new RegExp('\\bxai-' + '[a-zA-Z0-9]{20,}'),
  new RegExp('\\bgsk_' + '[a-zA-Z0-9]{30,}'),
];

// (const/readonly/static) string ApiKey = "literal";
const ASSIGN_LITERAL_RE =
  /\b(?:const\s+|readonly\s+|static\s+|private\s+|public\s+|internal\s+)*string\s+\w*(?:Key|Secret|Token|Password|Api|API)\w*\s*=\s*"[^"]{20,}"/;

const PLACEHOLDER_RE = /your[_-]?key|xxx+|\.\.\.|EXAMPLE|changeme|placeholder|<[^>]+>|sk-\.\.\./i;
const ENV_REF_RE =
  /Environment\.GetEnvironmentVariable|IConfiguration|Configuration\[|builder\.Configuration|GetConnectionString|\bUserSecrets\b|AddAzureKeyVault/;

export const CS_SECRETS_001 = {
  probe_id: 'CS-SECRETS-001',
  xl_family: 'XL-006',
  language: 'csharp',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.cs',
  what_it_catches:
    'A provider-key-shaped literal, or a credential-named string field/const bound to a 20+ char string literal, in C# source rather than read from Environment.GetEnvironmentVariable / IConfiguration / Key Vault.',
  why_ai_v05:
    'AI inlines a placeholder key so the app runs; the placeholder is forgotten before rotation.',
  vibe_v05: '"Hard-code it for now, move it to appsettings/Key Vault later." Later never arrives.',
  detection_approach:
    'RX per line: provider key prefix patterns OR a credential-named string field = "<20+ chars>". Gates: placeholder substrings, Environment/IConfiguration references.',
  fp_gates_v05: [
    'comment lines',
    'placeholder substrings (your_key, xxx, ..., EXAMPLE, changeme, <...>)',
    'config references (Environment.GetEnvironmentVariable, IConfiguration, Key Vault)',
    '*Tests.cs / src/test / scanner self-source / fixture tree (csharpFiles())',
  ],
  remediation:
    'Read the key from configuration: Environment.GetEnvironmentVariable / IConfiguration / Azure Key Vault. Rotate any key ever committed.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CS-SECRETS-001/positive.cs',
    negative: 'src/lib/probes/v05/fixtures/CS-SECRETS-001/negative.cs',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of csharpFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isCsCommentLine(line)) return;
        if (PLACEHOLDER_RE.test(line)) return;
        const keyShape = KEY_PATTERNS.some((re) => re.test(line));
        const assignLiteral = ASSIGN_LITERAL_RE.test(line) && !ENV_REF_RE.test(line);
        if (!keyShape && !assignLiteral) return;
        findings.push({
          id: `cs-secret-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Hardcoded provider key / secret in C# source',
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
            'Move the key to configuration / Key Vault. Rotate it — anything committed to git is compromised even after deletion.',
        });
      });
    }
    return findings;
  },
};
