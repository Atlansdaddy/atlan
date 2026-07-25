// src/lib/stable-id.js
// Deterministic per-finding identifiers that survive line shifts and reformats, plus the
// per-probe confidence / autofix metadata that the UI surfaces alongside severity.

import { PROBE_MANIFEST_V05, MANIFEST_OWASP_MAP, mergeOwaspMaps } from './probes/v05/manifest.js';

// Reverse-lookup: probe name -> v0.5 manifest entry. Built lazily at module load so
// attachProbeMeta can find the v0.5 record by the same `finding.probe` string the
// v0.4 pipeline uses. Empty for Phase 0; populated incrementally as adapters land.
const MANIFEST_BY_PROBE_NAME = (() => {
  const out = {};
  for (const entry of Object.values(PROBE_MANIFEST_V05)) {
    if (entry?.name) out[entry.name] = entry;
  }
  return out;
})();
//
// Why the stableId hash exists: a finding's default uid=197610(jviru) gid=197610 groups=197610 field uses byte offsets, so any
// edit above a vulnerability invents a new id. That makes suppression and "have I seen
// this before" comparisons impossible. stableId() hashes (probe + file + title + ±3-line
// whitespace-normalized context) instead, so trivial reformats don't perturb the ID.

// --- Stable cross-scan finding ID ---
// The existing `id` field on each finding uses byte offsets, so adding a line above the
// vulnerability creates a new `id`. That makes suppression / "you've seen this before" impossible.
//
// stableId() returns a deterministic hash from {probe, file, title, ±3-line normalized context}.
// The context is whitespace-normalized so trivial reformats don't perturb the ID. The hash itself
// is a 32-bit FNV-1a → base36 (8 chars), fast in JS, collision rate is fine at this scale.

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

export function stableId(finding, fileContent) {
  const file = (finding.file || '').replace(/\\/g, '/');
  const lines = (fileContent || '').split('\n');
  const ln = finding.line || 0;
  const ctxStart = Math.max(0, ln - 4);
  const ctxEnd = Math.min(lines.length, ln + 3);
  const ctx = lines
    .slice(ctxStart, ctxEnd)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('|');
  // v0.5 migration continuity: when a v0.5 adapter replaces a v0.4 probe, it can
  // declare legacy_finding_id_seed in its manifest entry. The stableId hash uses
  // that seed in place of the probe name so the hash is byte-identical to what the
  // v0.4 probe produced. Users' suppression entries (which reference the old hash)
  // keep working without rewrites. New probes (no seed) hash by probe name as before.
  const v05 = MANIFEST_BY_PROBE_NAME[finding.probe];
  const seed = v05?.legacy_finding_id_seed || finding.probe;
  const key = `${seed}|${file}|${finding.title}|${ctx}`;
  return fnv1a(key);
}

// Apply stableId to every finding. Pure helper — call from handleScan after probes run.
export function attachStableIds(findings, files) {
  const fileMap = new Map(files.map((f) => [f.path, f.content]));
  findings.forEach((f) => {
    f.stableId = stableId(f, fileMap.get(f.file));
  });
  return findings;
}

