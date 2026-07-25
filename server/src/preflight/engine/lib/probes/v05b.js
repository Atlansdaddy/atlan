// src/lib/probes/v05b.js
//
// v0.5 wave 2 OWASP-framed probe additions. Five probes covering the
// remaining gaps from the v0.5 OWASP-alignment plan:
//
//   probeSourceMapExposure       — CWE-540 / OWASP A05 (Security Misconfiguration)
//   probeIframeSandbox           — CWE-1021 (Improper Restriction of Rendered UI Layers)
//                                  / OWASP A05
//   probeSecurityLogging         — OWASP A09 (Security Logging Failures)
//                                  / CWE-778 (Insufficient Logging)
//   probeRAGIngestion            — OWASP LLM04 (Data and Model Poisoning)
//                                  / CWE-1395 (Dependency on Vulnerable Third-Party Component)
//   probeVectorEmbeddingWeaknesses — OWASP LLM08 (Vector and Embedding Weaknesses)
//                                    / CWE-200 (Information Exposure)
//
// Same contract as the existing probes.

import { isTestFile, isScannerSelfSource } from '../file-filter.js';

// ---------- 6. Source map exposure ----------
//
// Production builds that ship .map files expose the original source code,
// including comments, variable names, and (sometimes) developer-only branches.
// Two scan surfaces:
//   - vite.config / next.config / webpack.config / rollup.config:
//     production source-map directives enabled.
//   - any file with a sourceMappingURL comment pointing at a public-looking path.

