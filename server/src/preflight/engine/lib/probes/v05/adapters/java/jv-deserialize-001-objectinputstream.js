// src/lib/probes/v05/adapters/java/jv-deserialize-001-objectinputstream.js
//
// XL-001 adapter for Java. RX-based. The strongest XL-001 surface across
// all languages: ObjectInputStream.readObject (gadget-chain RCE), Jackson
// default typing, and Snakeyaml load(). Corpus: docs/v05-research/
// preflight_v05_probe_inventory.md "4. Java" (readObject / Jackson default
// typing / Snakeyaml load vs safeLoad).

import { javaFiles, isJavaCommentLine } from '../../shared-detectors/java-scope.js';

const PROBE_NAME = 'Java Unsafe Deserialization';

const OIS_RE = /\bnew\s+ObjectInputStream\s*\(/;
const READ_OBJECT_RE = /\.\s*readObject\s*\(\s*\)/;
const JACKSON_DEFAULT_TYPING_RE = /\.\s*(?:enableDefaultTyping|activateDefaultTyping)\s*\(/;
const SNAKEYAML_LOAD_RE = /\bnew\s+Yaml\s*\([^;]*\)\s*\.\s*load\s*\(/;

export const JV_DESERIALIZE_001 = {
  probe_id: 'JV-DESERIALIZE-001',
  xl_family: 'XL-001',
  language: 'java',
  name: PROBE_NAME,
  category: 'security',
  severity: 'critical',
  confidence: 'medium',
  cwe: 'CWE-502',
  owasp_web: 'A08',
  owasp_llm: null,
  detector: 'rx',
  scope: '**/*.java',
  what_it_catches:
    'ObjectInputStream.readObject(), Jackson enableDefaultTyping/activateDefaultTyping, or new Yaml().load(...) — the three Java deserialization gadget-chain entry points.',
  why_ai_v05:
    'Java serialization is the "obvious" persistence API and the tutorial corpus predates the RCE-gadget era; the model emits readObject / default typing without an ObjectInputFilter or safe loader.',
  vibe_v05:
    '"Serialize the object, read it back." No model of the bytes carrying a class graph an attacker controls.',
  detection_approach:
    'RX per line: new ObjectInputStream(...) or a .readObject() call; Jackson enableDefaultTyping/activateDefaultTyping; new Yaml(...).load(...).',
  fp_gates_v05: [
    'comment lines',
    'readObject on a trusted constant/local stream (manual review)',
    'Snakeyaml 2.0+ default-safe Constructor (manifest version check, future)',
    '*Test.java / src/test / scanner self-source / fixture tree (javaFiles())',
  ],
  remediation:
    'Prefer JSON. If Java serialization is unavoidable, install an ObjectInputFilter (Java 9+) allowlisting expected classes. Jackson: never enable default typing; use explicit @JsonSubTypes. Snakeyaml: new Yaml(new SafeConstructor()).',
  autofix_v05: 'manual',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/JV-DESERIALIZE-001/positive.java',
    negative: 'src/lib/probes/v05/fixtures/JV-DESERIALIZE-001/negative.java',
  },
  known_incidents:
    'CWE-502; OWASP A08; CVE-2017-7525 (Jackson); Commons-Collections gadget chains; Log4Shell-era Java deser CVEs',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: null,
  detect(files) {
    const findings = [];
    for (const f of javaFiles(files)) {
      const lines = f.content.split('\n');
      lines.forEach((line, i) => {
        if (isJavaCommentLine(line)) return;
        const ois = OIS_RE.test(line) || READ_OBJECT_RE.test(line);
        const jackson = JACKSON_DEFAULT_TYPING_RE.test(line);
        const snake = SNAKEYAML_LOAD_RE.test(line);
        if (!ois && !jackson && !snake) return;
        findings.push({
          id: `jv-deser-${f.path}-${i}`,
          probe: PROBE_NAME,
          title: jackson
            ? 'Jackson polymorphic default typing enabled'
            : snake
              ? 'Snakeyaml load() (unsafe constructor)'
              : 'Java object deserialization (ObjectInputStream.readObject)',
          severity: 'critical',
          category: 'Security',
          cwe: 'CWE-502',
          file: f.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Avoid Java serialization for untrusted data. Use an ObjectInputFilter, disable Jackson default typing, or construct Snakeyaml with a SafeConstructor.',
        });
      });
    }
    return findings;
  },
};
