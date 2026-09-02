'use strict';

// Number Sanctuary — StarHermit authoritative game server (Node.js).
// Serves the browser distribution and provides /api and /ws routes.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIST_ROOT = __dirname;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (parseInt(process.env.STARHERMIT_PORT || '80', 10));

// --- static file table -----------------------------------------------------
const FILES = {
  '/index.html': 'index.html',
  '/main.js': 'main.js',
  '/rules.js': 'rules.js',
  '/audio.js': 'audio.js',
  '/style.css': 'style.css',
  '/three.min.js': 'three.min.js',
  '/favicon.svg': 'favicon.svg',
  '/icon.png': 'icon.png',
};

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html; charset=utf-8';
  if (p.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (p.endsWith('.css')) return 'text/css; charset=utf-8';
  if (p.endsWith('.json')) return 'application/json; charset=utf-8';
  if (p.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (p.endsWith('.opus')) return 'audio/ogg; codecs=opus';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

// Authored one-shot samples live under sfx/ (see sfx/manifest.json).
function sfxFile(p) {
  const m = /^\/sfx\/([a-z0-9-]+\.(?:opus|json))$/.exec(p);
  return m ? 'sfx/' + m[1] : null;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  let p = url.split('?')[0];
  const sfx = sfxFile(p);
  if (!(p in FILES) && !sfx) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(DIST_ROOT, sfx || FILES[p]);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); res.end('error: ' + err.message); return; }
    res.writeHead(200, { 'Content-Type': contentType(p), 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('Number Sanctuary listening on port ' + PORT);
  });
}

module.exports = { server };
