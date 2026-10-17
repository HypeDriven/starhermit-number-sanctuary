// Platform adapter over the shared StarHermit SDK: launch token, profile
// name, game:<slug> cloud-save round-trip (ETag-versioned, merged on a
// conflict), settings KV, controls, and no network at all when standalone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Load the shipped SDK copy as a classic script (the package is ESM).
const sdkModule = { exports: {} };
new Function('module', 'self', fs.readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule, globalThis);
const SDK = sdkModule.exports;
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = 'h.' + b64u({ sub: 'user-123456', game_scope: 'ns-slug', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

// SDK renewal timers must not keep the test process alive.
const unrefTimeout = (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; };

// Stored-only zip (what the SDK writes), for a save made on another device.
function zipStored(text) {
  const data = Buffer.from(text, 'utf8');
  const name = Buffer.from('save.json');
  let c = ~0;
  for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  const crc = (~c) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

function fakeServer() {
  const calls = [], saves = {}, kv = {}, versions = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const headers = init.headers || {};
    calls.push([method, url, headers['If-Match']]);
    const r = (status, body) => new Response(body == null ? null : body, { status });
    if (url.includes('/cloud-saves/')) {
      const rest = decodeURIComponent(url.split('/cloud-saves/')[1]);
      if (rest.endsWith('/info')) {
        const k = rest.slice(0, -5);
        return r(200, JSON.stringify(saves[k] ? { exists: true, etag: `"v${versions[k]}"` } : { exists: false }));
      }
      const key = rest;
      if (method === 'PUT') {
        // writes are conditional on the version the client last read (ETag)
        const cur = saves[key] ? `"v${versions[key]}"` : null;
        if (headers['If-Match'] && headers['If-Match'] !== cur) return r(412, JSON.stringify({ error: 'precondition failed', etag: cur }));
        if (headers['If-None-Match'] === '*' && saves[key]) return r(412, JSON.stringify({ error: 'precondition failed', etag: cur }));
        saves[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        versions[key] = (versions[key] || 0) + 1;
        return r(200, JSON.stringify({ etag: `"v${versions[key]}"` }));
      }
      return saves[key] ? r(200, saves[key]) : r(404);
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'u', nickname: 'Tess' }));
    if (url.endsWith('/settings') && method === 'PATCH') { Object.assign(kv, JSON.parse(init.body).settings); return r(200, '{}'); }
    if (url.endsWith('/settings')) return r(200, JSON.stringify({ settings: kv }));
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'hint', codes: ['KeyJ'] }] }));
    return r(404);
  };
  // Another device writes the slot (bumps the version behind this client's back).
  const writeElsewhere = (key, doc) => { saves[key] = zipStored(JSON.stringify(doc)); versions[key] = (versions[key] || 0) + 1; };
  return { calls, saves, kv, fetch, writeElsewhere };
}

function install(hash, srv, hostname = 'ns-slug.starhermit.com') {
  const win = {
    location: { hash, search: '', pathname: '/', hostname, origin: 'https://' + hostname, href: 'https://' + hostname + '/' },
    history: { replaceState() {} },
    addEventListener() {},
  };
  win.StarHermit = SDK.create({ window: win, fetch: srv.fetch, setTimeout: unrefTimeout });
  globalThis.window = win;
  globalThis.location = win.location;
  globalThis.fetch = srv.fetch; // any direct request is counted too
  return win;
}

test('hosted: token, profile, cloud save game:<slug>, settings, controls', async () => {
  const srv = fakeServer();
  const win = install('#game_token=' + token, srv, 'ns-slug.starhermit.com');
  globalThis.document = { addEventListener() {}, hidden: false };
  const P = await import('../platform.js?hosted');
  let name = null;
  P.init({ onProfile: (n) => { name = n; } });
  assert.equal(P.hasSession(), true);
  assert.equal(win.StarHermit.userId, 'user-123456');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(name, 'Tess');

  P.scheduleCloudSave(JSON.stringify({ best: { easy: 10 } }));
  await P.flushCloudSave();
  assert.deepEqual(Object.keys(srv.saves), []);    // held until the start-up load resolves
  assert.equal(await P.loadCloud(), null);
  await P.flushCloudSave();
  assert.deepEqual(Object.keys(srv.saves), ['game:ns-slug']);
  assert.deepEqual(await P.loadCloud(), { best: { easy: 10 } });

  P.patchSettings({ muted: true });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(srv.kv.muted, true);
  assert.deepEqual(await P.getSettings(), { muted: true });

  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'], mute: ['KeyM'] }), { hint: ['KeyJ'], mute: ['KeyM'] });
  assert.ok(P.inviteLink().endsWith('/game-invite/user-123456/ns-slug'));
  assert.equal(P.canSignIn(), false);
});

