// src/lib/probes/code-hygiene.js
//
// Code-hygiene probes that do not fit a topical family. Currently: Trojan Source bidi controls.
//
// Extracted from the prior builtin.js monolith when it crossed the
// file-size HIGH threshold. Probe bodies are byte-identical to the
// originals; only the location moved. Public import surface is
// preserved by builtin.js, which is now a back-compat shim re-exporting
// every probe function from its new family file.

import { BIDI_CONTROL_RE } from '../threat-intel.js';
import { isTestFile, isScannerSelfSource } from '../file-filter.js';

export function probeTrojanSource(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!BIDI_CONTROL_RE.test(file.content)) return;
    const lines = file.content.split('\n');
    lines.forEach((line, i) => {
      if (BIDI_CONTROL_RE.test(line)) {
        findings.push({
          id: `trojan-${file.path}-${i}`,
          probe: 'Trojan Source',
          title: 'Bidirectional Unicode control character in source',
          severity: 'high',
          category: 'Code Injection',
          cwe: 'CWE-1007',
          file: file.path,
          line: i + 1,
          evidence: 'Hidden Unicode (U+202A-U+202E or U+2066-U+2069) on this line',
          remediation:
            'Bidirectional override characters reorder how source displays without changing what the compiler executes (CVE-2021-42574). The same primitive drives the 2026 "rules file backdoor" attacks against Cursor and GitHub Copilot. Strip these characters in CI; configure your editor to render them as visible markers.',
        });
      }
    });
  });
  return findings;
}

// --- 2026: AI tooling rule-file and prompt-injection-via-config ---