// --- Probe metadata: confidence + fixability ---
// Each probe declares two attributes the UI surfaces alongside severity:
//
//   confidence:
//     'high'      — deterministic pattern match. Almost no false positives in practice.
//     'medium'    — regex matches that need a glance of context to validate.
//     'heuristic' — path / structural inference; real but warrants manual review.
//
//   autofix:
//     'mechanical'    — a one-or-two-line drop-in patch fixes it cleanly.
//     'review-needed' — clear remediation path but requires reading the surrounding code.
//     'manual'        — architectural / scope-dependent; no canned fix.
//
// These aren't severity. A 'critical' + 'heuristic' finding still demands attention; the
// tag just tells the user "look at this twice before acting." A 'low' + 'mechanical' finding
// is the 30-second win that's worth doing before merge.
// `learn_more_slug` (optional) — when set, FindingCard renders a "Learn more about
// this pattern →" link to /learn/patterns/<slug> IF the markdown file exists AND
// is not a draft. Graceful fallback: missing or draft file = link hidden.
export const PROBE_META = {
  // Every probe entry below now declares learn_more_slug pointing at the
  // matching pattern under src/learn/patterns/. resolvePatternForProbe() in
  // learn-content.js gates the link on draft:false, so a draft pattern won't
  // produce a broken "Learn more" link.

  // Deterministic + mechanical: drop-in patches
  'Env File Hygiene': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'env-file-hygiene',
  },
  'AI Rules Files': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'ai-rules-files',
  },
  'Trojan Source': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'trojan-source',
  },
  'Package Manager Hardening': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'package-json-supply-chain',
  },
  'Slopsquat / Typosquat': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'slopsquat-typosquat',
  },

  // Deterministic + needs-review: clear fix but requires looking around
  'Secret Scanner': {
    confidence: 'high',
    autofix: 'review-needed',
    learn_more_slug: 'secret-scanner',
  },
  'NEXT_PUBLIC_ Misuse': {
    confidence: 'high',
    autofix: 'review-needed',
    learn_more_slug: 'next-public-misuse',
  },
  'Compromised Packages': {
    confidence: 'high',
    autofix: 'review-needed',
    learn_more_slug: 'package-json-supply-chain',
  },
  'Malicious Artifacts': {
    confidence: 'high',
    autofix: 'manual',
    learn_more_slug: 'malicious-artifacts',
  },

  // Pattern matches: regex + light context
  CORS: { confidence: 'medium', autofix: 'mechanical', learn_more_slug: 'cors' },
  'Cookie Security': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'cookie-security',
  },
  'HTML Hygiene': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'html-hygiene',
  },
  'A11y Landmarks': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'a11y-landmarks',
  },
  'SEO Hygiene': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'seo-hygiene',
  },
  'GEO Hygiene': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'geo-hygiene',
  },

  // Pattern matches that need real fix work
  'Supabase RLS': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'supabase-rls',
  },
  'Firebase Rules': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'firebase-rules',
  },
  'Auth Weakness': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'auth-weakness',
  },
  'Webhook Validation': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'webhook-validation',
  },
  'GitHub Actions': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'github-actions',
  },
  'Client Auth Storage': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'client-auth-storage',
  },
  'SSRF / Open Redirect': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'ssrf-open-redirect',
  },
  'MCP Security': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'mcp-security',
  },
  'URL Reputation': {
    confidence: 'medium',
    autofix: 'manual',
    learn_more_slug: 'url-reputation',
  },
  'AI Code Smells': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'ai-code-smells',
  },
  'Code Correctness': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'code-correctness',
  },

  // Heuristics that benefit from manual scrutiny
  'Admin Route Exposure': {
    confidence: 'heuristic',
    autofix: 'manual',
    learn_more_slug: 'admin-route-exposure',
  },
  'API Route Auth': {
    confidence: 'heuristic',
    autofix: 'manual',
    learn_more_slug: 'api-route-auth',
  },
  'Security Headers': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'security-headers',
  },
  'LLM Security': {
    confidence: 'heuristic',
    autofix: 'review-needed',
    learn_more_slug: 'llm-security',
  },
  'Code Quality': {
    confidence: 'medium',
    autofix: 'manual',
    learn_more_slug: 'code-quality',
  },

  // v0.5 OWASP-framed additions
  'SQL Injection': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'sql-injection',
  },
  'Path Traversal': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'path-traversal',
  },
  'Weak Randomness': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'weak-randomness',
  },
  'Stack Trace Leaks': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'stack-trace-leaks',
  },
  'Subresource Integrity': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'subresource-integrity',
  },

  // v0.5 wave 2 OWASP-framed additions
  'Source Map Exposure': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'source-map-exposure',
  },
  'Iframe Sandbox': {
    confidence: 'high',
    autofix: 'mechanical',
    learn_more_slug: 'iframe-sandbox',
  },
  'Security Logging': {
    confidence: 'heuristic',
    autofix: 'review-needed',
    learn_more_slug: 'security-logging',
  },
  'RAG Ingestion': {
    confidence: 'heuristic',
    autofix: 'review-needed',
    learn_more_slug: 'rag-ingestion',
  },
  'Vector Embedding Weaknesses': {
    confidence: 'heuristic',
    autofix: 'review-needed',
    learn_more_slug: 'vector-embedding-weaknesses',
  },

  // v0.6: intra-procedural taint analyzer for JS/TS. The findings come from
  // dataflow analysis, not regex; routing them to the path-traversal Learn
  // page is the closest fit for the canonical CWE-22 case, with the
  // remediation in the finding itself explaining the source-to-sink path.
  'Taint Flow': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'path-traversal',
  },

  // Architectural classification — informational, no autofix, no dedicated pattern.
  // Architecture findings are themselves shape descriptions; the per-shape Learn
  // pages under /learn/shapes/ are the natural destination but those don't map
  // 1:1 to a single slug.
  Architecture: { confidence: 'heuristic', autofix: 'manual' },
  // v2 F0: host-detection classifier. Info-only inventory finding; the
  // detected host routes downstream copy, nothing to fix.
  'Host Detection': { confidence: 'heuristic', autofix: 'manual' },
  // v2 F7: maintainability tells of unreviewed generated code.
  'AI Codegen Bloat': {
    confidence: 'medium',
    autofix: 'manual',
    learn_more_slug: 'ai-codegen-bloat',
  },

  // Package.json catch-all + supply-chain-related aliases.
  'Package.json': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'package-json-supply-chain',
  },
  'Supply Chain': {
    confidence: 'medium',
    autofix: 'mechanical',
    learn_more_slug: 'package-json-supply-chain',
  },
  'Code Injection': {
    confidence: 'medium',
    autofix: 'review-needed',
    learn_more_slug: 'auth-weakness',
  },

  // 2026: agent/editor auto-execution backdoors. Behavioral detection of
  // .claude SessionStart hooks and .vscode runOn:folderOpen tasks — the
  // Miasma / Shai-Hulud npm-worm persistence vector. High confidence: a
  // committed config that auto-runs a shell command is unambiguous.
  'Agent Config Backdoor': {
    confidence: 'high',
    autofix: 'manual',
  },
};

