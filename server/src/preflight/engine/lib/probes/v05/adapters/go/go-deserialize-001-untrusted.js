// src/lib/probes/v05/adapters/go/go-deserialize-001-untrusted.js
//
// XL-001 adapter for Go. RX-based. Go deserialization is memory-safe, so
// the failure mode is decoding an untrusted source with no bound: gob
// Decode, yaml.Unmarshal of a non-literal, or json.NewDecoder(r.Body).
// Decode without a MaxBytesReader. Corpus: docs/v05-research/preflight_v05_
// probe_inventory.md "3. Go" (json.Decode / unmarshal patterns).

import { goFiles, isGoCommentLine } from '../../shared-detectors/go-scope.js';

const PROBE_NAME = 'Go Untrusted Deserialization';

const GOB_RE = /\bgob\.NewDecoder\([^)]*\)\.Decode\s*\(/;
const JSON_BODY_RE = /\bjson\.NewDecoder\(\s*r\.Body\s*\)\.Decode\s*\(/;
const YAML_RE = /\byaml\.Unmarshal\s*\(\s*([^),]*)/;
const LITERAL_ARG_RE = /^\s*\[\]byte\(\s*[`"]|^\s*[`"]/;

export const GO_DESERIALIZE_001 = {
  probe_id: 'GO-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'go',
  name: PROBE_NAME,
  category: 'security',
  severity: 'medium',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.go',
  what_it_catches:
    'gob.NewDecoder(...).Decode, json.NewDecoder(r.Body).Decode with no MaxBytesReader, or yaml.Unmarshal of a non-literal — an untrusted source decoded with no size/type bound.',
  why_ai_v05:
    'Go error handling is verbose; the model emits the shortest decode call and skips http.MaxBytesReader and post-decode validation.',
  vibe_v05:
    '"Decode the body into the struct." No model of the body being attacker-sized or attacker-shaped.',
  detection_approach:
    'RX per line: gob Decode, json.NewDecoder(r.Body).Decode, or yaml.Unmarshal whose first argument is not a string / []byte literal.',
  fp_gates_v05: [
    'comment lines',
    'yaml.Unmarshal of a string / []byte literal (a constant config blob)',
    'test files (_test.go) / scanner self-source / fixture tree (goFiles())',
  ],
  remediation:
    'Wrap the body: http.MaxBytesReader(w, r.Body, N) before decoding; validate the decoded value. For gob/yaml from untrusted sources, prefer a length-checked reader and a strict schema.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/GO-DESERIALIZE-001/positive.go',
    negative: 'src/lib/probes/v05/fixtures/GO-DESERIALIZE-001/negative.go',
  },
  known_incidents: 'CWE-502; OWASP A08; Go net/http MaxBytesReader guidance',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of goFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isGoCommentLine(line)) return;
        let hit = GOB_RE.test(line) || JSON_BODY_RE.test(line);
        if (!hit) {
          const y = YAML_RE.exec(line);
          if (y && !LITERAL_ARG_RE.test(y[1])) hit = true;
        }
        if (!hit) return;
        findings.push({
          id: `go-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Untrusted deserialization without a bound',
          severity: 'medium',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Bound the input (http.MaxBytesReader) and validate the decoded value. Avoid gob/yaml on untrusted sources without a strict schema and length check.',
        });
      });
    }
    return findings;
  },
};
