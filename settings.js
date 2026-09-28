'use strict';

// Number Sanctuary — Settings dialog (Graphics section).
//
// Owns only the dialog's DOM: it reads the saved graphics settings and the
// renderer's info through callbacks from main.js and hands back new settings
// through `apply`, which applies them live and persists them.

import { PRESETS, CATEGORIES, presetTier, choosePreset } from './gfx.js';

let cfg = null;
let root, panel, opener = null, ticker = null;

export function isSettingsOpen() { return !!root && !root.hidden; }

export function openSettings(from) {
  if (!cfg || isSettingsOpen()) return;
  opener = from || document.activeElement;
  if (cfg.onOpen) cfg.onOpen();
  root.hidden = false;
  sync();
  ticker = setInterval(syncSummary, 1000);
  const first = root.querySelector('#gfx-preset');
  if (first) first.focus();
}

export function closeSettings() {
  if (!isSettingsOpen()) return;
  root.hidden = true;
  clearInterval(ticker);
  ticker = null;
  const back = opener && document.contains(opener) ? opener : document.getElementById('settings-btn');
  opener = null;
  if (back) back.focus();
}

function el(tag, attrs, text) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

function row(labelText, control, id) {
  const r = el('div', { class: 'gfx-row' });
  r.append(el('label', { for: id }, labelText), control);
  return r;
}

function toggle(id, labelText) {
  const r = el('div', { class: 'gfx-row gfx-toggle' });
  const box = el('input', { type: 'checkbox', id });
  r.append(el('label', { for: id }, labelText), box);
  return r;
}

function build() {
  const t = cfg.t;
  const sec = document.getElementById('gfx-section');
  sec.textContent = '';
  sec.append(el('h3', { id: 'gfx-heading' }, t('gfx.heading')));

  const preset = el('select', { id: 'gfx-preset', 'data-gfx': 'preset' });
  preset.append(el('option', { value: 'auto' }, ''));
  for (const p of PRESETS) preset.append(el('option', { value: p }, t('gfx.preset.' + p)));
  sec.append(row(t('gfx.quality'), preset, 'gfx-preset'));

  const scaleWrap = el('div', { class: 'gfx-scale' });
  const scale = el('input', { type: 'range', id: 'gfx-scale', min: '50', max: '200', step: '5', 'data-gfx': 'render_scale' });
  scaleWrap.append(scale, el('output', { id: 'gfx-scale-value', for: 'gfx-scale' }, '100%'));
  sec.append(row(t('gfx.scale'), scaleWrap, 'gfx-scale'));

  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const s = el('select', { id: 'gfx-cat-' + cat, 'data-gfx-cat': cat });
    s.append(el('option', { value: 'preset' }, ''));
    for (const tier of tiers) s.append(el('option', { value: tier }, t('gfx.tier.' + tier)));
    sec.append(row(t('gfx.cat.' + cat), s, 'gfx-cat-' + cat));
  }

  sec.append(toggle('gfx-adaptive', t('gfx.adaptive')));
  sec.append(toggle('gfx-fps', t('gfx.fps')));
  sec.append(el('p', { id: 'gfx-summary', class: 'gfx-summary', 'aria-live': 'polite' }, ''));
  const note = el('p', { id: 'gfx-post-note', class: 'gfx-note' }, t('gfx.postFailed'));
  note.hidden = true;
  sec.append(note);

  preset.addEventListener('change', () => update(choosePreset(cfg.getSaved(), preset.value)));
  scale.addEventListener('input', () => {
    const next = Object.assign({}, cfg.getSaved(), { render_scale: Number(scale.value) / 100 });
    update(next);
  });
  for (const cat of Object.keys(CATEGORIES)) {
    const s = sec.querySelector('#gfx-cat-' + cat);
    s.addEventListener('change', () => {
      const next = Object.assign({}, cfg.getSaved());
      if (s.value === 'preset') delete next[cat]; else next[cat] = s.value;
      update(next);
    });
  }
  sec.querySelector('#gfx-adaptive').addEventListener('change', (e) => {
    update(Object.assign({}, cfg.getSaved(), { adaptive: e.target.checked }));
  });
  sec.querySelector('#gfx-fps').addEventListener('change', (e) => {
    update(Object.assign({}, cfg.getSaved(), { show_fps: e.target.checked }));
  });
}

function update(next) {
  cfg.apply(next);
  sync();
}

// Reflect the saved settings and the resolved tiers into the controls.
function sync() {
  const t = cfg.t;
  const saved = cfg.getSaved();
  const info = cfg.info();
  const r = info.resolved;
  const preset = root.querySelector('#gfx-preset');
  preset.options[0].textContent = t('gfx.preset.auto', { tier: t('gfx.preset.' + info.detected) });
  preset.value = PRESETS.includes(saved.preset) ? saved.preset : 'auto';
  const pct = Math.round(r.renderScale * 100);
  root.querySelector('#gfx-scale').value = String(pct);
  root.querySelector('#gfx-scale-value').textContent = pct + '%';
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    const s = root.querySelector('#gfx-cat-' + cat);
    s.options[0].textContent = t('gfx.fromPreset', { tier: t('gfx.tier.' + presetTier(r.preset, cat)) });
    s.value = tiers.includes(saved[cat]) ? saved[cat] : 'preset';
  }
  root.querySelector('#gfx-adaptive').checked = r.adaptive;
  root.querySelector('#gfx-fps').checked = r.showFps;
  syncSummary();
}

function syncSummary() {
  if (!cfg || !root) return;
  const info = cfg.info();
  root.querySelector('#gfx-summary').textContent = `${info.gpu} · ${info.summary}`;
  root.querySelector('#gfx-post-note').hidden = !info.postFailed;
}

/**
 * cfg: { t, getSaved(), apply(saved), info() -> { gpu, detected, resolved, summary, postFailed }, onOpen() }
 */
export function initSettings(options) {
  cfg = options;
  root = document.getElementById('settings');
  panel = root.querySelector('.settings-panel');
  build();
  const btn = document.getElementById('settings-btn');
  if (btn) btn.addEventListener('click', () => openSettings(btn));
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  // a click on the dimmed backdrop (outside the panel) closes the dialog
  root.addEventListener('click', (e) => { if (e.target === root) closeSettings(); });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSettings(); return; }
    if (e.key !== 'Tab') return;
    // keep keyboard focus inside the dialog
    const f = Array.from(panel.querySelectorAll('button, select, input')).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
