// Number Sanctuary — one round of the Sudoku courtyard: the browser build's
// main.js game state and actions, pure (no I/O, no clock of its own) so the
// engine client, the node tests and the play-script generator share it.
// The round clock is `elapsedMs`, advanced by the caller (the engine's fixed
// steps while a round runs unpaused). Actions return the event the client
// answers with sound and colour: 'place' | 'invalid' | 'erase' | 'note' |
// 'hint' | 'solve' | null (nothing happened).
import { generateGrid, makePuzzle } from '../rules.js';

export const SIZE = 9;
export const BOX = 3;
export const MODES = ['learn', 'journey', 'daily', 'practice', 'challenge'];
export const DIFFICULTIES = ['easy', 'medium', 'hard'];

export function boxIndex(r, c) { return Math.floor(r / BOX) * BOX + Math.floor(c / BOX); }

/** Learn & Practice easy, Journey medium, Daily & Challenge hard (setActiveMode). */
export function difficultyFor(mode) {
  if (mode === 'learn' || mode === 'practice') return 'easy';
  if (mode === 'journey') return 'medium';
  return 'hard';
}

/** Daily rounds: the same grid for everyone on a UTC day (YYYYMMDD as the seed). */
export function dailySeed(ms) {
  const d = new Date(ms);
  return (d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()) >>> 0;
}

/** The browser build's rules stream (mulberry32 over a running seed): fresh seeds for non-daily rounds. */
export function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    let s = (state + 1) | 0;
    state = (s + 0x6D2B79F5) | 0;
    s = state;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** nextSeed(): the UTC date for Daily, else a fresh seed from the rules stream. */
export function nextSeed(mode, rand, nowMs) {
  if (mode === 'daily') return dailySeed(nowMs);
  return (Math.floor(rand() * 0xFFFFFFFF) ^ (mode.length * 7919)) >>> 0;
}

/** A new round of `mode` on `seed`: easy removes 40 cells, medium 50, hard 56, each keeping one solution. */
export function newRound(mode, seed) {
  const difficulty = difficultyFor(mode);
  const puzzleSeed = seed >>> 0;
  const grid = generateGrid(puzzleSeed);
  const target = difficulty === 'easy' ? 40 : difficulty === 'medium' ? 50 : 56;
  const board = makePuzzle(grid, puzzleSeed, target).puzzle;
  return {
    mode, difficulty, puzzleSeed, grid, board, given: board.map((v) => v !== 0),
    notes: new Set(), selected: -1, mistakes: 0, moves: 0, hints: 0,
    elapsedMs: 0, gameOver: false, completedElapsed: null,
  };
}

export function diffWeight(r) { return r.difficulty === 'easy' ? 10 : r.difficulty === 'medium' ? 20 : 30; }

export function elapsedSeconds(r) {
  if (r.gameOver && r.completedElapsed !== null) return r.completedElapsed;
  return Math.max(0, Math.floor(r.elapsedMs / 1000));
}

/** Integer score parts (scoreParts): placements, penalties, and on a solve the solve and time bonuses. */
export function scoreParts(r) {
  const placed = diffWeight(r) * r.moves;
  const mistakePenalty = -5 * r.mistakes;
  const hintPenalty = -25 * r.hints;
  let solveBonus = 0, timeBonus = 0;
  if (r.gameOver) {
    solveBonus = 100 * diffWeight(r) / 10;
    timeBonus = Math.max(0, 600 - elapsedSeconds(r));
  }
  return { placed, mistakePenalty, hintPenalty, solveBonus, timeBonus, total: placed + mistakePenalty + hintPenalty + solveBonus + timeBonus };
}
export function computeScore(r) { return scoreParts(r).total; }

/** The share of the player's own cells holding the right digit (0..1). */
export function computeProgress(r) {
  let open = 0, correct = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (r.given[i]) continue;
    open++;
    if (r.board[i] && r.board[i] === r.grid[i]) correct++;
  }
  return open ? correct / open : 1;
}

export function filledCount(r) {
  let n = 0;
  for (let i = 0; i < SIZE * SIZE; i++) if (r.board[i]) n++;
  return n;
}

/** How many of digit d are on the board (the pad greys a digit placed nine times). */
export function digitCount(r, d) {
  let n = 0;
  for (let i = 0; i < SIZE * SIZE; i++) if (r.board[i] === d) n++;
  return n;
}

