// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// switches to Practice and keeps solving the courtyard through the real UI — tapping an open cell on
// the 3D board (located through the game's own camera projection, like a player) and typing its digit —
// so tile colours/finishes, digit sprites, the selection ring, fireflies and lantern flicker update
// constantly. A solved board restarts with R.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#scene-canvas', { timeout: 20000 });
  await page.click('#settings-btn');
  await page.waitForSelector('#settings:not([hidden])');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#settings-close');
  await page.waitForSelector('#settings', { state: 'hidden' });
  const resume = page.locator('#resume-btn');
  if (await resume.isVisible()) await resume.click();
}

const nextCell = (page) => page.evaluate(async () => {
  const m = await import('./main.js?v=production-qa-1');
  const st = m.Game.state;
  if (st.gameOver) return { over: true };
  const rect = document.getElementById('scene-canvas').getBoundingClientRect();
  for (let i = 0; i < 81; i++) {
    if (st.given[i] || st.board[i]) continue;
    const pt = m.Game.project(i);
    if (pt.x < rect.left + 2 || pt.x > rect.right - 2 || pt.y < rect.top + 2 || pt.y > rect.bottom - 2) continue;
    return { pt, digit: st.solution[i] };
  }
  return { over: true };
});

async function step(page, mobile) {
  const c = await nextCell(page);
  if (c.over) return page.keyboard.press('r');
  if (mobile) await page.touchscreen.tap(c.pt.x, c.pt.y);
  else await page.mouse.click(c.pt.x, c.pt.y);
  await page.keyboard.press(String(c.digit));
}

export async function start(page, { mobile } = {}) {
  await page.click('.mode-btn[data-mode="practice"]');
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await step(page, mobile); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(300).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}
