// Localization coverage: every string key the engine client uses (literal
// keys in native/*.ts plus the mode, difficulty and sync keys it builds) is
// in en-US and translated in every full locale (en-GB, es-ES and fr-CA
// override their parents' rows), placeholders survive, and no table row is
// unused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LOCALES, TABLE } from '../lang/strings.js';

const ROOT = new URL('../', import.meta.url);
const KEY = /["'`]((?:app|mode|aria|panel|status|sync|diff|cell|btn|info|overlay|score|lb|settings|account|progress)\.[A-Za-z]+)["'`]/g;

function usedKeys() {
  const keys = new Set();
  for (const f of readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts'))) {
    for (const m of readFileSync(new URL(`native/${f}`, ROOT), 'utf8').matchAll(KEY)) keys.add(m[1]);
  }
  for (const m of ['learn', 'journey', 'daily', 'practice', 'challenge']) keys.add(`mode.${m}`);
  for (const d of ['easy', 'medium', 'hard']) keys.add(`diff.${d}`);
  for (const s of ['saving', 'synced', 'error']) keys.add(`sync.${s}`);
  return [...keys].sort();
}
const FULL = ['es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const holders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();

test('every used key is in en-US and every full locale; placeholders intact; no unused rows', () => {
  const used = usedKeys();
  assert.ok(used.length > 50, `only ${used.length} keys`);
  const problems = [];
  for (const k of used) if (!(k in TABLE['en-US'])) problems.push(`en-US missing ${k}`);
  for (const loc of FULL) {
    for (const k of used) if (k !== 'app.title' && !(k in TABLE[loc])) problems.push(`${loc} missing ${k}`);
  }
  for (const [loc, table] of Object.entries(TABLE)) {
    assert.ok(LOCALES.includes(loc), loc);
    for (const [k, v] of Object.entries(table)) {
      if (!used.includes(k)) problems.push(`${loc} unused ${k}`);
      else if (holders(v) !== holders(TABLE['en-US'][k])) problems.push(`${loc} placeholders ${k}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('nine locales, regional rows differ where the browser build did', () => {
  assert.deepEqual(Object.keys(TABLE).sort(), [...LOCALES].sort());
  assert.equal(TABLE['en-GB']['btn.mark'], 'Pencil (N)');
  assert.notEqual(TABLE['fr-CA']['mode.challenge'], TABLE['fr-FR']['mode.challenge']);
  assert.match(TABLE['de-DE']['settings.options'], /Grafik/);
});