/** A digit may go in a cell when no other cell of its row, column or box holds it. */
export function isLegal(r, cell, digit) {
  if (!digit) return false;
  const b = r.board;
  const row = Math.floor(cell / SIZE), col = cell % SIZE, bx = boxIndex(row, col);
  for (let i = 0; i < SIZE; i++) {
    if (b[row * SIZE + i] === digit && row * SIZE + i !== cell) return false;
    if (b[i * SIZE + col] === digit && i * SIZE + col !== cell) return false;
  }
  const br = Math.floor(bx / BOX), bc = bx % BOX;
  for (let i = 0; i < BOX; i++) {
    for (let j = 0; j < BOX; j++) {
      const p = (br * BOX + i) * SIZE + bc * BOX + j;
      if (p !== cell && b[p] === digit) return false;
    }
  }
  return true;
}

export function isSolved(r) {
  const b = r.board;
  for (let i = 0; i < SIZE * SIZE; i++) if (!b[i]) return false;
  const unit = (cells) => {
    const seen = new Array(SIZE + 1).fill(false);
    for (const p of cells) { if (seen[b[p]]) return false; seen[b[p]] = true; }
    return true;
  };
  for (let k = 0; k < SIZE; k++) {
    const row = [], col = [], box = [];
    const br = Math.floor(k / BOX), bc = k % BOX;
    for (let i = 0; i < SIZE; i++) {
      row.push(k * SIZE + i);
      col.push(i * SIZE + k);
      box.push((br * BOX + Math.floor(i / BOX)) * SIZE + bc * BOX + (i % BOX));
    }
    if (!unit(row) || !unit(col) || !unit(box)) return false;
  }
  return true;
}

function applyDigit(r, cell, digit) {
  if (!r.board[cell]) r.moves++;
  r.board[cell] = digit;
  r.notes.delete(cell);
}

function finish(r) {
  if (r.completedElapsed === null) r.completedElapsed = elapsedSeconds(r);
  r.gameOver = true;
  r.selected = -1;
  return 'solve';
}

/** Selects a cell (-1: none). */
export function select(r, idx) {
  if (r.gameOver) return null;
  r.selected = idx;
  return 'select';
}

/** Arrow keys: one cell, clamped; from no selection, the centre (index 40). */
export function moveSelection(r, dr, dc) {
  if (r.gameOver) return null;
  if (r.selected === -1) return select(r, 40);
  const row = Math.min(SIZE - 1, Math.max(0, Math.floor(r.selected / SIZE) + dr));
  const col = Math.min(SIZE - 1, Math.max(0, (r.selected % SIZE) + dc));
  return select(r, row * SIZE + col);
}

/** enterDigit: a clue refuses (no mistake); the cell's own digit erases; an illegal digit is a mistake. */
export function enterDigit(r, d) {
  if (r.gameOver || r.selected === -1) return null;
  const s = r.selected;
  if (r.given[s]) return 'invalid';
  if (r.board[s] === d) return eraseCell(r);
  if (!isLegal(r, s, d)) { r.mistakes++; return 'mistake'; }
  applyDigit(r, s, d);
  return isSolved(r) ? finish(r) : 'place';
}

/** Erases the selected player cell (digit and mark); 'erase' when there was something, else 'none'. */
export function eraseCell(r) {
  if (r.gameOver || r.selected === -1 || r.given[r.selected]) return null;
  const s = r.selected;
  const had = !!r.board[s] || r.notes.has(s);
  if (r.board[s]) { r.board[s] = 0; r.moves = Math.max(0, r.moves - 1); }
  r.notes.delete(s);
  return had ? 'erase' : 'none';
}

/** Toggles the pencil mark on the selected empty cell. */
export function toggleNote(r) {
  if (r.gameOver || r.selected === -1 || r.board[r.selected]) return null;
  if (r.notes.has(r.selected)) r.notes.delete(r.selected); else r.notes.add(r.selected);
  return 'note';
}

/** Fills the selected cell when it is open or wrong, else the first such cell, and selects it. */
export function hint(r) {
  if (r.gameOver) return null;
  let target = (r.selected !== -1 && !r.given[r.selected] && r.board[r.selected] !== r.grid[r.selected]) ? r.selected : -1;
  if (target === -1) {
    for (let i = 0; i < SIZE * SIZE; i++) if (!r.given[i] && r.board[i] !== r.grid[i]) { target = i; break; }
  }
  if (target === -1) return null;
  r.hints++;
  applyDigit(r, target, r.grid[target]);
  r.selected = target;
  return isSolved(r) ? finish(r) : 'hint';
}

