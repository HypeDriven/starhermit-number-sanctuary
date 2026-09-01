'use strict';

const THREE = window.THREE;
import { generateGrid, countSolutions, makePuzzle } from './rules.js';

// ---------------------------------------------------------------------------
// Constants and static data
// ---------------------------------------------------------------------------

const SIZE = 9;
const BOX = 3;

const MODES = ['learn', 'journey', 'daily', 'practice', 'challenge'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];

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
let notes = new Set();                           // note cell indices
let given = new Array(SIZE * SIZE).fill(false);  // fixed cells
let selected = -1;                               // selected cell index (-1 none)
let mode = 'learn';                              // active mode
let difficulty = 'easy';                         // active difficulty
let score = 0;                                   // current score (integer units)
let mistakes = 0;                                // count of invalid actions
let moves = 0;                                  // count of placed digits
let startTime = Date.now();                      // round start timestamp
let paused = false;                              // pause flag
let muted = false;                               // mute flag
let gameOver = false;                            // terminal (solved) flag

// ---------------------------------------------------------------------------
// Puzzle construction per mode/difficulty
// ---------------------------------------------------------------------------

function buildPuzzle() {
  const g = generateGrid(1234567);
  let s = 0x5EED ^ (mode.length * 7919) ^ (difficulty.charCodeAt(difficulty.length - 1));
  // deterministic shuffle of positions to vary which cells are removed
  const order = new Array(SIZE * SIZE);
  for (let i = 0; i < order.length; i++) order[i] = i;
  let s2 = (s ^ 0x9E37) >>> 0;
  const rnd = () => {
    s2 |= 0; s2 = (s2 + 0x6D2B79F5) | 0;
    let t = Math.imul(s2 ^ (s2 >>> 15), 1 | s2);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  // remove cells: easy fewer, medium more, hard most
  const targetRemoved = difficulty === 'easy' ? 40 : difficulty === 'medium' ? 52 : 60;
  let removedCount = 0;
  for (const pos of order) {
    if (g[pos] && removedCount < targetRemoved) { board[pos] = 0; given[pos] = false; removedCount++; }
    else { given[pos] = true; }
  }
}

// ---------------------------------------------------------------------------
// Scoring and progress
// ---------------------------------------------------------------------------

function computeScore() {
  // base per placed digit + difficulty weight, integer units only
  const diffWeight = difficulty === 'easy' ? 10 : difficulty === 'medium' ? 20 : 30;
  return moves * diffWeight - mistakes * 5;
}

function computeProgress() {
  // fraction of cells correctly filled (0..1)
  let correct = 0;
  for (let i = 0; i < SIZE * SIZE; i++) if (board[i] === grid[i]) correct++;
  return correct / (SIZE * SIZE);
}

function elapsedSeconds() {
  return Math.floor((Date.now() - startTime) / 1000);
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
  // verify each row/col/box has all digits once
  const usedRow = new Array(SIZE).fill(0).map(() => new Array(SIZE + 1).fill(false));
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const d = board[r * SIZE + c];
      if (!d) return false;
      usedRow[r][d] = true;
    }
  // columns and boxes checked implicitly by full fill + rows? need explicit:
  for (let c = 0; c < SIZE; c++) {
    const seen = new Array(SIZE + 1).fill(false);
    let ok = true;
    for (let r = 0; r < SIZE; r++) { if (!board[r * SIZE + c]) return false; if (seen[board[r * SIZE + c]]) { ok = false; break; } seen[board[r * SIZE + c]] = true; }
    if (!ok) return false;
  }
  for (let b = 0; b < BOX * BOX; b++) {
    const br = Math.floor(b / BOX), bc = b % BOX;
    const seen = new Array(SIZE + 1).fill(false);
    let ok = true;
    for (let i = 0; i < BOX && ok; i++)
      for (let j = 0; j < BOX; j++) { if (!seen[board[(br * BOX + i) * SIZE + bc * BOX + j]]) seen[board[(br * BOX + i) * SIZE + bc * BOX + j]] = true; else ok = false; }
    if (!ok) return false;
  }
  return true;
}

function applyDigit(cell, digit) {
  board[cell] = digit;
  notes.delete(cell);
  moves++;
}

