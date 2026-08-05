// ⚠ SUPERSEDED 2026-08-05 — DO NOT RUN. Kept for provenance, not for use.
//
// This file is no longer needed: preview.js now accepts any host the cockpit
// itself answers to (auth.js allowedHosts(), derived from `tailscale status`),
// so `tailscale serve --bg --https=<port> <PREVIEW_PORT>` reaches the preview
// proxy directly. Set ATLAN_PREVIEW_TLS_PORT to that port and the client builds
// the right URL. One process fewer, one port fewer, nothing hardcoded.
//
// It is also actively unsafe. `proxyReq.removeHeader('origin')` below strips
// Origin, so previewOriginOk() takes its `if (!o) return true` branch and lets
// cross-site requests through. Measured 2026-08-05: `Origin: http://evil.example`
// gets 403 direct to :4590 and 200 through this shim — the exact vector the gate
// exists to close. It refuses to start for that reason; the override exists only
// so the failure is explicit rather than mysterious.
//
// Deleting it is John's call, not mine. Until then it cannot run by accident.
if (!process.env.ATLAN_ALLOW_SUPERSEDED_SHIM) {
  console.error(
    'preview-shim.mjs is SUPERSEDED and unsafe (it strips Origin, re-opening the\n'
    + 'cross-site vector preview.js blocks). Use instead:\n'
    + '  tailscale serve --bg --https=4591 4590\n'
    + '  ATLAN_PREVIEW_TLS_PORT=4591   (or previewTlsPort in atlan.config.json)\n'
    + 'then restart the cockpit. See server/src/preview.js.',
  );
  process.exit(1);
}

// ── original implementation below, unchanged, for the record ────────────────
// Tailnet bridge for the preview proxy (:4590).
//
// The preview proxy deliberately listens on loopback and rejects any request
// whose Host isn't loopback (anti-rebinding gate in src/preview.js). That's
// correct for a browser on this machine — and it means the phone, which reaches
// the cockpit via tailscale serve (https://johnpc.tail7538c0.ts.net), can never
// load the preview iframe: port 4590 isn't served, http-in-https is mixed
// content, and the gate would 403 the foreign Host anyway.
//
// This shim closes that gap without weakening the gate: tailscale serve
// terminates TLS on :4591 and hands requests here; we accept only the tailnet
// hostname (or loopback) as Host — a rebinding page still can't get through,
// because its forged DNS name won't match — then forward to :4590 with Host
// rewritten to loopback (changeOrigin) and Origin stripped, which is exactly
// the shape of a legitimate local preview load. Tailnet-only: serve is not
// funnel, so nothing here is internet-reachable.
//
// Run: node server/preview-shim.mjs  (from /root/atlan)
import { createServer } from 'node:http';
import { createProxyMiddleware } from 'http-proxy-middleware';

const PREVIEW = 'http://127.0.0.1:4590';
const SHIM_PORT = 4591;
const ALLOWED_HOSTS = new Set(['johnpc.tail7538c0.ts.net', '127.0.0.1', 'localhost', '::1']);

const hostOk = (req) =>
  ALLOWED_HOSTS.has(String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, ''));

const proxy = createProxyMiddleware({
  target: PREVIEW,
  changeOrigin: true, // Host → 127.0.0.1:4590, which the preview gate accepts
  ws: true,
  on: {
    proxyReq: (proxyReq) => proxyReq.removeHeader('origin'),
    proxyReqWs: (proxyReq) => proxyReq.removeHeader('origin'),
    error: (_err, _req, res) => {
      if (res?.writeHead && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('preview proxy (:4590) not reachable');
      }
    },
  },
});

const server = createServer((req, res) => {
  if (!hostOk(req)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('bad host'); return; }
  proxy(req, res, () => { res.writeHead(404); res.end(); });
});
server.on('upgrade', (req, socket, head) => {
  if (!hostOk(req)) { socket.destroy(); return; }
  proxy.upgrade(req, socket, head);
});
server.listen(SHIM_PORT, '127.0.0.1', () =>
  console.log(`preview shim · 127.0.0.1:${SHIM_PORT} → ${PREVIEW} (Host rewritten for the gate)`));
