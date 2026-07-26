// src/lib/probes/v05/adapters/scala/sc-deserialize-001-objectinput.js
//
// XL-001 adapter for Scala. RX-based. JVM deserialization reachable from
// Scala: ObjectInputStream.readObject, Jackson default typing, or Kryo
// readObject/readClassAndObject of untrusted bytes. Corpus: docs/v05-
// research/preflight_v05_probe_inventory.md "12. Scala" (Jackson default
// typing inherited from Java; Kryo of untrusted bytes).

import { scalaFiles, isScalaCommentLine } from '../../shared-detectors/scala-scope.js';

const PROBE_NAME = 'Scala Unsafe Deserialization';

const OIS_RE = /\bnew\s+ObjectInputStream\s*\(|\.\s*readObject\s*\(\s*\)/;
const JACKSON_RE = /\.\s*(?:enableDefaultTyping|activateDefaultTyping)\s*\(/;
const KRYO_RE = /\bkryo\s*\.\s*(?:readClassAndObject|readObject)\s*\(/i;

export const SC_DESERIALIZE_001 = {
  probe_id: 'SC-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'scala',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.scala',
  what_it_catches:
    'ObjectInputStream.readObject, Jackson enableDefaultTyping/activateDefaultTyping, or Kryo readObject/readClassAndObject — JVM deserialization gadget entry points reachable from Scala.',
  why_ai_v05:
    'Scala on the JVM inherits the Java serialization surface; the model reaches for readObject / Kryo without an ObjectInputFilter or class allowlist.',
  vibe_v05:
    '"Serialize the case class, read it back." No model of the bytes carrying an attacker class graph.',
  detection_approach:
    'RX per line: new ObjectInputStream / .readObject(); Jackson default typing; kryo.readObject/readClassAndObject.',
  fp_gates_v05: [
    'comment lines',
    'Kryo with a registered, closed class set (manual review)',
    'circe / uPickle / Play-JSON parsing (type-safe, not flagged)',
    '*Test/*Spec.scala / src/test / scanner self-source / fixture tree (scalaFiles())',
  ],
  remediation:
    'Use a type-safe JSON library (circe, uPickle, Play-JSON). If JVM serialization is unavoidable use an ObjectInputFilter; never enable Jackson default typing; register a closed Kryo class set.',
  autofix_v05: 'manual',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/SC-DESERIALIZE-001/positive.scala',
    negative: 'src/lib/probes/v05/fixtures/SC-DESERIALIZE-001/negative.scala',
  },
  known_incidents: 'CWE-502; OWASP A08; JVM deser gadget chains; Jackson default-typing CVEs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of scalaFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isScalaCommentLine(line)) return;
        if (!OIS_RE.test(line) && !JACKSON_RE.test(line) && !KRYO_RE.test(line)) return;
        findings.push({
          id: `sc-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: 'JVM unsafe deserialization (ObjectInputStream / Jackson default typing / Kryo)',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Use circe/uPickle/Play-JSON. ObjectInputFilter if serialization is required; no Jackson default typing; closed Kryo registration.',
        });
      });
    }
    return findings;
  },
};