test('standalone: no token means no fetch at all', async () => {
  const srv = fakeServer();
  install('', srv, 'localhost');
  const P = await import('../platform.js?standalone');
  P.init({});
  assert.equal(P.hasSession(), false);
  assert.equal(await P.loadCloud(), null);
  P.scheduleCloudSave('{}');
  await P.flushCloudSave();
  P.patchSettings({ muted: true });
  assert.equal(await P.getSettings(), null);
  assert.deepEqual(await P.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  assert.equal(P.inviteLink(), null);
  assert.equal(P.canSignIn(), false);
  assert.equal(srv.calls.length, 0);
});

test('mergeSaveDocs: best per difficulty keeps the higher score; rounds by progress', async () => {
  const { mergeSaveDocs } = await import('../platform.js?merge');
  const round = (seed, filled, gameOver = false) => ({ mode: 'practice', difficulty: 'easy', puzzleSeed: seed,
    board: Array.from({ length: 81 }, (_, i) => (i < filled ? 1 : 0)), gameOver });
  const a = { best: { easy: 300, hard: 50 }, round: round(1, 20) };
  const b = { best: { easy: 200, medium: 90 }, round: round(1, 30) };
  assert.deepEqual(mergeSaveDocs(a, b).best, { easy: 300, hard: 50, medium: 90 });
  assert.equal(mergeSaveDocs(a, b).round, b.round);                    // same puzzle, further along
  assert.equal(mergeSaveDocs(b, a).round, b.round);
  assert.equal(mergeSaveDocs(a, { round: round(1, 5, true) }).round.gameOver, true); // finished wins
  assert.equal(mergeSaveDocs(a, { round: round(2, 60) }).round, a.round);         // different puzzle: local
  assert.equal(mergeSaveDocs({ best: {} }, b).round, b.round);                       // no local round
  assert.deepEqual(mergeSaveDocs(null, null), { best: {}, round: null });
});

test('save conflict: a save made elsewhere is merged, not overwritten', async () => {
  const srv = fakeServer();
  const win = install('#game_token=' + token, srv, 'ns-slug.starhermit.com');
  globalThis.document = { addEventListener() {}, hidden: false };
  const P = await import('../platform.js?conflict');
  let local = { best: { easy: 100 }, round: null };
  const conflicts = [];
  P.init({
    onConflict(remote) { conflicts.push(remote); local = P.mergeSaveDocs(local, remote); return JSON.stringify(local); },
  });
  assert.equal(await P.loadCloud(), null);
  P.scheduleCloudSave(JSON.stringify(local));
  await P.flushCloudSave();
  srv.writeElsewhere('game:ns-slug', { best: { easy: 50, hard: 400 }, round: null });
  local = { best: { easy: 120 }, round: null };
  P.scheduleCloudSave(JSON.stringify(local));
  await P.flushCloudSave();                         // 412: the other device saved first
  for (let i = 0; i < 50 && !conflicts.length; i++) await new Promise((r) => setTimeout(r, 5));
  const puts = () => srv.calls.filter(([m, u]) => m === 'PUT' && u.includes('/cloud-saves/'));
  for (let i = 0; i < 100 && puts().length < 3; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(win.StarHermit.saveConflicted(), false);
  assert.deepEqual(conflicts, [{ best: { easy: 50, hard: 400 }, round: null }]);
  assert.equal(puts().length, 3);                   // first save, rejected save, merged save
  assert.deepEqual(await P.loadCloud(), { best: { easy: 120, hard: 400 }, round: null });
});
