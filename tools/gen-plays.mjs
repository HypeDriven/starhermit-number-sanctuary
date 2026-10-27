// Writes the Daily play script for a UTC day: the Daily's grid is a pure
// function of the date (src/round.js), so the script can solve it through the
// real UI — click each open tile by its accessible name (the board targets),
// then type its digit (or, every seventh cell, click it on the number pad),
// with no mistakes and no hints. tests/native.mjs generates today's into
// .starhermit/daily.play before the render checks (the committed scripts use
// hints, which solve any grid). CLI: node tools/gen-plays.mjs [OUT] [YYYY-MM-DD]
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newRound } from '../src/round.js';

export function dailyPlay(ms) {
  const d = new Date(ms);
  const seed = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const r = newRound('daily', seed);
  const out = [
    `# Desktop: the Daily of ${d.toISOString().slice(0, 10)} (seed ${seed}) solved through the board and the keys/pad, no mistakes.`,
    '# viewport 1280x800@1',
    'until 300 Mistakes 0',
    'frames 120',
    'click =Daily',
    'frames 10',
    'expect Hard',
  ];
  let n = 0;
  for (let i = 0; i < 81; i++) {
    if (r.board[i]) continue;
    const row = Math.floor(i / 9) + 1, col = (i % 9) + 1, digit = r.grid[i];
    out.push(`click =Cell row ${row}, column ${col}: empty`, 'frames 2');
    if (n % 7 === 3) out.push(`click =${digit}`, 'frames 3');
    else out.push(`key Digit${digit} 1`, 'frames 2');
    if (n === 10) out.push(`expect Cell row ${row}, column ${col}: ${digit}`, 'save daily-progress');
    n++;
  }
  out.push('until 60 Sanctuary complete', 'frames 20', 'expect Mistakes (0)', 'expect Hints (0)', 'save daily-results', '');
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || 'daily.play';
  const ms = process.argv[3] ? Date.parse(process.argv[3] + 'T12:00:00Z') : Date.now();
  writeFileSync(out, dailyPlay(ms));
  console.log(`wrote ${out}`);
}
