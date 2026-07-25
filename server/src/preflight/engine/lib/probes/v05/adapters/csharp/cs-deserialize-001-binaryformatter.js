// src/lib/probes/v05/adapters/csharp/cs-deserialize-001-binaryformatter.js
//
// XL-001 adapter for C#. RX-based. BinaryFormatter / NetDataContract /
// Soap / Los / ObjectStateFormatter, and Newtonsoft TypeNameHandling
// All/Auto. Corpus: docs/v05-research/preflight_v05_probe_inventory.md
// "7. C#" (BinaryFormatter obsolete RCE vector; Newtonsoft default typing).

import { csharpFiles, isCsCommentLine } from '../../shared-detectors/csharp-scope.js';

const PROBE_NAME = 'C# Unsafe Deserialization';

const FORMATTER_RE =
  /\b(?:BinaryFormatter|NetDataContractSerializer|SoapFormatter|LosFormatter|ObjectStateFormatter)\b/;
const TYPENAME_RE = /\bTypeNameHandling\s*(?:=\s*TypeNameHandling)?\s*\.\s*(?:All|Auto)\b/;

export const CS_DESERIALIZE_001 = {
  probe_id: 'CS-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'csharp',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.cs',
  what_it_catches:
    'BinaryFormatter / NetDataContractSerializer / SoapFormatter / LosFormatter / ObjectStateFormatter usage, or Newtonsoft.Json TypeNameHandling set to All or Auto — .NET deserialization RCE vectors.',
  why_ai_v05:
    'BinaryFormatter is the "obvious" .NET serialization API in older corpora; TypeNameHandling.Auto is a common StackOverflow answer for polymorphic JSON.',
  vibe_v05:
    '"Serialize the object graph, read it back." No model of the type metadata being attacker-chosen.',
  detection_approach:
    'RX per line: a known dangerous formatter type name, or TypeNameHandling.All / .Auto.',
  fp_gates_v05: [
    'comment lines',
    'TypeNameHandling.None (the safe default)',
    '*Tests.cs / src/test / scanner self-source / fixture tree (csharpFiles())',
  ],
  remediation:
    'Use System.Text.Json or a contract-based serializer. Never BinaryFormatter (obsolete). Keep TypeNameHandling at None; for polymorphism use a custom SerializationBinder or System.Text.Json polymorphic attributes.',
  autofix_v05: 'manual',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/CS-DESERIALIZE-001/positive.cs',
    negative: 'src/lib/probes/v05/fixtures/CS-DESERIALIZE-001/negative.cs',
  },
  known_incidents: 'CWE-502; OWASP A08; many .NET BinaryFormatter / Json.NET TypeNameHandling CVEs',
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
        const fmt = FORMATTER_RE.test(line);
        const tnh = TYPENAME_RE.test(line);
        if (!fmt && !tnh) return;
        findings.push({
          id: `cs-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: tnh
            ? 'Newtonsoft.Json TypeNameHandling All/Auto (polymorphic deser)'
            : 'Dangerous .NET formatter (BinaryFormatter family)',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use System.Text.Json. Never BinaryFormatter. Keep TypeNameHandling at None; use a SerializationBinder for controlled polymorphism.',
        });
      });
    }
    return findings;
  },
};
