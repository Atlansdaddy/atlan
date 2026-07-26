// src/lib/probes/builtin.js
//
// Back-compat shim. The v0.4 built-in probes used to live in this file
// as a 3300-line monolith; they were split into family files when the
// monolith tripped probeCodeQuality's HIGH severity (3000-line) bar of
// its own ladder. Public import surface is preserved: every probe
// function below is re-exported from its new home, so src/lib/probes.js
// and every other caller keep importing from here unchanged.

export { probeSecrets, probeNextPublic, probeEnvFiles } from './secrets-config.js';
export { probeSupabaseRLS, probeFirebaseRules } from './database.js';
export {
  probePackageJson,
  probeCompromisedPackages,
  probeSlopsquatting,
  probeAIRulesFiles,
  probeMaliciousArtifacts,
  probeNpmrcHygiene,
} from './supply-chain.js';
export {
  probeAuthWeakness,
  probeAdminRoutes,
  probeClientAuthStorage,
  probeCookieFlags,
  probeAPIRouteAuth,
} from './auth.js';
export { probeMissingHeaders, probeCORS, probeSSRFOpenRedirect } from './transport.js';
export { probeLLMSecurity, probeMCPSecurity, probeAICodeSmells } from './llm.js';
export { probeWebhookValidation, probeGitHubActions } from './ci.js';
export { probeTrojanSource } from './code-hygiene.js';
