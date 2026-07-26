// src/lib/probes/v05/adapters/rust/rs-deserialize-001-untrusted.js
//
// XL-001 adapter for Rust. RX-based. Rust deserialization is memory-safe
// (no pickle-style arbitrary code execution), so the real failure mode is
// parsing an unbounded untrusted body: serde_json::from_str/from_slice/
// from_reader, bincode::deserialize, or rmp_serde::from_slice on a value
// rather than a constant. Corpus: docs/v05-research/preflight_v05_probe_
// inventory.md "serde_json::from_str on untrusted input without size limit".

import { rustFiles, isRustCommentLine } from '../../shared-detectors/rust-scope.js';

const PROBE_NAME = 'Rust Untrusted Deserialization';

// Deserialization surfaces. The captured paren-arg is checked for a literal.
const DESER_RE =
  /\b(?:serde_json::from_(?:str|slice|reader)|bincode::deserialize(?:_from)?|rmp_serde::from_(?:slice|read)|serde_json::Deserializer::from_reader)\s*\(\s*([^)]*)/;

// If the first argument is a string/byte literal or an include_*! it is a
// constant, not an untrusted body.
const LITERAL_ARG_RE = /^\s*(?:&\s*)?(?:b?"|r#*"|include_str!|include_bytes!)/;

export const RS_DESERIALIZE_001 = {
  probe_id: 'RS-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'rust',
  name: PROBE_NAME,
  category: 'security',
  severity: 'medium',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.rs',
  what_it_catches:
    'serde_json::from_str/from_slice/from_reader, bincode::deserialize, or rmp_serde::from_slice given a non-literal argument — i.e. an untrusted request body parsed with no prior size bound.',
  why_ai_v05:
    'The query! / size-limited path needs setup the model cannot run, so it falls back to from_str(&body) and never adds DefaultBodyLimit or a take(N) reader.',
  vibe_v05: '"It is just JSON, parse it." No model of the body being attacker-sized.',
  detection_approach:
    'RX per line: a serde_json/bincode/rmp_serde deserialize surface whose first argument is NOT a string/byte literal or include_*! macro.',
  fp_gates_v05: [
    'comment lines',
    'first argument is a string / byte literal or include_str!/include_bytes!',
    'test files / scanner self-source / fixture tree (rustFiles())',
  ],
  remediation:
    'Bound the input before parsing: axum DefaultBodyLimit / Actix PayloadConfig, or serde_json::Deserializer::from_reader(rdr.take(N)). Validate the deserialized type before use.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/RS-DESERIALIZE-001/positive.rs',
    negative: 'src/lib/probes/v05/fixtures/RS-DESERIALIZE-001/negative.rs',
  },
  known_incidents: 'CWE-502; OWASP A08; serde/axum body-limit guidance',
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
        const m = DESER_RE.exec(line);
        if (!m) return;
        if (LITERAL_ARG_RE.test(m[1])) return;
        findings.push({
          id: `rs-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'Untrusted deserialization without a size bound',
          severity: 'medium',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Apply a body-size limit (axum DefaultBodyLimit / Actix PayloadConfig) and parse from a bounded reader (take(N)). Validate the type before use.',
        });
      });
    }
    return findings;
  },
};
