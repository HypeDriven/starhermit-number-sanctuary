'use strict';

// Number Sanctuary — StarHermit platform adapter over the shared SDK
// (starhermit-sdk.js, loaded by index.html as window.StarHermit).
//
// The game stays fully playable offline: without a launch token this module
// is inert and never touches the network. When the platform hands us a token
// (#game_token=… library launch or #access_token=… sign-in return) the SDK
// owns it (renewal included); this adapter resolves the account nickname,
// mirrors the localStorage save doc to the `game:<slug>` cloud slot (remote
// wins on conflict), and exposes the settings KV, keyboard bindings and the
// sign-in / invite helpers.

function sdk() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  return (w && w.StarHermit) || null;
}

let _hooks = {};       // { onProfile(name), onSync(state), onAuth({signedIn}) }
let _inited = false;

const signedIn = () => { const s = sdk(); return !!(s && s.signedIn && s.slug); };

// ---------------------------------------------------------------------------
// Cloud save: one slot, debounced; localStorage stays the offline cache
// ---------------------------------------------------------------------------

let _pendingDoc = null;   // latest save doc (JSON string) awaiting upload
let _saveTimer = null;    // debounce handle
let _saving = false;      // PUT in flight
let _retryTimer = null;   // failure-retry handle

function scheduleCloudSave(docJson) {
  if (!signedIn()) return;
  _pendingDoc = docJson;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; flushCloudSave(); }, 2000);
  onSync('saving');
}

async function flushCloudSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const doc = _pendingDoc;
  if (!doc || !signedIn() || _saving) return;
  _saving = true;
  try {
    // keepalive lets the pagehide flush survive tab teardown; saves are a few KB.
    const ok = await sdk().writeSave(doc, { keepalive: true });
    if (!ok) throw new Error('save failed');
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
  const s = sdk();
  if (!s || _inited) return;
  _inited = true;
  s.init();
  s.on('auth', (a) => { if (_hooks.onAuth) _hooks.onAuth(a); });
  if (!s.signedIn) return; // local play: no account, no network calls

  s.profile()
    .then((p) => { if (p && _hooks.onProfile) _hooks.onProfile(p.displayName); })
    .catch(() => {});
  window.addEventListener('pagehide', flushCloudSave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushCloudSave();
  });
}

// Cloud mirror is available (token + a resolvable slug).
export function hasSession() { return signedIn(); }

// Remote save doc, or null when none/404/error. The caller decides precedence.
export async function loadCloud() {
  if (!signedIn()) return null;
  const doc = await sdk().loadJSON();
  return doc && typeof doc === 'object' ? doc : null;
}

// Per-player settings KV (null standalone).
export async function getSettings() { return signedIn() ? sdk().getSettings() : null; }
export function patchSettings(obj) { if (signedIn()) sdk().patchSettings(obj); }

// Keyboard bindings: the platform's rebinds over the game's defaults.
export async function loadBindings(defaults) {
  if (!signedIn()) return structuredClone(defaults);
  try { return await sdk().loadBindings(defaults); } catch (e) { return structuredClone(defaults); }
}

export function canSignIn() { const s = sdk(); return !!(s && s.canSignIn()); }
export function signIn() { const s = sdk(); return !!(s && s.signIn()); }
export function inviteLink() { return signedIn() ? sdk().inviteLink() : null; }

export { scheduleCloudSave, flushCloudSave };