/** clearBoard: the same puzzle with every player digit and mark removed, counters and clock reset. */
export function clearBoard(r) {
  for (let i = 0; i < SIZE * SIZE; i++) if (!r.given[i]) r.board[i] = 0;
  r.notes.clear();
  r.moves = 0; r.mistakes = 0; r.hints = 0;
  r.selected = -1; r.gameOver = false; r.completedElapsed = null;
  r.elapsedMs = 0;
  return 'clear';
}

// ---------------------------------------------------------------------------------------------------
// The save document (buildDoc / restoreRound / platform.mergeSaveDocs): { best, round }.

/** The round as the browser build saved it. */
export function roundDoc(r) {
  return {
    mode: r.mode, difficulty: r.difficulty, puzzleSeed: r.puzzleSeed, moves: r.moves, mistakes: r.mistakes, hints: r.hints,
    gameOver: r.gameOver, board: r.board.slice(), given: r.given.slice(), notes: Array.from(r.notes), elapsed: elapsedSeconds(r),
  };
}

/** A saved round rebuilt from its seed with the player's digits re-applied, or null when it does not validate. */
export function restoreRound(d) {
  if (!d || typeof d !== 'object' || !MODES.includes(d.mode) || !DIFFICULTIES.includes(d.difficulty)) return null;
  if (!Array.isArray(d.board) || d.board.length !== SIZE * SIZE) return null;
  if (!Array.isArray(d.given) || d.given.length !== SIZE * SIZE) return null;
  if (!Number.isFinite(d.puzzleSeed)) return null;
  const r = newRound(d.mode, d.puzzleSeed >>> 0);
  // the browser build kept the saved difficulty (rounds always matched their mode's)
  r.difficulty = d.difficulty;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (r.given[i]) continue;
    const v = d.board[i];
    r.board[i] = (Number.isInteger(v) && v >= 1 && v <= SIZE) ? v : 0;
  }
  r.notes = new Set((Array.isArray(d.notes) ? d.notes : []).filter((i) => Number.isInteger(i) && i >= 0 && i < SIZE * SIZE && !r.given[i]));
  r.moves = Math.max(0, d.moves | 0);
  r.mistakes = Math.max(0, d.mistakes | 0);
  r.hints = Math.max(0, d.hints | 0);
  r.elapsedMs = Math.max(0, d.elapsed | 0) * 1000;
  r.gameOver = !!d.gameOver && isSolved(r);
  r.completedElapsed = r.gameOver ? Math.max(0, d.elapsed | 0) : null;
  return r;
}

function filled(r) { return Array.isArray(r.board) ? r.board.filter(Boolean).length : 0; }

/** Bests keep the higher per difficulty; the same puzzle's further-along round wins (finished first, then more
 * filled cells, ties local); different puzzles keep the local round; a missing round comes from the other side. */
export function mergeSaveDocs(local, remote) {
  const l = local && typeof local === 'object' ? local : {};
  const r = remote && typeof remote === 'object' ? remote : {};
  const best = {};
  for (const src of [r.best, l.best]) {
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (DIFFICULTIES.includes(k) && typeof v === 'number' && Number.isFinite(v) && !(best[k] >= v)) best[k] = v;
    }
  }
  let round = l.round || r.round || null;
  if (l.round && r.round && l.round.mode === r.round.mode && l.round.difficulty === r.round.difficulty
    && l.round.puzzleSeed === r.round.puzzleSeed) {
    const lr = l.round, rr = r.round;
    if (!!rr.gameOver !== !!lr.gameOver) round = rr.gameOver ? rr : lr;
    else round = filled(rr) > filled(lr) ? rr : lr;
  }
  return { best, round };
}

/** A save document normalised: bests (finite numbers) and a round that restores, else null. */
export function normalizeDoc(doc) {
  const merged = mergeSaveDocs(doc, null);
  return { best: merged.best, round: merged.round && restoreRound(merged.round) ? merged.round : null };
}

/** The browser build's cloud document (the JS SDK's save.json text: JSON { best, round }), or null. */
export function readForeign(text) {
  let doc;
  try { doc = typeof text === 'string' ? JSON.parse(text) : null; } catch { return null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  return normalizeDoc(doc);
}
