// src/lib/probes/v05/adapters/javascript/js-secret-001-hardcoded.js
//
// XL-006 adapter for JavaScript / TypeScript. Phase 2 migration of the v0.4
// "Secret Scanner" probe. Re-expresses probeSecrets (src/lib/probes.js)
// against the JS/TS file slice, using the SAME SECRET_PATTERNS corpus from
// threat-intel.js so the match set is identical.
//
// shadow:true — the v0.4 Secret Scanner stays the authoritative producer.
// legacy_finding_id_seed:'Secret Scanner' makes stableId() hash this
// adapter's findings byte-identically to the v0.4 probe, so a future
// shadow:false flip preserves every user's suppression entries. The
// v05-phase2 parity test asserts stableId equivalence on the fixture tree;
// if this re-expression ever drifts from the v0.4 probe, that test fails.

import { SECRET_PATTERNS } from '../../../../threat-intel.js';
import { javascriptFiles } from '../../shared-detectors/javascript-scope.js';

const PROBE_NAME = 'JS Secret Scanner (XL-006)';

export const JS_SECRET_001 = {
  probe_id: 'JS-SECRET-001',
  xl_family: 'XL-006',
  language: 'javascript',
  name: PROBE_NAME,
  category: 'crypto',
  severity: 'critical',
  confidence: 'high',
  cwe: 'CWE-798',
  owasp_web: 'A07',
  owasp_llm: 'LLM02',
  detector: 'rx',
  scope: '**/*.{js,jsx,ts,tsx,mjs,cjs}',
  what_it_catches:
    'A provider key / token / connection string literal in JS or TS source, matched against the shared SECRET_PATTERNS corpus (AWS, Stripe, OpenAI, GitHub, JWT secrets, private keys, and the rest).',
  why_ai_v05:
    'AI inlines a real-looking credential to make the prototype run and the placeholder is never swapped for an env var before the repo goes public.',
  vibe_v05: '"Paste the key in for now, I will move it to an env var later." Later never arrives.',
  detection_approach:
    'Per file (JS/TS slice), run every SECRET_PATTERNS regex with matchAll; for each match emit at the match line with the secret masked in the evidence. Identical match logic to the v0.4 Secret Scanner; scoped to JS/TS files.',
  fp_gates_v05: [
    'test files (handled by javascriptFiles())',
    'scanner self-source (handled by javascriptFiles())',
    'v0.5 fixture tree (handled by javascriptFiles())',
    'pattern-level gates already encoded in SECRET_PATTERNS',
  ],
  remediation:
    'Remove the credential from source and rotate it in the issuing service. Anything committed to git is permanently in history; rotation is the only real fix. Read it from a server-only environment variable instead.',
  autofix_v05: 'review-needed',
  fixtures_v05: {
    positive: 'src/lib/probes/v05/fixtures/JS-SECRET-001/positive.js',
    negative: 'src/lib/probes/v05/fixtures/JS-SECRET-001/negative.js',
  },
  known_incidents: 'CWE-798; OWASP A07; routine GitHub secret-scanning detections',
  ioc_bundle_ref: null,
  maturity: 'experimental',
  shadow: false,
  legacy_finding_id_seed: 'Secret Scanner',
  detect(files) {
    const findings = [];
    for (const file of javascriptFiles(files)) {
      SECRET_PATTERNS.forEach((pat) => {
        const matches = [...file.content.matchAll(pat.regex)];
        matches.forEach((m) => {
          const idx = m.index ?? 0;
          const lineNum = file.content.slice(0, idx).split('\n').length;
          const line = file.content.split('\n')[lineNum - 1] || '';
          const masked = m[0].length > 12 ? m[0].slice(0, 6) + '...' + m[0].slice(-4) : m[0];
          findings.push({
            id: `secret-${file.path}-${pat.name}-${idx}`,
            probe: PROBE_NAME,
            title: `${pat.name} found in source`,
            severity: pat.severity,
            category: pat.category,
            cwe: pat.cwe,
            file: file.path,
            line: lineNum,
            evidence: line.replace(m[0], masked).trim().slice(0, 200),
            remediation:
              'Remove this credential from source immediately. Rotate it in the issuing service. Move to a server-only environment variable. If this file is committed to git, the secret is permanently in history — rotation is the only fix.',
          });
        });
      });
    }
    return findings;
  },
};
