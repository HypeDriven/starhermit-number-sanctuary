'use strict';

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { detectPreset, resolve, describe, SHADOW_MAP, PARTICLE_COUNT, CATEGORIES } from './gfx.js';
import { initSettings, isSettingsOpen, openSettings } from './settings.js';
import { generateGrid, makePuzzle } from './rules.js';
import * as audio from './audio.js';
import { t, getLocale, setLocale } from './i18n.js';
import * as platform from './platform.js';

// ---------------------------------------------------------------------------
// Constants and static data
// ---------------------------------------------------------------------------

const SIZE = 9;
const BOX = 3;

const MODES = ['learn', 'journey', 'daily', 'practice', 'challenge'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const STORE_KEY = 'number-sanctuary:v1';

// Keyboard actions (KeyboardEvent.code), mirrored as control.* lines in
// starhermit.txt; the player's platform rebinds replace these at boot.
const KEY_DEFAULTS = {
  digit1: ['Digit1', 'Numpad1'], digit2: ['Digit2', 'Numpad2'], digit3: ['Digit3', 'Numpad3'],
  digit4: ['Digit4', 'Numpad4'], digit5: ['Digit5', 'Numpad5'], digit6: ['Digit6', 'Numpad6'],
  digit7: ['Digit7', 'Numpad7'], digit8: ['Digit8', 'Numpad8'], digit9: ['Digit9', 'Numpad9'],
  erase: ['Backspace', 'Delete', 'Digit0', 'Numpad0'],
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  note: ['KeyN', 'KeyU'], hint: ['KeyH'], clear: ['KeyC'], restart: ['KeyR'], pause: ['KeyP'], mute: ['KeyM'],
  menu: ['Escape'],
};
let keyBindings = structuredClone(KEY_DEFAULTS);
function keyAction(code) {
  for (const [a, codes] of Object.entries(keyBindings)) if (codes.includes(code)) return a;
  return null;
}
function keyLabel(code) {
  const named = { Escape: 'Esc', Backspace: '⌫', Delete: 'Del', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return named[code] || String(code || '').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

function boxIndex(r, c) { return Math.floor(r / BOX) * BOX + Math.floor(c / BOX); }

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — separate stream for rules vs. presentation
// ---------------------------------------------------------------------------

let _rulesSeed = 0;
export function setRulesSeed(s) { _rulesSeed = s >>> 0; }
function rand() {
  let s = (_rulesSeed + 1) | 0;
  _rulesSeed = (s + 0x6D2B79F5) | 0;
  s = _rulesSeed;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

let grid = new Array(SIZE * SIZE).fill(0);      // solution
let board = new Array(SIZE * SIZE).fill(0);     // current values (0 empty)
let notes = new Set();                           // marked (pencil) cell indices
let given = new Array(SIZE * SIZE).fill(false);  // fixed cells
let selected = -1;                               // selected cell index (-1 none)
let mode = 'learn';                              // active mode
let difficulty = 'easy';                         // active difficulty
let mistakes = 0;                                // count of invalid actions
let moves = 0;                                   // count of placed digits
let hints = 0;                                   // hints consumed this round
let puzzleSeed = 0;                              // seed of the current round
let startTime = Date.now();                      // round start timestamp
let pausedAt = 0;                                // wall clock when pause began
let pausedTotal = 0;                             // accumulated paused milliseconds
let paused = false;                              // pause flag
let muted = false;                               // mute flag
let gameOver = false;                            // terminal (solved) flag
let best = {};                                   // difficulty -> best score

// ---------------------------------------------------------------------------
// Puzzle construction per mode/difficulty
// ---------------------------------------------------------------------------

// Daily rounds are the same for everyone on a given UTC day; every other mode
// gets a fresh seed per round so restart is a genuinely new puzzle.
function nextSeed() {
  if (mode === 'daily') {
    const d = new Date();
    return (d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()) >>> 0;
  }
  return (Math.floor(rand() * 0xFFFFFFFF) ^ (mode.length * 7919)) >>> 0;
}

function buildPuzzle(seed) {
  puzzleSeed = seed >>> 0;
  grid = generateGrid(puzzleSeed);
  // remove cells: easy fewer, medium more, hard most. A cell is only removed
  // when the puzzle still has exactly one solution, so every round is fair.
  const targetRemoved = difficulty === 'easy' ? 40 : difficulty === 'medium' ? 50 : 56;
  board = makePuzzle(grid, puzzleSeed, targetRemoved).puzzle;
  given = board.map((v) => v !== 0);
}

// ---------------------------------------------------------------------------
// Scoring and progress
// ---------------------------------------------------------------------------

function diffWeight() {
  return difficulty === 'easy' ? 10 : difficulty === 'medium' ? 20 : 30;
}

// Integer units only; presentation formats them.
function scoreParts() {
  const placed = diffWeight() * moves;
  const mistakePenalty = -5 * mistakes;
  const hintPenalty = -25 * hints;
  let solveBonus = 0;
  let timeBonus = 0;
  if (gameOver) {
    solveBonus = 100 * diffWeight() / 10;
    timeBonus = Math.max(0, 600 - elapsedSeconds());
  }
  const total = placed + mistakePenalty + hintPenalty + solveBonus + timeBonus;
  return { placed, mistakePenalty, hintPenalty, solveBonus, timeBonus, total };
}

function computeScore() { return scoreParts().total; }

function computeProgress() {
  // fraction of the player's own cells filled with the right digit (0..1)
  let open = 0, correct = 0;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (given[i]) continue;
    open++;
    if (board[i] && board[i] === grid[i]) correct++;
  }
  return open ? correct / open : 1;
}

let completedElapsed = null;

function elapsedSeconds() {
  if (gameOver && completedElapsed !== null) return completedElapsed;
  const now = paused ? pausedAt : Date.now();
  return Math.max(0, Math.floor((now - startTime - pausedTotal) / 1000));
}

function filledCount() {
  let n = 0;
  for (let i = 0; i < SIZE * SIZE; i++) if (board[i]) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Persistence (localStorage is the offline cache; the platform cloud save is
// a mirror when a launch token is present — never store host or launch tokens)
// ---------------------------------------------------------------------------

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (data.best && typeof data.best === 'object') best = data.best;
    return data;
  } catch (e) { return null; }
}

function saveStore() {
  const doc = {
    best,
    round: {
      mode, difficulty, puzzleSeed, moves, mistakes, hints, gameOver,
      board, given, notes: Array.from(notes),
      elapsed: elapsedSeconds(),
    },
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(doc));
  } catch (e) { /* storage unavailable or full: play continues */ }
  platform.scheduleCloudSave(JSON.stringify(doc));
}

function restoreRound(r) {
  if (!r || !MODES.includes(r.mode) || !DIFFICULTIES.includes(r.difficulty)) return false;
  if (!Array.isArray(r.board) || r.board.length !== SIZE * SIZE) return false;
  if (!Array.isArray(r.given) || r.given.length !== SIZE * SIZE) return false;
  if (!Number.isFinite(r.puzzleSeed)) return false;
  mode = r.mode; difficulty = r.difficulty;
  buildPuzzle(r.puzzleSeed >>> 0);
  // keep the regenerated solution/givens, then re-apply the player's digits
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (given[i]) continue;
    const v = r.board[i];
    board[i] = (Number.isInteger(v) && v >= 1 && v <= SIZE) ? v : 0;
  }
  notes = new Set((r.notes || []).filter((i) => Number.isInteger(i) && i >= 0 && i < SIZE * SIZE && !given[i]));
  moves = Math.max(0, r.moves | 0);
  mistakes = Math.max(0, r.mistakes | 0);
  hints = Math.max(0, r.hints | 0);
  startTime = Date.now() - Math.max(0, (r.elapsed | 0)) * 1000;
  pausedTotal = 0;
  gameOver = !!r.gameOver && isSolved();
  completedElapsed = gameOver ? Math.max(0, r.elapsed | 0) : null;
  return true;
}

// ---------------------------------------------------------------------------
// Legal-action queries and resolution
// ---------------------------------------------------------------------------

export function isLegal(cell, digit) {
  if (!digit) return false;
  const r = Math.floor(cell / SIZE), c = cell % SIZE, b = boxIndex(r, c);
  for (let i = 0; i < SIZE; i++) {
    if (board[r * SIZE + i] === digit && r * SIZE + i !== cell) return false;
    if (board[i * SIZE + c] === digit && i * SIZE + c !== cell) return false;
  }
  const br = Math.floor(b / BOX), bc = b % BOX;
  for (let i = 0; i < BOX; i++)
    for (let j = 0; j < BOX; j++) {
      const p = (br * BOX + i) * SIZE + bc * BOX + j;
      if (p !== cell && board[p] === digit) return false;
    }
  return true;
}

export function isSolved() {
  for (let i = 0; i < SIZE * SIZE; i++) if (!board[i]) return false;
  for (let r = 0; r < SIZE; r++) {
    const seen = new Array(SIZE + 1).fill(false);
    for (let c = 0; c < SIZE; c++) {
      const d = board[r * SIZE + c];
      if (seen[d]) return false;
      seen[d] = true;
    }
  }
  for (let c = 0; c < SIZE; c++) {
    const seen = new Array(SIZE + 1).fill(false);
    for (let r = 0; r < SIZE; r++) {
      const d = board[r * SIZE + c];
      if (seen[d]) return false;
      seen[d] = true;
    }
  }
  for (let b = 0; b < BOX * BOX; b++) {
    const br = Math.floor(b / BOX), bc = b % BOX;
    const seen = new Array(SIZE + 1).fill(false);
    for (let i = 0; i < BOX; i++)
      for (let j = 0; j < BOX; j++) {
        const d = board[(br * BOX + i) * SIZE + bc * BOX + j];
        if (seen[d]) return false;
        seen[d] = true;
      }
  }
  return true;
}

function applyDigit(cell, digit) {
  if (!board[cell]) moves++;
  board[cell] = digit;
  notes.delete(cell);
}

// ---------------------------------------------------------------------------
// Three.js scene: meditative stone courtyard with inset number tiles
// ---------------------------------------------------------------------------

const canvas = document.getElementById('scene-canvas');
let renderer, scene, camera;
let labelScene;           // digit sprites, drawn last and unprocessed so they stay crisp
let cellMeshes = [];      // per-cell tile meshes (interaction layer)
let labelSprites = [];     // digit labels
let ringGeom, ringMat;
let selectedRing;         // selection highlight ring
const spriteCache = new Map(); // digit -> shared texture

const CELL_SIZE = 1.0;
const GAP = 0.06;
const BOARD_SPAN = SIZE * CELL_SIZE + GAP * SIZE;
const COLOR_EMPTY = 0x2b6cb0;
const COLOR_GIVEN = 0xc05621;
const COLOR_PLACED = 0x2f855a;
const COLOR_NOTE = 0x6b46c1;
const COLOR_INVALID = 0xe53e3e;
const RING_COLOR = new THREE.Color(0xf6e05e);

// Lighting and set dressing (see §8 Graphics in spec.md)
let hemi, keyLight, rimLight;
let boardMesh, plinth, shadowCatcher, contactShadow, lanternGroup, aoOverlay;
const lanternLights = [];
const lanternFlames = [];
let tileGeomPlain, tileGeomDetailed;
const tileMatsPlain = [];
const tileMatsDetailed = [];
let fireflies = null, fireflyBase = null;
let envTexture = null;
const litMaterials = [];

// Graphics quality state
const GFX_KEY = 'number-sanctuary:gfx';
let gfxSaved = {};
let gfx = resolve({}, 'low');
let gpuName = '';
let detectedPreset = 'balanced';
let composer = null, postKey = null, postFailed = false;
let pixelRatio = 0, adaptiveScale = 1, fps = 0, lastFrameTs = 0, animTime = 0;
let frameTimes = [];
let viewPx = [0, 0];
const reducedMotionMq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
function motionAllowed() { return !(reducedMotionMq && reducedMotionMq.matches); }

function cellX(idx) { return ((idx % SIZE) - SIZE / 2 + 0.5) * CELL_SIZE; }
function cellZ(idx) { return (Math.floor(idx / SIZE) - SIZE / 2 + 0.5) * CELL_SIZE; }

function viewSize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

// The canvas rectangle not covered by the HUD panels (each panel hugs one
// edge: status top/left, controls right/bottom depending on the breakpoint).
function safeRect(w, h) {
  let l = 0, t = 0, r = w, b = h;
  const cr = canvas.getBoundingClientRect();
  for (const el of document.querySelectorAll('.stage .panel')) {
    if (el.hidden || getComputedStyle(el).display === 'none') continue;
    const bb = el.getBoundingClientRect();
    if (!bb.width || !bb.height) continue;
    const e = { l: bb.left - cr.left, t: bb.top - cr.top, r: bb.right - cr.left, b: bb.bottom - cr.top };
    if (e.r - e.l > w * 0.6) { // full-width band: top or bottom
      if (e.t < h * 0.5) t = Math.max(t, e.b); else b = Math.min(b, e.t);
    } else if (e.l < w * 0.5) l = Math.max(l, e.r); else r = Math.min(r, e.l);
  }
  if (r - l < w * 0.4) { l = 0; r = w; }
  if (b - t < h * 0.4) { t = Math.min(t, h * 0.3); b = Math.max(b, h * 0.7); }
  return { x: l, y: t, w: r - l, h: b - t };
}

// Frame the whole board inside the HUD-free rectangle regardless of aspect:
// a view offset centres it there and the camera pulls back until every
// column and row fits with a margin.
function frameCamera() {
  const { w, h } = viewSize();
  const sr = safeRect(w, h);
  camera.aspect = sr.w / sr.h;
  camera.setViewOffset(sr.w, sr.h, -sr.x, -sr.y, w, h);
  const boardSpan = BOARD_SPAN;
  const vFov = (camera.fov * Math.PI) / 180;
  const distV = (boardSpan * 0.75) / Math.tan(vFov / 2);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distH = (boardSpan * 0.6) / Math.tan(hFov / 2);
  let dist = Math.max(distV, distH, SIZE * CELL_SIZE * 1.05 + 3);
  // refine against the projected board corners (tilted board, near edge wider)
  const half = boardSpan / 2 + 0.4;
  const corners = [];
  for (const x of [-half, half]) for (const z of [-half, half]) corners.push(new THREE.Vector3(x, 0.3, z));
  const v = new THREE.Vector3();
  // narrow safe rects get a steeper (more top-down) view so the board uses
  // the width instead of shrinking under foreshortening
  const steep = camera.aspect < 0.9;
  const ey = steep ? 0.95 : 0.75, ez = steep ? 0.4 : 0.72;
  for (let i = 0; i < 10; i++) {
    camera.position.set(0, dist * ey, dist * ez);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let worst = 0;
    for (const c of corners) { v.copy(c).project(camera); worst = Math.max(worst, Math.abs(v.x), Math.abs(v.y)); }
    if (worst <= 0.94) break;
    dist *= Math.min(1.5, worst / 0.94 + 0.01);
  }
  camera.position.set(0, dist * ey, dist * ez);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function resize() {
  if (!renderer) return;
  frameCamera();
  render();
}

function tileColor(idx) {
  if (board[idx]) return given[idx] ? COLOR_GIVEN : COLOR_PLACED;
  return notes.has(idx) ? COLOR_NOTE : COLOR_EMPTY;
}

// Tile finish by state (detailed tiles only): clues are glazed, the player's
// digits satin, open cells matte stone — a second cue alongside hue.
function tileFinish(idx) {
  if (board[idx]) return given[idx] ? 0.9 : 0.45;
  return 0.12;
}

function setTileColor(idx, hex) {
  tileMatsPlain[idx].color.setHex(hex);
  tileMatsDetailed[idx].color.setHex(hex);
}

// Grey value noise, tiled, for the tiles' roughness/bump and the stone rim.
function makeNoiseTexture(size, seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const grid = 8, lat = [];
  for (let i = 0; i < grid * grid; i++) lat.push(rnd());
  const at = (x, y) => lat[((y % grid) * grid) + (x % grid)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * grid, gy = (y / size) * grid;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      const v = (top + (bot - top) * sy) * 0.7 + rnd() * 0.3;
      const c = Math.round(110 + v * 110);
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = c; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Baked contact occlusion for the static board: a black overlay whose alpha
// darkens the grout between tiles and the plinth rim around the grid. The
// scene never moves, so this replaces screen-space AO at no per-frame cost.
function makeContactAoTexture(extent) {
  const px = 512, k = px / extent;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, px, px);
  ctx.filter = 'blur(' + Math.round(0.12 * k) + 'px)';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const edge = (extent - BOARD_SPAN) / 2 - 0.08;
  ctx.fillRect(edge * k, edge * k, (BOARD_SPAN + 0.16) * k, (BOARD_SPAN + 0.16) * k);
  ctx.filter = 'blur(' + Math.round(0.05 * k) + 'px)';
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  const t = CELL_SIZE * 1.02;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const x = (cellX(i) + extent / 2 - t / 2) * k, y = (cellZ(i) + extent / 2 - t / 2) * k;
    ctx.fillRect(x, y, t * k, t * k);
  }
  ctx.filter = 'none';
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

// Tile sides darken towards their base (the "high" ambient-occlusion tier).
function addBaseShade(geom) {
  const pos = geom.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); // -0.25 .. 0.25
    const f = 0.5 + 0.5 * Math.min(1, Math.max(0, (y + 0.25) / 0.4));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geom;
}

// Soft round glow used by fireflies and the plinth's contact shadow.
function makeRadialTexture(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

function readGpu() {
  try {
    const gl = renderer.getContext();
    // Firefox already unmasks RENDERER and warns about the debug extension.
    if (/firefox/i.test(navigator.userAgent)) return String(gl.getParameter(gl.RENDERER) || '');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch (e) { return ''; }
}

function isMobileDevice() {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return (coarse && (navigator.maxTouchPoints || 0) > 0) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // nothing that casts ever moves
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2026);
  labelScene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

  // lighting: cool dusk sky fill, one warm low key light with fitted shadows,
  // and a faint cool rim from behind that picks out the tile edges
  hemi = new THREE.HemisphereLight(0xb4c8ea, 0x2a2119, 1.25);
  scene.add(hemi);
  keyLight = new THREE.DirectionalLight(0xffe2bd, 1.8);
  keyLight.position.set(-5, 11, 7);
  const sh = keyLight.shadow;
  const ext = BOARD_SPAN / 2 + 1.2;
  Object.assign(sh.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 4, far: 26 });
  sh.camera.updateProjectionMatrix();
  sh.bias = -0.0004;
  sh.normalBias = 0.02;
  sh.radius = 3;
  scene.add(keyLight);
  scene.add(keyLight.target);
  rimLight = new THREE.DirectionalLight(0x8fb2ff, 0.55);
  rimLight.position.set(3, 5, -9);
  scene.add(rimLight);

  // board plane (stone courtyard base). The authored limestone scan multiplies
  // into the base colour; if it fails to load the flat colour is what remains.
  const boardGeom = new THREE.PlaneGeometry(BOARD_SPAN, BOARD_SPAN);
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x3a4750, roughness: 0.95 });
  boardMesh = new THREE.Mesh(boardGeom, boardMat);
  boardMesh.rotation.x = -Math.PI / 2;
  boardMesh.receiveShadow = true;
  scene.add(boardMesh);
  litMaterials.push(boardMat);

  // detailed: the board sits on a raised limestone plinth with a soft contact
  // shadow beneath, and a shadow-catching ground for the key light
  const pl = BOARD_SPAN + 0.8;
  const plinthTop = new THREE.MeshStandardMaterial({ color: 0x55636d, roughness: 0.9, envMapIntensity: 0.3 });
  const plinthSide = new THREE.MeshStandardMaterial({ color: 0x5a6670, roughness: 0.95, envMapIntensity: 0.3 });
  plinth = new THREE.Mesh(new THREE.BoxGeometry(pl, 0.5, pl),
    [plinthSide, plinthSide, plinthTop, plinthSide, plinthSide, plinthSide]);
  plinth.position.y = -0.25;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  scene.add(plinth);
  litMaterials.push(plinthTop, plinthSide);
  contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(pl * 1.5, pl * 1.5),
    new THREE.MeshBasicMaterial({ map: makeRadialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = -0.52;
  scene.add(contactShadow);
  shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.35 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = -0.5;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
  litMaterials.push(shadowCatcher.material);
  loadTextures(boardMat, plinthTop, plinthSide);
  const aoExtent = pl + 0.4;
  aoOverlay = new THREE.Mesh(new THREE.PlaneGeometry(aoExtent, aoExtent), new THREE.MeshBasicMaterial({
    color: 0x000000, alphaMap: makeContactAoTexture(aoExtent), transparent: true, opacity: 0.55, depthWrite: false,
  }));
  aoOverlay.rotation.x = -Math.PI / 2;
  aoOverlay.position.y = 0.004;
  aoOverlay.renderOrder = -1;
  scene.add(aoOverlay);

  // stone lanterns at the plinth's four corners; the two far ones carry lights
  lanternGroup = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x5b646b, roughness: 0.85, envMapIntensity: 0.3 });
  litMaterials.push(stone);
  const postGeom = new THREE.BoxGeometry(0.26, 0.42, 0.26);
  const capGeom = new THREE.ConeGeometry(0.26, 0.2, 4);
  const flameGeom = new THREE.SphereGeometry(0.075, 12, 8);
  const lc = pl / 2 - 0.2;
  const haloMat = new THREE.SpriteMaterial({
    map: makeRadialTexture('rgba(255,170,80,0.55)', 'rgba(255,140,40,0)'), color: 0xffffff,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  for (const [x, z] of [[-lc, -lc], [lc, -lc], [-lc, lc], [lc, lc]]) {
    const post = new THREE.Mesh(postGeom, stone);
    post.position.set(x, 0.21, z);
    post.castShadow = true;
    const cap = new THREE.Mesh(capGeom, stone);
    cap.position.set(x, 0.62, z);
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff9a2e).multiplyScalar(1.8) });
    const flame = new THREE.Mesh(flameGeom, flameMat);
    flame.position.set(x, 0.5, z);
    flame.userData.phase = x * 1.7 + z * 0.9;
    lanternFlames.push(flame);
    const halo = new THREE.Sprite(haloMat);
    halo.position.set(x, 0.5, z);
    halo.scale.setScalar(0.9);
    lanternGroup.add(post, cap, flame, halo);
    if (z < 0) {
      const light = new THREE.PointLight(0xff9f45, 5, 7, 2);
      light.position.set(x, 0.7, z);
      light.userData.phase = flame.userData.phase;
      light.userData.base = 5;
      lanternLights.push(light);
      lanternGroup.add(light);
    }
  }
  scene.add(lanternGroup);

  // cell tiles (inset number tiles): plain boxes, or rounded glazed tiles
  tileGeomPlain = addBaseShade(new THREE.BoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.5, CELL_SIZE * 0.94));
  tileGeomDetailed = addBaseShade(new RoundedBoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.5, CELL_SIZE * 0.94, 3, 0.07));
  const grain = makeNoiseTexture(128, 0x5a17);
  for (let idx = 0; idx < SIZE * SIZE; idx++) {
    const plain = new THREE.MeshStandardMaterial({ color: tileColor(idx) });
    const detailed = new THREE.MeshPhysicalMaterial({
      color: tileColor(idx), roughness: 0.62, metalness: 0, roughnessMap: grain, bumpMap: grain, bumpScale: 0.6,
      clearcoat: 0.4, clearcoatRoughness: 0.28, envMapIntensity: 0.3,
    });
    tileMatsPlain[idx] = plain;
    tileMatsDetailed[idx] = detailed;
    litMaterials.push(plain, detailed);
    const m = new THREE.Mesh(tileGeomPlain, plain);
    m.position.set(cellX(idx), 0.1, cellZ(idx));
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.cell = idx;
    scene.add(m);
    cellMeshes[idx] = m;
    labelSprites[idx] = null;
    updateCellVisual(idx);
  }

  // selection ring (hidden until a cell is selected); bright enough to bloom
  ringGeom = new THREE.RingGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.62, 48);
  ringMat = new THREE.MeshBasicMaterial({ color: RING_COLOR.clone(), side: THREE.DoubleSide });
  selectedRing = new THREE.Mesh(ringGeom, ringMat);
  selectedRing.rotation.x = -Math.PI / 2;
  selectedRing.position.y = 0.4;
  selectedRing.visible = false;
  scene.add(selectedRing);

  // fireflies drifting around the plinth (never over the grid itself)
  const maxFlies = PARTICLE_COUNT.high;
  const pos = new Float32Array(maxFlies * 3);
  const col = new Float32Array(maxFlies * 3);
  fireflyBase = [];
  let fs = 0x0f1e5;
  const frnd = () => { fs = (fs * 1103515245 + 12345) & 0x7fffffff; return fs / 0x7fffffff; };
  for (let i = 0; i < maxFlies; i++) {
    const a = frnd() * Math.PI * 2, r = pl / 2 + 0.6 + frnd() * 4.5;
    fireflyBase.push({ x: Math.cos(a) * r, y: 0.3 + frnd() * 2.6, z: Math.sin(a) * r, p: frnd() * 100, s: 0.4 + frnd() * 0.8 });
    pos[i * 3] = fireflyBase[i].x; pos[i * 3 + 1] = fireflyBase[i].y; pos[i * 3 + 2] = fireflyBase[i].z;
    col[i * 3] = 1; col[i * 3 + 1] = 0.8; col[i * 3 + 2] = 0.45;
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  fireflies = new THREE.Points(fg, new THREE.PointsMaterial({
    size: 0.2, map: makeRadialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), vertexColors: true,
    color: new THREE.Color(1, 0.85, 0.55).multiplyScalar(2.2), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  gpuName = readGpu();
  detectedPreset = detectPreset(gpuName, isMobileDevice());
  applyGraphics(loadGraphics());
  frameCamera();
}

// Optional authored art. Every load is best-effort: a failure leaves the
// procedural look untouched and never blocks play.
function loadTextures(boardMat, plinthTop, plinthSide) {
  let loader;
  try { loader = new THREE.TextureLoader(); } catch (e) { return; }
  loader.load('./assets/courtyard-stone.webp', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.anisotropy = 4;
    boardMat.map = tex;
    boardMat.needsUpdate = true;
    plinthTop.map = tex;
    plinthTop.needsUpdate = true;
    const side = tex.clone();
    side.repeat.set(3, 0.18);
    side.needsUpdate = true;
    plinthSide.map = side;
    plinthSide.needsUpdate = true;
    render();
  }, undefined, () => { /* keep the flat stone colour */ });
  loader.load('./assets/sanctuary-backdrop.webp', (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    render();
  }, undefined, () => { /* keep the flat backdrop colour */ });
}

function makeTextSprite(text) {
  let mat = spriteCache.get(text);
  if (!mat) {
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.font = 'bold 96px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // a soft dark halo keeps the digit legible over any tile colour
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, size / 2, size / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mat = new THREE.SpriteMaterial({ map: tex, toneMapped: false, depthTest: false, depthWrite: false });
    spriteCache.set(text, mat);
  }
  return new THREE.Sprite(mat);
}

function updateCellVisual(idx) {
  const v = board[idx];
  setTileColor(idx, tileColor(idx));
  const dm = tileMatsDetailed[idx];
  dm.clearcoat = tileFinish(idx);

  // label: remove stale sprite, add the current digit
  const existing = labelSprites[idx];
  if (existing && existing.userData.digit !== v) {
    labelScene.remove(existing);
    labelSprites[idx] = null;
  }
  if (v && !labelSprites[idx]) {
    const sp = makeTextSprite(String(v));
    sp.userData.digit = v;
    sp.position.set(cellX(idx), 0.55, cellZ(idx));
    labelScene.add(sp);
    labelSprites[idx] = sp;
  }
}

function updateSelectionVisual() {
  if (selected === -1) { selectedRing.visible = false; return; }
  selectedRing.visible = true;
  selectedRing.position.set(cellX(selected), 0.4, cellZ(selected));
}

// ---------------------------------------------------------------------------
// Graphics settings: quality presets, per-effect overrides, post-processing
// ---------------------------------------------------------------------------

// Colour grade + vignette (display-space colours in, display-space out).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.26 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // gentle S-curve, a touch more saturation, warm highlights / cool shadows
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.06);
      s *= mix(vec3(0.95, 0.98, 1.06), vec3(1.05, 1.0, 0.95), smoothstep(0.2, 0.8, l));
      float d = length(vUv - 0.5);
      s *= 1.0 - uVignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(s, src.a);
    }`,
};

function loadGraphics() {
  try {
    const raw = localStorage.getItem(GFX_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}

function applyGraphics(saved) {
  gfxSaved = saved && typeof saved === 'object' ? saved : {};
  try { localStorage.setItem(GFX_KEY, JSON.stringify(gfxSaved)); } catch (e) { /* storage unavailable */ }
  const g = resolve(gfxSaved, detectedPreset);
  gfx = g;

  // shadows
  const mapSize = SHADOW_MAP[g.shadows];
  renderer.shadowMap.enabled = mapSize > 0;
  keyLight.castShadow = mapSize > 0;
  if (mapSize > 0 && keyLight.shadow.mapSize.x !== mapSize) {
    keyLight.shadow.mapSize.set(mapSize, mapSize);
    if (keyLight.shadow.map) { keyLight.shadow.map.dispose(); keyLight.shadow.map = null; }
  }
  shadowCatcher.visible = mapSize > 0;

  // detail: rounded glazed tiles, plinth, lanterns
  const detailed = g.detail === 'detailed';
  for (let i = 0; i < cellMeshes.length; i++) {
    cellMeshes[i].geometry = detailed ? tileGeomDetailed : tileGeomPlain;
    cellMeshes[i].material = detailed ? tileMatsDetailed[i] : tileMatsPlain[i];
  }
  boardMesh.visible = !detailed;
  plinth.visible = detailed;
  contactShadow.visible = detailed;
  lanternGroup.visible = detailed;

  // contact occlusion: grout/rim overlay, plus darker tile bases at "high"
  aoOverlay.visible = g.ao !== 'off';
  for (let i = 0; i < tileMatsPlain.length; i++) {
    tileMatsPlain[i].vertexColors = g.ao === 'high';
    tileMatsDetailed[i].vertexColors = g.ao === 'high';
  }

  // image-based reflections
  if (g.reflections === 'on' && !envTexture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTexture = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
  }
  scene.environment = g.reflections === 'on' ? envTexture : null;
  hemi.intensity = g.reflections === 'on' ? 0.75 : 1.25;

  // ambient particles
  fireflies.visible = g.particles !== 'off';
  fireflies.geometry.setDrawRange(0, PARTICLE_COUNT[g.particles]);

  for (const m of litMaterials) m.needsUpdate = true;
  renderer.shadowMap.needsUpdate = true;
  adaptiveScale = 1;
  frameTimes = [];
  postKey = null; // rebuild the post chain on the next frame
  postFailed = false;

  const fpsEl = document.getElementById('fps-meter');
  if (fpsEl) {
    fpsEl.hidden = !g.showFps;
    if (!fpsEl.textContent) fpsEl.textContent = '… fps';
  }
  const ds = document.body.dataset;
  ds.gfxPreset = g.preset;
  ds.gfxAuto = String(g.auto);
  for (const cat of Object.keys(CATEGORIES)) ds['gfx' + cat[0].toUpperCase() + cat.slice(1)] = g[cat];
  render();
}

/** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost summary. */
function graphicsInfo() {
  const px = [Math.round(viewPx[0] * pixelRatio), Math.round(viewPx[1] * pixelRatio)];
  return {
    gpu: gpuName || t('gfx.unknownGpu'),
    detected: detectedPreset,
    resolved: gfx,
    summary: describe(gfx, px, t),
    fps: Math.round(fps),
    postFailed,
  };
}

function buildPost(w, h) {
  if (composer) { composer.dispose(); composer = null; }
  const g = gfx;
  if (!g.post) return;
  try {
    const pw = Math.round(w * pixelRatio), ph = Math.round(h * pixelRatio);
    const target = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0 });
    const c = new EffectComposer(renderer, target);
    c.setPixelRatio(pixelRatio);
    c.setSize(w, h);
    c.addPass(new RenderPass(scene, camera));
    if (g.bloom === 'on') {
      // high threshold: only the lantern flames, fireflies and the selection ring bloom
      c.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.75, 0.55, 0.9));
    }
    c.addPass(new OutputPass());
    if (g.grade === 'on') c.addPass(new ShaderPass(GradeShader));
    if (g.antialias === 'smaa') c.addPass(new SMAAPass(pw, ph));
    if (g.antialias === 'fxaa') {
      const fxaa = new ShaderPass(FXAAShader);
      fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
      c.addPass(fxaa);
    }
    composer = c;
  } catch (e) {
    // Post-processing is an enhancement: render directly and say so in the panel.
    postFailed = true;
    composer = null;
  }
}

// Adaptive resolution: step the render scale down when frames are slow, back up when fast.
function adapt(dt) {
  frameTimes.push(dt);
  if (frameTimes.length < 90) return;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  frameTimes = [];
  fps = 1000 / avg;
  const el = document.getElementById('fps-meter');
  if (el && !el.hidden) el.textContent = `${Math.round(fps)} fps · ${Math.round(pixelRatio * 100) / 100}×`;
  if (!gfx.adaptive) return;
  if (avg > 26) adaptiveScale = Math.max(0.6, adaptiveScale - 0.1);
  else if (avg < 14 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + 0.05);
}

// Gentle ambient motion: firefly drift, lantern flicker, a breathing ring.
function animateScene(dt) {
  if (!motionAllowed()) { ringMat.color.copy(RING_COLOR).multiplyScalar(1.4); return; }
  animTime += dt / 1000;
  const tm = animTime;
  ringMat.color.copy(RING_COLOR).multiplyScalar(1.3 + 0.3 * Math.sin(tm * 2.4));
  if (lanternGroup.visible) {
    for (const f of lanternFlames) {
      const k = 0.85 + 0.15 * Math.sin(tm * 7.1 + f.userData.phase) * Math.sin(tm * 3.3 + f.userData.phase * 2);
      f.scale.setScalar(k);
    }
    for (const l of lanternLights) {
      l.intensity = l.userData.base * (0.85 + 0.15 * Math.sin(tm * 6.3 + l.userData.phase));
    }
  }
  if (fireflies.visible) {
    const pos = fireflies.geometry.attributes.position;
    const col = fireflies.geometry.attributes.color;
    const n = PARTICLE_COUNT[gfx.particles];
    for (let i = 0; i < n; i++) {
      const b = fireflyBase[i];
      const ph = b.p + tm * b.s;
      pos.array[i * 3] = b.x + Math.sin(ph * 0.7) * 0.6;
      pos.array[i * 3 + 1] = b.y + Math.sin(ph * 1.3) * 0.25;
      pos.array[i * 3 + 2] = b.z + Math.cos(ph * 0.5) * 0.6;
      const glow = Math.max(0, Math.sin(ph * 1.9)) ** 2;
      col.array[i * 3] = glow; col.array[i * 3 + 1] = 0.8 * glow; col.array[i * 3 + 2] = 0.45 * glow;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

function render() {
  if (!renderer) return;
  const { w, h } = viewSize();
  const ratio = Math.min(3, Math.min(window.devicePixelRatio || 1, gfx.maxDpr) * gfx.scale * adaptiveScale);
  if (w !== viewPx[0] || h !== viewPx[1] || ratio !== pixelRatio) {
    viewPx = [w, h];
    pixelRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
  }
  const key = gfx.post ? [gfx.bloom, gfx.grade, gfx.antialias, w, h, pixelRatio].join('|') : 'none';
  if (key !== postKey) { postKey = key; buildPost(w, h); }
  if (composer) {
    try { composer.render(); } catch (e) { postFailed = true; composer.dispose(); composer = null; renderer.render(scene, camera); }
  } else {
    renderer.render(scene, camera);
  }
  // digits last, straight to the canvas: never bloomed, occluded or tone-mapped
  renderer.setRenderTarget(null);
  renderer.autoClear = false;
  renderer.render(labelScene, camera);
  renderer.autoClear = true;
}

// ---------------------------------------------------------------------------
// DOM / UI wiring (semantic HTML over the canvas)
// ---------------------------------------------------------------------------

const statusTextEl = document.getElementById('status-text');
const progressFillEl = document.getElementById('progress-fill');
const progressBarEl = document.getElementById('progress-bar');
const overlayEl = document.getElementById('overlay');
const modeBtns = Array.from(document.querySelectorAll('.mode-btn'));
const padEl = document.getElementById('number-pad');
const actionBtns = Array.from(document.querySelectorAll('.action-btn'));
const noteBtn = document.querySelector('.action-btn[data-action="note"]');
const cellReadoutEl = document.getElementById('cell-readout');
const playerLineEl = document.getElementById('player-line');
const playerNameEl = document.getElementById('player-name');
const syncStatusEl = document.getElementById('sync-status');

// Apply the active locale to every statically authored string in index.html.
// Elements carry data-i18n (text) and/or data-i18n-aria-label.
function applyStaticStrings() {
  document.documentElement.lang = getLocale();
  document.title = t('app.title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  }
  reflectKeys();
}

// Action-button labels end in their key, e.g. "Hint (H)": show the effective
// binding (platform rebinds included) in place of the authored default.
const KEYED_BUTTONS = { note: 'note', hint: 'hint', clear: 'clear', restart: 'restart', pause: 'pause', mute: 'mute' };
function reflectKeys() {
  for (const [action, bind] of Object.entries(KEYED_BUTTONS)) {
    const btn = document.querySelector(`.action-btn[data-action="${action}"]`);
    if (!btn) continue;
    const key = keyLabel((keyBindings[bind] || [])[0]);
    btn.textContent = btn.textContent.replace(/\(([^)]*)\)\s*$/, key ? `(${key})` : '').trim();
  }
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateStatus() {
  const bestTxt = best[difficulty] != null ? t('status.best', { best: best[difficulty] }) : '';
  statusTextEl.textContent = t('status.line', {
    difficulty: t('diff.' + difficulty),
    filled: filledCount(),
    score: computeScore(),
    mistakes,
    time: fmtTime(elapsedSeconds()),
  }) + bestTxt;
  if (cellReadoutEl) {
    let value;
    if (board[selected]) {
      value = given[selected] ? t('cell.fixed', { digit: board[selected] }) : String(board[selected]);
    } else {
      value = notes.has(selected) ? t('cell.marked') : t('cell.empty');
    }
    cellReadoutEl.textContent = selected === -1
      ? t('cell.none')
      : t('cell.at', { row: Math.floor(selected / SIZE) + 1, col: (selected % SIZE) + 1, value });
  }
}

function setProgress(p) {
  const pct = Math.round(p * 100);
  progressFillEl.style.width = pct + '%';
  if (progressBarEl) {
    progressBarEl.setAttribute('aria-valuenow', String(pct));
    progressBarEl.setAttribute('aria-valuetext', pct + '% complete');
  }
}

function showOverlay(html, kind) {
  overlayEl.className = 'overlay ' + (kind || '');
  overlayEl.innerHTML = html;
}
function hideOverlay() { overlayEl.className = 'overlay hidden'; overlayEl.textContent = ''; }

function refresh() {
  updateSelectionVisual();
  render();
  updateStatus();
  setProgress(computeProgress());
  if (padEl) {
    for (const b of padEl.querySelectorAll('.pad-btn[data-digit]')) {
      const d = Number(b.dataset.digit);
      let used = 0;
      for (let i = 0; i < SIZE * SIZE; i++) if (board[i] === d) used++;
      b.classList.toggle('exhausted', used >= SIZE);
    }
  }
  if (noteBtn) noteBtn.setAttribute('aria-pressed', String(selected !== -1 && notes.has(selected)));
  saveStore();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function selectCell(idx) {
  if (paused || gameOver) return;
  selected = idx;
  audio.playSelect();
  refresh();
}

function enterDigit(d) {
  if (paused || gameOver || selected === -1) return;
  if (given[selected]){ audio.playInvalid(); flashInvalid(selected); return; }
  if (board[selected] === d) { eraseCell(); return; }
  if (!isLegal(selected, d)) {
    mistakes++;
    audio.playInvalid();
    flashInvalid(selected);
    refresh();
    return;
  }
  applyDigit(selected, d);
  audio.playPlace();
  updateCellVisual(selected);
  if (isSolved()) finishRound();
  else refresh();
}

function eraseCell() {
  if (paused || gameOver || selected === -1 || given[selected]) return;
  const had = !!board[selected] || notes.has(selected);
  if (board[selected]) { board[selected] = 0; moves = Math.max(0, moves - 1); }
  notes.delete(selected);
  if (had) audio.playErase();
  updateCellVisual(selected);
  refresh();
}

function toggleNote() {
  if (paused || gameOver || selected === -1 || board[selected]) return;
  if (notes.has(selected)) notes.delete(selected); else notes.add(selected);
  updateCellVisual(selected);
  refresh();
}

let flashTimer = null;
function flashInvalid(idx) {
  setTileColor(idx, COLOR_INVALID);
  render();
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { updateCellVisual(idx); render(); }, 220);
}

function finishRound() {
  if (completedElapsed === null) completedElapsed = elapsedSeconds();
  gameOver = true;
  const p = scoreParts();
  if (best[difficulty] == null || p.total > best[difficulty]) best[difficulty] = p.total;
  audio.playSolve();
  for (let i = 0; i < SIZE * SIZE; i++) updateCellVisual(i);
  selected = -1;
  showOverlay(
    `<h2>${t('overlay.complete')}</h2>` +
    `<ul class="score-list">` +
    `<li>${t('score.placed')} <span>${p.placed}</span></li>` +
    `<li>${t('score.mistakes', { n: mistakes })} <span>${p.mistakePenalty}</span></li>` +
    `<li>${t('score.hints', { n: hints })} <span>${p.hintPenalty}</span></li>` +
    `<li>${t('score.solve')} <span>${p.solveBonus}</span></li>` +
    `<li>${t('score.time', { time: fmtTime(elapsedSeconds()) })} <span>${p.timeBonus}</span></li>` +
    `<li class="total">${t('score.total')} <span>${p.total}</span></li>` +
    `</ul><p class="hint-line">${t('overlay.again')}</p>`,
    'results');
  refresh();
}

function showHint() {
  if (paused || gameOver) return;
  // fill the selected cell when it is open, otherwise the first open cell
  let target = (selected !== -1 && !given[selected] && board[selected] !== grid[selected]) ? selected : -1;
  if (target === -1) {
    for (let i = 0; i < SIZE * SIZE; i++) if (!given[i] && board[i] !== grid[i]) { target = i; break; }
  }
  if (target === -1) return;
  hints++;
  applyDigit(target, grid[target]);
  selected = target;
  audio.playHint();
  updateCellVisual(target);
  if (isSolved()) finishRound();
  else refresh();
}

function clearBoard() {
  // remove all player digits and marks, keeping the same puzzle
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (!given[i] && board[i]) { board[i] = 0; updateCellVisual(i); }
  }
  notes.clear();
  for (let i = 0; i < SIZE * SIZE; i++) updateCellVisual(i);
  moves = 0; mistakes = 0; hints = 0;
  selected = -1; gameOver = false; completedElapsed = null;
  resumeIfPaused();
  startTime = Date.now(); pausedTotal = 0;
  hideOverlay();
  refresh();
}

function restartRound() {
  buildPuzzle(nextSeed());
  notes.clear();
  moves = 0; mistakes = 0; hints = 0;
  selected = -1; gameOver = false; completedElapsed = null;
  resumeIfPaused();
  startTime = Date.now(); pausedTotal = 0;
  for (let i = 0; i < SIZE * SIZE; i++) updateCellVisual(i);
  hideOverlay();
  refresh();
}

function resumeIfPaused() {
  if (!paused) return;
  pausedTotal += Date.now() - pausedAt;
  paused = false;
}

function setPaused(next) {
  if (gameOver || next === paused) return;
  if (next) {
    paused = true;
    pausedAt = Date.now();
    audio.playPause();
    showOverlay(`<h2>${t('overlay.paused')}</h2><p class="hint-line">${t('overlay.pausedHint')}</p>` +
      `<div class="overlay-actions"><button type="button" id="resume-btn" class="action-btn">${t('btn.resume')}</button>` +
      `<button type="button" id="pause-settings-btn" class="action-btn" aria-haspopup="dialog">${t('settings.button')}</button></div>`, 'paused');
    const rb = document.getElementById('resume-btn');
    if (rb) rb.addEventListener('click', () => setPaused(false));
    const sb = document.getElementById('pause-settings-btn');
    if (sb) sb.addEventListener('click', () => openSettings(sb));
  } else {
    resumeIfPaused();
    audio.playResume();
    hideOverlay();
  }
  refresh();
}

function togglePause() { setPaused(!paused); }

function setMuted(next) {
  muted = next;
  audio.setMuted(muted);
  const btn = document.querySelector('.action-btn[data-action="mute"]');
  if (btn) {
    btn.setAttribute('aria-pressed', String(muted));
    btn.textContent = muted ? t('btn.unmute') : t('btn.mute');
    reflectKeys();
  }
}

// ---------------------------------------------------------------------------
// Input handling: pointer (click/tap), keyboard, on-screen pad
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  pickCell(e.clientX - rect.left, e.clientY - rect.top);
});

function pickCell(px, py) {
  const { w, h } = viewSize();
  pointerNdc.set((px / w) * 2 - 1, -(py / h) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
  const hits = raycaster.intersectObjects(cellMeshes, false);
  if (!hits.length) {
    selected = -1;
    refresh();
    return;
  }
  selectCell(hits[0].object.userData.cell);
}

function moveSelection(dr, dc) {
  if (paused || gameOver) return;
  if (selected === -1) { selectCell(40); return; }
  const r = Math.min(SIZE - 1, Math.max(0, Math.floor(selected / SIZE) + dr));
  const c = Math.min(SIZE - 1, Math.max(0, (selected % SIZE) + dc));
  selectCell(r * SIZE + c);
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isSettingsOpen()) return; // the Settings dialog owns the keyboard while open
  const tag = (e.target && e.target.tagName) || '';
  const typingTarget = tag === 'INPUT' || tag === 'TEXTAREA';
  if (typingTarget) return;
  // let Enter/Space activate a focused button normally
  if ((e.key === 'Enter' || e.key === ' ') && tag === 'BUTTON') return;

  const act = keyAction(e.code);
  if (!act) return;
  if (act.startsWith('digit')) {
    enterDigit(parseInt(act.slice(5), 10));
    e.preventDefault();
  } else if (act === 'erase') {
    eraseCell();
    e.preventDefault();
  } else if (act === 'up') { moveSelection(-1, 0); e.preventDefault(); }
  else if (act === 'down') { moveSelection(1, 0); e.preventDefault(); }
  else if (act === 'left') { moveSelection(0, -1); e.preventDefault(); }
  else if (act === 'right') { moveSelection(0, 1); e.preventDefault(); }
  else if (act === 'note') toggleNote();
  else if (act === 'hint') showHint();
  else if (act === 'clear') clearBoard();
  else if (act === 'restart') restartRound();
  else if (act === 'pause') togglePause();
  else if (act === 'mute') { setMuted(!muted); pushPlatformSettings(); }
  else if (act === 'menu' && !paused && !gameOver) setPaused(true);
});

if (padEl) {
  padEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.pad-btn');
    if (!btn) return;
    if (btn.dataset.digit) enterDigit(Number(btn.dataset.digit));
    else if (btn.dataset.action === 'erase') eraseCell();
  });
}

for (const btn of actionBtns) {
  btn.addEventListener('click', () => {
    switch (btn.dataset.action) {
      case 'note': toggleNote(); break;
      case 'hint': showHint(); break;
      case 'clear': clearBoard(); break;
      case 'restart': restartRound(); break;
      case 'pause': togglePause(); break;
      case 'mute': setMuted(!muted); pushPlatformSettings(); break;
    }
  });
}

window.addEventListener('resize', resize);
// The stage and the HUD panels change size without a window resize (chat
// sidebar, orientation, pad contents): keep the renderer and framing in sync.
if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement || canvas);
  for (const el of document.querySelectorAll('.stage .panel')) ro.observe(el);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

// ---------------------------------------------------------------------------
// Mode and difficulty switching (UI buttons)
// ---------------------------------------------------------------------------

function setActiveMode(m) {
  mode = m;
  modeBtns.forEach((b) => {
    const on = b.dataset.mode === m;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  // difficulty: learn & practice easy, journey medium, daily/challenge hard
  if (m === 'learn' || m === 'practice') difficulty = 'easy';
  else if (m === 'journey') difficulty = 'medium';
  else difficulty = 'hard';
}

modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveMode(btn.dataset.mode);
    audio.playMode();
    restartRound();
  });
});

// ---------------------------------------------------------------------------
// StarHermit platform hookup: inert without a launch token, so local/offline
// play makes no network calls and shows no account line
// ---------------------------------------------------------------------------

const accountSection = document.getElementById('account-section');
const signInBtn = document.getElementById('sh-sign-in');
const inviteBtn = document.getElementById('sh-invite');
const accountHint = document.getElementById('account-hint');
const shToast = document.getElementById('sh-toast');
let _toastTimer = null;
function showToast(msg) {
  if (!shToast) return;
  shToast.textContent = msg;
  shToast.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { shToast.hidden = true; }, 3200);
}
// Settings → Account: sign-in only when the platform can offer it (on
// *.starhermit.com without a token), invite only when signed in.
function reflectAccount() {
  const canSignIn = platform.canSignIn();
  const canInvite = !!platform.inviteLink();
  if (signInBtn) signInBtn.hidden = !canSignIn;
  if (accountHint) accountHint.hidden = !canSignIn;
  if (inviteBtn) inviteBtn.hidden = !canInvite;
  if (accountSection) accountSection.hidden = !canSignIn && !canInvite;
}
if (signInBtn) signInBtn.addEventListener('click', () => platform.signIn());
if (inviteBtn) inviteBtn.addEventListener('click', async () => {
  const link = platform.inviteLink();
  if (!link) return;
  try { await navigator.clipboard.writeText(link); showToast(t('account.copied')); }
  catch (e) { showToast(t('account.copyFailed')); }
});

// Player preferences mirrored to the platform settings KV.
function pushPlatformSettings() {
  platform.patchSettings({ muted, graphics: gfxSaved, locale: getLocale() });
}

let _wasSignedIn = false;
platform.init({
  onProfile(name) {
    if (playerNameEl) playerNameEl.textContent = name;
    if (playerLineEl) playerLineEl.hidden = false;
  },
  onSync(state) {
    if (syncStatusEl) syncStatusEl.textContent = t('sync.' + state);
  },
  onAuth(a) {
    if (a.signedIn === _wasSignedIn) return; // token renewals change nothing visible
    _wasSignedIn = a.signedIn;
    if (!a.signedIn) {
      if (playerLineEl) playerLineEl.hidden = true;
      showToast(t('account.signedOut'));
    }
    reflectAccount();
  },
});
_wasSignedIn = platform.hasSession();
reflectAccount();

// ---------------------------------------------------------------------------
// Boot: restore (cloud-preferred when hosted) or build a round, then render.
// Without a token the cloud probe is skipped entirely — offline boot is
// unchanged.
// ---------------------------------------------------------------------------

setRulesSeed((Date.now() ^ 0x5EED) >>> 0);
let cloudDoc = null;
if (platform.hasSession()) {
  cloudDoc = await Promise.race([
    platform.loadCloud(),
    new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
  ]);
}
const saved = loadStore();
const savedRound = saved && saved.round;
let restored = !!(savedRound && restoreRound(savedRound));
// Remote-preferred load: a differing remote doc wins over the local cache.
if (cloudDoc && typeof cloudDoc === 'object') {
  const localSnap = JSON.stringify({ best: (saved && saved.best) || {}, round: savedRound || null });
  const cloudSnap = JSON.stringify({ best: cloudDoc.best || {}, round: cloudDoc.round || null });
  if (cloudSnap !== localSnap) {
    if (cloudDoc.best && typeof cloudDoc.best === 'object') best = cloudDoc.best;
    restored = restoreRound(cloudDoc.round) || restored;
  }
}
if (!restored) {
  setActiveMode(mode);
  buildPuzzle(nextSeed());
} else {
  setActiveMode(mode);
}
// Account preferences (settings KV) win over local values when signed in.
const platformSettings = platform.hasSession()
  ? await Promise.race([platform.getSettings(), new Promise((r) => setTimeout(() => r(null), 1500))])
  : null;
if (platformSettings && typeof platformSettings.locale === 'string') setLocale(platformSettings.locale);
keyBindings = platform.hasSession()
  ? await Promise.race([platform.loadBindings(KEY_DEFAULTS), new Promise((r) => setTimeout(() => r(structuredClone(KEY_DEFAULTS)), 1500))])
  : keyBindings;
applyStaticStrings();
try {
  initThree();
} catch (e) {
  const msg = document.createElement('p');
  msg.setAttribute('role', 'alert');
  msg.style.cssText = 'position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;padding:1.5rem;text-align:center;background:#1a2026;color:#eee;font:1rem system-ui,sans-serif';
  msg.textContent = 'Number Sanctuary needs WebGL, which is unavailable in this browser. Your settings and progress are preserved.';
  document.body.appendChild(msg);
  throw e;
}
// Settings dialog (Graphics section). Opening it pauses a running round.
initSettings({
  t,
  getSaved: () => gfxSaved,
  apply: (next) => { applyGraphics(next); pushPlatformSettings(); },
  info: graphicsInfo,
  onOpen: () => { if (!paused && !gameOver) setPaused(true); },
});
if (platformSettings && platformSettings.graphics && typeof platformSettings.graphics === 'object') applyGraphics(platformSettings.graphics);
if (platformSettings && typeof platformSettings.muted === 'boolean') muted = platformSettings.muted;
setMuted(muted);
if (gameOver) finishRound();
else refresh();

let _rafId = null;
let _lastStatus = 0;
function animate(ts) {
  _rafId = requestAnimationFrame(animate);
  if (document.hidden) { lastFrameTs = 0; return; }
  const now = performance.now();
  const dt = lastFrameTs ? Math.min(250, now - lastFrameTs) : 16;
  lastFrameTs = now;
  adapt(dt);
  animateScene(dt);
  render();
  // clock in the HUD only needs second-level updates
  if (!paused && !gameOver && ts - _lastStatus > 500) { _lastStatus = ts; updateStatus(); }
}
animate(0);

window.addEventListener('pagehide', saveStore);

export const Game = {
  get state() {
    return {
      board: board.slice(), solution: grid.slice(), given: given.slice(),
      notes: Array.from(notes), selected, mode, difficulty,
      moves, mistakes, hints, paused, muted, gameOver,
      score: computeScore(), progress: computeProgress(), seed: puzzleSeed,
      locale: getLocale(),
    };
  },
  // project a cell centre to page coordinates (used by the automated QA pass)
  project(idx) {
    const rect = canvas.getBoundingClientRect();
    const v = new THREE.Vector3(cellX(idx), 0.35, cellZ(idx)).project(camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * canvas.clientWidth,
      y: rect.top + ((1 - v.y) / 2) * canvas.clientHeight,
    };
  },
};
