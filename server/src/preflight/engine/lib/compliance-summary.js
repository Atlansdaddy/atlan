// src/lib/compliance-summary.js
//
// Aggregates per-finding compliance_refs into a scan-level view for the
// compliance / GRC persona, FILTERED to the regulatory regimes the user
// declared apply to their app.
//
// Why the declaration matters: mapping HIPAA / PCI / SOC2 onto an app
// that is not in that regulatory domain is false authority. The
// applicability assertion is the USER's ("this app processes PHI"); the
// tool only maps technical clauses given that assertion. Declare
// nothing => no compliance output at all (the un-regulated default), and
// a hardcoded key stays a plain security finding.
//
// This is an INTERPRETATION layer, never a certification. direct|
// indicative is preserved; an indicative mapping is never collapsed into
// a stated violation. SCAN scope only — FERPA / SOX / FDA / FTC /
// EU-AI-Act never appear here (education-scope; not detected).

/**
 * @param {Array<{compliance_refs?: Array<{framework,clause,url,relationship}>}>} findings
 * @param {string[]|Set<string>} scope  declared regulatory frameworks; empty => no output
 * @returns {{
 *   declaredScope: string[],
 *   mappedFindingCount: number,
 *   frameworkCount: number,
 *   frameworks: Array<{framework:string, findingCount:number,
 *     direct: Array<{clause,url,count}>, indicative: Array<{clause,url,count}>}>,
 *   hasDirect: boolean,
 *   hasIndicative: boolean,
 * }}
 */
export function summarizeCompliance(findings, scope) {
  const declared = Array.isArray(scope) ? scope : scope instanceof Set ? [...scope] : [];
  const inScope = new Set(declared);
  const empty = {
    declaredScope: declared,
    mappedFindingCount: 0,
    frameworkCount: 0,
    frameworks: [],
    hasDirect: false,
    hasIndicative: false,
  };
  if (inScope.size === 0) return empty;

  const byFw = {};
  let mapped = 0;
  for (const f of findings || []) {
    const refs = f && f.compliance_refs;
    if (!Array.isArray(refs) || refs.length === 0) continue;
    let countedThisFinding = false;
    for (const r of refs) {
      if (!r || !r.framework || !inScope.has(r.framework)) continue;
      if (!countedThisFinding) {
        mapped += 1;
        countedThisFinding = true;
      }
      const fw = (byFw[r.framework] ||= { framework: r.framework, findingCount: 0, clauses: {} });
      fw.findingCount += 1;
      const c = (fw.clauses[r.clause] ||= {
        clause: r.clause,
        url: r.url,
        relationship: r.relationship,
        count: 0,
      });
      c.count += 1;
      if (r.relationship === 'direct') c.relationship = 'direct';
    }
  }

  const frameworks = Object.values(byFw)
    .map((fw) => {
      const all = Object.values(fw.clauses);
      const byCount = (a, b) => b.count - a.count;
      return {
        framework: fw.framework,
        findingCount: fw.findingCount,
        direct: all.filter((c) => c.relationship === 'direct').sort(byCount),
        indicative: all.filter((c) => c.relationship !== 'direct').sort(byCount),
      };
    })
    // frameworks with a 'direct' clause failure sort first, then by volume.
    .sort((a, b) => b.direct.length - a.direct.length || b.findingCount - a.findingCount);

  return {
    declaredScope: declared,
    mappedFindingCount: mapped,
    frameworkCount: frameworks.length,
    frameworks,
    hasDirect: frameworks.some((fw) => fw.direct.length > 0),
    hasIndicative: frameworks.some((fw) => fw.indicative.length > 0),
  };
}

const DISCLAIMER =
  'Interpretation layer, not a compliance determination or legal advice. ' +
  'You declared the regulatory scope; PreFlight maps technical clauses, ' +
  'it does not decide a regime applies to you. "indicative" mappings need ' +
  'human judgement in context. PreFlight scans only code-detectable ' +
  'technical safeguards (HIPAA 164.312, PCI-DSS, GDPR Art.32/25, SOC2 ' +
  'readiness). It does not scan FERPA, SOX, FDA 21 CFR 11, FTC, or the EU ' +
  'AI Act; those are taught in the compliance Learn pages, not detected.';

export { DISCLAIMER as COMPLIANCE_DISCLAIMER };

/**
 * Deterministic markdown auditor handoff. Records the declared scope so a
 * reviewer sees the mapping was scoped to a stated regime, not guessed.
 * @param {ReturnType<typeof summarizeCompliance>} summary
 * @param {string} [scannedAt]
 * @returns {string}
 */
export function formatComplianceExport(summary, scannedAt) {
  const lines = [];
  lines.push('# PreFlight regulatory mapping (scan-scope)');
  lines.push('');
  lines.push(`Declared regulatory scope: ${summary.declaredScope.join(', ') || '(none)'}`);
  if (scannedAt) lines.push(`Scan: ${scannedAt}`);
  lines.push(
    `${summary.mappedFindingCount} finding(s) map to ${summary.frameworkCount} declared framework(s).`
  );
  lines.push('');
  for (const fw of summary.frameworks) {
    lines.push(`## ${fw.framework} (${fw.findingCount} finding-refs)`);
    if (fw.direct.length) {
      lines.push('Direct (the pattern is itself the clause failure):');
      for (const c of fw.direct) lines.push(`- ${c.clause} x${c.count} — ${c.url}`);
    }
    if (fw.indicative.length) {
      lines.push('Indicative (needs human judgement in context):');
      for (const c of fw.indicative) lines.push(`- ${c.clause} x${c.count} — ${c.url}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push(DISCLAIMER);
  return lines.join('\n');
}
