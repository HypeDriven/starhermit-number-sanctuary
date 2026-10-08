'use strict';

// Number Sanctuary — graphics quality model: presets, per-category overrides,
// GPU detection and a cost summary. Pure (no three.js, no DOM) so the settings
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
export const PARTICLE_COUNT = { off: 0, low: 36, high: 110 };

/** Best preset for this GPU, from the unmasked renderer string when the browser exposes it. */
export function detectPreset(gpu, mobile) {
  const g = String(gpu || '').toLowerCase();
  let p = 'balanced';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(g)) p = 'low';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|amd radeon(?!.*graphics)|apple m\d/.test(g)) p = 'high';
  // Phones and tablets stay at Balanced at most on Auto (battery and heat).
  if (mobile && PRESETS.indexOf(p) > PRESETS.indexOf('balanced')) p = 'balanced';
  return p;
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected) {
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
    r.particles === 'off' ? null : t('gfx.sum.particles', { n: PARTICLE_COUNT[r.particles] }),
    r.antialias === 'off' ? t('gfx.sum.noAA') : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