// OWASP category mapping per probe. Grouped by category so a reader can scan
// "which probes cover A03" at once. Probes may map to multiple categories
// (e.g., Auth Weakness covers both A03 injection via eval and A07 broken auth
// via JWT). The mapping is the source of truth for /learn/owasp-coverage and
// for the OWASP category chip rendered in FindingCard.
//
// Reference: OWASP Top 10 2025 (https://owasp.org/Top10/) and
//            OWASP LLM Top 10 2025 (https://genai.owasp.org/llm-top-10/).
//
// v0.5 migration shape: the hand-coded map below is one of two contributors.
// MANIFEST_OWASP_MAP (built from the v0.5 PROBE_MANIFEST_V05) is the other.
// PROBE_OWASP_MAP is the merge of both. As probes migrate to v0.5 their hand-
// coded entries move out of HAND_CODED_OWASP_MAP and into the manifest; the
// exported PROBE_OWASP_MAP shape stays identical so OwaspCoverageView and the
// tests don't need to change. For Phase 0 the manifest map is empty.
const HAND_CODED_OWASP_MAP = {
  // OWASP Top 10 2025
  A01: [
    'Admin Route Exposure',
    'API Route Auth',
    'Supabase RLS',
    'Firebase Rules',
    'Path Traversal',
    'Taint Flow',
  ],
  A02: [
    'Secret Scanner',
    'NEXT_PUBLIC_ Misuse',
    'Env File Hygiene',
    'Weak Randomness',
    'Client Auth Storage',
    'Cookie Security',
  ],
  A03: ['Auth Weakness', 'SQL Injection', 'HTML Hygiene'],
  A04: ['AI Code Smells', 'Stack Trace Leaks', 'Code Correctness'],
  A05: ['Security Headers', 'CORS', 'Source Map Exposure', 'Iframe Sandbox'],
  A06: ['Compromised Packages', 'Slopsquat / Typosquat', 'Package Manager Hardening'],
  A07: ['Auth Weakness', 'Webhook Validation'],
  A08: [
    'Trojan Source',
    'AI Rules Files',
    'Malicious Artifacts',
    'Agent Config Backdoor',
    'Subresource Integrity',
    'Package.json',
    'GitHub Actions',
    'URL Reputation',
  ],
  A09: ['Security Logging', 'Code Quality'],
  A10: ['SSRF / Open Redirect'],

  // OWASP LLM Top 10 2025
  LLM01: ['LLM Security'],
  LLM02: ['LLM Security'],
  LLM04: ['RAG Ingestion'],
  LLM06: ['LLM Security', 'MCP Security'],
  LLM07: ['LLM Security'],
  LLM08: ['Vector Embedding Weaknesses'],
};

// The exported map is the merge. For Phase 0 (manifest empty) this is byte-
// identical to HAND_CODED_OWASP_MAP. Consumers (OwaspCoverageView,
// FindingCard via OWASP_BY_PROBE) read PROBE_OWASP_MAP and need no changes.
export const PROBE_OWASP_MAP = mergeOwaspMaps(HAND_CODED_OWASP_MAP, MANIFEST_OWASP_MAP);

