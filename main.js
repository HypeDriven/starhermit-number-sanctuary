'use strict';

const THREE = window.THREE;
import { generateGrid, makePuzzle } from './rules.js';
import * as audio from './audio.js';

// ---------------------------------------------------------------------------
// Constants and static data
// ---------------------------------------------------------------------------

const SIZE = 9;
const BOX = 3;

const MODES = ['learn', 'journey', 'daily', 'practice', 'challenge'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const STORE_KEY = 'number-sanctuary:v1';

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
// Persistence (local only — never store host or launch tokens)
// ---------------------------------------------------------------------------

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (data.best && typeof data.best === 'object') best = data.best;
    return data.round || null;
  } catch (e) { return null; }
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      best,
      round: {
        mode, difficulty, puzzleSeed, moves, mistakes, hints, gameOver,
        board, given, notes: Array.from(notes),
        elapsed: elapsedSeconds(),
      },
    }));
  } catch (e) { /* storage unavailable or full: play continues */ }
}

function restoreRound(r) {
  if (!r || !MODES.includes(r.mode) || !DIFFICULTIES.includes(r.difficulty)) return false;
  if (!Array.isArray(r.board) || r.board.length !== SIZE * SIZE) return false;
  if (!Array.isArray(r.given) || r.given.length !== SIZE * SIZE) return false;
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
let cellMeshes = [];      // per-cell tile meshes (interaction layer)
let labelSprites = [];     // digit labels
let ringGeom, ringMat;
let selectedRing;         // selection highlight ring
const spriteCache = new Map(); // digit -> shared texture

const CELL_SIZE = 1.0;
const GAP = 0.06;
const COLOR_EMPTY = 0x2b6cb0;
const COLOR_GIVEN = 0xc05621;
const COLOR_PLACED = 0x2f855a;
const COLOR_NOTE = 0x6b46c1;

function cellX(idx) { return ((idx % SIZE) - SIZE / 2 + 0.5) * CELL_SIZE; }
function cellZ(idx) { return (Math.floor(idx / SIZE) - SIZE / 2 + 0.5) * CELL_SIZE; }

function viewSize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

// Frame the whole board regardless of aspect: on narrow/portrait viewports the
// camera pulls back so no column falls off screen.
function frameCamera() {
  const { w, h } = viewSize();
  camera.aspect = w / h;
  const boardSpan = SIZE * CELL_SIZE + GAP * SIZE;
  const vFov = (camera.fov * Math.PI) / 180;
  const distV = (boardSpan * 0.75) / Math.tan(vFov / 2);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distH = (boardSpan * 0.6) / Math.tan(hFov / 2);
  const dist = Math.max(distV, distH, SIZE * CELL_SIZE * 1.05 + 3);
  camera.position.set(0, dist * 0.75, dist * 0.72);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function resize() {
  const { w, h } = viewSize();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  frameCamera();
  render();
}

function tileColor(idx) {
  if (board[idx]) return given[idx] ? COLOR_GIVEN : COLOR_PLACED;
  return notes.has(idx) ? COLOR_NOTE : COLOR_EMPTY;
}

function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

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
  const tileGeom = new THREE.BoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.5, CELL_SIZE * 0.94);
  for (let idx = 0; idx < SIZE * SIZE; idx++) {
    const mat = new THREE.MeshStandardMaterial({ color: tileColor(idx) });
    const m = new THREE.Mesh(tileGeom, mat);
    m.position.set(cellX(idx), 0.1, cellZ(idx));
    m.userData.cell = idx;
    scene.add(m);
    cellMeshes[idx] = m;
    labelSprites[idx] = null;
    updateCellVisual(idx);
  }

  // selection ring (hidden until a cell is selected)
  ringGeom = new THREE.RingGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.62, 32);
  ringMat = new THREE.MeshBasicMaterial({ color: 0xf6e05e, side: THREE.DoubleSide });
  selectedRing = new THREE.Mesh(ringGeom, ringMat);
  selectedRing.rotation.x = -Math.PI / 2;
  selectedRing.position.y = 0.4;
  selectedRing.visible = false;
  scene.add(selectedRing);

  resize();
}

function makeTextSprite(text) {
  let mat = spriteCache.get(text);
  if (!mat) {
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
    mat = new THREE.SpriteMaterial({ map: tex });
    spriteCache.set(text, mat);
  }
  return new THREE.Sprite(mat);
}

function updateCellVisual(idx) {
  const v = board[idx];
  cellMeshes[idx].material.color.setHex(tileColor(idx));

  // label: remove stale sprite, add the current digit
  const existing = labelSprites[idx];
  if (existing && existing.userData.digit !== v) {
    scene.remove(existing);
    labelSprites[idx] = null;
  }
  if (v && !labelSprites[idx]) {
    const sp = makeTextSprite(String(v));
    sp.userData.digit = v;
    sp.position.set(cellX(idx), 0.55, cellZ(idx));
    scene.add(sp);
    labelSprites[idx] = sp;
  }
}

