// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways (DPR 3). Desktop: keyboard selection and a
// mark, a tile clicked through its accessible board target, a Hint button
// press, a page reload (the round comes back from the save), pause and resume,
// the Settings dialog, then hints to the results and a new round. Portrait
// phone: taps on a tile, Hint, Erase and Mark, a Practice round solved by Hint
// taps. Landscape phone: a Challenge round solved by the H key. Screenshots of
// each step go to --shots. Fails on console errors or warnings, the runtime's
// error screen, or a round that does not finish.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args[0] : '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    for (const name of ['playwright-core', 'playwright']) {
      const p = join(r, 'node_modules', name);
      if (existsSync(p)) return createRequire(join(r, 'package.json'))(name);
    }
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  // The platform's clock (platform.serverTime / serverNow), as the game host answers it.
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const desktop = [
  ['until', 'No cell selected.'], ['shot', 'start'],
  ['key', 'ArrowUp'], ['wait', 300], ['key', 'KeyN'], ['wait', 300], ['expect', 'Cell row 5, column 5: marked, empty'], ['shot', 'mark'],
  ['cell', 'Cell row 9, column 9:'], ['wait', 500], ['expect', 'Cell row 9, column 9'],
  ['role', 'Hint (H)'], ['wait', 500], ['expect', 'Score -'], ['shot', 'hint'],
  ['reload'], ['until', 'Score -'], ['expect', 'marked, empty'], ['shot', 'reloaded'],
  ['key', 'KeyP'], ['wait', 500], ['expect', 'Press P or click Resume to continue.'], ['shot', 'paused'],
  ['role', 'Settings'], ['wait', 600], ['expect', 'Options: graphics, sound, language, controls'], ['shot', 'settings'],
  ['role', 'Close'], ['wait', 500], ['role', 'Resume'], ['wait', 500],
  ['hints', 'Sanctuary complete'], ['wait', 800], ['expect', 'Total'], ['shot', 'results'],
  ['key', 'KeyR'], ['wait', 800], ['expect', 'Mistakes 0'], ['role', 'Journey'], ['wait', 800], ['expect', 'Medium'], ['shot', 'journey'],
];
const phone = [
  ['until', 'Mistakes 0'], ['shot', 'start'], ['cell', 'Cell row 9, column 9:'], ['wait', 500], ['role', 'Hint (H)'], ['wait', 500],
  ['role', 'Erase selected cell'], ['wait', 500], ['role', 'Mark (N)'], ['wait', 500], ['expect', 'marked, empty'], ['shot', 'mark'],
  ['role', 'Practice'], ['wait', 800], ['expect', 'Easy'], ['hints', 'Sanctuary complete'], ['wait', 800], ['shot', 'results'],
];
const landscape = [
  ['until', 'Mistakes 0'], ['shot', 'start'], ['role', 'Challenge'], ['wait', 800], ['expect', 'Hard'],
  ['keyhints', 'Sanctuary complete'], ['wait', 800], ['shot', 'results'],
];
const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, steps: desktop },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: phone },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: landscape },
];

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(4000); // the first press can be lost while the runtime starts up
  const press = async (loc) => (v.hasTouch ? loc.tap({ timeout: 10000 }) : loc.click({ timeout: 10000 }));
  const seen = async (text) => (await page.getByText(text).count().catch(() => 0)) > 0 || (await page.getByLabel(text).count().catch(() => 0)) > 0
    || (await page.getByRole('button', { name: text }).count().catch(() => 0)) > 0;
  const waitStart = () => page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [op, a] of v.steps) {
    try {
      if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(80); await page.keyboard.up(a); await page.waitForTimeout(80); }
      if (op === 'wait') await page.waitForTimeout(a);
      if (op === 'role') {
        // the mode tabs are a radiogroup's radios; the rest are buttons
        const btn = page.getByRole('button', { name: a, exact: true });
        await press((await btn.count()) ? btn.first() : page.getByRole('radio', { name: a, exact: true }).first());
      }
      if (op === 'cell') {
        // a board tile: its accessible target (ui.target) over the tile
        const re = new RegExp('^' + esc(a));
        const btn = page.getByRole('button', { name: re });
        await press((await btn.count()) ? btn.first() : page.getByText(re).first());
      }
      if (op === 'reload') { await page.reload({ waitUntil: 'load' }); await waitStart(); await page.waitForTimeout(4000); }
      if (op === 'until') {
        let ok = false;
        for (let i = 0; i < 60 && !ok; i++) { ok = await seen(a); if (!ok) await page.waitForTimeout(500); }
        if (!ok) problems.push(`never saw "${a}"`);
      }
      if (op === 'hints') {
        let ok = false;
        for (let i = 0; i < 80 && !ok; i++) {
          // the last hint ends the round: the results replace the rail while the loop looks
          await press(page.getByRole('button', { name: 'Hint (H)', exact: true }).first()).catch(() => undefined);
          await page.waitForTimeout(350);
          ok = await seen(a);
        }
        if (!ok) problems.push(`never reached "${a}"`);
      }
      if (op === 'keyhints') {
        let ok = false;
        for (let i = 0; i < 120 && !ok; i++) {
          await page.keyboard.down('KeyH'); await page.waitForTimeout(60); await page.keyboard.up('KeyH'); await page.waitForTimeout(140);
          ok = await seen(a);
        }
        if (!ok) problems.push(`never reached "${a}"`);
      }
      if (op === 'expect' && !(await seen(a))) problems.push(`expected "${a}" on screen`);
      if (op === 'shot' && shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${a}.png`) }); }
    } catch (e) { problems.push(`${op} ${typeof a === 'string' ? a : JSON.stringify(a)}: ${e.message.split('\n')[0]}`); }
  }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
