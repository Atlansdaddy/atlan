// SPDX-License-Identifier: CC-BY-4.0
// (c) 2026 Mid-Atlantic AI. Attribution required — see LICENSE-DATA in the repo root.
//
// src/data/compromised-packages.js
// Threat-intel manifest exported as a JS module (rather than .json) so it imports
// cleanly from Vite, Vitest, ESLint, and bare Node without needing the ES2025
// `with { type: "json" }` attribute that not all toolchains parse yet.
//
// Schema: { [package-name]: { versions: string[], note: string } }
//  array entries match exact resolved versions, or use "*" for any version.

export default {
  _schema: 'preflight/compromised-packages/v1',
  _note:
    "Threat-intel manifest. Each key is an npm package name. `versions` is an array of malicious version strings (exact match or '*' = any). `note` cites the campaign / source. Update when new incidents are published.",
  // Review discipline: every entry here must trace to a primary source (the
  // victim's postmortem, GHSA/CVE/CISA, or an OSV MAL- advisory) checked
  // directly. Aggregated or summarized intel is a lead, not an entry — a
  // 2026-07-25 research pass confidently reported a wave-wide "0.10.1" marker
  // version across the TanStack packages that GHSA-g7cv-rxg3-hmpx shows does
  // not exist; importing it would have false-positived ~45 packages.
  _lastReviewed: '2026-07-25',

  axios: {
    versions: ['1.14.1', '0.30.4'],
    note: 'Sapphire Sleet RAT injection via plain-crypto-js dep (CISA, GTIG) — March 31, 2026',
  },
  'plain-crypto-js': {
    versions: ['*'],
    note: 'Malicious dep injected into axios; do not install any version',
  },

  // IronWorm, May 2026. Impersonation packages that clone a real project's
  // metadata, then ship a packed ELF at .claude/settings plus a settings.json
  // registering it as a Claude Code SessionStart hook. Verified against OSV
  // MAL-2026-3652 (2026-07-25).
  'supabase-javascript': {
    versions: ['2.98.3'],
    note: 'IronWorm impersonation of the Supabase client; SessionStart-hook infostealer — May 2026 (OSV MAL-2026-3652). The official supabase-js is unaffected.',
  },
  // Mini Shai-Hulud wave via a compromised npm publisher account, May 19 2026.
  // Verified against the GitHub malware advisory (2026-07-25), which lists
  // these two versions only. Sibling packages named in secondary reporting for
  // this wave (size-sensor, timeago.js, the @antv/* scope) could NOT be
  // confirmed against any primary advisory and are deliberately not listed.
  'echarts-for-react': {
    versions: ['3.1.7', '3.2.7'],
    note: 'Malware published via a compromised maintainer account — May 19, 2026. Treat any machine that installed it as compromised and rotate every credential from a different machine.',
  },
  // Unscoped name-squat of the official @modelcontextprotocol/server-github.
  // postinstall beacons host, cwd, node version and npm user-agent before any
  // tool call runs. Verified against OSV MAL-2026-5479 (2026-07-25).
  'mcp-server-github': {
    versions: ['0.0.1', '0.0.2'],
    note: 'Typosquat of @modelcontextprotocol/server-github; install-time host beacon — June 2026 (OSV MAL-2026-5479)',
  },

  '@bitwarden/cli': {
    versions: ['2026.4.0'],
    note: 'Bitwarden CLI compromise — April 22, 2026; hunted Claude/Cursor/Codex credentials',
  },

  'intercom-client': {
    versions: ['7.0.4', '7.0.5'],
    note: 'Mini Shai-Hulud credential stealer — April 29, 2026 SAP campaign',
  },
  '@cap-js/sqlite': {
    versions: ['*'],
    note: 'SAP CAP toolchain; Mini Shai-Hulud — flagged by independent tracking; treat all versions as suspect',
  },
  '@cap-js/db-service': {
    versions: ['*'],
    note: 'SAP CAP toolchain; Mini Shai-Hulud — flagged by independent tracking; treat all versions as suspect',
  },

  lightning: {
    versions: ['2.6.2', '2.6.3'],
    note: 'PyPI Mini Shai-Hulud variant',
  },

  '@tanstack/router-utils': {
    versions: ['1.161.11', '1.161.14'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-core': {
    versions: ['1.169.5', '1.169.8'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/arktype-adapter': {
    versions: ['1.166.12', '1.166.15'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/eslint-plugin-router': {
    versions: ['1.161.9', '1.161.12'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/eslint-plugin-start': {
    versions: ['0.0.4', '0.0.7'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/history': {
    versions: ['1.161.9', '1.161.12'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/nitro-v2-vite-plugin': {
    versions: ['1.154.12', '1.154.15'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/react-router': {
    versions: ['1.169.5', '1.169.8'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP); 12M+ weekly downloads, highest-impact in the campaign',
  },
  '@tanstack/react-router-devtools': {
    versions: ['1.166.16', '1.166.19'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/react-router-ssr-query': {
    versions: ['1.166.15', '1.166.18'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/react-start': {
    versions: ['1.167.68', '1.167.71'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/react-start-client': {
    versions: ['1.166.51', '1.166.54'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/react-start-rsc': {
    versions: ['0.0.47', '0.0.50'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/react-start-server': {
    versions: ['1.166.55', '1.166.58'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-cli': {
    versions: ['1.166.46', '1.166.49'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-devtools': {
    versions: ['1.166.16', '1.166.19'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-devtools-core': {
    versions: ['1.167.6', '1.167.9'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-generator': {
    versions: ['1.166.45', '1.166.48'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-plugin': {
    versions: ['1.167.38', '1.167.41'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-ssr-query-core': {
    versions: ['1.168.3', '1.168.6'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/router-vite-plugin': {
    versions: ['1.166.53', '1.166.56'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/solid-router': {
    versions: ['1.169.5', '1.169.8'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/solid-router-devtools': {
    versions: ['1.166.16', '1.166.19'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/solid-router-ssr-query': {
    versions: ['1.166.15', '1.166.18'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/solid-start': {
    versions: ['1.167.65', '1.167.68'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/solid-start-client': {
    versions: ['1.166.50', '1.166.53'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/solid-start-server': {
    versions: ['1.166.54', '1.166.57'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/start-client-core': {
    versions: ['1.168.5', '1.168.8'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/start-fn-stubs': {
    versions: ['1.161.9', '1.161.12'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/start-plugin-core': {
    versions: ['1.169.23', '1.169.26'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/start-server-core': {
    versions: ['1.167.33', '1.167.36'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/start-static-server-functions': {
    versions: ['1.166.44', '1.166.47'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/start-storage-context': {
    versions: ['1.166.38', '1.166.41'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/valibot-adapter': {
    versions: ['1.166.12', '1.166.15'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/virtual-file-routes': {
    versions: ['1.161.10', '1.161.13'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/vue-router': {
    versions: ['1.169.5', '1.169.8'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/vue-router-devtools': {
    versions: ['1.166.16', '1.166.19'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/vue-router-ssr-query': {
    versions: ['1.166.15', '1.166.18'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/vue-start': {
    versions: ['1.167.61', '1.167.64'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/vue-start-client': {
    versions: ['1.166.46', '1.166.49'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/vue-start-server': {
    versions: ['1.166.50', '1.166.53'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },
  '@tanstack/zod-adapter': {
    versions: ['1.166.12', '1.166.15'],
    note: 'Mini Shai-Hulud TanStack — May 11, 2026 (TeamPCP)',
  },

  '@mistralai/mistralai': {
    versions: ['2.2.3', '2.2.4'],
    note: 'Mini Shai-Hulud Mistral — May 11, 2026 (TeamPCP)',
  },
  '@mistralai/mistralai-azure': {
    versions: ['1.7.2', '1.7.3'],
    note: 'Mini Shai-Hulud Mistral — May 11, 2026 (TeamPCP)',
  },
  '@mistralai/mistralai-gcp': {
    versions: ['1.7.2', '1.7.3'],
    note: 'Mini Shai-Hulud Mistral — May 11, 2026 (TeamPCP)',
  },

  '@opensearch-project/opensearch': {
    versions: ['3.5.3', '3.6.2', '3.7.0', '3.8.0'],
    note: 'Mini Shai-Hulud OpenSearch — May 11, 2026 (TeamPCP)',
  },

  '@draftauth/client': {
    versions: ['0.2.1', '0.2.2'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@draftauth/core': {
    versions: ['0.13.1', '0.13.2'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@draftlab/auth': {
    versions: ['0.24.1', '0.24.2'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@draftlab/auth-router': {
    versions: ['0.5.1', '0.5.2'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@draftlab/db': {
    versions: ['0.16.1', '0.16.2'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },

  '@squawk/airways': {
    versions: ['0.4.2', '0.4.3', '0.4.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/airport-data': {
    versions: ['0.7.4', '0.7.5', '0.7.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/airports': {
    versions: ['0.6.2', '0.6.3', '0.6.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/airspace': {
    versions: ['0.8.1', '0.8.2', '0.8.4'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/airspace-data': {
    versions: ['0.5.3', '0.5.4', '0.5.6'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/airway-data': {
    versions: ['0.5.4', '0.5.5', '0.5.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/fix-data': {
    versions: ['0.6.4', '0.6.5', '0.6.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/fixes': {
    versions: ['0.3.2', '0.3.3', '0.3.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/flight-math': {
    versions: ['0.5.4', '0.5.5', '0.5.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/flightplan': {
    versions: ['0.5.2', '0.5.3', '0.5.5', '0.5.6'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/geo': {
    versions: ['0.4.4', '0.4.5', '0.4.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/icao-registry': {
    versions: ['0.5.2', '0.5.3', '0.5.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/icao-registry-data': {
    versions: ['0.8.4', '0.8.5', '0.8.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/mcp': {
    versions: ['0.9.1', '0.9.2', '0.9.4', '0.9.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/navaid-data': {
    versions: ['0.6.4', '0.6.5', '0.6.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/navaids': {
    versions: ['0.4.2', '0.4.3', '0.4.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/notams': {
    versions: ['0.3.6', '0.3.7', '0.3.9'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/procedure-data': {
    versions: ['0.7.3', '0.7.4', '0.7.6'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/procedures': {
    versions: ['0.5.2', '0.5.3', '0.5.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/types': {
    versions: ['0.8.1', '0.8.2', '0.8.4'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/units': {
    versions: ['0.4.3', '0.4.4', '0.4.6'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@squawk/weather': {
    versions: ['0.5.6', '0.5.7', '0.5.9', '0.5.10'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },

  '@uipath/docsai-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-apiworkflow': {
    versions: ['0.0.19'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-workflowcompiler-browser': {
    versions: ['0.0.34'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-functions': {
    versions: ['0.1.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/agent.sdk': {
    versions: ['0.0.18'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/filesystem': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/admin-tool': {
    versions: ['0.1.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/llmgw-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/access-policy-sdk': {
    versions: ['0.3.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/access-policy-tool': {
    versions: ['0.3.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/agent-sdk': {
    versions: ['1.0.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/agent-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/aops-policy-tool': {
    versions: ['0.3.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/ap-chat': {
    versions: ['1.5.7'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/api-workflow-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/apollo-core': {
    versions: ['5.9.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/apollo-react': {
    versions: ['4.24.5'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/apollo-wind': {
    versions: ['2.16.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/auth': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/case-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/cli': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/codedagent-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/codedagents-tool': {
    versions: ['0.1.12'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/codedapp-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/common': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/context-grounding-tool': {
    versions: ['0.1.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/data-fabric-tool': {
    versions: ['1.0.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/flow-tool': {
    versions: ['1.0.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/functions-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/gov-tool': {
    versions: ['0.3.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/identity-tool': {
    versions: ['0.1.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/insights-sdk': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/insights-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/integrationservice-sdk': {
    versions: ['1.0.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/integrationservice-tool': {
    versions: ['1.0.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/maestro-sdk': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/maestro-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/orchestrator-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-bpmn': {
    versions: ['0.0.9'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-case': {
    versions: ['0.0.9'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-connector': {
    versions: ['0.0.19'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-flow': {
    versions: ['0.0.19'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-webapp': {
    versions: ['1.0.6'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/packager-tool-workflowcompiler': {
    versions: ['0.0.16'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/platform-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/project-packager': {
    versions: ['1.1.16'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/resource-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/resourcecatalog-tool': {
    versions: ['0.1.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/resources-tool': {
    versions: ['0.1.11'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/robot': {
    versions: ['1.3.4'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/rpa-legacy-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/rpa-tool': {
    versions: ['0.9.5'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/solution-packager': {
    versions: ['0.0.35'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/solution-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/solutionpackager-sdk': {
    versions: ['1.0.11'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/solutionpackager-tool-core': {
    versions: ['0.0.34'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/tasks-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/telemetry': {
    versions: ['0.0.7'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/test-manager-tool': {
    versions: ['1.0.2'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/tool-workflowcompiler': {
    versions: ['0.0.12'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/traces-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/ui-widgets-multi-file-upload': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/uipath-python-bridge': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/vertical-solutions-tool': {
    versions: ['1.0.1'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/vss': {
    versions: ['0.1.6'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },
  '@uipath/widget.sdk': {
    versions: ['1.2.3'],
    note: 'Mini Shai-Hulud UiPath — May 11, 2026 (TeamPCP)',
  },

  '@taskflow-corp/cli': {
    versions: ['0.1.24', '0.1.25', '0.1.26', '0.1.27', '0.1.28', '0.1.29'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tolka/cli': {
    versions: ['1.0.2', '1.0.3', '1.0.4', '1.0.6'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@supersurkhet/cli': {
    versions: ['0.0.2', '0.0.3', '0.0.4', '0.0.5', '0.0.6', '0.0.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@supersurkhet/sdk': {
    versions: ['0.0.2', '0.0.3', '0.0.4', '0.0.5', '0.0.6', '0.0.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@beproduct/nestjs-auth': {
    versions: [
      '0.1.2',
      '0.1.3',
      '0.1.4',
      '0.1.5',
      '0.1.6',
      '0.1.7',
      '0.1.8',
      '0.1.9',
      '0.1.10',
      '0.1.11',
      '0.1.12',
      '0.1.13',
      '0.1.14',
      '0.1.15',
      '0.1.16',
      '0.1.17',
      '0.1.19',
    ],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@dirigible-ai/sdk': {
    versions: ['0.6.2', '0.6.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@ml-toolkit-ts/preprocessing': {
    versions: ['1.0.2', '1.0.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@ml-toolkit-ts/xgboost': {
    versions: ['1.0.3', '1.0.4'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/components': {
    versions: ['1.0.1', '1.0.2', '1.0.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/connector-medusa': {
    versions: ['1.0.1', '1.0.2', '1.0.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/connector-shopify': {
    versions: ['1.0.1', '1.0.2', '1.0.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/connector-vendure': {
    versions: ['1.0.1', '1.0.2', '1.0.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/connector-woocommerce': {
    versions: ['1.0.1', '1.0.2', '1.0.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/core': {
    versions: ['0.2.1', '0.2.2', '0.2.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/database': {
    versions: ['1.0.1', '1.0.2', '1.0.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/pos': {
    versions: ['0.1.1', '0.1.2', '0.1.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/storage-sqlite': {
    versions: ['0.2.1', '0.2.2', '0.2.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@tallyui/theme': {
    versions: ['0.2.1', '0.2.2', '0.2.3'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@mesadev/rest': { versions: ['0.28.3'], note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)' },
  '@mesadev/saguaro': {
    versions: ['0.4.22'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  '@mesadev/sdk': { versions: ['0.28.3'], note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)' },

  'safe-action': {
    versions: ['0.8.3', '0.8.4'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'cmux-agent-mcp': {
    versions: ['0.1.3', '0.1.4', '0.1.5', '0.1.6', '0.1.7', '0.1.8'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'git-git-git': {
    versions: ['1.0.8', '1.0.9', '1.0.10', '1.0.12'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'git-branch-selector': {
    versions: ['1.3.3', '1.3.4', '1.3.5', '1.3.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'nextmove-mcp': {
    versions: ['0.1.3', '0.1.4', '0.1.5', '0.1.7'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'agentwork-cli': {
    versions: ['0.1.4', '0.1.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'ml-toolkit-ts': {
    versions: ['1.0.4', '1.0.5'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'wot-api': {
    versions: ['0.8.1', '0.8.2', '0.8.4'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'cross-stitch': {
    versions: ['1.1.3', '1.1.4', '1.1.6'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
  'ts-dna': {
    versions: ['3.0.1', '3.0.2', '3.0.4'],
    note: 'Mini Shai-Hulud — May 11, 2026 (TeamPCP)',
  },
};
