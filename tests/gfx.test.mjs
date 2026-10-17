// Unit tests for the pure graphics quality model (gfx.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// gpu-level.js is a classic script in the page (window.StarHermitGpu); evaluate it the same way here.
new Function('window', 'module', readFileSync(new URL('../gpu-level.js', import.meta.url), 'utf8'))(globalThis, undefined);
const { detectPreset, detectLevel, presetForLevel, budgetFor, fireflyCount, resolve, presetTier, describe, choosePreset, PRESETS, CATEGORIES, LEVELS, BUDGETS, FIREFLY_MAX } = await import('../gfx.js');

const DESK = { cores: 8, memoryGb: 8 };
const PHONE = { mobile: true, cores: 8, memoryGb: 8 };

test('hardware level picks the Auto preset (Low 0, Balanced 4, High 10, Ultra 17)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', DESK), 'low');
  assert.equal(detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', DESK), 0);
  assert.equal(detectPreset('', DESK), 'low', 'no WebGL');
  assert.equal(detectPreset(undefined, DESK), 'low');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', DESK), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', DESK), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', DESK), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  assert.equal(detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 20);
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', DESK), 'ultra');
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(3), 'low');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most; software GPUs stay Low', () => {
  assert.equal(detectPreset('Adreno (TM) 740', PHONE), 'balanced');
  assert.ok(detectLevel('Adreno (TM) 740', PHONE) <= 9);
  assert.equal(detectPreset('Apple M2', PHONE), 'balanced');
  assert.equal(detectPreset('SwiftShader', PHONE), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'label', 'lanternLights', 'fireflies', 'bloomRes'];
  for (const p of PRESETS) for (const k of keys) assert.ok(BUDGETS[p][k] != null, `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) for (const k of keys) {
    if (typeof BUDGETS.low[k] === 'number') assert.ok(BUDGETS[PRESETS[i]][k] >= BUDGETS[PRESETS[i - 1]][k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].bloomRes), [0.5, 0.5, 0.5, 1], 'half-res bloom below Ultra');
  assert.deepEqual(resolve({ preset: 'high' }, 'low', 10).budget, BUDGETS.high, 'floor level = the tuned budget');
  assert.deepEqual(resolve({ preset: 'ultra' }, 'low', 0).budget, resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(budgetFor('balanced', 9).fireflies > budgetFor('balanced', 4).fireflies, 'counts scale up within the preset');
  assert.ok(budgetFor('ultra', 20).fireflies <= FIREFLY_MAX);
  assert.equal(fireflyCount(resolve({ preset: 'high' }, 'low', 10)), BUDGETS.high.fireflies);
  assert.equal(fireflyCount(resolve({ preset: 'low' }, 'low', 0)), 0, 'Low: no fireflies');
  assert.equal(resolve({}, 'low', 0).budget.material, 'lambert', 'headless SwiftShader: Low, Lambert');
});

test('resolve: auto uses the detected preset and its tiers', () => {
  const r = resolve({}, 'low');
  assert.equal(r.auto, true);
  assert.equal(r.preset, 'low');
  assert.equal(r.shadows, 'off');
  assert.equal(r.bloom, 'off');
  assert.equal(r.post, false, 'Low renders without a post chain');
  assert.equal(r.adaptive, true);
  assert.equal(r.showFps, false);
  for (const cat of Object.keys(CATEGORIES)) assert.equal(r[cat], presetTier('low', cat));
});

test('resolve: explicit preset, overrides and invalid values', () => {
  const r = resolve({ preset: 'high', bloom: 'off', shadows: 'bogus', particles: 'low' }, 'low');
  assert.equal(r.auto, false);
  assert.equal(r.preset, 'high');
  assert.equal(r.bloom, 'off');
  assert.equal(r.shadows, presetTier('high', 'shadows'));
  assert.equal(r.particles, 'low');
  assert.equal(resolve({ preset: 'nope' }, 'balanced').preset, 'balanced');
  for (const p of PRESETS) assert.ok(resolve({ preset: p }).post || p === 'low');
});

test('resolve: render scale is clamped to 50–200%', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).renderScale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).renderScale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }).renderScale, 1);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
});

test('choosing a preset clears overrides but keeps scale and toggles', () => {
  const next = choosePreset({ preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'low');
  assert.deepEqual(next, { preset: 'low', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(choosePreset({ bloom: 'on' }, 'auto').preset, 'auto');
  const r = resolve(next, 'high');
  for (const cat of Object.keys(CATEGORIES)) assert.equal(r[cat], presetTier('low', cat));
});

test('describe summarises cost and pixels', () => {
  const s = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(s, /2048² shadows/);
  assert.match(s, /bloom/);
  assert.match(s, /SMAA/);
  assert.match(s, /1280×800 px$/);
  assert.match(describe(resolve({ preset: 'low', antialias: 'off' })), /no shadows.*no anti-aliasing/);
});
