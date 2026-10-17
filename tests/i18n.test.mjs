// Localization coverage: every string key the game uses exists in en-US and
// has a translation in every non-English locale; en-GB/es-419/fr-CA resolve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EN_US, TABLE, LOCALES, t, setLocale } from '../i18n.js';

const dir = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(dir + f, 'utf8');
const sources = ['main.js', 'settings.js', 'gfx.js'].map(read).join('\n');
const html = read('index.html');

function usedKeys() {
  const keys = new Set();
  for (const m of sources.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) keys.add(m[1]);
  for (const m of sources.matchAll(/\[\s*'((?:lb|sync)\.[\w.]+)'/g)) keys.add(m[1]);
  for (const m of html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)) keys.add(m[1]);
  return keys;
}
// Keys built from a prefix at runtime (t('diff.' + d), t('sync.' + state), ...).
const DYNAMIC = ['diff.', 'sync.', 'gfx.preset.', 'gfx.tier.', 'gfx.cat.', 'gfx.sum.', 'mode.'];

test('every key used in code and markup exists in en-US', () => {
  const missing = [...usedKeys()].filter((k) => !k.endsWith('.') && !(k in EN_US));
  assert.deepEqual(missing, []);
});

test('every en-US key is used (directly or through a dynamic prefix)', () => {
  const used = usedKeys();
  const unused = Object.keys(EN_US).filter((k) => !used.has(k) && !DYNAMIC.some((p) => k.startsWith(p))
    && !['status.ready', 'app.title'].includes(k));
  assert.deepEqual(unused, []);
});

test('all nine locales are present and translate every key', () => {
  assert.deepEqual([...LOCALES].sort(), ['de-DE', 'en-GB', 'en-US', 'es-419', 'es-ES', 'fr-CA', 'fr-FR', 'it-IT', 'pt-BR']);
  for (const loc of ['es-ES', 'es-419', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    const missing = Object.keys(EN_US).filter((k) => !(k in TABLE[loc]) && k !== 'app.title' && !/^gfx\.tier\.(fxaa|smaa|msaa)$/.test(k));
    assert.deepEqual(missing, [], loc);
  }
  for (const loc of LOCALES) {
    for (const [k, v] of Object.entries(TABLE[loc] || {})) {
      const want = (EN_US[k].match(/\{\w+\}/g) || []).sort().join();
      assert.equal((v.match(/\{\w+\}/g) || []).sort().join(), want, `${loc} ${k} placeholders`);
    }
  }
});

test('lookup follows the active locale', () => {
  setLocale('de-DE');
  assert.notEqual(t('btn.erase'), EN_US['btn.erase']);
  setLocale('fr-CA');
  assert.equal(t('mode.challenge'), 'Épreuve');
  setLocale('en-US');
  assert.equal(t('progress.complete', { pct: 40 }), '40% complete');
});
