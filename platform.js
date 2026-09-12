'use strict';

// Number Sanctuary — StarHermit platform adapter.
//
// The game stays fully playable offline: without a launch token this module is
// inert and never touches the network. When the platform hands us a token
// (#game_token=<jwt> URL fragment), every REST call carries it as a Bearer
// token, the account nickname is resolved for the HUD, and the localStorage
// save doc is mirrored to the platform cloud-save slot (zip + base64, one
// slot, remote wins on conflict). Tokens live in memory only — never persisted.

// ---------------------------------------------------------------------------
// Stored-zip helper (single stored entry, no compression, CRC32 included)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}

function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(b64) {
  const s = atob(b64);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// ---------------------------------------------------------------------------
// Launch token: read once from the fragment, strip it, decode sub/game_scope
// ---------------------------------------------------------------------------

let _token = null;     // current launch token (memory only)
let _sub = null;       // user id from the JWT payload
let _slug = null;      // game slug from game_scope (never hard-coded)
let _hooks = {};       // { onProfile(name), onSync(state), onCloud(doc) }

// Read #game_token=<jwt> exactly once, then strip it from the URL. Any other
// fragment params (e.g. session_id) are preserved.
function readFragmentToken() {
  try {
    const hash = window.location.hash || '';
    if (!hash) return null;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('game_token');
    if (!token) return null;
    params.delete('game_token');
    const rest = params.toString();
    const url = window.location.pathname + window.location.search + (rest ? '#' + rest : '');
    window.history.replaceState(null, '', url);
    return token;
  } catch (e) { return null; }
}

// Query-param fallbacks are for local dev only (dev server has no fragment
// injection), never for the hosted *.starhermit.com origin.
function readQueryToken() {
  try {
    const h = window.location.hostname;
    if (h !== 'localhost' && h !== '127.0.0.1') return null;
    const q = new URLSearchParams(window.location.search);
    return q.get('game_token') || q.get('launch_token') || q.get('token') || q.get('launch');
  } catch (e) { return null; }
}

// Base64url-decode the JWT payload (no signature verification — the platform
// contract only needs the claims).
function decodeJwt(token) {
  try {
    const part = token.split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const json = decodeURIComponent(Array.prototype.map.call(bin, (c) =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    const claims = JSON.parse(json);
    return claims && typeof claims === 'object' ? claims : null;
  } catch (e) { return null; }
}

// Fallback for a token without game_scope: derive the slug from the host.
function slugFromHost() {
  try {
    const h = window.location.hostname;
    if (h.endsWith('.starhermit.com')) return h.slice(0, -'.starhermit.com'.length) || null;
  } catch (e) { /* no location */ }
  return null;
}

// ---------------------------------------------------------------------------
// API plumbing: Bearer on every call, 45-min launch-token refresh
// ---------------------------------------------------------------------------

async function apiFetch(path, opts = {}) {
  const headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + _token });
  // keepalive lets the pagehide flush survive tab teardown; saves are a few KB.
  const res = await fetch(path, Object.assign({}, opts, { headers, keepalive: true }));
  if (!res.ok) {
    const err = new Error('api ' + res.status + ' ' + path);
    err.status = res.status;
    throw err;
  }
  return res;
}

// Scoped launch tokens may be re-minted: POST with the current token, swap in
// the fresh one. Success re-arms in 45 min, failure retries in ~60 s.
function scheduleRefresh(delay) {
  setTimeout(async () => {
    try {
      const res = await apiFetch('/api/v1/games/' + encodeURIComponent(_slug) + '/launch-token', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (body && typeof body.token === 'string' && body.token) _token = body.token;
      scheduleRefresh(45 * 60 * 1000);
    } catch (e) {
      scheduleRefresh(60 * 1000);
    }
  }, delay);
}

// GET /api/v1/me is off-limits for launch tokens (403); the profile route is
// the documented way. Nickname only — never the username.
async function fetchProfile() {
  try {
    const res = await apiFetch('/api/v1/users/' + encodeURIComponent(_sub) + '/profile');
    const p = await res.json().catch(() => ({}));
    if (p && typeof p.nickname === 'string' && p.nickname.trim()) return p.nickname;
  } catch (e) { /* offline or unauthenticated: use the fallback name */ }
  return 'Player ' + String(_sub).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Cloud save: one slot, zip + base64; localStorage stays the offline cache
// ---------------------------------------------------------------------------

function buildSaveZip(docJson) {
  return zipStore('save.json', new TextEncoder().encode(docJson));
}

function parseSaveZip(zipBytes) {
  try {
    const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(zipBytes)));
    return doc && typeof doc === 'object' ? doc : null;
  } catch (e) { return null; }
}

let _pendingDoc = null;   // latest save doc awaiting upload
let _saveTimer = null;    // debounce handle
let _saving = false;      // PUT in flight
let _retryTimer = null;   // failure-retry handle

function scheduleCloudSave(docJson) {
  if (!_token || !_slug) return;
  _pendingDoc = docJson;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; flushCloudSave(); }, 2000);
  onSync('saving');
}

async function flushCloudSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const doc = _pendingDoc;
  if (!doc || !_token || !_slug || _saving) return;
  _saving = true;
  try {
    await apiFetch('/api/v1/me/cloud-saves/' + encodeURIComponent(_slug), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataBase64: bytesToBase64(buildSaveZip(doc)) }),
    });
    if (_pendingDoc === doc) _pendingDoc = null;
    onSync('synced');
  } catch (e) {
    onSync('error');
    if (!_retryTimer) {
      _retryTimer = setTimeout(() => { _retryTimer = null; flushCloudSave(); }, 60000);
    }
  } finally {
    _saving = false;
    if (_pendingDoc && _pendingDoc !== doc) flushCloudSave(); // newer doc queued mid-flight
  }
}

function onSync(state) { if (_hooks.onSync) _hooks.onSync(state); }

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function init(hooks) {
  _hooks = hooks || {};
  if (_token) return; // already initialised (module evaluated twice)
  _token = readFragmentToken() || readQueryToken();
  if (!_token) return; // local play: no account, no network calls

  const claims = decodeJwt(_token);
  _sub = (claims && claims.sub) || null;
  _slug = (claims && claims.game_scope) || slugFromHost();

  if (_sub) {
    fetchProfile()
      .then((name) => { if (_hooks.onProfile) _hooks.onProfile(name); })
      .catch(() => {});
  }
  if (_slug) {
    scheduleRefresh(45 * 60 * 1000);
    window.addEventListener('pagehide', flushCloudSave);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushCloudSave();
    });
  }
}

// Cloud mirror is available (token + a resolvable slug).
export function hasSession() { return !!(_token && _slug); }

// Remote save doc, or null when none/404/error. The caller decides precedence.
export function loadCloud() {
  return loadCloudDoc();
}

async function loadCloudDoc() {
  try {
    const res = await apiFetch('/api/v1/me/cloud-saves/' + encodeURIComponent(_slug));
    return parseSaveZip(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    if (e.status === 404) return null; // no remote save yet
    return null;
  }
}

export { zipStore, unzipFirstEntry, bytesToBase64, base64ToBytes, scheduleCloudSave };
