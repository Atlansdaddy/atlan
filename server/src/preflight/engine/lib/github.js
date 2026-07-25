// src/lib/github.js
// Fetch a public GitHub repository's tree and source contents from the browser using
// the public REST API + raw.githubusercontent.com. Filters the tree down to files that
// shouldScanFile() recognizes, ranks them by security relevance, takes the top 80, and
// reports progress through onProgress. The rank matters: GitHub-mode fetches each file
// individually (sequentially) so the cap is a latency knob, not a rate-limit
// cliff: the ones we pull must be the ones that matter most, not the first N
// in tree order. (Files / Folder upload has no cap.)
//
// All errors are mapped to a friendly Error.message that explains the typical recovery
// (rate limit → wait, sandboxed iframe → use file upload, private repo → use file upload).

import { log } from './logger.js';
import { shouldScanFile } from './probes.js';

// GitHub-mode fetches each file individually under a rate-limit budget, so a
// public scan is capped (see MAX_GITHUB_TARGETS). Tree order is meaningless
// for security, so rank first: config / secrets / supply-chain manifests and
// migrations (tier 0), security-named paths like auth/session/jwt (tier 1),
// server + route entrypoints (tier 2), general source in a scanned language
// (tier 3), everything else shouldScanFile allowed (tier 4). Lower = fetched
// first. Pure + exported so it is unit-testable.
//
// Cap = 500. The unauthenticated 60/hr GitHub API limit applies only to the
// ~2 metadata/tree calls, NOT the file fetches (those come from the
// raw.githubusercontent.com CDN, which is not API-rate-limited). The blob
// loop is fully SEQUENTIAL, so there is no burst/abuse-throttle risk; the
// only cost of a higher cap is wall-clock (~one CDN round-trip per file).
// History: started at 80, bumped to 100, raised to 500 after PreFlight's
// OWN repo (158 scannable JS/TS files) hit the silent cap and dropped a
// 3500-line monolith from the scan entirely. A real production app
// regularly carries 200-500 scannable files; 100 was too tight for that.
// Above 500 the latency genuinely starts to break the "scan finishes in
// seconds" UX, and the escape hatch for ginormous repos is still Files /
// Folder upload (no count cap, only per-file size).
export const MAX_GITHUB_TARGETS = 500;

// Per-file byte cap on GitHub-URL mode. Folder-upload mode caps at 500_000
// (App.jsx#handleFiles). There is no good reason for the GitHub path to
// drop more aggressively than folder-upload — both are user-initiated and
// browser-rendered. Pre-2026-06 this was 200_000 (200 KB), which silently
// dropped the same kind of file the cap fix above just exposed: PreFlight's
// own dist/ bundle and any project's vendor chunks. Matched to 500_000
// so the two paths agree.
export const MAX_GITHUB_BLOB_BYTES = 500_000;

// Tier-3 (general source) files this large are promoted into tier 1. Rationale:
// a 50 KB+ source file is statistically far more likely to harbour
// mixed-responsibility logic, monolithic-spa shape, or hidden security paths
// than a small file with no security keyword in its path. The path-keyword
// rank was the only signal; size is a structural risk signal in its own
// right and should compete on equal footing. Without this, PreFlight's own
// 164 KB probes/builtin.js sat in tier 3 and got sliced by the cap.
export const TIER1_BYTE_PROMOTION_THRESHOLD = 50_000;

const CONFIG_RE =
  /(^|\/)(\.env(\.|$)|.*\.config\.(js|ts|mjs|cjs)$|next\.config\.|vite\.config\.|nuxt\.config\.|svelte\.config\.|astro\.config\.|wrangler\.toml$|netlify\.toml$|vercel\.json$|dockerfile$|docker-compose|\.npmrc$|package\.json$|requirements\.txt$|pyproject\.toml$|pipfile$|go\.mod$|cargo\.toml$|composer\.json$|gemfile$|pom\.xml$|build\.gradle|mix\.exs$|pubspec\.yaml$|.*\.csproj$|.*\.tf$|firebase\.json$|firestore\.rules$|storage\.rules$|\.github\/workflows\/)/i;
