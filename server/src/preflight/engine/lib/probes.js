// src/lib/probes.js
//
// Registry hub. The probe FUNCTIONS live in focused modules:
//   - ./probes/builtin.js          v0.4 built-ins (probeSecrets..probeNpmrcHygiene)
//   - ./probes/web.js              URL / HTML / SEO / GEO / A11y
//   - ./probes/quality.js          Code Quality + Architecture classifier
//   - ./probes/code-correctness.js Code Correctness (AST)
//   - ./probes/v05.js, v05b.js     v0.5 OWASP-framed additions
//   - ./probes/v05/manifest.js     language-agnostic adapter projection
//
// This file re-exports every threat-intel constant, file-filter helper,
// stable-id utility, suppression API, and probe function from their
// dedicated modules so existing callers (App.jsx, tests, history
// snapshots) keep importing from './lib/probes.js' unchanged. It also
// assembles the PROBES registry that drives the scan loop.
//
// Pure: every export is a plain function or data structure. No React,
// no DOM, no localStorage.

// --- Back-compat re-export surface (paths historical callers depend on) ---
export {
  SECRET_PATTERNS,
  COMPROMISED_PACKAGES,
  TYPOSQUATS,
  SLOPSQUAT_GENERIC_RE,
  BIDI_CONTROL_RE,
  NEXT_PUBLIC_DANGER_NAMES,
  NEXT_PUBLIC_DANGER_VALUES,
  URL_PLACEHOLDER_HOSTS,
  URL_PLACEHOLDER_IP_RE,
  URL_SAFE_HOSTS,
  URL_SUSPICIOUS_TLD_RE,
  URL_RAW_IP_RE,
  URL_SHORTENERS,
  isHostInSafeList,
  AI_CRAWLER_BOTS,
  FILE_SIZE_WARN_LINES,
  FILE_SIZE_MED_LINES,
  FILE_SIZE_HIGH_LINES,
  FILE_SIZE_CRIT_LINES,
  FILE_SIZE_FAIL_LINES,
} from './threat-intel.js';
export {
  isTestFile,
  isScannerSelfSource,
  isMetaDocFile,
  FILE_INCLUDE,
  FILE_EXCLUDE,
  shouldScanFile,
} from './file-filter.js';
export { stableId, attachStableIds, PROBE_META, attachProbeMeta } from './stable-id.js';
export {
  SUPPRESSION_KEY,
  SUPPRESSION_DISPOSITIONS,
  loadSuppressions,
  saveSuppressions,
  suppressFinding,
  unsuppressFinding,
  partitionFindings,
} from './suppression.js';

// --- Probe functions (in scope here so the PROBES registry can reference
//     them; also re-exported below so the import surface is unchanged) ---
import {
  probeSecrets,
  probeNextPublic,
  probeSupabaseRLS,
  probeFirebaseRules,
  probePackageJson,
  probeEnvFiles,
  probeAuthWeakness,
  probeAdminRoutes,
  probeMissingHeaders,
  probeCORS,
  probeLLMSecurity,
  probeWebhookValidation,
  probeGitHubActions,
  probeClientAuthStorage,
  probeSSRFOpenRedirect,
  probeCookieFlags,
  probeAPIRouteAuth,
  probeCompromisedPackages,
  probeSlopsquatting,
  probeMCPSecurity,
  probeTrojanSource,
  probeAIRulesFiles,
  probeMaliciousArtifacts,
  probeAICodeSmells,
  probeNpmrcHygiene,
} from './probes/builtin.js';
export {
  probeSecrets,
  probeNextPublic,
  probeSupabaseRLS,
  probeFirebaseRules,
  probePackageJson,
  probeEnvFiles,
  probeAuthWeakness,
  probeAdminRoutes,
  probeMissingHeaders,
  probeCORS,
  probeLLMSecurity,
  probeWebhookValidation,
  probeGitHubActions,
  probeClientAuthStorage,
  probeSSRFOpenRedirect,
  probeCookieFlags,
  probeAPIRouteAuth,
  probeCompromisedPackages,
  probeSlopsquatting,
  probeMCPSecurity,
  probeTrojanSource,
  probeAIRulesFiles,
  probeMaliciousArtifacts,
  probeAICodeSmells,
  probeNpmrcHygiene,
};

// v0.5 live adapters projected as {name, fn}. manifest.js is already in
// the module graph via stable-id.js and does NOT import probes.js, so
// this direct import introduces no cycle.
import { MANIFEST_LIVE_PROBES } from './probes/v05/manifest.js';

// v0.6 taint engine — intra-procedural dataflow analyzer.
import { probeTaintFlow } from './probes/taint-engine.js';
import { probeHostDetection } from './probes/v2/context.js';
import { probeAICodegenBloat } from './probes/v2/bloat.js';

// 2026: agent/editor auto-execution backdoors (.claude hooks, .vscode runOn:
// folderOpen) — the Miasma / Shai-Hulud persistence vector.
import { probeAgentConfigBackdoor } from './probes/agent-backdoor.js';

