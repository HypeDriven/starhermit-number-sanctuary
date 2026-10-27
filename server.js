// Number Sanctuary — local development server for the engine package: serves
// the web loader (index.html) and the package's files as the platform does,
// plus the platform's /api/v1/time answer the runtime asks for the Daily's
// UTC date. Not part of the package (.starhermitignore); the platform runs
// only score-script.js (starhermit.txt server=). `npm start`, then open
// http://127.0.0.1:8000/ (PORT overrides).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ts': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.opus': 'audio/ogg',
};

export const server = http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/api/v1/time') {
    const now = Date.now();
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ serverTime: now, serverTimeIso: new Date(now).toISOString() }));
    return;
  }
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || rel.split('/').some((s) => s.startsWith('.'))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Number Sanctuary on http://127.0.0.1:${PORT}/`));
}
