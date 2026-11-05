// The look per graphics level. The engine's level table owns the engine effects
// (levelSettings(): shadows and their map size, bloom, grade, anti-aliasing); the
// browser build's four presets (gfx.js TABLE / BUDGETS) keep the game-only art,
// keyed by the quality tier: baked contact occlusion (an overlay, not the engine's
// AO), reflections, materials, detail. Fireflies scale with the level's particle
// budget against the tier's anchor level, at most 2×. The runtime owns the rest of
// what the old Settings › Graphics section did: Auto and the level choice, render
// scale and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout, the GPU summary. The old section's per-category overrides are not
// offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
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
}
export interface Look {
  preset: QualityTier;
  /** Key-light shadow map: the level's size (0 = off). */
  shadows: number;
  /** Baked contact occlusion: the grout/rim overlay ("on"), plus darker tile bases ("high"). */
  ao: "off" | "on" | "high";
  /** The level's bloom resolution (null = off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  particles: "off" | "low" | "high";
  /** Rounded glazed tiles on the limestone plinth with the corner lanterns. */
  detailed: boolean;
  budget: Budget;
}

type Art = Pick<Look, "ao" | "reflections" | "particles" | "detailed">;
const ART: Record<QualityTier, Art> = {
  low: { ao: "off", reflections: false, particles: "off", detailed: false },
  balanced: { ao: "on", reflections: true, particles: "low", detailed: true },
  high: { ao: "on", reflections: true, particles: "high", detailed: true },
  ultra: { ao: "high", reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<QualityTier, Budget> = {
  low: { material: "lambert", label: 128, lanternLights: 0, fireflies: 50 },
  balanced: { material: "standard", label: 128, lanternLights: 0, fireflies: 80 },
  high: { material: "physical", label: 128, lanternLights: 2, fireflies: 110 },
  ultra: { material: "physical", label: 256, lanternLights: 2, fireflies: 160 },
};
export const FIREFLY_MAX = 320;
const PARTICLE_SHARE = { off: 0, low: 1 / 3, high: 1 };
/** Each tier's anchor level: its budgets are written for it. */
const ANCHOR: Record<QualityTier, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a level's settings. Plain data: render.applyLook compares it as JSON. */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = BUDGETS[preset];
  // The level's particle budget against the anchor's: more fireflies above the anchor, at most 2× (gfx.js budgetFor).
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: { ...b, fireflies: Math.min(FIREFLY_MAX, Math.round(b.fireflies * k)) },
  };
}
/** Fireflies drawn for a look (gfx.js fireflyCount). */
export function fireflyCount(l: Look): number { return Math.round(l.budget.fireflies * PARTICLE_SHARE[l.particles]); }