import {
  probeExternalURLs,
  probeHTML,
  probeSEOHygiene,
  probeGEOHygiene,
  probeA11yLandmarks,
} from './probes/web.js';
import { probeCodeQuality, classifyProject, probeArchitecture } from './probes/quality.js';
import { probeCodeCorrectness } from './probes/code-correctness.js';
import {
  probeSQLInjectionTemplateLiterals,
  probePathTraversal,
  probeWeakRandomness,
  probeStackTraceLeaks,
  probeSubresourceIntegrity,
} from './probes/v05.js';
import {
  probeSourceMapExposure,
  probeIframeSandbox,
  probeSecurityLogging,
  probeRAGIngestion,
  probeVectorEmbeddingWeaknesses,
} from './probes/v05b.js';
export {
  probeExternalURLs,
  probeHTML,
  probeSEOHygiene,
  probeGEOHygiene,
  probeA11yLandmarks,
  probeCodeQuality,
  classifyProject,
  probeArchitecture,
  probeCodeCorrectness,
  probeSQLInjectionTemplateLiterals,
  probePathTraversal,
  probeWeakRandomness,
  probeStackTraceLeaks,
  probeSubresourceIntegrity,
  probeSourceMapExposure,
  probeIframeSandbox,
  probeSecurityLogging,
  probeRAGIngestion,
  probeVectorEmbeddingWeaknesses,
};
export { probeTaintFlow } from './probes/taint-engine.js';
export { probeAgentConfigBackdoor } from './probes/agent-backdoor.js';
// v2 F0: cross-cutting context detectors (framework / host / hook-context /
// async-context) that route the v2 probe families. See docs/preflight-v2-spec.md §1.10.
export {
  detectFrameworks,
  detectHost,
  getHookContextRanges,
  hookContextAt,
  getAsyncContextRanges,
  parseModule,
  probeHostDetection,
} from './probes/v2/context.js';
export { probeAICodegenBloat } from './probes/v2/bloat.js';
export const PROBES = [
  { name: 'Architecture', fn: probeArchitecture },
  { name: 'Secret Scanner', fn: probeSecrets },
  { name: 'NEXT_PUBLIC_ Misuse', fn: probeNextPublic },
  { name: 'Supabase RLS', fn: probeSupabaseRLS },
  { name: 'Firebase Rules', fn: probeFirebaseRules },
  { name: 'Package.json', fn: probePackageJson },
  { name: 'Env File Hygiene', fn: probeEnvFiles },
  { name: 'Auth Weakness', fn: probeAuthWeakness },
  { name: 'Admin Route Exposure', fn: probeAdminRoutes },
  { name: 'Security Headers', fn: probeMissingHeaders },
  { name: 'CORS', fn: probeCORS },
  { name: 'LLM Security', fn: probeLLMSecurity },
  { name: 'Webhook Validation', fn: probeWebhookValidation },
  { name: 'GitHub Actions', fn: probeGitHubActions },
  { name: 'Client Auth Storage', fn: probeClientAuthStorage },
  { name: 'SSRF / Open Redirect', fn: probeSSRFOpenRedirect },
  { name: 'Cookie Security', fn: probeCookieFlags },
  { name: 'API Route Auth', fn: probeAPIRouteAuth },
  { name: 'Compromised Packages', fn: probeCompromisedPackages },
  { name: 'Slopsquat / Typosquat', fn: probeSlopsquatting },
  { name: 'MCP Security', fn: probeMCPSecurity },
  { name: 'Trojan Source', fn: probeTrojanSource },
  { name: 'AI Rules Files', fn: probeAIRulesFiles },
  { name: 'Malicious Artifacts', fn: probeMaliciousArtifacts },
  { name: 'Agent Config Backdoor', fn: probeAgentConfigBackdoor },
  { name: 'AI Code Smells', fn: probeAICodeSmells },
  { name: 'URL Reputation', fn: probeExternalURLs },
  { name: 'HTML Hygiene', fn: probeHTML },
  { name: 'SEO Hygiene', fn: probeSEOHygiene },
  { name: 'GEO Hygiene', fn: probeGEOHygiene },
  { name: 'A11y Landmarks', fn: probeA11yLandmarks },
  { name: 'Code Quality', fn: probeCodeQuality },
  { name: 'Code Correctness', fn: probeCodeCorrectness },
  { name: 'Package Manager Hardening', fn: probeNpmrcHygiene },
  // v0.5 OWASP-framed additions (wave 1)
  { name: 'SQL Injection', fn: probeSQLInjectionTemplateLiterals },
  { name: 'Path Traversal', fn: probePathTraversal },
  { name: 'Weak Randomness', fn: probeWeakRandomness },
  { name: 'Stack Trace Leaks', fn: probeStackTraceLeaks },
  { name: 'Subresource Integrity', fn: probeSubresourceIntegrity },
  // v0.5 OWASP-framed additions (wave 2)
  { name: 'Source Map Exposure', fn: probeSourceMapExposure },
  { name: 'Iframe Sandbox', fn: probeIframeSandbox },
  { name: 'Security Logging', fn: probeSecurityLogging },
  { name: 'RAG Ingestion', fn: probeRAGIngestion },
  { name: 'Vector Embedding Weaknesses', fn: probeVectorEmbeddingWeaknesses },
  // v0.6: lightweight intra-procedural taint analyzer for JS/TS. Sources are
  // request inputs (req.url, req.body, etc.) and browser storage; sinks are
  // filesystem calls, dynamic code execution, and shell spawn. Complements
  // the regex-list probes by catching multi-line flows the literal regexes
  // miss (e.g. `const x = req.body.path; ... ; fs.readFile(x)`).
  { name: 'Taint Flow', fn: probeTaintFlow },
  // v2 F0: host detection surfaced as an inspectable info finding.
  { name: 'Host Detection', fn: probeHostDetection },
  // v2 F7: AI Codegen Bloat — the maintainability tells of unreviewed
  // generated code. Severity ceiling is medium by design.
  { name: 'AI Codegen Bloat', fn: probeAICodegenBloat },
  // v0.5: the live (shadow:false, net-new) language-agnostic adapters,
  // projected from PROBE_MANIFEST_V05. Migration adapters are held out
  // until the v0.4 cutover (see isLiveAdapter).
  ...MANIFEST_LIVE_PROBES,
];
