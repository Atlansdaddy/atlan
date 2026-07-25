// src/lib/probes/v05/adapters/ruby/rb-deserialize-001-marshal.js
//
// XL-001 adapter for Ruby. RX-based. Marshal.load / Marshal.restore (the
// pickle-equivalent, no safe form) or YAML.load of a non-literal (vs
// YAML.safe_load). Corpus: docs/v05-research/preflight_v05_probe_
// inventory.md "10. Ruby" (Marshal.load; YAML.load vs safe_load;
// CVE-2013-0156).

import { rubyFiles, isRubyCommentLine } from '../../shared-detectors/ruby-scope.js';

const PROBE_NAME = 'Ruby Unsafe Deserialization';

const MARSHAL_RE = /\bMarshal\s*\.\s*(?:load|restore)\s*\(/;
const YAML_LOAD_RE = /\bYAML\s*\.\s*load\s*\(\s*([^)]*)/;
const LITERAL_ARG_RE = /^\s*(['"])/;

export const RB_DESERIALIZE_001 = {
  probe_id: 'RB-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'ruby',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.rb',
  what_it_catches:
    'Marshal.load / Marshal.restore (arbitrary object instantiation, no safe form), or YAML.load of a non-literal (use YAML.safe_load with permitted_classes).',
  why_ai_v05:
    'Marshal/YAML.load are the "obvious" round-trip APIs; the corpus predates the Rails YAML-param RCE era and rarely shows safe_load.',
  vibe_v05: '"Dump it, load it back." No model of the bytes describing arbitrary Ruby objects.',
  detection_approach:
    'RX per line: Marshal.load/restore(...), or YAML.load(...) whose first argument is not a string literal.',
  fp_gates_v05: [
    'comment lines',
    'YAML.safe_load (the safe API — different token)',
    'YAML.load of a string literal constant',
    '_spec.rb / spec|test dirs / scanner self-source / fixture tree (rubyFiles())',
  ],
  remediation:
    'Never Marshal.load untrusted bytes — use JSON. For YAML use YAML.safe_load(input, permitted_classes: [...]).',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RB-DESERIALIZE-001/positive.rb',
    negative: 'src/lib/probes/v05/fixtures/RB-DESERIALIZE-001/negative.rb',
  },
  known_incidents: 'CWE-502; OWASP A08; CVE-2013-0156 (Rails YAML param deserialization)',
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
        let hit = MARSHAL_RE.test(line);
        if (!hit) {
          const y = YAML_LOAD_RE.exec(line);
          if (y && !LITERAL_ARG_RE.test(y[1])) hit = true;
        }
        if (!hit) return;
        findings.push({
          id: `rb-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Unsafe deserialization (Marshal.load / YAML.load)',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use JSON instead of Marshal for untrusted data. For YAML use YAML.safe_load(input, permitted_classes: [...]).',
        });
      });
    }
    return findings;
  },
};
