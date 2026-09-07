'use strict';

// Number Sanctuary — pure deterministic rules engine (Sudoku 9x9).
// No I/O, no globals. Exported via module.exports at the bottom.

const SIZE = 9;
const BOX = 3;

function boxIndex(r, c) { return Math.floor(r / BOX) * BOX + Math.floor(c / BOX); }

function validPuzzle(puzzle) {
  if (!Array.isArray(puzzle) || puzzle.length !== SIZE * SIZE) return false;
  const rows = Array.from({ length: SIZE }, () => new Set());
  const cols = Array.from({ length: SIZE }, () => new Set());
  const boxes = Array.from({ length: SIZE }, () => new Set());
  for (let i = 0; i < puzzle.length; i++) {
    const v = puzzle[i], r = Math.floor(i / SIZE), c = i % SIZE, b = boxIndex(r, c);
    if (!Number.isInteger(v) || v < 0 || v > SIZE) return false;
    if (!v) continue;
    if (rows[r].has(v) || cols[c].has(v) || boxes[b].has(v)) return false;
    rows[r].add(v); cols[c].add(v); boxes[b].add(v);
  }
  return true;
}

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
    // box cells:
    const br = Math.floor(b / BOX), bc = b % BOX;
    for (let i = 0; i < BOX; i++)
      for (let j = 0; j < BOX; j++)
        used[g[(br * BOX + i) * SIZE + bc * BOX + j]] = true;
    // shuffle candidates for variety
    const cands = [];
    for (let d = 1; d <= SIZE; d++) if (!used[d]) cands.push(d);
    for (let i = cands.length - 1; i > 0; i--) {
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
export function countSolutions(puzzle, limit = 2) {
  if (!validPuzzle(puzzle)) return 0;
  const g = puzzle.slice();
  let count = 0;
  // digit indices run 1..SIZE, so these need SIZE + 1 slots
  const usedRow = new Array(SIZE).fill(0).map(() => new Array(SIZE + 1).fill(false));
  const usedCol = new Array(SIZE).fill(0).map(() => new Array(SIZE + 1).fill(false));
  const usedBox = new Array(SIZE).fill(0).map(() => new Array(SIZE + 1).fill(false));
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
 * Build a puzzle from `grid` by removing up to `target` cells, keeping the
 * puzzle uniquely solvable at every step. Returns {puzzle, removed}.
 */
export function makePuzzle(grid, seed, target) {
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
  const want = Number.isInteger(target) ? target : SIZE * SIZE;
  let removed = 0;
  for (const pos of order) {
    if (removed >= want) break;
    if (!p[pos]) continue;
    const kept = p[pos];
    p[pos] = 0;
    if (countSolutions(p, 2) === 1) removed++;
    else p[pos] = kept;
  }
  return { puzzle: p, removed };
}

/**
 * Solve `puzzle` via backtracking. Returns solution array or null.
 */
export function solve(puzzle) {
  if (!validPuzzle(puzzle)) return null;
  const g = puzzle.slice();

  const fits = (pos, d) => {
    const r = Math.floor(pos / SIZE), c = pos % SIZE, b = boxIndex(r, c);
    for (let i = 0; i < SIZE; i++) {
      if (g[r * SIZE + i] === d || g[i * SIZE + c] === d) return false;
    }
    const br = Math.floor(b / BOX), bc = b % BOX;
    for (let i = 0; i < BOX; i++)
      for (let j = 0; j < BOX; j++)
        if (g[(br * BOX + i) * SIZE + bc * BOX + j] === d) return false;
    return true;
  };

  const rec = (from) => {
    let pos = -1;
    for (let i = from; i < SIZE * SIZE; i++) if (!g[i]) { pos = i; break; }
    if (pos === -1) return true;
    for (let d = 1; d <= SIZE; d++) {
      if (!fits(pos, d)) continue;
      g[pos] = d;
      if (rec(pos + 1)) return true;
      g[pos] = 0;
    }
    return false;
  };

  return rec(0) ? g.slice() : null;
}

export const RULES_VERSION = 1;

const api = { SIZE, BOX, boxIndex, generateGrid, countSolutions, makePuzzle, solve };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
export default api;
