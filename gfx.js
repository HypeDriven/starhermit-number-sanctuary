'use strict';

// Number Sanctuary — graphics quality model: presets, per-category overrides,
// StarHermit hardware-level detection, per-preset budgets and a cost summary. Pure (no three.js, no DOM) so the settings
// panel, the renderer and tests/gfx.test.mjs agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  particles: ['off', 'low', 'high'],
  detail: ['plain', 'detailed'],
};

// Each preset is a row of tiers, a render scale (multiplies the device pixel
// ratio) and a device-pixel-ratio cap, so Low never renders more pixels than
// the game did before the upgrade.
const TABLE = {
  low: { scale: 1, maxDpr: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'off', detail: 'plain' },
  balanced: { scale: 1, maxDpr: 1.5, shadows: 'low', ao: 'on', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'low', detail: 'detailed' },
  high: { scale: 1, maxDpr: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { scale: 1.25, maxDpr: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };

// Auto picks the preset from the StarHermit hardware level (0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX
// 5090; gpu-level.js → window.StarHermitGpu, a classic script loaded before the game): Low from 0,
// Balanced from 4, High from 10, Ultra from 17. Phones, tablets and ≤ 4 GB machines are capped at level 9.
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system) {
  const G = gpuApi();
  const sys = { webgl: true, webgl2: true, ...(system || {}), gpu: String(gpu || '') };
  if (!gpu) sys.webgl = false; // no renderer string: no usable WebGL
  return G ? G.detectLevel(sys) : (gpu ? LEVELS.balanced : 0);
}

/** The preset Auto starts from for a hardware level. */
export function presetForLevel(level) {
  const G = gpuApi();
  return G ? G.presetForLevel(level, LEVELS) : PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU (the hardware level already caps phones/tablets at Balanced). */
export function detectPreset(gpu, system) {
  return presetForLevel(detectLevel(gpu, system));
}

/*
 * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it (Low →
 * level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). The grid, digits,
 * colours, hit areas and rules are identical on every preset — only visuals change.
 *   material      tile shading: lambert (Low) / standard satin tiles whose roughness carries the
 *                 clue / player / open finish (Balanced) / physical clear-coated glaze (High, Ultra)
 *   label         digit sprite texture size in px
 *   lanternLights point lights in the far lanterns (Detail on; flames and halos always glow)
 *   fireflies     fireflies at Particles "high" (low: a third), scaled with the level
 *   bloomRes      bloom resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', label: 128, lanternLights: 0, fireflies: 50, bloomRes: 0.5 },
  balanced: { material: 'standard', label: 128, lanternLights: 0, fireflies: 80, bloomRes: 0.5 },
  high: { material: 'physical', label: 128, lanternLights: 2, fireflies: 110, bloomRes: 0.5 },
  ultra: { material: 'physical', label: 256, lanternLights: 2, fireflies: 160, bloomRes: 1 },
};
export const FIREFLY_MAX = 320;
const PARTICLE_SHARE = { off: 0, low: 1 / 3, high: 1 };

/** A preset's concrete budget for a hardware level (the firefly count scales ≤ 2× within the preset). */
export function budgetFor(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] || 0;
  const lv = Math.max(Number.isFinite(level) ? level : floor, floor);
  const k = G ? Math.min(2, G.scaleBudget(1, lv, floor)) : 1;
  b.fireflies = Math.min(FIREFLY_MAX, Math.round(b.fireflies * k));
  return b;
}

/** Fireflies drawn for a resolved setting (Particles tier share of the preset's budget). */
export function fireflyCount(r) {
  return Math.round(r.budget.fireflies * (PARTICLE_SHARE[r.particles] ?? 0));
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const out = {
    preset, auto,
    renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
    maxDpr: row.maxDpr,
  };
  out.scale = row.scale * out.renderScale;
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budgetFor(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // Post-processing runs only when something needs it; otherwise the canvas MSAA is used.
  // (Ambient occlusion is baked into the static board, so it needs no pass.)
  out.post = out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Saved settings after choosing a preset: overrides are cleared, scale/toggles kept. */
export function choosePreset(saved, preset) {
  const s = saved || {};
  const out = { preset: PRESETS.includes(preset) ? preset : 'auto' };
  for (const k of ['render_scale', 'adaptive', 'show_fps']) if (k in s) out[k] = s[k];
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset] ? TABLE[preset][cat] : undefined;
}

const EN = {
  'gfx.sum.noShadows': 'no shadows',
  'gfx.sum.shadows': '{size}² shadows',
  'gfx.sum.ao': 'ambient occlusion',
  'gfx.sum.aoHigh': 'full ambient occlusion',
  'gfx.sum.bloom': 'bloom',
  'gfx.sum.reflections': 'reflections',
  'gfx.sum.particles': '{n} fireflies',
  'gfx.sum.noAA': 'no anti-aliasing',
};
function enT(key, vars) {
  return EN[key].replace(/\{(\w+)\}/g, (m, n) => String(vars && vars[n] !== undefined ? vars[n] : m));
}

/** Cost summary, e.g. "2048² shadows · ambient occlusion · bloom · SMAA · 1280×800 px". */
export function describe(r, pixels, tr) {
  const t = tr || enT;
  const parts = [
    r.shadows === 'off' ? t('gfx.sum.noShadows') : t('gfx.sum.shadows', { size: SHADOW_MAP[r.shadows] }),
    r.ao === 'off' ? null : r.ao === 'high' ? t('gfx.sum.aoHigh') : t('gfx.sum.ao'),
    r.bloom === 'on' ? t('gfx.sum.bloom') : null,
    r.reflections === 'on' ? t('gfx.sum.reflections') : null,
    r.particles === 'off' ? null : t('gfx.sum.particles', { n: r.budget ? fireflyCount(r) : 0 }),
    r.antialias === 'off' ? t('gfx.sum.noAA') : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
