/**
 * Number Sanctuary — automated QA playthrough (tests/e2e.mjs).
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome): load -> mode tabs -> select board cells by clicking/tapping the
 * Three.js canvas -> place digits with real key presses and the on-screen
 * number pad -> illegal move rejection, notes, hint, pause/resume, mute,
 * clear, restart, persistence -> solve the whole board through the UI and
 * reach the results screen (desktop pass). Two passes: desktop 1280x800 and
 * mobile 390x844 (touch).
 *
 * State is read back through the game's own ES module (`Game.state`) purely
 * for verification/synchronization; every action goes through the visible UI
 * (pointer on the canvas, keyboard digits/shortcuts, mode buttons, pad).
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'application/javascript; charset=utf-8',
};

// benign GPU/swiftshader noise (from tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function runPass(browser, passName, viewport, hasTouch) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
  });

  const SHOT = (stage) => `/tmp/number-sanctuary-e2e-${stage}-${passName}.png`;
  const base = `http://127.0.0.1:${server.address().port}/`;

  // Read game state through the game's own module (read-only; allowed for
  // verification). All actions below go through the visible UI.
  const gameState = () => page.evaluate(async () => {
    const m = await import('./main.js?v=production-qa-1');
    return m.Game.state;
  });

  // Project a board cell (0..80) to page coordinates using the game's own
  // camera. Returns null if the cell projects outside the canvas.
  const cellPoint = (idx) => page.evaluate(async (idx) => {
    const m = await import('./main.js?v=production-qa-1');
    const pt = m.Game.project(idx);
    const rect = document.getElementById('scene-canvas').getBoundingClientRect();
    if (pt.x < rect.left + 2 || pt.x > rect.right - 2 || pt.y < rect.top + 2 || pt.y > rect.bottom - 2) return null;
    return pt;
  }, idx);

  const tapCell = async (idx) => {
    const pt = await cellPoint(idx);
    assert(pt, `cell ${idx} not clickable in this viewport`);
    if (hasTouch) await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
  };

  // an empty, player-owned cell that is currently on screen
  const findOpenCell = async (st) => {
    for (let i = 0; i < 81; i++) {
      if (st.given[i] || st.board[i]) continue;
      if (await cellPoint(i)) return i;
    }
    return -1;
  };

  try {
    await step(`${passName}: load, title and board visible`, async () => {
      await page.goto(base, { waitUntil: 'load' });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('h1.title', { timeout: 10000 });
      await page.waitForSelector('#scene-canvas', { timeout: 10000 });
      await page.waitForFunction(() => {
        const m = document.querySelectorAll('.mode-btn');
        return m.length === 5 && document.getElementById('status-text').textContent.includes('/81');
      });
      await page.waitForTimeout(400);
      const title = await page.textContent('h1.title');
      assert(title.trim() === 'Number Sanctuary', `unexpected title: ${title}`);
      const status = await page.textContent('#status-text');
      assert(status.startsWith('Easy'), `expected Easy mode at boot, got: ${status}`);
      const st = await gameState();
      const givens = st.given.filter(Boolean).length;
      assert(givens === 41, `expected 41 clues on easy, got ${givens}`);
      assert(st.solution.every((d) => d >= 1 && d <= 9), 'solution grid not populated');
      assert(st.given.every((g, i) => !g || st.board[i] === st.solution[i]), 'clue cells do not match the solution');
      await page.screenshot({ path: SHOT('menu') });
    });

    await step(`${passName}: mode tabs switch difficulty (Journey/Daily/Practice)`, async () => {
      await page.click('.mode-btn[data-mode="journey"]');
      await page.waitForFunction(() => document.getElementById('status-text').textContent.startsWith('Medium'));
      await page.click('.mode-btn[data-mode="daily"]');
      await page.waitForFunction(() => document.getElementById('status-text').textContent.startsWith('Hard'));
      await page.click('.mode-btn[data-mode="practice"]');
      await page.waitForFunction(() => document.getElementById('status-text').textContent.startsWith('Easy'));
      const active = await page.evaluate(() => document.querySelector('.mode-btn.active').dataset.mode);
      assert(active === 'practice', `practice tab not active, got ${active}`);
      const st = await gameState();
      assert(st.mode === 'practice' && st.difficulty === 'easy', `bad mode state: ${JSON.stringify(st)}`);
      await page.screenshot({ path: SHOT('practice') });
    });

    await step(`${passName}: select a cell by clicking the board`, async () => {
      await tapCell(40); // center cell
      const st = await gameState();
      assert(st.selected === 40, `expected selected=40, got ${st.selected}`);
    });

    await step(`${passName}: place a correct digit via keyboard`, async () => {
      let st = await gameState();
      const cell = await findOpenCell(st);
      assert(cell !== -1, 'no open cell available');
      await tapCell(cell);
      await page.keyboard.press(String(st.solution[cell]));
      st = await gameState();
      assert(st.board[cell] === st.solution[cell], `cell ${cell} not filled through the UI`);
      assert(st.progress > 0, 'progress did not advance');
      const status = await page.textContent('#status-text');
      assert(/Score /.test(status), `status missing score: ${status}`);
      await page.screenshot({ path: SHOT('play') });
    });

    await step(`${passName}: illegal digit is rejected and counted as a mistake`, async () => {
      const st = await gameState();
      const cell = await findOpenCell(st);
      assert(cell !== -1, 'no open cell available');
      const row = Math.floor(cell / 9);
      // a digit already present elsewhere in the same row is always illegal
      let clash = 0;
      for (let c = 0; c < 9; c++) {
        const v = st.board[row * 9 + c];
        if (v && row * 9 + c !== cell) { clash = v; break; }
      }
      assert(clash, 'no clashing digit found in the row');
      await tapCell(cell);
      await page.keyboard.press(String(clash));
      const after = await gameState();
      assert(after.board[cell] === 0, 'illegal digit was accepted');
      assert(after.mistakes === st.mistakes + 1, `mistake not counted (${st.mistakes} -> ${after.mistakes})`);
    });

    await step(`${passName}: on-screen number pad places digits`, async () => {
      const st = await gameState();
      const cell = await findOpenCell(st);
      assert(cell !== -1, 'no open cell available');
      await tapCell(cell);
      await page.click(`.pad-btn[data-digit="${st.solution[cell]}"]`);
      let after = await gameState();
      assert(after.board[cell] === st.solution[cell], 'pad digit not placed');
      await page.click('.pad-btn[data-action="erase"]');
      after = await gameState();
      assert(after.board[cell] === 0, 'pad erase did not clear the cell');
    });

    await step(`${passName}: note toggle (N)`, async () => {
      const st = await gameState();
      const cell = await findOpenCell(st);
      assert(cell !== -1, 'no open cell available');
      await tapCell(cell);
      await page.keyboard.press('n');
      let after = await gameState();
      assert(after.notes.includes(cell), `note not set on ${cell}: ${JSON.stringify(after.notes)}`);
      await page.keyboard.press('n');
      after = await gameState();
      assert(!after.notes.includes(cell), 'note not toggled off');
    });

    await step(`${passName}: hint fills a cell from the solution`, async () => {
      const before = await gameState();
      await page.keyboard.press('h');
      const after = await gameState();
      const filledBefore = before.board.filter(Boolean).length;
      const filledAfter = after.board.filter(Boolean).length;
      assert(filledAfter === filledBefore + 1, `hint did not fill a cell (${filledBefore} -> ${filledAfter})`);
      assert(after.board.every((d, i) => !d || d === after.solution[i]), 'hint wrote a wrong digit');
      assert(after.hints === before.hints + 1, 'hint not counted');
    });

    await step(`${passName}: pause overlay, resume and mute`, async () => {
      await page.keyboard.press('p');
      await page.waitForFunction(() => !document.getElementById('overlay').classList.contains('hidden'));
      let st = await gameState();
      assert(st.paused, 'pause flag not set');
      await page.screenshot({ path: SHOT('pause') });
      await page.click('#resume-btn');
      await page.waitForFunction(() => document.getElementById('overlay').classList.contains('hidden'));
      st = await gameState();
      assert(!st.paused, 'resume did not clear the pause flag');
      await page.click('.action-btn[data-action="mute"]');
      st = await gameState();
      assert(st.muted, 'mute button did not mute');
      await page.keyboard.press('m');
      st = await gameState();
      assert(!st.muted, 'M did not unmute');
    });

    await step(`${passName}: keyboard arrows move the selection`, async () => {
      await tapCell(40);
      await page.keyboard.press('ArrowRight');
      let st = await gameState();
      assert(st.selected === 41, `ArrowRight: expected 41, got ${st.selected}`);
      await page.keyboard.press('ArrowUp');
      st = await gameState();
      assert(st.selected === 32, `ArrowUp: expected 32, got ${st.selected}`);
    });

    await step(`${passName}: progress and state survive a reload`, async () => {
      const before = await gameState();
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#scene-canvas');
      await page.waitForTimeout(300);
      const after = await gameState();
      assert(after.mode === before.mode && after.seed === before.seed, 'round not restored after reload');
      assert(after.board.every((d, i) => d === before.board[i]), 'board not restored after reload');
    });

    await step(`${passName}: Settings > Graphics presets and overrides apply live and persist`, async () => {
      const body = (name) => page.getAttribute('body', 'data-gfx-' + name);
      const summary = () => page.textContent('#gfx-summary');
      await page.click('#settings-btn');
      await page.waitForSelector('#settings:not([hidden])');
      const box = await page.locator('.settings-panel').boundingBox();
      const vp = page.viewportSize();
      assert(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1,
        `settings panel cut off: ${JSON.stringify(box)}`);
      assert((await gameState()).paused, 'opening Settings did not pause the round');
      const autoLabel = await page.textContent('#gfx-preset option[value="auto"]');
      assert(/^Auto \(detected: Low\)$/.test(autoLabel), `unexpected Auto label: ${autoLabel}`);
      assert(await body('preset') === 'low' && await body('auto') === 'true', 'software GPU should resolve Auto to Low');
      assert(/SwiftShader|llvmpipe/i.test(await summary()), `summary lacks the GPU name: ${await summary()}`);
      await page.screenshot({ path: SHOT('settings') });

      await page.selectOption('#gfx-preset', 'low');
      assert(await body('preset') === 'low' && await body('auto') === 'false', 'Low preset not applied');
      await page.selectOption('#gfx-preset', 'high');
      assert(await body('preset') === 'high', 'High preset not applied');
      assert(await body('bloom') === 'on' && await body('shadows') === 'medium', 'High tiers not applied');
      assert(/bloom/.test(await summary()), `summary missing bloom at High: ${await summary()}`);
      const fromPreset = await page.textContent('#gfx-cat-bloom option[value="preset"]');
      assert(fromPreset === 'From preset (On)', `unexpected preset label: ${fromPreset}`);
      await page.selectOption('#gfx-cat-bloom', 'off');
      assert(await body('bloom') === 'off', 'bloom override not applied');
      assert(!/bloom/.test(await summary()), 'summary still lists bloom after turning it off');
      await page.focus('#gfx-scale');
      await page.keyboard.press('ArrowRight');
      assert(await page.textContent('#gfx-scale-value') === '105%', 'render scale slider did not move');
      await page.click('#gfx-fps');
      assert(await page.isVisible('#fps-meter'), 'frame-rate readout not shown');
      await page.waitForTimeout(1500); // let High render some frames
      await page.screenshot({ path: SHOT('graphics-high') });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#settings', { state: 'hidden' });

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#scene-canvas');
      await page.waitForTimeout(300);
      assert(await body('preset') === 'high' && await body('bloom') === 'off', 'graphics settings did not survive a reload');
      assert(await page.isVisible('#fps-meter'), 'frame-rate toggle did not survive a reload');
      await page.click('#settings-btn');
      await page.waitForSelector('#settings:not([hidden])');
      assert(await page.inputValue('#gfx-preset') === 'high', 'preset select not restored');
      assert(await page.inputValue('#gfx-cat-bloom') === 'off', 'override select not restored');
      assert(await page.inputValue('#gfx-scale') === '105', 'render scale not restored');

      await page.selectOption('#gfx-preset', 'ultra');
      assert(await body('preset') === 'ultra', 'Ultra preset not applied');
      assert(await page.inputValue('#gfx-cat-bloom') === 'preset' && await body('bloom') === 'on', 'choosing a preset did not clear overrides');
      await page.waitForTimeout(1500); // let Ultra render some frames
      await page.selectOption('#gfx-preset', 'auto');
      assert(await body('preset') === 'low' && await body('auto') === 'true', 'Auto not restored');
      await page.click('#gfx-fps');
      assert(!(await page.isVisible('#fps-meter')), 'frame-rate readout still shown');
      await page.click('#settings-close');
      await page.waitForSelector('#settings', { state: 'hidden' });
      await page.click('#resume-btn');
      await page.waitForFunction(() => document.getElementById('overlay').classList.contains('hidden'));
      assert(!(await gameState()).paused, 'round did not resume after Settings');
    });

    await step(`${passName}: clear (C) removes only the player's digits`, async () => {
      const before = await gameState();
      assert(before.board.filter(Boolean).length > before.given.filter(Boolean).length,
        'nothing of the player on the board to clear');
      await page.keyboard.press('c');
      const st = await gameState();
      const givens = st.given.filter(Boolean).length;
      assert(st.board.filter(Boolean).length === givens, 'clear left player digits behind');
      assert(st.given.every((g, i) => !g || st.board[i] === st.solution[i]), 'clear removed clue digits');
      assert(st.mistakes === 0 && st.hints === 0, 'clear did not reset counters');
      const status = await page.textContent('#status-text');
      assert(status.includes(`${givens}/81`), `status not reset: ${status}`);
    });

    await step(`${passName}: restart (R) starts a fresh round`, async () => {
      const before = await gameState();
      const cell = await findOpenCell(before);
      assert(cell !== -1, 'no open cell available');
      await tapCell(cell);
      await page.keyboard.press(String(before.solution[cell]));
      let st = await gameState();
      assert(st.board[cell] === before.solution[cell], 'probe digit not placed');
      await page.keyboard.press('r');
      st = await gameState();
      assert(st.seed !== before.seed, 'restart reused the same puzzle seed');
      assert(st.moves === 0 && st.mistakes === 0, 'restart did not reset counters');
      assert(st.given.every((g, i) => !g || st.board[i] === st.solution[i]), 'fresh round clues inconsistent');
      const status = await page.textContent('#status-text');
      assert(status.startsWith('Easy'), `unexpected status after restart: ${status}`);
      await page.screenshot({ path: SHOT('final') });
    });

    if (passName === 'desktop') {
      await step('desktop: solve the whole board through the UI and reach results', async () => {
        let st = await gameState();
        for (let idx = 0; idx < 81; idx++) {
          if (st.given[idx] || st.board[idx]) continue;
          await tapCell(idx);
          await page.keyboard.press(String(st.solution[idx]));
          if (idx === 40) await page.screenshot({ path: SHOT('filling') });
        }
        st = await gameState();
        assert(st.board.every((d, i) => d === st.solution[i]), 'board not fully solved through the UI');
        assert(st.gameOver, 'win not detected after solving the board');
        await page.waitForFunction(() => !document.getElementById('overlay').classList.contains('hidden'));
        const overlay = await page.textContent('#overlay');
        assert(/Sanctuary complete/.test(overlay), `results screen missing: ${overlay}`);
        assert(/Total/.test(overlay), 'results screen has no score breakdown');
        const finalScore = st.score;
        await page.waitForTimeout(1200);
        assert((await gameState()).score === finalScore, 'completed score kept changing');
        await page.reload();
        await page.waitForFunction(() => !document.getElementById('overlay').classList.contains('hidden'));
        assert(/Sanctuary complete/.test(await page.textContent('#overlay')), 'completed round did not restore results');
        assert((await gameState()).score === finalScore, 'completed score changed after reload');
        await page.screenshot({ path: SHOT('results') });
      });
    }
  } finally {
    const bad = errors.slice();
    await context.close();
    if (bad.length) {
      throw new Error(`${passName} pass had page errors:\n${bad.join('\n')}`);
    }
  }
}

let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });

  await runPass(browser, 'desktop', { width: 1280, height: 800 }, false);
  await runPass(browser, 'mobile', { width: 390, height: 844 }, true);

  console.log('\nE2E PASS — Number Sanctuary playable via UI on desktop and mobile, no page errors');
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
