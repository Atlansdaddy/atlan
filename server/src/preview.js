import express from 'express';
import { createServer } from 'node:http';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREVIEW_PORT = 4590;

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
  server.on('upgrade', proxy.upgrade);
  server.listen(PREVIEW_PORT, '127.0.0.1', () =>
    console.log(`preview proxy · http://127.0.0.1:${PREVIEW_PORT} → ${target}`));
  return server;
}
