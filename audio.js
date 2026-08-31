'use strict';

// Number Sanctuary — WebAudio sound module (no external dependencies).
// Prefers authored one-shot samples (sfx/*.opus, see sfx/manifest.json);
// synthesized tones remain as fallback while samples load or if they fail.

let _ctx = null;
let _bus = null;       // effects bus: all output routes through here
let _unlocked = false; // set by the user-gesture unlock below
let _muted = false;
let _volume = 1.0;

function ctx() {
  if (!_ctx) _ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  return _ctx;
}

function bus() {
  const c = ctx();
  if (!_bus) {
    _bus = c.createGain();
    _bus.gain.value = _muted ? 0 : _volume;
    _bus.connect(c.destination);
  }
  return _bus;
}

export function setMuted(m) {
  _muted = !!m;
  if (_bus) _bus.gain.value = _muted ? 0 : _volume;
}

export function setVolume(v) {
  _volume = Math.max(0, Math.min(1, Number(v) || 0));
  if (_bus && !_muted) _bus.gain.value = _volume;
}

// --- user-gesture unlock -----------------------------------------------------
// Sample fetches only start after this; until then synthesis carries events.
function unlock() {
  if (_unlocked) return;
  _unlocked = true;
  try { ctx().resume(); } catch (e) { /* audio unavailable */ }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}

// --- authored samples ----------------------------------------------------------
// Maps each public event method to its clips (basenames under sfx/, .opus).
// Round-robin rotation avoids repeating the same clip back to back.
const EVENT_SAMPLES = {
  playPlace: ['place-wood-tap', 'place-stone-set', 'place-peg-thunk', 'place-glass-tick'],
  playInvalid: ['invalid-wood-knock', 'invalid-dull-thud', 'invalid-rubber-bounce', 'invalid-dice-rattle'],
  playSelect: ['select-switch-tick', 'select-pen-click', 'select-brass-chime', 'select-cork-pop'],
};

const _clips = new Map();   // name -> { status: 'loading'|'ready'|'failed', buffer }
const _rotation = new Map(); // event -> next clip index

function loadClip(name) {
  let entry = _clips.get(name);
  if (entry) return entry;
  entry = { status: 'loading', buffer: null };
  _clips.set(name, entry);
  fetch('./sfx/' + name + '.opus')
    .then((res) => {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.arrayBuffer();
    })
    .then((data) => ctx().decodeAudioData(data))
    .then((buffer) => { entry.buffer = buffer; entry.status = 'ready'; })
    .catch(() => { entry.status = 'failed'; });
  return entry;
}

// Returns true when a sample was started; false means the caller must synthesize.
function tryPlaySample(event) {
  const names = EVENT_SAMPLES[event];
  if (!names || !_unlocked) return false;
  const i = (_rotation.get(event) || 0) % names.length;
  _rotation.set(event, i + 1);
  const entry = loadClip(names[i]);
  if (entry.status === 'failed') return false;
  if (entry.status !== 'ready') return false; // still loading: synthesis covers it
  try {
    const src = ctx().createBufferSource();
    src.buffer = entry.buffer;
    src.connect(bus());
    src.start();
    return true;
  } catch (e) {
    return false;
  }
}

// --- synthesized fallback -------------------------------------------------------
function beep(freq, durSec) {
  try {
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.25;
    osc.connect(gain);
    gain.connect(bus());
    const now = c.currentTime;
    osc.start(now);
    gain.gain.setTargetAtTime(0.0001, now + durSec * 0.5);
    osc.stop(now + durSec);
  } catch (e) { /* audio unavailable */ }
}

export function playPlace() { if (!tryPlaySample('playPlace')) beep(440, 0.12); }
export function playInvalid() { if (!tryPlaySample('playInvalid')) beep(180, 0.18); }
export function playSelect() { if (!tryPlaySample('playSelect')) beep(660, 0.08); }