// ---------------------------------------------------------------------------
// Three.js scene: meditative stone courtyard with inset number tiles
// ---------------------------------------------------------------------------

const canvas = document.getElementById('scene-canvas');
let renderer, scene, camera;
let cellMeshes = [];      // per-cell tile meshes (instanced? using individual for clarity)
let labelSprites = [];     // digit labels
let ringGeom, ringMat;
let selectedRing;         // selection highlight ring

const CELL_SIZE = 1.0;
const GAP = 0.06;

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);

  // lighting: one dominant key + soft fill
  const amb = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(4, 8, 6);
  scene.add(dir);

  // board plane (stone courtyard base)
  const boardGeom = new THREE.PlaneGeometry(SIZE * CELL_SIZE + GAP * SIZE, SIZE * CELL_SIZE + GAP * SIZE);
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x3a4750 });
  const boardMesh = new THREE.Mesh(boardGeom, boardMat);
  boardMesh.rotation.x = -Math.PI / 2;
  scene.add(boardMesh);

  // cell tiles (inset number tiles)
  const tileGeom = new THREE.BoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.94, CELL_SIZE * 0.5);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const idx = r * SIZE + c;
      let col;
      if (!board[idx]) col = 0x2b6cb0;          // empty: blue
      else if (given[idx]) col = 0xc05621;       // given: orange-red
      else col = 0x2f855a;                       // placed: green
      const mat = new THREE.MeshStandardMaterial({ color: col });
      const m = new THREE.Mesh(tileGeom, mat);
      const x = (c - SIZE / 2 + 0.5) * CELL_SIZE;
      const z = (r - SIZE / 2 + 0.5) * CELL_SIZE;
      m.position.set(x, 0.1, z);
      scene.add(m);
      cellMeshes[idx] = m;

      // digit label sprite
      if (board[idx]) {
        const sp = makeTextSprite(String(board[idx]));
        sp.position.set(x, 0.55, z);
        scene.add(sp);
        labelSprites[idx] = sp;
      } else {
        labelSprites[idx] = null;
      }
    }
  }

  // selection ring (hidden until a cell is selected)
  ringGeom = new THREE.RingGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.62, 32);
  ringMat = new THREE.MeshBasicMaterial({ color: 0xf6e05e });
  selectedRing = new THREE.Mesh(ringGeom, ringMat);
  selectedRing.rotation.x = -Math.PI / 2;
  selectedRing.visible = false;
  scene.add(selectedRing);

  // camera framing constants (no magic offsets)
  const dist = SIZE * CELL_SIZE * 1.05 + 3;
  camera.position.set(0, dist * 0.75, dist);
  camera.lookAt(0, 0, 0);
}

function makeTextSprite(text) {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 96px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.SpriteMaterial({ map: tex });
  return new THREE.Sprite(mat);
}

function updateCellVisual(idx) {
  const v = board[idx];
  let col;
  if (!v) col = 0x2b6cb0;
  else if (given[idx]) col = 0xc05621;
  else col = 0x2f855a;
  cellMeshes[idx].material.color.setHex(col);

  // label: remove old, add new if digit present
  const x = ((idx % SIZE) - SIZE / 2 + 0.5) * CELL_SIZE;
  const z = (Math.floor(idx / SIZE) - SIZE / 2 + 0.5) * CELL_SIZE;
  if (!v && labelSprites[idx]) { scene.remove(labelSprites[idx]); labelSprites[idx] = null; }
  else if (v && !labelSprites[idx]) {
    const sp = makeTextSprite(String(v));
    sp.position.set(x, 0.55, z);
    scene.add(sp);
    labelSprites[idx] = sp;
  }

  // selection ring follows selected cell
  if (selected === idx) {
    selectedRing.visible = true;
    selectedRing.position.set(x, 0.12, z);
  } else {
    selectedRing.visible = false;
  }
}

function render() { renderer.render(scene, camera); }

// ---------------------------------------------------------------------------
// DOM / UI wiring (semantic HTML over the canvas)
// ---------------------------------------------------------------------------

const statusTextEl = document.getElementById('status-text');
const progressFillEl = document.getElementById('progress-fill');
const overlayEl = document.getElementById('overlay');
const modeBtns = Array.from(document.querySelectorAll('.mode-btn'));

