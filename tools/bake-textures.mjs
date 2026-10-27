// Bakes the browser build's procedural canvas textures into package images
// (the engine's canvas has no `filter`, and per-pixel painting is slow in the
// native interpreter): the painters below are main.js's makeNoiseTexture and
// makeContactAoTexture, unchanged, run once in Chrome (on the GPU through
// ~/games/tools/gpu-chrome.mjs). Writes
//   assets/textures/grain.png    128² grey value noise (tile roughness / bump)
//   assets/textures/contact-ao.png  512² contact occlusion, black with the old
//                                  alphaMap's grey as alpha
// Run: node tools/bake-textures.mjs (offline; commit the PNGs).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, close } = await launchChrome(chromium);
try {
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  const out = await page.evaluate(() => {
    const SIZE = 9, CELL_SIZE = 1.0, GAP = 0.06, BOARD_SPAN = SIZE * CELL_SIZE + GAP * SIZE;
    const cellX = (idx) => ((idx % SIZE) - SIZE / 2 + 0.5) * CELL_SIZE;
    const cellZ = (idx) => (Math.floor(idx / SIZE) - SIZE / 2 + 0.5) * CELL_SIZE;
    function makeNoiseTexture(size, seed) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(size, size);
      let s = seed >>> 0;
      const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const grid = 8, lat = [];
      for (let i = 0; i < grid * grid; i++) lat.push(rnd());
      const at = (x, y) => lat[((y % grid) * grid) + (x % grid)];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const gx = (x / size) * grid, gy = (y / size) * grid;
          const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
          const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
          const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
          const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
          const v = (top + (bot - top) * sy) * 0.7 + rnd() * 0.3;
          const c = Math.round(110 + v * 110);
          const o = (y * size + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = c; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return cv;
    }
    function makeContactAoTexture(extent) {
      const px = 512, k = px / extent;
      const cv = document.createElement('canvas');
      cv.width = cv.height = px;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, px, px);
      ctx.filter = 'blur(' + Math.round(0.12 * k) + 'px)';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      const edge = (extent - BOARD_SPAN) / 2 - 0.08;
      ctx.fillRect(edge * k, edge * k, (BOARD_SPAN + 0.16) * k, (BOARD_SPAN + 0.16) * k);
      ctx.filter = 'blur(' + Math.round(0.05 * k) + 'px)';
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      const t = CELL_SIZE * 1.02;
      for (let i = 0; i < SIZE * SIZE; i++) {
        const x = (cellX(i) + extent / 2 - t / 2) * k, y = (cellZ(i) + extent / 2 - t / 2) * k;
        ctx.fillRect(x, y, t * k, t * k);
      }
      ctx.filter = 'none';
      return cv;
    }
    // The old alphaMap read the grey (green) channel: black pixels whose alpha is that grey.
    const ao = makeContactAoTexture(BOARD_SPAN + 0.8 + 0.4);
    const a = ao.getContext('2d');
    const img = a.getImageData(0, 0, ao.width, ao.height);
    for (let i = 0; i < img.data.length; i += 4) { img.data[i + 3] = img.data[i + 1]; img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; }
    a.putImageData(img, 0, 0);
    return { grain: makeNoiseTexture(128, 0x5a17).toDataURL('image/png'), ao: ao.toDataURL('image/png') };
  });
  mkdirSync(join(root, 'assets/textures'), { recursive: true });
  const save = (name, url) => writeFileSync(join(root, 'assets/textures', name), Buffer.from(url.split(',')[1], 'base64'));
  save('grain.png', out.grain);
  save('contact-ao.png', out.ao);
  console.log('wrote assets/textures/grain.png, contact-ao.png');
} finally { await close(); }