function updateSelectionVisual() {
  if (selected === -1) { selectedRing.visible = false; return; }
  selectedRing.visible = true;
  selectedRing.position.set(cellX(selected), 0.4, cellZ(selected));
}

function render() { if (renderer) renderer.render(scene, camera); }

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

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateStatus() {
  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  const bestTxt = best[difficulty] != null ? ` · Best ${best[difficulty]}` : '';
  statusTextEl.textContent =
    `${diffLabel} · ${filledCount()}/${SIZE * SIZE} · Score ${computeScore()} · Mistakes ${mistakes} · ${fmtTime(elapsedSeconds())}${bestTxt}`;
  if (cellReadoutEl) {
    cellReadoutEl.textContent = selected === -1
      ? 'No cell selected.'
      : `Cell row ${Math.floor(selected / SIZE) + 1}, column ${selected % SIZE + 1}: ` +
        (board[selected] ? `${board[selected]}${given[selected] ? ' (fixed)' : ''}` : notes.has(selected) ? 'marked, empty' : 'empty');
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
  if (board[selected]) { board[selected] = 0; moves = Math.max(0, moves - 1); }
  notes.delete(selected);
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
  cellMeshes[idx].material.color.setHex(0xe53e3e);
  render();
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { updateCellVisual(idx); render(); }, 220);
}

function finishRound() {
  if (completedElapsed === null) completedElapsed = elapsedSeconds();
  gameOver = true;
  const p = scoreParts();
  if (best[difficulty] == null || p.total > best[difficulty]) best[difficulty] = p.total;
  audio.playPlace();
  for (let i = 0; i < SIZE * SIZE; i++) updateCellVisual(i);
  selected = -1;
  showOverlay(
    `<h2>Sanctuary complete</h2>` +
    `<ul class="score-list">` +
    `<li>Digits placed <span>${p.placed}</span></li>` +
    `<li>Mistakes (${mistakes}) <span>${p.mistakePenalty}</span></li>` +
    `<li>Hints (${hints}) <span>${p.hintPenalty}</span></li>` +
    `<li>Solve bonus <span>${p.solveBonus}</span></li>` +
    `<li>Time bonus (${fmtTime(elapsedSeconds())}) <span>${p.timeBonus}</span></li>` +
    `<li class="total">Total <span>${p.total}</span></li>` +
    `</ul><p class="hint-line">Press R for a new round.</p>`,
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
  audio.playPlace();
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
    showOverlay('<h2>Paused</h2><p class="hint-line">Press P or click Resume to continue.</p>' +
      '<button type="button" id="resume-btn" class="action-btn">Resume</button>', 'paused');
    const rb = document.getElementById('resume-btn');
    if (rb) rb.addEventListener('click', () => setPaused(false));
  } else {
    resumeIfPaused();
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
    btn.textContent = muted ? 'Unmute (M)' : 'Mute (M)';
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
  const tag = (e.target && e.target.tagName) || '';
  const typingTarget = tag === 'INPUT' || tag === 'TEXTAREA';
  if (typingTarget) return;
  // let Enter/Space activate a focused button normally
  if ((e.key === 'Enter' || e.key === ' ') && tag === 'BUTTON') return;

  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '9') {
    enterDigit(parseInt(k, 10));
    e.preventDefault();
  } else if (k === 'backspace' || k === 'delete' || k === '0') {
    eraseCell();
    e.preventDefault();
  } else if (k === 'arrowup' || k === 'w') { moveSelection(-1, 0); e.preventDefault(); }
  else if (k === 'arrowdown' || k === 's') { moveSelection(1, 0); e.preventDefault(); }
  else if (k === 'arrowleft' || k === 'a') { moveSelection(0, -1); e.preventDefault(); }
  else if (k === 'arrowright' || k === 'd') { moveSelection(0, 1); e.preventDefault(); }
  else if (k === 'n' || k === 'u') toggleNote();
  else if (k === 'h') showHint();
  else if (k === 'c') clearBoard();
  else if (k === 'r') restartRound();
  else if (k === 'p') togglePause();
  else if (k === 'm') setMuted(!muted);
  else if (k === 'escape' && !paused && !gameOver) setPaused(true);
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
      case 'mute': setMuted(!muted); break;
    }
  });
}

window.addEventListener('resize', resize);
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
    restartRound();
  });
});

// ---------------------------------------------------------------------------
// Boot: restore or build a round, then start rendering
// ---------------------------------------------------------------------------

setRulesSeed((Date.now() ^ 0x5EED) >>> 0);
const savedRound = loadStore();
if (!savedRound || !restoreRound(savedRound)) {
  setActiveMode(mode);
  buildPuzzle(nextSeed());
} else {
  setActiveMode(mode);
}
initThree();
setMuted(muted);
if (gameOver) finishRound();
else refresh();

let _rafId = null;
let _lastStatus = 0;
function animate(ts) {
  _rafId = requestAnimationFrame(animate);
  if (document.hidden) return;
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
