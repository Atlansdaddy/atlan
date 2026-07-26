import express from 'express';
import { createServer } from 'node:http';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { PREVIEW_PORT } from './config.js';
import { allowedOrigins } from './auth.js';

// Anti-rebinding / cross-site gate for the preview proxy (peer-review finding:
// :PREVIEW_PORT was an open, unauthenticated loopback — a DNS-rebinding page or
// a cross-site fetch/WS in the browser could reach it). Two checks, no token:
//   • Host — a rebinding attack arrives with a FOREIGN host (e.g. evil.com) that
//     resolves to 127.0.0.1; a real preview load carries a loopback host. Reject
//     anything that isn't loopback.
//   • Origin — cross-site fetch/WS carries the attacker's origin. The preview's
//     own subresources send the preview origin; the cockpit sends one of its
//     allowed origins; a top-level iframe navigation sends none. Reject the rest.
// Residual (documented, NOT closed): a NATIVE local app can forge these headers;
// only a secret token stops that, which we deliberately avoid in the URL. This
// shuts the browser-reachable vector, which is the realistic remote threat.
function previewOriginOk(req) {
  const name = String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '');
  if (name !== '127.0.0.1' && name !== 'localhost' && name !== '::1') return false;
  const o = req.headers.origin;
  if (!o) return true; // top-level navigation / most subresources
  const self = [`http://127.0.0.1:${PREVIEW_PORT}`, `http://localhost:${PREVIEW_PORT}`];
  return self.includes(o) || allowedOrigins().includes(o);
}

let target = 'http://127.0.0.1:5173';
export function setPreviewTarget(url) { target = url; }
export function getPreviewTarget() { return target; }

// Script injected into every proxied HTML page: console capture + snapshot.
// Runs on the PREVIEW origin, talks to the cockpit via parent.postMessage.
const INJECT = `
(() => {
  if (window.__atlanInjected) return; window.__atlanInjected = true;
  const post = (m) => { try { parent.postMessage(Object.assign({ __atlan: true }, m), '*'); } catch (e) {} };
  const fmt = (args) => args.map((a) => {
    if (a instanceof Error) return a.stack || String(a);
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
    return String(a);
  }).join(' ').slice(0, 1000);
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { post({ kind: 'console', level, text: fmt(args) }); orig(...args); };
  }
  window.addEventListener('error', (e) => post({ kind: 'console', level: 'error',
    text: (e.message || 'error') + ' — ' + (e.filename || '').split('/').pop() + ':' + e.lineno }));
  window.addEventListener('unhandledrejection', (e) => post({ kind: 'console', level: 'error',
    text: 'unhandled rejection: ' + fmt([e.reason]) }));
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return; // only the embedding cockpit may trigger a snapshot
    if (e.data && e.data.__atlan === 'snapshot') {
      const go = () => window.html2canvas(document.body, { logging: false, scale: 1 })
        .then((c) => post({ kind: 'snapshot', data: c.toDataURL('image/png') }))
        .catch((err) => post({ kind: 'console', level: 'error', text: 'snapshot failed: ' + err }));
      if (window.html2canvas) go();
      else {
        const s = document.createElement('script');
        s.src = '/__atlan/html2canvas.js'; s.onload = go;
        s.onerror = () => post({ kind: 'console', level: 'error', text: 'snapshot lib blocked (CSP?)' });
        document.head.appendChild(s);
      }
    }
  });
  post({ kind: 'ready', url: location.href });
})();
`;

export function startPreviewProxy() {
  const app = express();

  // Gate every request first: block DNS-rebinding (foreign Host) and cross-site
  // access (foreign Origin) before anything is proxied or injected.
  app.use((req, res, next) => {
    if (!previewOriginOk(req)) return res.status(403).type('text/plain').send('bad origin');
    next();
  });

  app.get('/__atlan/inject.js', (_req, res) => res.type('application/javascript').send(INJECT));
  app.get('/__atlan/html2canvas.js', (_req, res) =>
    res.type('application/javascript').send(readFileSync(join(__dirname, 'vendor-html2canvas.js'))));

  const proxy = createProxyMiddleware({
    router: () => target,
    target,
    changeOrigin: true,
    ws: true,
    selfHandleResponse: true,
    on: {
      proxyRes: responseInterceptor(async (buf, proxyRes) => {
        const ct = String(proxyRes.headers['content-type'] ?? '');
        if (!ct.includes('text/html')) return buf;
        let html = buf.toString('utf8');
        const tag = '<script src="/__atlan/inject.js"></script>';
        if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
        else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html([^>]*)>/i, `<html$1>${tag}`);
        else html = tag + html;
        return html;
      }),
      error: (_err, _req, res) => {
        if (res?.writeHead && !res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/html' });
          res.end(`<body style="background:#03203D;color:#7C99B2;font-family:system-ui;display:grid;place-items:center;height:100vh">
            <div style="text-align:center"><h3 style="color:#6BD4D8">nothing at ${target}</h3>
            <p>start the project's dev server, then reload</p></div></body>`);
        }
      },
    },
  });

  app.use('/', proxy);
  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => {
    // Same gate for WS upgrades (HMR sockets) — a rebinding/cross-site WS carries
    // a foreign Origin/Host and is dropped before the proxy sees it.
    if (!previewOriginOk(req)) { socket.destroy(); return; }
    proxy.upgrade(req, socket, head);
  });
  server.listen(PREVIEW_PORT, '127.0.0.1', () =>
    console.log(`preview proxy · http://127.0.0.1:${PREVIEW_PORT} → ${target}`));
  return server;
}
