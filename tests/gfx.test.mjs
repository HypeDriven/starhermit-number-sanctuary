// Unit tests for the pure graphics quality model (gfx.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPreset, resolve, presetTier, describe, choosePreset, PRESETS, CATEGORIES } from '../gfx.js';

test('detectPreset maps GPU strings to tiers', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('Apple M2'), 'high');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.equal(detectPreset(''), 'balanced');
  assert.equal(detectPreset(undefined), 'balanced');
});

test('mobile devices cap Auto at balanced', () => {
  assert.equal(detectPreset('Apple M2', true), 'balanced');
  assert.equal(detectPreset('Adreno (TM) 740', true), 'balanced');
  assert.equal(detectPreset('SwiftShader', true), 'low');
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
