'use strict';

// Number Sanctuary — pure deterministic rules engine (Sudoku 9x9).
// No I/O, no globals. Exported via module.exports at the bottom.

const SIZE = 9;
const BOX = 3;

function boxIndex(r, c) { return Math.floor(r / BOX) * BOX + Math.floor(c / BOX); }

/**
 * Generate a full valid Sudoku grid using a seeded PRNG (mulberry32).
 */
export function generateGrid(seed) {
  const g = new Array(SIZE * SIZE).fill(0);
  let s = seed >>> 0;
  const rnd = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const place = (pos) => {
    if (pos === SIZE * SIZE) return true;
    const r = Math.floor(pos / SIZE), c = pos % SIZE, b = boxIndex(r, c);
    const used = new Array(10).fill(false);
    for (let i = 0; i < SIZE; i++) {
      used[g[r * SIZE + i]] = true;
      used[g[i * SIZE + c]] = true;
    }
    for (let i = 0; i < BOX; i++)
      for (let j = 0; j < BOX; j++)
        used[g[(b - Math.floor(b / BOX) * BOX + i) * SIZE + (Math.floor(b / BOX) * BOX + j)] ] !== undefined && null; // noop guard
    // box cells:
    const br = Math.floor(b / BOX), bc = b % BOX;
    for (let i = 0; i < BOX; i++)
      for (let j = 0; j < BOX; j++)
        used[g[(br * BOX + i) * SIZE + bc * BOX + j]] = true;
    // shuffle candidates for variety
    const cands = [];
    for (let d = 1; d <= SIZE; d++) if (!used[d]) cands.push(d);
    const k = Math.floor(rnd() * cands.length);
    for (let i = 0; i < cands.length - 1; i++) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
    }
    for (const d of cands) {
      g[pos] = d;
      if (place(pos + 1)) return true;
    }
    g[pos] = 0;
    return false;
  };

  place(0);
  return g;
}

/**
 * Count solutions up to `limit` using backtracking.
 */
export function countSolutions(puzzle, limit) {
  const g = puzzle.slice();
  let count = 0;
  const usedRow = new Array(SIZE).fill(0).map(() => new Array(SIZE).fill(false));
  const usedCol = new Array(SIZE).fill(0).map(() => new Array(SIZE).fill(false));
  const usedBox = new Array(SIZE).fill(0).map(() => new Array(SIZE).fill(false));
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const v = g[r * SIZE + c];
      if (v) { usedRow[r][v] = true; usedCol[c][v] = true; usedBox[boxIndex(r, c)][v] = true; }
    }

  const rec = () => {
    let best = -1, bestN = 10, br2 = 0, bc2 = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!g[r * SIZE + c]) {
          let n = 0;
          for (let d = 1; d <= SIZE; d++)
            if (!usedRow[r][d] && !usedCol[c][d] && !usedBox[boxIndex(r, c)][d]) n++;
          if (n < bestN) { bestN = n; best = r * SIZE + c; br2 = r; bc2 = c; if (n === 1) break; }
        }
      }
      if (bestN === 1) break;
    }
    if (best === -1) { count++; return; }
    const r = br2, c = bc2;
    for (let d = 1; d <= SIZE; d++) {
      if (!usedRow[r][d] && !usedCol[c][d] && !usedBox[boxIndex(r, c)][d]) {
        g[best] = d; usedRow[r][d] = true; usedCol[c][d] = true; usedBox[boxIndex(r, c)][d] = true;
        rec();
        if (count >= limit) return;
        usedRow[r][d] = false; usedCol[c][d] = false; usedBox[boxIndex(r, c)][d] = false;
      }
    }
    g[best] = 0;
  };

  rec();
  return count;
}

/**
 * Build a puzzle from `grid` by removing cells. Returns {puzzle, removed}.
 */
export function makePuzzle(grid, seed) {
  const p = grid.slice();
  let s = (seed ^ 0x9E3779B9) >>> 0;
  const rnd = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = new Array(SIZE * SIZE);
  for (let i = 0; i < order.length; i++) order[i] = i;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  let removed = 0;
  for (const pos of order) {
    if (p[pos]) { p[pos] = 0; removed++; }
  }
  return { puzzle: p, removed };
}

/**
 * Solve `puzzle` via backtracking. Returns solution array or null.
 */
export function solve(puzzle) {
  const g = puzzle.slice();
  for (let start = 0; start <= SIZE * SIZE; start++) {
    let pos = -1;
    outer:
    for (let i = start; i < SIZE * SIZE; i++) if (!g[i]) { pos = i; break; }
    if (pos === -1) {
      // check earlier empties only when start>0 handled by loop structure
      let found = false;
      for (let i = 0; i < start; i++) if (!g[i]) { found = true; break; }
      if (!found) return g.slice();
    } else {
      const r = Math.floor(pos / SIZE), c = pos % SIZE, b = boxIndex(r, c);
      for (let d = 1; d <= SIZE; d++) {
        let ok = true;
        for (let i = 0; i < SIZE; i++) { if (g[r * SIZE + i] === d) { ok = false; break; } if (g[i * SIZE + c] === d) { ok = false; break; } }
        if (ok) {
          const br = Math.floor(b / BOX), bc = b % BOX;
          for (let i = 0; i < BOX && ok; i++)
            for (let j = 0; j < BOX; j++)
              if (g[(br * BOX + i) * SIZE + bc * BOX + j] === d) { ok = false; break; }
        }
        if (!ok) continue;
        g[pos] = d;
        let done = true;
        for (let i = pos + 1; i < SIZE * SIZE; i++) if (!g[i]) { done = false; break; }
        if (done) return g.slice();
      }
      g[pos] = 0;
    }
  }
  // fallback: no solution found in loop
  let anyEmpty = false;
  for (let i = 0; i < SIZE * SIZE; i++) if (!g[i]) { anyEmpty = true; break; }
  return anyEmpty ? null : g.slice();
}

export const RULES_VERSION = 1;

const api = { SIZE, BOX, boxIndex, generateGrid, countSolutions, makePuzzle, solve };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
export default api;