const MIGRATION_OR_SQL_RE = /(^|\/)migrations?\/|\.sql$/i;
const SECURITY_PATH_RE =
  /(auth|login|logout|signin|signup|session|token|jwt|oauth|sso|secret|credential|crypto|password|passwd|admin|middleware|security|permission|policy|guard|rbac|acl)/i;
// Basename entrypoints must be a CODE file — app.css / index.html are not
// route entrypoints and must not eat priority slots.
const ENTRYPOINT_RE =
  /(^|\/)(server|app|main|index|wsgi|asgi|manage)\.(py|js|jsx|ts|tsx|mjs|cjs|rb|go|rs|java|php|kt|kts|scala|ex|exs)$|(^|\/)(api|routes|controllers|handlers)\/|(^|\/)(pages|app)\/api\//i;
const SCANNED_LANG_RE =
  /\.(py|js|jsx|ts|tsx|mjs|cjs|rs|go|java|rb|php|kt|kts|swift|scala|sc|ex|exs|dart|c|h|cpp|cc|cxx|hpp|cs)$/i;

/**
 * Security-relevance tier for a repo path. Lower fetches first.
 *
 * The `size` argument is optional. When provided, a tier-3 file at or above
 * TIER1_BYTE_PROMOTION_THRESHOLD bytes is promoted to tier 1. This catches
 * monolithic-spa files (the canonical "single source file > 50 KB" signal)
 * that have no security keyword in their path and would otherwise be
 * silently sliced off the bottom of the rank by the count cap. PreFlight's
 * own probes/builtin.js was the trigger case (164 KB, no auth/admin/security
 * substring, tier 3 → dropped from scan → silent dogfood blind).
 *
 * @param {string} path
 * @param {number} [size] optional byte size from the git-tree entry
 * @returns {0|1|2|3|4}
 */
export function scanTargetRank(path, size) {
  const p = String(path || '');
  if (CONFIG_RE.test(p) || MIGRATION_OR_SQL_RE.test(p)) return 0;
  if (SECURITY_PATH_RE.test(p)) return 1;
  if (ENTRYPOINT_RE.test(p)) return 2;
  if (SCANNED_LANG_RE.test(p)) {
    if (typeof size === 'number' && size >= TIER1_BYTE_PROMOTION_THRESHOLD) return 1;
    return 3;
  }
  return 4;
}

// BYOT — Bring Your Own Token. The Personal Access Token lives in localStorage under
// `preflight.github_pat`. When present, it's added as an `Authorization: token <pat>`
// header on every GitHub API + raw.githubusercontent.com request the scanner makes.
// Without a token: 60/hr unauthenticated, public repos only. With a token: 5000/hr,
// plus private repos the user has read access to.
const GITHUB_PAT_KEY = 'preflight.github_pat';

