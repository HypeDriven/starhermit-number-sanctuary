'use strict';

// Number Sanctuary — StarHermit authoritative game server (Node.js).
// Serves only the browser distribution: the launch bundle, sfx/* and assets/*.
// The game is single-player with no shared state, so there are no /api or
// /ws routes.

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST_ROOT = __dirname;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (parseInt(process.env.STARHERMIT_PORT || '80', 10));

// --- static file table -----------------------------------------------------
const FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/main.js': 'main.js',
  '/platform.js': 'platform.js',
  '/starhermit-sdk.js': 'starhermit-sdk.js',
  '/rules.js': 'rules.js',
  '/audio.js': 'audio.js',
  '/i18n.js': 'i18n.js',
  '/gfx.js': 'gfx.js',
  '/settings.js': 'settings.js',
  '/style.css': 'style.css',
  '/favicon.svg': 'favicon.svg',
  '/icon.png': 'icon.png',
  '/coverart.png': 'coverart.png',
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
  if (p.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

// Authored one-shot samples live under sfx/ (see sfx/manifest.json).
function sfxFile(p) {
  const m = /^\/sfx\/([a-z0-9-]+\.(?:opus|json))$/.exec(p);
  return m ? 'sfx/' + m[1] : null;
}

// Authored art (stone scan, courtyard backdrop) lives under assets/.
function assetFile(p) {
  const m = /^\/assets\/([a-z0-9-]+\.(?:webp|png|glb))$/.exec(p);
  return m ? 'assets/' + m[1] : null;
}

// Vendored three.js r160 ES module build and its same-revision addons.
function vendorFile(p) {
  const m = /^\/vendor\/three\/((?:addons\/[a-z]+\/)?[A-Za-z0-9.]+\.js)$/.exec(p);
  return m && !m[1].includes('..') ? 'vendor/three/' + m[1] : null;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  let p = url.split('?')[0];
  const sfx = sfxFile(p);
  const asset = assetFile(p);
  const vendor = vendorFile(p);
  if (!(p in FILES) && !sfx && !asset && !vendor) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(DIST_ROOT, sfx || asset || vendor || FILES[p]);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); res.end('error: ' + err.message); return; }
    res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('Number Sanctuary listening on port ' + PORT);
  });
}

module.exports = { server };
