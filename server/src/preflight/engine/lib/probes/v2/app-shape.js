// src/lib/probes/v2/app-shape.js
//
// What KIND of app is this, and which findings does that change?
//
// Some findings are only findings because of who can reach them. A stack trace
// returned to the browser is a disclosure when the browser might belong to an
// attacker. In a tool that binds to 127.0.0.1 and serves exactly one person,
// that same stack trace is a debugging feature, and reporting 23 of them as
// security exposure is the scanner failing to understand what it is looking at.
//
// The response is awareness, not silence. A single-user loopback tool still
// gets the finding, at reduced weight, with the reason stated: it would matter
// if this were deployed. Hiding it would teach nothing and would be wrong the
// day the thing gets a public URL.
//
// Deliberately conservative. Every signal here has to be something a public
// multi-user app would not do.

// Server binds that cannot receive traffic from another machine.
// The port is usually a constant, not a literal: `server.listen(PORT,
// '127.0.0.1')`. Requiring \d+ meant the most common form in real code never
// matched, which is why a cockpit that binds loopback twice was not detected
// as local at all.
const LOOPBACK_BIND_RE =
  /(?:listen|bind|host|hostname|HOST)\s*[:=(]\s*['"`](?:127\.0\.0\.1|localhost|::1)['"`]|--host[= ](?:127\.0\.0\.1|localhost)|\b(?:listen|bind)\s*\(\s*[^,)]+,\s*['"`](?:127\.0\.0\.1|localhost|::1)['"`]/;

// A public bind anywhere is disqualifying: the app can receive outside traffic.
const PUBLIC_BIND_RE =
  /(?:listen|bind|host|hostname)\s*[:=(]\s*['"`](?:0\.0\.0\.0|::)['"`]|\b(?:listen|bind)\s*\(\s*[^,)]+,\s*['"`](?:0\.0\.0\.0|::)['"`]|--host[= ]0\.0\.0\.0/;

// Desktop shells. These run as one local user by construction.
const DESKTOP_SHELL_RE =
  /\b(?:electron|@electron\/|tauri|@tauri-apps\/|neutralinojs|nw\.js)\b|BrowserWindow\s*\(|tauri\.conf\.json/;

// Multi-user signals. Any of these means the "single user" premise is wrong.
// Every token here has to mean "more than one human uses this". An earlier
// version made the suffix optional in `register(User|Account)?`, so bare
// `register` matched — and `navigator.serviceWorker.register('/sw.js')` in a
// single-user cockpit read as a signup flow. `permissions: [` came out too:
// an agent-permission prompt is not user-account permissions.
const MULTI_USER_RE =
  /\b(?:signup|sign_up|signUp|registerUser|registerAccount|createUser|inviteUser|invite_user|tenantId|tenant_id|organization[Ii]d|orgId|workspaceId|roleBased|\brbac\b|users\s*\.\s*(?:findMany|insertMany)|multi[-_]?tenant)\b/;

// Deploy targets imply a public URL.
const DEPLOY_CONFIG_RE =
  /(^|\/)(?:vercel\.json|netlify\.toml|wrangler\.toml|fly\.toml|render\.yaml|Procfile|app\.yaml|\.github\/workflows\/deploy)/i;

/**
 * Detect a single-user / loopback-only application.
 *
 * @returns {{ isSingleUserLocal: boolean, signals: string[], reasons: string[] }}
 */
export function detectAppShape(files) {
  const signals = [];
  let loopback = false;
  let publicBind = false;
  let desktop = false;
  let multiUser = false;
  let deployTarget = false;

  for (const f of files || []) {
    const path = f?.path || '';
    const content = f?.content || '';
    if (DEPLOY_CONFIG_RE.test(path)) {
      deployTarget = true;
      signals.push(`deploy config: ${path}`);
    }
    if (/(^|\/)tauri\.conf\.json$/i.test(path)) {
      desktop = true;
      signals.push('tauri config');
    }
    if (!/\.(?:[jt]sx?|py|json|toml|ya?ml)$/i.test(path)) continue;

    if (!publicBind && PUBLIC_BIND_RE.test(content)) {
      publicBind = true;
      signals.push(`public bind in ${path}`);
    }
    if (!loopback && LOOPBACK_BIND_RE.test(content)) {
      loopback = true;
      signals.push(`loopback bind in ${path}`);
    }
    if (!desktop && DESKTOP_SHELL_RE.test(content)) {
      desktop = true;
      signals.push(`desktop shell in ${path}`);
    }
    if (!multiUser && MULTI_USER_RE.test(content)) {
      multiUser = true;
      signals.push(`multi-user surface in ${path}`);
    }
  }

  const reasons = [];
  if (loopback) reasons.push('binds to loopback only');
  if (desktop) reasons.push('runs in a desktop shell');
  if (publicBind) reasons.push('also binds a public interface');
  if (multiUser) reasons.push('has a multi-user surface');
  if (deployTarget) reasons.push('ships a deploy config');

  const isSingleUserLocal = (loopback || desktop) && !publicBind && !multiUser && !deployTarget;
  return { isSingleUserLocal, signals, reasons };
}

// Findings whose severity depends on a hostile party being able to reach the
// app. In a single-user local tool the reachability premise does not hold, so
// these are downgraded rather than dropped.
const EXPOSURE_DEPENDENT_PROBES = new Set([
  'Stack Trace Leaks',
  'Information Disclosure',
  'Security Headers',
  'Iframe Sandbox',
]);

const DOWNGRADE = { critical: 'medium', high: 'medium', medium: 'low', low: 'info', info: 'info' };

/**
 * Re-weight findings for a single-user local app, in place of suppressing them.
 *
 * Each affected finding keeps its place in the report, drops one or two
 * severity bands, and gains a `shapeNote` explaining what changed and why, so
 * the reader learns the finding would count if the app were deployed.
 */
export function applyAppShape(findings, shape) {
  if (!shape?.isSingleUserLocal) return findings || [];
  return (findings || []).map((f) => {
    if (!EXPOSURE_DEPENDENT_PROBES.has(f?.probe)) return f;
    const downgraded = DOWNGRADE[f.severity] || f.severity;
    if (downgraded === f.severity) return f;
    return {
      ...f,
      severity: downgraded,
      originalSeverity: f.severity,
      shapeNote:
        'Reduced because this project looks like a single-user tool bound to loopback: the disclosure reaches only the person running it. Restore full weight the moment it listens on a public interface or gains a second user.',
    };
  });
}
