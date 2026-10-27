// The round (src/round.js, the browser build's main.js rules contract): modes
// and difficulty, the Daily's UTC-date seed, legal entries and refusals,
// marks, hints, clearing, the score breakdown and the solve, and the save
// document (restore, merge, the browser build's cloud save as foreign text).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/round.js';

const openCells = (r) => r.board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);

test('modes set the difficulty and clue count; rounds are unique-solution puzzles', () => {
  for (const [mode, diff, holes] of [['learn', 'easy', 40], ['practice', 'easy', 40], ['journey', 'medium', 50], ['daily', 'hard', 56], ['challenge', 'hard', 56]]) {
    const r = R.newRound(mode, 1234);
    assert.equal(r.difficulty, diff);
    assert.ok(openCells(r).length <= holes && openCells(r).length > holes - 12, `${mode} ${openCells(r).length}`);
    for (let i = 0; i < 81; i++) if (r.given[i]) assert.equal(r.board[i], r.grid[i]);
  }
});

test('daily seed is the UTC date; other modes draw fresh seeds', () => {
  const ms = Date.UTC(2026, 9, 27, 23, 59);
  assert.equal(R.nextSeed('daily', () => 0.5, ms), 20261027);
  const rand = R.makeRng(42);
  const a = R.nextSeed('practice', rand, ms), b = R.nextSeed('practice', rand, ms);
  assert.notEqual(a, b);
});

test('entries: clue refused, illegal digit is a mistake, same digit erases, solving ends the round', () => {
  const r = R.newRound('learn', 77);
  assert.equal(R.enterDigit(r, 5), null); // nothing selected
  const clue = r.given.indexOf(true);
  R.select(r, clue);
  assert.equal(R.enterDigit(r, 1), 'invalid');
  assert.equal(r.mistakes, 0);
  const cell = openCells(r)[0];
  R.select(r, cell);
  const wrong = [1, 2, 3, 4, 5, 6, 7, 8, 9].find((d) => !R.isLegal(r, cell, d));
  assert.equal(R.enterDigit(r, wrong), 'mistake');
  assert.equal(r.mistakes, 1);
  assert.equal(R.enterDigit(r, r.grid[cell]), 'place');
  assert.equal(r.moves, 1);
  assert.equal(R.enterDigit(r, r.grid[cell]), 'erase');
  assert.equal(r.moves, 0);
  assert.equal(R.toggleNote(r), 'note');
  assert.ok(r.notes.has(cell));
  for (const i of openCells(r)) { R.select(r, i); R.enterDigit(r, r.grid[i]); }
  assert.equal(r.gameOver, true);
  assert.equal(r.selected, -1);
  r.elapsedMs = 95000;
  const p = R.scoreParts(r);
  assert.equal(p.placed, 10 * r.moves);
  assert.equal(p.mistakePenalty, -5);
  assert.equal(p.solveBonus, 100);
  assert.equal(p.timeBonus, 600); // the clock froze at the solve (0 s here)
  assert.equal(R.computeProgress(r), 1);
});

test('hints fill the selected or first open cell and cost 25; clear resets the counters', () => {
  const r = R.newRound('journey', 9);
  const first = openCells(r)[0];
  assert.equal(R.hint(r), 'hint');
  assert.equal(r.selected, first);
  assert.equal(r.board[first], r.grid[first]);
  assert.equal(R.scoreParts(r).total, 20 - 25);
  assert.equal(R.moveSelection(r, 0, 1), 'select');
  r.elapsedMs = 5000;
  assert.equal(R.clearBoard(r), 'clear');
  assert.equal(r.board[first], 0);
  assert.equal(r.hints + r.moves + r.mistakes + r.elapsedMs, 0);
  assert.equal(r.selected, -1);
  assert.equal(R.moveSelection(r, 1, 1), 'select');
  assert.equal(r.selected, 40); // from no selection: the centre
  let ev;
  while ((ev = R.hint(r)) === 'hint');
  assert.equal(ev, 'solve');
});

test('a saved round restores from its seed with the player digits; solved rounds keep their time', () => {
  const r = R.newRound('challenge', 4242);
  const cell = openCells(r)[0];
  R.select(r, cell); R.enterDigit(r, r.grid[cell]); R.toggleNote(r);
  R.select(r, openCells(r)[1]); R.toggleNote(r);
  r.elapsedMs = 61500;
  const doc = JSON.parse(JSON.stringify(R.roundDoc(r)));
  assert.equal(doc.elapsed, 61);
  const back = R.restoreRound(doc);
  assert.deepEqual(back.board, r.board);
  assert.deepEqual([...back.notes], [...r.notes]);
  assert.equal(back.elapsedMs, 61000);
  assert.equal(R.restoreRound({ ...doc, mode: 'nope' }), null);
  assert.equal(R.restoreRound({ ...doc, board: [] }), null);
  // a claimed solve that is not one restores unsolved
  assert.equal(R.restoreRound({ ...doc, gameOver: true }).gameOver, false);
});

test('mergeSaveDocs: best per difficulty keeps the higher score; rounds by progress', () => {
  const round = (seed, filled, gameOver = false) => ({ mode: 'practice', difficulty: 'easy', puzzleSeed: seed,
    board: Array.from({ length: 81 }, (_, i) => (i < filled ? 1 : 0)), gameOver });
  const a = { best: { easy: 300, hard: 50 }, round: round(1, 20) };
  const b = { best: { easy: 200, medium: 90 }, round: round(1, 30) };
  assert.deepEqual(R.mergeSaveDocs(a, b).best, { easy: 300, hard: 50, medium: 90 });
  assert.equal(R.mergeSaveDocs(a, b).round, b.round);
  assert.equal(R.mergeSaveDocs(b, a).round, b.round);
  assert.equal(R.mergeSaveDocs(a, { round: round(1, 5, true) }).round.gameOver, true);
  assert.equal(R.mergeSaveDocs(a, { round: round(2, 60) }).round, a.round);
  assert.equal(R.mergeSaveDocs({ best: {} }, b).round, b.round);
  assert.deepEqual(R.mergeSaveDocs(null, null), { best: {}, round: null });
});

test('the browser build\'s cloud save (JS SDK save.json text) reads as a document', () => {
  const r = R.newRound('daily', 20261027);
  const text = JSON.stringify({ best: { hard: 812, easy: 'x' }, round: R.roundDoc(r) });
  const doc = R.readForeign(text);
  assert.deepEqual(doc.best, { hard: 812 });
  assert.equal(doc.round.puzzleSeed, 20261027);
  assert.deepEqual(R.readForeign(JSON.stringify({ best: {}, round: { mode: 'x' } })), { best: {}, round: null });
  assert.equal(R.readForeign('not json'), null);
  assert.equal(R.readForeign(null), null);
});
