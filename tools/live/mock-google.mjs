// A local stand-in for Google Translate's two endpoints, to check what the extension's
// requests really carry without sending anything to Google. Start the test Chrome with
// SK_MOCK_GOOGLE=1 (tools/live/driver.mjs): translate.googleapis.com and
// translate-pa.googleapis.com then resolve to this server.
//
//   node tools/live/mock-google.mjs            (https://127.0.0.1:8443, self-signed)
//   GET  /__log            the requests seen: method, host, path, Origin, Referer, User-Agent
//   POST /__mode?main=503  make the main endpoint fail (to exercise the backup); main=200 again
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(import.meta.dirname, '../../.live/mock-google');
fs.mkdirSync(dir, { recursive: true });
const key = path.join(dir, 'key.pem');
const cert = path.join(dir, 'cert.pem');
if (!fs.existsSync(key)) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=translate.googleapis.com',
    '-addext', 'subjectAltName=DNS:translate.googleapis.com,DNS:translate-pa.googleapis.com', '-keyout', key, '-out', cert], { stdio: 'ignore' });
}

const log = [];
let mainStatus = 200;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, `https://${req.headers.host}`);
    if (url.pathname === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(log, null, 1)); }
    if (url.pathname === '/__mode') { mainStatus = Number(url.searchParams.get('main')) || 200; res.writeHead(200); return res.end(`main=${mainStatus}`); }
    // A local page for the "a tab's request is not touched" check (a public page asking for a
    // local address waits on Chrome's local-network prompt).
    if (url.pathname === '/__page') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>mock tab</title>'); }
    log.push({
      method: req.method, host: req.headers.host, path: url.pathname,
      origin: req.headers.origin ?? null, referer: req.headers.referer ?? null, userAgent: req.headers['user-agent'] ?? null,
    });
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    // Main endpoint: one sentence per line, "<line> (mock)".
    if (url.pathname === '/translate_a/single') {
      if (mainStatus !== 200) { res.writeHead(mainStatus, cors); return res.end(); }
      const lines = (new URLSearchParams(body).get('q') ?? '').split('\n');
      const sentences = lines.map((l, i) => ({ trans: `${l} (mock)${i < lines.length - 1 ? '\n' : ''}`, orig: `${l}${i < lines.length - 1 ? '\n' : ''}` }));
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ sentences }));
    }
    // The backup's script (its key) and its translate call: "<line> (mock backup)".
    if (url.pathname.startsWith('/_/translate_http/')) {
      res.writeHead(200, { ...cors, 'content-type': 'text/javascript' });
      return res.end(`var c={"X-Goog-Api-Key":"${'m'.repeat(39)}"};`);
    }
    if (url.pathname === '/v1/translateHtml') {
      const batch = JSON.parse(body || '[[[]]]')[0][0] ?? [];
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      return res.end(JSON.stringify([batch.map((l) => `${l} (mock backup)`)]));
    }
    res.writeHead(404, cors);
    res.end();
  });
}).listen(8443, '127.0.0.1', () => console.log('mock Google Translate on https://127.0.0.1:8443'));
