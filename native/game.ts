// Typed facade over the pure round module (src/round.js, shared with the node
// tests and tools/gen-plays.mjs), so the engine client reads it through
// hand-written interfaces instead of allowJs's inference.
import * as R from "../src/round.js";

export type Mode = "learn" | "journey" | "daily" | "practice" | "challenge";
export type Difficulty = "easy" | "medium" | "hard";
/** What an action did (the client answers with sound and colour). */
export type RoundEvent = "select" | "place" | "invalid" | "mistake" | "erase" | "none" | "note" | "hint" | "solve" | "clear" | null;
export interface Round {
  mode: Mode; difficulty: Difficulty; puzzleSeed: number;
  grid: number[]; board: number[]; given: boolean[]; notes: Set<number>;
  selected: number; mistakes: number; moves: number; hints: number;
  elapsedMs: number; gameOver: boolean; completedElapsed: number | null;
}
export interface ScoreParts { placed: number; mistakePenalty: number; hintPenalty: number; solveBonus: number; timeBonus: number; total: number }
export interface Doc { best: Record<string, number>; round: unknown }

interface Api {
  SIZE: number;
  MODES: Mode[];
  makeRng(seed: number): () => number;
  nextSeed(mode: Mode, rand: () => number, nowMs: number): number;
  newRound(mode: Mode, seed: number): Round;
  elapsedSeconds(r: Round): number;
  scoreParts(r: Round): ScoreParts;
  computeScore(r: Round): number;
  computeProgress(r: Round): number;
  filledCount(r: Round): number;
  digitCount(r: Round, d: number): number;
  select(r: Round, idx: number): RoundEvent;
  moveSelection(r: Round, dr: number, dc: number): RoundEvent;
  enterDigit(r: Round, d: number): RoundEvent;
  eraseCell(r: Round): RoundEvent;
  toggleNote(r: Round): RoundEvent;
  hint(r: Round): RoundEvent;
  clearBoard(r: Round): RoundEvent;
  roundDoc(r: Round): unknown;
  restoreRound(d: unknown): Round | null;
  mergeSaveDocs(local: unknown, remote: unknown): Doc;
}
export const Game = R as unknown as Api;
