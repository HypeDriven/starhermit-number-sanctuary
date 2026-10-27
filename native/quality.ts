// The look per graphics level: the browser build's four presets and budgets
// (gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU its
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the fireflies scaled within the tier by the level (frame().levelIndex), as
// the browser build scaled them by its hardware level (at most 2×). The
// runtime owns the rest of what the old Settings › Graphics section did: Auto
// and the level choice, render scale and the pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout, the GPU summary. The old
// section's per-category overrides are not offered (the runtime's Options
// choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export interface Budget {
  /** Tile shading: Lambert (Low), Standard satin (Balanced), Physical clear-coated glaze (High, Ultra). */
  material: "lambert" | "standard" | "physical";
  /** Digit sprite texture size in px. */
  label: number;
  /** Point lights in the far lanterns (detailed looks; flames and halos always glow). */
  lanternLights: number;
  /** Fireflies at Particles "high" (low: a third). */
  fireflies: number;
  bloomRes: number;
}
export interface Look {
  preset: QualityTier;
  shadows: 0 | 1024 | 2048 | 4096;
  /** Baked contact occlusion: the grout/rim overlay ("on"), plus darker tile bases ("high"). */
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "off" | "low" | "high";
  /** Rounded glazed tiles on the limestone plinth with the corner lanterns. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<QualityTier, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particles: "off", detailed: false },
  balanced: { shadows: 1024, ao: "on", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "low", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", label: 128, lanternLights: 0, fireflies: 50, bloomRes: 0.5 },
  balanced: { material: "standard", label: 128, lanternLights: 0, fireflies: 80, bloomRes: 0.5 },
  high: { material: "physical", label: 128, lanternLights: 2, fireflies: 110, bloomRes: 0.5 },
  ultra: { material: "physical", label: 256, lanternLights: 2, fireflies: 160, bloomRes: 1 },
};
export const FIREFLY_MAX = 320;
const PARTICLE_SHARE = { off: 0, low: 1 / 3, high: 1 };
/** The first level index of each tier. */
const TIER_FLOOR: Record<QualityTier, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 … 9). */
export function lookFor(preset: QualityTier, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: the fireflies grow with the level above the tier's first,
  // at most 2× (gfx.js budgetFor).
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.fireflies = Math.min(FIREFLY_MAX, Math.round(b.fireflies * k));
  return { preset, ...TABLE[preset], budget: b };
}
/** Fireflies drawn for a look (gfx.js fireflyCount). */
export function fireflyCount(l: Look): number { return Math.round(l.budget.fireflies * PARTICLE_SHARE[l.particles]); }