export function loadGitHubPAT() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(GITHUB_PAT_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveGitHubPAT(pat) {
  try {
    if (typeof pat !== 'string' || pat.trim().length === 0) {
      localStorage.removeItem(GITHUB_PAT_KEY);
      return;
    }
    localStorage.setItem(GITHUB_PAT_KEY, pat.trim());
  } catch (e) {
    log.debug('github: PAT save failed', { error: e?.message });
  }
}

export function clearGitHubPAT() {
  try {
    localStorage.removeItem(GITHUB_PAT_KEY);
  } catch (e) {
    log.debug('github: PAT clear failed', { error: e?.message });
  }
}

// Verifies a token by calling api.github.com/user. Returns { ok, username, error }.
// Pure: doesn't read or write the PAT store; pass the candidate token in directly.
export async function testGitHubToken(pat) {
  if (!pat || typeof pat !== 'string') return { ok: false, error: 'No token provided.' };
  try {
    const resp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${pat.trim()}` },
    });
    if (resp.status === 401) {
      return { ok: false, error: 'Token rejected (401). Check the token and required scope.' };
    }
    if (resp.status === 403) {
      return {
        ok: false,
        error:
          'Forbidden (403). Most often this means the token lacks the `repo` scope, or the user is rate-limited.',
      };
    }
    if (!resp.ok) {
      return { ok: false, error: `GitHub API ${resp.status} ${resp.statusText}` };
    }
    const data = await resp.json();
    return { ok: true, username: data.login || '(unknown)' };
  } catch (e) {
    return { ok: false, error: e?.message || 'Network call failed.' };
  }
}

// Build the headers object once per scan. If the user has a PAT stored, attach it;
// otherwise return an empty object so fetch() goes out unauthenticated.
function buildAuthHeaders() {
  const pat = loadGitHubPAT();
  return pat ? { Authorization: `token ${pat}` } : {};
}

export async function fetchGitHubRepo(url, onProgress) {
  const ghLog = log.child('github');
  const authHeaders = buildAuthHeaders();
  const authenticated = Object.keys(authHeaders).length > 0;

  if (typeof url !== 'string') {
    ghLog.error('fetchGitHubRepo got non-string url', { typeofArg: typeof url });
    throw new Error(
      `We tried to read that GitHub URL but got something that wasn't a string (got ${typeof url}). Refresh the page and try again — if it keeps happening, open the Diagnostics panel and share the log.`
    );
  }
  const trimmed = url.trim();
  if (!trimmed) throw new Error('GitHub URL is empty.');

  const m = trimmed.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (!m) {
    ghLog.warn('URL did not match github.com/owner/repo pattern', { url: trimmed });
    throw new Error('Use the format https://github.com/owner/repo');
  }
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, '');
  ghLog.info('Resolved repo', { owner, repo });

  onProgress?.({ stage: 'Resolving repository', current: 0, total: 1 });

  let repoResp;
  try {
    repoResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: authHeaders,
    });
  } catch (e) {
    ghLog.error('Repo metadata fetch threw', { error: e?.message });
    throw new Error(
      `Network call to api.github.com failed (${e.message || 'unknown'}). ` +
        `This artifact runs in a sandboxed iframe; some browsers / extensions ` +
        `block cross-origin fetches. Workaround: use the Files / Folder tab — ` +
        `download the repo as a zip from GitHub, expand it, and select the folder.`
    );
  }

  ghLog.debug('Repo response', { status: repoResp.status });

  if (repoResp.status === 404) {
    throw new Error(
      authenticated
        ? 'Repository not found, or the token does not have access to it. Verify the URL and the PAT scope (Settings → Private Repos).'
        : 'Repository not found, or it is private. Public repos need no auth; for a private repo, paste a GitHub Personal Access Token in Settings → Private Repos.'
    );
  }
  if (repoResp.status === 403) {
    const remaining = repoResp.headers.get('x-ratelimit-remaining');
    const resetUnix = parseInt(repoResp.headers.get('x-ratelimit-reset') || '0', 10);
    const resetIn = resetUnix
      ? Math.max(0, Math.ceil((resetUnix * 1000 - Date.now()) / 60000))
      : null;
    ghLog.warn('Rate limit hit', { remaining, resetIn });
    throw new Error(
      `GitHub API rate limit hit (${remaining || 0} remaining)` +
        (resetIn !== null ? `, resets in ~${resetIn} min` : '') +
        `. Unauthenticated limit is 60/hour per IP. Use Files / Folder upload as fallback.`
    );
  }
  if (!repoResp.ok) {
    throw new Error(`GitHub API ${repoResp.status} ${repoResp.statusText}`);
  }

  let repoInfo;
  try {
    repoInfo = await repoResp.json();
  } catch (e) {
    ghLog.error('Repo metadata JSON parse failed', { error: e?.message });
    throw new Error('GitHub responded with non-JSON. Try again or use Files upload.');
  }

  const branch = repoInfo.default_branch;
  if (!branch) {
    throw new Error('GitHub did not report a default branch. Repository may be empty.');
  }
  // raw.githubusercontent.com is the CDN-fast path but it does not reliably honor
  // Authorization headers for private-repo blobs (returns 404 even with a valid PAT).
  // For private repos we route blob fetches through api.github.com/repos/.../contents
  // with `Accept: application/vnd.github.raw` so the auth header is respected.
  const isPrivate = repoInfo.private === true;

  onProgress?.({ stage: `Walking ${branch} tree`, current: 0, total: 1 });
  let treeResp;
  try {
    treeResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: authHeaders }
    );
  } catch (e) {
    ghLog.error('Tree fetch threw', { error: e?.message });
    throw new Error(`Tree fetch failed: ${e.message || 'unknown'}. Try Files / Folder upload.`);
  }
  if (!treeResp.ok) {
    throw new Error(`Tree fetch returned ${treeResp.status}`);
  }
  const treeData = await treeResp.json();
  if (treeData.truncated) {
    ghLog.warn('Tree was truncated by GitHub (large repo)', { entryCount: treeData.tree?.length });
  }

  // Two-phase rank-and-cap. Phase 1: every blob that passes shouldScanFile +
  // per-file size cap is a candidate. Phase 2: rank candidates and take the
  // top N. We track BOTH counts so the user gets a real banner when the cap
  // slices files off the bottom (pre-2026-06 this was silent).
  const allMatched = (treeData.tree || []).filter(
    (node) =>
      node.type === 'blob' && shouldScanFile(node.path) && (node.size || 0) < MAX_GITHUB_BLOB_BYTES
  );
  const ranked = allMatched
    // Rank by security relevance, then take the top N. Stable within a tier
    // (original tree order breaks ties) so the selection is deterministic.
    // Pass node.size so tier-3 files at or above TIER1_BYTE_PROMOTION_THRESHOLD
    // get promoted to tier 1 (closes the silent-slice blind on large source
    // files that have no security keyword in their path).
    .map((node, i) => ({ node, i, rank: scanTargetRank(node.path, node.size) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
  const targets = ranked.slice(0, MAX_GITHUB_TARGETS).map((x) => x.node);
  const droppedByCap = Math.max(0, ranked.length - targets.length);
  // Oversized blobs were rejected by the per-file size filter — also
  // user-facing so a 600 KB file silently skipped doesn't look like a bug.
  const oversized = (treeData.tree || []).filter(
    (node) =>
      node.type === 'blob' && shouldScanFile(node.path) && (node.size || 0) >= MAX_GITHUB_BLOB_BYTES
  );
  ghLog.info('Targets selected', {
    totalEntries: treeData.tree?.length,
    targetCount: targets.length,
  });

  if (targets.length === 0) {
    throw new Error('No security-relevant files found in this repository tree.');
  }

  const out = [];
  let blobFailures = 0;
  let firstFailureDetail = null;
  let usingApiFallback = isPrivate; // private repos always use the api/contents path
  // Path segments need to be individually URL-encoded so that spaces / unicode / hashes in
  // file names don't break the contents-endpoint URL. raw.githubusercontent.com is more
  // lenient but we encode either way for consistency.
  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');
  // Two per-file blob fetchers. raw.githubusercontent.com is the CDN-fast path for public
  // repos. api.github.com/contents is the auth-respecting fallback used unconditionally for
  // private repos AND as a recovery path for public repos when raw.gh is unreachable. The
  // contents endpoint costs rate-limit budget (60/hr unauth, 5000/hr with PAT) whereas the
  // CDN does not, so we prefer raw.gh first and only fall back on failure.
  const rawGhFetch = (path) =>
    fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodePath(path)}`, {
      headers: authHeaders,
    });
  const apiContentsFetch = (path) =>
    fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      { headers: { ...authHeaders, Accept: 'application/vnd.github.raw' } }
    );
  // Returns { ok, content } or { ok: false, detail }. Catches network throws and non-OK
  // responses uniformly so the caller can treat them the same way.
  async function tryFetch(fetcher, path) {
    try {
      const r = await fetcher(path);
      if (r.ok) return { ok: true, content: await r.text() };
      return { ok: false, detail: `HTTP ${r.status} ${r.statusText || ''}`.trim() };
    } catch (e) {
      return { ok: false, detail: `network: ${e?.message || String(e)}` };
    }
  }
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    onProgress?.({ stage: `Fetching ${t.path}`, current: i + 1, total: targets.length });
    let result = await tryFetch(usingApiFallback ? apiContentsFetch : rawGhFetch, t.path);
    if (!result.ok && !usingApiFallback) {
      // raw.gh failed on a public repo. Try the api/contents path for THIS blob. If that
      // works, latch onto the fallback for the rest of the scan so we don't burn time
      // double-fetching every file. Mobile networks (cellular carriers, strict-privacy
      // browser shields, cached failed CORS preflights) commonly block raw.gh while
      // leaving api.github.com reachable.
      const fallbackResult = await tryFetch(apiContentsFetch, t.path);
      if (fallbackResult.ok) {
        ghLog.warn('raw.gh failed; switching to api.github.com/contents fallback', {
          rawFailure: result.detail,
        });
        usingApiFallback = true;
        result = fallbackResult;
      } else {
        result = {
          ok: false,
          detail: `raw.gh: ${result.detail}; api/contents: ${fallbackResult.detail}`,
        };
      }
    }
    if (result.ok) {
      out.push({ path: t.path, content: result.content });
    } else {
      blobFailures++;
      if (!firstFailureDetail) firstFailureDetail = result.detail;
      ghLog.debug('Blob fetch failed', { path: t.path, detail: result.detail });
    }
  }
  if (blobFailures > 0) {
    ghLog.warn('Some blob fetches failed', {
      fetched: out.length,
      failed: blobFailures,
      private: isPrivate,
      usingApiFallback,
      firstFailure: firstFailureDetail,
    });
  }
  if (out.length === 0) {
    const detail = firstFailureDetail ? ` First failure: ${firstFailureDetail}.` : '';
    throw new Error(
      isPrivate
        ? `All ${targets.length} private-repo blob fetches failed.${detail} The PAT was accepted for repo metadata but rejected for file content. Verify the token has "Contents: read" repo access (fine-grained PAT) or the classic "repo" scope, then re-scan. Fallback: use Files / Folder upload.`
        : `All ${targets.length} blob fetches failed.${detail} Both raw.githubusercontent.com and api.github.com/contents were unreachable from this browser. On mobile this is often a carrier-level block, a strict-privacy browser shield (Brave / DuckDuckGo / Firefox Focus), or a cached failed CORS preflight. Try switching between WiFi and cellular, disabling the privacy shield for this site, or use the Files / Folder tab.`
    );
  }
  // Attach scan-coverage metadata to the returned array so the caller (and the
  // UI) can render a "scanned X of Y matching files" banner when the count
  // cap or per-file size cap silently dropped files. Storing on the array
  // instead of changing the return shape keeps the existing call sites
  // (App.jsx#handleScan) working unchanged; new consumers can read
  // out.coverage. Pre-2026-06 this was silent — PreFlight's own 158-file
  // repo lost 58 files to the count cap with no UI signal at all.
  out.coverage = {
    scanned: out.length,
    capacityCap: MAX_GITHUB_TARGETS,
    matched: allMatched.length,
    droppedByCap,
    oversizedDropped: oversized.length,
    oversizedSample: oversized.slice(0, 5).map((n) => ({ path: n.path, size: n.size })),
  };
  return out;
}