const VITE_SOURCEMAP_RE =
  /build\s*:\s*\{[^}]*sourcemap\s*:\s*(?:true|['"]inline['"]|['"]hidden['"])/s;
const NEXT_SOURCEMAP_RE = /productionBrowserSourceMaps\s*:\s*true/;
const WEBPACK_SOURCEMAP_RE =
  /devtool\s*:\s*['"](?:source-map|cheap-source-map|inline-source-map)['"][^}]*?(?:mode\s*:\s*['"]production['"]|production)/s;
const SOURCEMAP_URL_RE = /\/\/[#@]\s*sourceMappingURL=([^\s]+)/;

export function probeSourceMapExposure(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;

    // Config-file checks. Bundlers leak source maps to production when these
    // directives are set; the actual .map files only ship if the build runs
    // with that config. Probe flags the config, not the bytes.
    if (
      /vite\.config\.(?:js|ts|mjs|cjs)$/.test(file.path) &&
      VITE_SOURCEMAP_RE.test(file.content)
    ) {
      findings.push({
        id: `sourcemap-vite-${file.path}`,
        probe: 'Source Map Exposure',
        title: 'Vite build configured to emit production source maps',
        severity: 'medium',
        category: 'Information Disclosure',
        cwe: 'CWE-540',
        file: file.path,
        line: 1,
        evidence: 'build.sourcemap is enabled in vite.config',
        remediation:
          'Set `build.sourcemap: false` for production. If you need source maps for error monitoring (Sentry, etc.), use `build.sourcemap: "hidden"` (emits maps but does NOT add the sourceMappingURL comment to the bundle) and upload the maps to the error monitor at deploy time so they never reach a public origin.',
      });
    }
    if (
      /next\.config\.(?:js|ts|mjs|cjs)$/.test(file.path) &&
      NEXT_SOURCEMAP_RE.test(file.content)
    ) {
      findings.push({
        id: `sourcemap-next-${file.path}`,
        probe: 'Source Map Exposure',
        title: 'Next.js productionBrowserSourceMaps is enabled',
        severity: 'medium',
        category: 'Information Disclosure',
        cwe: 'CWE-540',
        file: file.path,
        line: 1,
        evidence: 'productionBrowserSourceMaps: true',
        remediation:
          'Remove `productionBrowserSourceMaps: true` from next.config. If you need browser source maps for production error tracking, upload them to your error monitor (Sentry / Datadog / etc.) at deploy and rely on hidden source maps that never ship publicly.',
      });
    }
    if (
      /webpack\.config\.(?:js|ts|cjs)$/.test(file.path) &&
      WEBPACK_SOURCEMAP_RE.test(file.content)
    ) {
      findings.push({
        id: `sourcemap-webpack-${file.path}`,
        probe: 'Source Map Exposure',
        title: 'Webpack production build emits public source maps',
        severity: 'medium',
        category: 'Information Disclosure',
        cwe: 'CWE-540',
        file: file.path,
        line: 1,
        evidence: 'devtool set to a public source-map mode under production',
        remediation:
          'For production, use `devtool: "hidden-source-map"` to emit maps without the sourceMappingURL comment, or `devtool: false` to skip emitting maps entirely. Public source maps disclose the original source.',
      });
    }

    // Source-map URL comment in a JS/CSS file. Almost always indicates a built
    // artifact that wasn't supposed to ship to production. PreFlight skips
    // dist/ in self-source, but a scan of a third-party deploy will find them.
    if (/\.(?:js|css|mjs)$/.test(file.path) && !file.path.includes('node_modules')) {
      const lines = file.content.split('\n');
      lines.forEach((line, i) => {
        const m = SOURCEMAP_URL_RE.exec(line);
        if (!m) return;
        const url = m[1];
        // Skip http(s) URLs that DON'T point at .map (analytics beacons, etc.).
        // A relative .map path AND a public https://... .map URL are both
        // production-leak shapes; both should fire. The previous gate
        // skipped public https://...map URLs (latent bug — fixed depth round 3).
        if (/^https?:\/\//.test(url) && !url.endsWith('.map')) return;
        // Data-URI source maps are a separate leak shape (the map IS the bundle).
        const isDataUri = /^data:/i.test(url);
        findings.push({
          id: `sourcemap-comment-${file.path}-${i}`,
          probe: 'Source Map Exposure',
          title: isDataUri
            ? 'Inline data: URI source map shipped with bundle'
            : 'sourceMappingURL comment points at a public .map asset',
          severity: 'low',
          category: 'Information Disclosure',
          cwe: 'CWE-540',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Production JS bundles should not include a sourceMappingURL comment that points to a publicly-deployed .map file. The map file exposes original source. Remove the comment, or switch the bundler to hidden-source-map / "hidden" mode.',
        });
      });
    }
  });
  return findings;
}

// ---------- 7. iframe sandbox ----------
//
// <iframe src="https://..."> without a sandbox attribute lets the embedded
// page do anything: run scripts, navigate the top window, submit forms,
// open popups, access the parent via window.parent. Even for first-party
// iframes the sandbox attribute is the right default.

// Depth round 3: scan WHOLE-file with [\s\S] so multi-line JSX iframe tags
// (very common: <iframe\n  src="..."\n  title="..."\n/>) are no longer
// invisible to the regex. Recompute line number from match index.
const IFRAME_TAG_RE = /<iframe\b[\s\S]*?>/gi;
const IFRAME_SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/;
const IFRAME_SRCDOC_RE = /\bsrcdoc\s*=\s*["']/;
const IFRAME_SANDBOX_RE = /\bsandbox\s*=\s*["'][^"']*["']|\bsandbox\b(?!\s*=)/;
const IFRAME_SANDBOX_VAL_RE = /\bsandbox\s*=\s*["']([^"']*)["']/;

export function probeIframeSandbox(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.(?:html?|jsx?|tsx?|astro|vue|svelte)$/.test(file.path)) return;

    const content = file.content;
    // postMessage handler without origin check — CWE-346, related to iframe
    // boundary control. Detect window.addEventListener('message', ...) where
    // the next ~30 lines have no `.origin` reference.
    if (/\.[jt]sx?$/.test(file.path)) {
      const msgListeners = [
        ...content.matchAll(
          /\b(?:window|globalThis|self)\.addEventListener\s*\(\s*['"`]message['"`]/g
        ),
      ];
      for (const ml of msgListeners) {
        const lineNum = content.slice(0, ml.index).split('\n').length;
        // Look at the next ~30 lines for an origin check.
        const after = content.slice(ml.index, ml.index + 1500);
        // Accept any control that establishes who sent the message, not just
        // the one spelling the remediation happens to suggest.
        //
        // Real-scan finding 2026-07: a cockpit guarded its handler with
        // `if (e.source !== window.parent) return`, and this probe reported it
        // as unvalidated. Comparing `event.source` is a reference check against
        // an actual window object, which cannot be forged the way a string can,
        // so it is at least as strong as an origin string comparison. Flagging
        // it pushes an author toward a weaker control to satisfy the scanner,
        // which is worse than not having the probe.
        //
        // Belt-and-braces (origin AND source) is still the ideal, and the
        // remediation says so. But a handler with either one is not a finding.
        const checksOrigin =
          /\.origin\s*(?:===|!==|==|!=)|origin\s*===|expectedOrigin|trustedOrigins|allowedOrigins|window\.location\.origin/.test(
            after
          );
        const checksSource =
          /\.source\s*(?:===|!==|==|!=)|\.source\s*\)|expectedSource|trustedSource|allowedSources/.test(
            after
          );
        if (checksSource) continue;
        // Skip if it's actually a MessageChannel port (port.onmessage), which
        // is origin-bound by construction.
        if (checksOrigin) continue;
        findings.push({
          id: `postmessage-no-origin-${file.path}-${ml.index}`,
          probe: 'Iframe Sandbox',
          title: 'postMessage handler does not validate event.origin',
          severity: 'medium',
          category: 'Misconfiguration',
          cwe: 'CWE-346',
          file: file.path,
          line: lineNum,
          evidence: content
            .slice(ml.index, ml.index + 80)
            .replace(/\s+/g, ' ')
            .slice(0, 200),
          remediation:
            'Without a sender check, any window (iframe, popup, parent) can send messages to your handler. Verify the origin against an allowlist at the top of the handler: if (event.origin !== "https://trusted.example") return. Comparing event.source against the specific window you expect (event.source !== iframe.contentWindow) is also accepted and is not forgeable; checking both is stronger still.',
        });
      }
    }

    // Iframe tags (whole-file scan, multi-line tolerant).
    let m;
    IFRAME_TAG_RE.lastIndex = 0;
    while ((m = IFRAME_TAG_RE.exec(content)) !== null) {
      const tag = m[0];
      const lineNum = content.slice(0, m.index).split('\n').length;
      const srcMatch = IFRAME_SRC_RE.exec(tag);
      const src = srcMatch?.[1] || '';
      const isCrossOrigin = /^(https?:)?\/\//i.test(src);
      const hasSrcdoc = IFRAME_SRCDOC_RE.test(tag);
      const hasSandbox = IFRAME_SANDBOX_RE.test(tag);
      if (!hasSandbox) {
        let title;
        let severity;
        if (hasSrcdoc) {
          title = '<iframe srcdoc> without sandbox runs inline HTML as same-origin';
          severity = 'medium';
        } else if (isCrossOrigin) {
          title = 'Cross-origin <iframe> missing sandbox attribute';
          severity = 'high';
        } else {
          title = '<iframe> missing sandbox attribute';
          severity = 'medium';
        }
        findings.push({
          id: `iframe-sandbox-${file.path}-${m.index}`,
          probe: 'Iframe Sandbox',
          title,
          severity,
          category: 'Misconfiguration',
          cwe: 'CWE-1021',
          file: file.path,
          line: lineNum,
          evidence: tag.trim().slice(0, 200),
          remediation:
            'Add a `sandbox` attribute to the iframe. The most restrictive useful default is `sandbox=""`. Relax incrementally with named tokens only for what the embedded page actually needs. Avoid combining `allow-scripts` and `allow-same-origin` for cross-origin iframes; the combination defeats the origin isolation.',
        });
        continue;
      }
      // Sandbox IS present — depth check the value.
      if (isCrossOrigin) {
        const valMatch = IFRAME_SANDBOX_VAL_RE.exec(tag);
        const val = valMatch?.[1] || '';
        const tokens = val.split(/\s+/).filter(Boolean);
        if (tokens.includes('allow-scripts') && tokens.includes('allow-same-origin')) {
          findings.push({
            id: `iframe-sandbox-defeat-${file.path}-${m.index}`,
            probe: 'Iframe Sandbox',
            title:
              'sandbox grants allow-scripts + allow-same-origin to cross-origin iframe (sandbox can be removed)',
            severity: 'medium',
            category: 'Misconfiguration',
            cwe: 'CWE-1021',
            file: file.path,
            line: lineNum,
            evidence: tag.trim().slice(0, 200),
            remediation:
              'When both tokens are present on a cross-origin iframe, the embedded page can call parent.document.querySelector("iframe").removeAttribute("sandbox") and reload itself, defeating the sandbox completely. MDN flags this explicitly. Drop allow-same-origin, or move the iframe to a same-origin context.',
          });
        }
      }
    }
  });
  return findings;
}

// ---------- 8. Security logging failures (A09) ----------
//
// Auth-touching handlers that don't emit any log/audit/track call. The
// heuristic is conservative: file path contains `auth`, `login`, `logout`,
// `register`, `signup`, `password`, `admin`, `permission`, `role`, OR the
// handler is a `DELETE` route, AND the visible function body contains no
// recognizable logging primitive.

const SECURITY_HANDLER_PATHS_RE =
  /\b(?:auth|login|logout|register|signup|password|admin|permission|role|access|impersonate|delete-account)\b/i;
const HANDLER_RE =
  /\b(?:export\s+)?(?:async\s+)?(?:function\s+\w+|const\s+\w+\s*=\s*async)\s*\(|app\.(?:post|delete|put|patch)\s*\(|export\s+async\s+function\s+(?:POST|DELETE|PUT|PATCH)\b/;
const LOGGER_CALL_RE =
  /\b(?:log|logger|console|audit|track|telemetry|metrics|trail|record|emit|capture|monitor)\.(?:info|warn|error|debug|log|event|capture|audit|track|emit|count|increment)\b|\bSentry\.captureException\b|\bdatadog(?:Logs|Metrics)?\.\w+\b/;
const DELETE_HANDLER_RE = /\b(?:export\s+async\s+function\s+DELETE\b|app\.delete\s*\()/;
// Audit logging (CWE-778) is a server-side control: the expectation only
// applies where requests are actually handled. A CLI's auth config or a
// client login form matching the path heuristic is not a missing-audit-log
// finding. FP triage 2026-07 (gemini-cli-fork scan): 19 medium findings on
// CLI config files named auth/oauth with no server in sight.
const SERVER_CONTEXT_RE =
  /\b(?:express|fastify|koa|hapi)\b|\bapp\.(?:get|post|put|delete|patch|use)\s*\(|\brouter\.(?:get|post|put|delete|patch)\s*\(|\bcreateServer\s*\(|\bNextRequest\b|\bNextResponse\b|export\s+async\s+function\s+(?:GET|POST|PUT|DELETE|PATCH)\b|\bres\.(?:status|json|send)\s*\(/;

export function probeSecurityLogging(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$/.test(file.path)) return;

    // Path heuristic: which files are likely to contain security-critical
    // handlers worth auditing for logging.
    const pathIsSecurity = SECURITY_HANDLER_PATHS_RE.test(file.path);
    const hasDeleteHandler = DELETE_HANDLER_RE.test(file.content);
    if (!pathIsSecurity && !hasDeleteHandler) return;
    // Path match alone is not enough: require server-handler evidence in the
    // file itself (a DELETE handler is server evidence by definition).
    if (!hasDeleteHandler && !SERVER_CONTEXT_RE.test(file.content)) return;

    // The file is in a security-relevant location. Check whether any logging
    // call appears in the file at all. If not, that's the finding.
    if (LOGGER_CALL_RE.test(file.content)) return;

    // No logging call anywhere. Surface at the first matching handler line.
    const lines = file.content.split('\n');
    let handlerLine = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (HANDLER_RE.test(lines[i])) {
        handlerLine = i + 1;
        break;
      }
    }
    findings.push({
      id: `seclogging-${file.path}`,
      probe: 'Security Logging',
      title: 'Security-sensitive file contains no logging or audit calls',
      severity: 'medium',
      category: 'Logging & Monitoring',
      cwe: 'CWE-778',
      file: file.path,
      line: handlerLine || 1,
      evidence: pathIsSecurity
        ? `path matches security pattern: ${file.path}`
        : 'destructive HTTP handler (DELETE/PUT/PATCH) found',
      remediation:
        "Add structured logging to every security-sensitive action: login attempts (success + failure), password resets, permission changes, account deletions, admin actions, and any state-changing operation. Use a logger module (winston, pino, your platform's log abstraction) so the output is parseable. Log enough context to debug an incident (userId, IP if you have it, the action, the outcome) without logging credentials or full request bodies.",
    });
  });
  return findings;
}

// ---------- 9. RAG ingestion (LLM04) ----------
//
// Patterns where user-uploaded content flows into an embedding API or a
// vector-store write without visible validation. The classic indirect-
// prompt-injection sink: user uploads a document, the document is chunked
// and embedded, future retrievals surface chunks that contain attacker-
// authored instructions targeting the LLM that retrieves them.

const EMBEDDING_CREATE_RE = /\b(?:embeddings|openai|client)\.(?:embeddings\.)?create\s*\(/;
const VECTOR_STORE_WRITE_RE =
  /\b(?:pinecone|weaviate|qdrant|chroma|milvus|faiss|pgvector|supabase\.vectors|vectorStore)\.(?:upsert|add|insert|index|write|save|put)\s*\(/i;
// Same `url`/`originalUrl`/`path`/`baseUrl` widening as USER_INPUT_TOKEN_RE
// in v05.js. RAG ingestion has the same shape of risk: a request-derived
// URL or path landing in the embedding/vector-store payload should be
// flagged for sanitize/validate review.
const USER_INPUT_NEAR_RE =
  /\b(?:req|request|ctx|context|event)\.(?:body|query|params|files|formData|url|originalUrl|path|baseUrl)(?:\.\w+)?|\buserInput\b|\buserDoc(?:ument)?\b|\buploaded(?:File|Document|Content)?\b/;
// No word boundaries: validation function names are frequently camelCase
// (`sanitizeDocument`, `validateInput`, `stripInjection`, `moderatePrompt`)
// and \b breaks inside CamelCase joins.
const RAG_VALIDATION_RE =
  /sanitize|validate|allowlist|stripinjection|stripmarkdown|striphtml|moderate|moderation|detectpromptinjection|promptshield/i;

export function probeRAGIngestion(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$/.test(file.path)) return;

    const lines = file.content.split('\n');
    lines.forEach((line, i) => {
      const isEmbedding = EMBEDDING_CREATE_RE.test(line);
      const isVectorWrite = VECTOR_STORE_WRITE_RE.test(line);
      if (!isEmbedding && !isVectorWrite) return;

      // Did user input flow into this call (or nearby)?
      const ctx = lines.slice(Math.max(0, i - 4), Math.min(lines.length, i + 4)).join(' ');
      if (!USER_INPUT_NEAR_RE.test(ctx)) return;
      if (RAG_VALIDATION_RE.test(ctx)) return; // visible validation; not a finding

      findings.push({
        id: `rag-ingest-${file.path}-${i}`,
        probe: 'RAG Ingestion',
        title: isVectorWrite
          ? 'User-controlled content written to vector store without validation'
          : 'User-controlled content sent to embedding API without validation',
        severity: 'medium',
        category: 'LLM Security',
        cwe: 'CWE-1395',
        file: file.path,
        line: i + 1,
        evidence: line.trim().slice(0, 200),
        remediation:
          'Before embedding or indexing user-uploaded content, sanitize the text for prompt-injection patterns ("ignore previous instructions," "you are now," instruction-override phrasing) and strip rendered-markdown that could carry hidden instructions. The OWASP LLM04 attack chain runs: user uploads a poisoned document, the doc is chunked and embedded, future retrievals surface the poisoned chunk to the LLM, the LLM follows the instructions in the chunk. A retrieval-time content filter or an LLM-judge moderation pass on incoming documents closes the loop.',
      });
    });
  });
  return findings;
}

// ---------- 10. Vector / embedding weaknesses (LLM08) ----------
//
// Vector-store queries with user-controlled metadata filters, and
// similarity searches that mix user content with cached embeddings
// without scope isolation. The LLM08 family covers cross-tenant data
// leakage through embedding similarity (one tenant's question retrieves
// another tenant's documents) and embedding-cache poisoning.

const VECTOR_QUERY_RE =
  /\b(?:pinecone|weaviate|qdrant|chroma|milvus|faiss|pgvector|supabase\.vectors|vectorStore|index)\.(?:query|search|similaritySearch|search(?:WithScore)?|nearest|topK)\s*\(/i;
const NAMESPACE_OR_FILTER_RE =
  /\bnamespace\s*[:=]|\bfilter\s*[:=]|\btenantId\s*[:=]|\borgId\s*[:=]|\buserId\s*[:=]|\bwhere\s*[:=]/;
const USER_METADATA_RE =
  /\b(?:req|request|ctx|context|event)\.(?:body|query|params|headers)\b|\buserId\b|\btenantId\b|\borgId\b/;

export function probeVectorEmbeddingWeaknesses(files) {
  const findings = [];
  files.forEach((file) => {
    if (isTestFile(file.path) || isScannerSelfSource(file.path)) return;
    if (!/\.[jt]sx?$/.test(file.path)) return;

    const lines = file.content.split('\n');
    lines.forEach((line, i) => {
      if (!VECTOR_QUERY_RE.test(line)) return;

      // Look at ±5 lines of context. The defense we expect: a namespace,
      // filter, or where-clause that pins the query to the current user /
      // tenant / org scope.
      const ctx = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 6)).join(' ');
      const hasScopeFilter = NAMESPACE_OR_FILTER_RE.test(ctx);
      const referencesUser = USER_METADATA_RE.test(ctx);

      // The case we want to flag: a vector query that has neither a scope
      // filter nor a reference to user / tenant context. That's a query
      // returning the global nearest-neighbors, which leaks across tenants.
      if (!hasScopeFilter && !referencesUser) {
        findings.push({
          id: `vector-${file.path}-${i}`,
          probe: 'Vector Embedding Weaknesses',
          title: 'Vector similarity query without tenant / user scope filter',
          severity: 'medium',
          category: 'LLM Security',
          cwe: 'CWE-200',
          file: file.path,
          line: i + 1,
          evidence: line.trim().slice(0, 200),
          remediation:
            'Vector similarity searches must scope to the calling user / tenant / org. Without a namespace or metadata filter, the query returns the nearest neighbors across every document in the index, regardless of who owns them. The classic LLM08 failure: tenant A asks "what was in last week\'s meeting" and the top-K nearest neighbors include tenant B\'s sensitive notes. Pin the query to the current scope: `index.query({ vector, namespace: tenantId, topK })` or `vectorStore.search({ filter: { tenantId }, k })`.',
        });
      }
    });
  });
  return findings;
}