function updateStatus() {
  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  statusTextEl.textContent = `${diffLabel} · ${moves}/${SIZE * SIZE}`;
}

function setProgress(p) { progressFillEl.style.width = (p * 100) + '%'; }

function showOverlay(msg, kind) {
  overlayEl.className = 'overlay ' + kind;
  overlayEl.textContent = msg;
}
function hideOverlay() { overlayEl.className = 'overlay hidden'; }

// ---------------------------------------------------------------------------
// Input handling: pointer (click/tap), keyboard
// ---------------------------------------------------------------------------

let dragging = false;

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  renderer.domElement.dispatchEvent(new Event('noop')); // no-op
  pickCell(x, y);
});

function pickCell(px, py) {
  const v = new THREE.Vector2((px / canvas.clientWidth) * 2 - 1, -(py / canvas.clientHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(v, camera);
  // test against cell tiles only (explicit interaction layer)
  let hitIdx = -1;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const inter = ray.ray.intersectSphere(new THREE.Sphere(cellMeshes[i].position, CELL_SIZE * 0.5), new THREE.Vector3());
    if (inter) { hitIdx = i; break; }
  }
  if (hitIdx === -1) { selected = -1; updateCellVisual(selected); render(); return; }

  const cell = hitIdx, val = board[cell];
  // toggle note on empty cells with no value? notes only when digit present handled elsewhere
  if (!val && !given[cell]) { /* will be set by number press */ }
  selected = cell;
  updateCellVisual(cell);
  render();
}

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  // digits place into selected cell if empty or replaceable
  if (k >= '1' && k <= '9') {
    const d = parseInt(k, 10);
    if (selected !== -1 && (!board[selected] || !given[selected])) {
      applyDigit(selected, d);
      updateCellVisual(selected);
      render();
    } else if (selected === -1) {
      // no selection: nothing to place
    }
  } else if (k === 'n' || k === 'u') {
    // toggle note on selected cell
    if (selected !== -1 && !board[selected]) {
      if (notes.has(selected)) notes.delete(selected); else notes.add(selected);
    }
    render();
  } else if (k === 'h') {
    showHint();
  } else if (k === 'c') {
    clearBoard();
  } else if (k === 'r') {
    restartRound();
  } else if (k === 'p') {
    togglePause();
  } else if (k === 'm') {
    muted = !muted;
  }
});

function showHint() {
  // find first empty non-given cell and fill with solution digit
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (!board[i] && !given[i]) { applyDigit(i, grid[i]); updateCellVisual(i); render(); return; }
  }
}

function clearBoard() {
  // remove all non-given digits and notes
  for (let i = 0; i < SIZE * SIZE; i++) if (!given[i] && board[i]) { board[i] = 0; updateCellVisual(i); }
  notes.clear();
  moves = 0; mistakes = 0; score = computeScore();
  selected = -1; gameOver = false; paused = false;
  render(); updateStatus(); setProgress(computeProgress()); hideOverlay();
}

function restartRound() {
  // rebuild the puzzle for current mode/difficulty and reset state
  buildPuzzle();
  notes.clear(); moves = 0; mistakes = 0; score = computeScore();
  selected = -1; gameOver = false; paused = false; startTime = Date.now();
  render(); updateStatus(); setProgress(computeProgress()); hideOverlay();
}

function togglePause() { paused = !paused; }

// ---------------------------------------------------------------------------
// Mode and difficulty switching (UI buttons)
// ---------------------------------------------------------------------------

modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const m = btn.dataset.mode;
    mode = m;
    modeBtns.forEach((b) => b.classList.toggle('active', b === btn));
    // difficulty: learn & practice easy, journey medium, daily/challenge hard
    if (m === 'learn' || m === 'practice') difficulty = 'easy';
    else if (m === 'journey') difficulty = 'medium';
    else difficulty = 'hard';
    restartRound();
  });
});

// ---------------------------------------------------------------------------
// Boot: build initial puzzle and start rendering loop
// ---------------------------------------------------------------------------

buildPuzzle();
initThree();
updateStatus();
setProgress(computeProgress());

let _rafId = null;
function animate() {
  _rafId = requestAnimationFrame(animate);
  render();
}
animate();

export const Game = {
  get state() { return { board: board.slice(), notes: Array.from(notes), selected, mode, difficulty }; },
};
