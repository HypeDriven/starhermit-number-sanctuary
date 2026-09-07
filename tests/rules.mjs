import assert from 'node:assert/strict';
import { generateGrid, makePuzzle, countSolutions, solve } from '../rules.js';
for (const seed of [1, 7, 42, 20260907, 4294967295]) {
  const full = generateGrid(seed);
  assert.equal(countSolutions(full, 2), 1);
  assert.deepEqual(generateGrid(seed), full);
  for (const holes of [40, 50, 56]) {
    const { puzzle, removed } = makePuzzle(full, seed, holes);
    assert.equal(removed, puzzle.filter(v => v === 0).length);
    assert.ok(removed > 0 && removed <= holes);
    assert.equal(countSolutions(puzzle, 2), 1);
    assert.deepEqual(solve(puzzle), full);
  }
}
const invalid = generateGrid(1);
invalid[1] = invalid[0];
for (const puzzle of [invalid, [], Array(81).fill(10)]) {
  assert.equal(countSolutions(puzzle, 2), 0);
  assert.equal(solve(puzzle), null);
}
console.log('PASS: deterministic puzzles, uniqueness, solving, and invalid givens');