// Human-readable label for each OWASP code. Used by the OWASP coverage page
// and by the FindingCard tooltip.
export const OWASP_LABELS = {
  A01: 'A01: Broken Access Control',
  A02: 'A02: Cryptographic Failures',
  A03: 'A03: Injection',
  A04: 'A04: Insecure Design',
  A05: 'A05: Security Misconfiguration',
  A06: 'A06: Vulnerable and Outdated Components',
  A07: 'A07: Identification and Authentication Failures',
  A08: 'A08: Software and Data Integrity Failures',
  A09: 'A09: Security Logging and Monitoring Failures',
  A10: 'A10: Server-Side Request Forgery',
  LLM01: 'LLM01: Prompt Injection',
  LLM02: 'LLM02: Sensitive Information Disclosure',
  LLM04: 'LLM04: Data and Model Poisoning',
  LLM06: 'LLM06: Excessive Agency',
  LLM07: 'LLM07: System Prompt Leakage',
  LLM08: 'LLM08: Vector and Embedding Weaknesses',
};

// Inverse index: probe name -> array of OWASP codes the probe covers.
// Built lazily from PROBE_OWASP_MAP at module load.
export const OWASP_BY_PROBE = (() => {
  const inverse = {};
  for (const [code, probes] of Object.entries(PROBE_OWASP_MAP)) {
    for (const probe of probes) {
      if (!inverse[probe]) inverse[probe] = [];
      inverse[probe].push(code);
    }
  }
  return inverse;
})();

// Attach probe-level confidence and autofix metadata to each finding.
// v0.5 extension: when a manifest entry exists for the probe (looked up by name),
// also copy the v0.5 fields onto the finding. Personas and downstream consumers
// (formatAgentPrompt, FindingCard) read these as plain finding fields per Q5
// resolution in docs/v05-research/v05-architecture.md — emission-time copy.
export function attachProbeMeta(findings) {
  findings.forEach((f) => {
    const meta = PROBE_META[f.probe];
    if (meta) {
      f.confidence = meta.confidence;
      f.autofix = meta.autofix;
      if (meta.learn_more_slug) f.learn_more_slug = meta.learn_more_slug;
    } else {
      /* fall through to default below */
    }
    // OWASP categories the finding's probe maps to. Attached for every
    // finding regardless of whether PROBE_META had an entry, so the FindingCard
    // OWASP chip is consistent.
    const owasp = OWASP_BY_PROBE[f.probe];
    if (owasp && owasp.length > 0) {
      f.owasp = owasp;
    }
    if (!meta) {
      // Default: treat as medium / manual when we haven't classified a probe yet.
      f.confidence = 'medium';
      f.autofix = 'manual';
    }
    // v0.5: copy manifest fields onto the finding when an adapter is registered
    // for this probe name. Phase 0 has no adapters; this block is a no-op until
    // Phase 1+ adapters land. The fields override v0.4 PROBE_META values when
    // both are present (manifest is authoritative for migrated probes).
    const v05 = MANIFEST_BY_PROBE_NAME[f.probe];
    if (v05) {
      f.probe_id = v05.probe_id;
      if (v05.xl_family != null) f.xl_family = v05.xl_family;
      f.maturity = v05.maturity;
      f.why_ai_v05 = v05.why_ai_v05;
      f.vibe_v05 = v05.vibe_v05;
      f.fp_gates_v05 = v05.fp_gates_v05;
      f.autofix_v05 = v05.autofix_v05;
      // Backward-compat fold: v0.5 autofix tier wins over v0.4 PROBE_META.autofix
      // for migrated probes. Same enum values, same semantics.
      f.autofix = v05.autofix_v05;
      f.confidence = v05.confidence;
      // v0.5 probes have no v0.4 PROBE_META entry, so their Learn link must
      // come from the manifest, or the in-app "Learn more" silently breaks.
      if (v05.learn_more_slug) f.learn_more_slug = v05.learn_more_slug;
      // Compliance is an interpretation layer over a finding the scanner
      // already emits. Surface the family's scan-scope refs so FindingCard
      // can render them (with the indicative/direct + not-a-certification
      // framing). Absent on most probes; only the mapped families carry it.
      if (Array.isArray(v05.compliance_refs) && v05.compliance_refs.length > 0) {
        f.compliance_refs = v05.compliance_refs;
      }
    }
  });
  return findings;
}
