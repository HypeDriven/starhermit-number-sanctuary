// The lamp-lit stone courtyard on starhermit:scene, as the browser build's
// main.js drew it with three.js r160: the 81 inset number tiles (plain boxes
// or rounded glazed tiles, coloured by state: open blue, clue orange, the
// player's green, marked purple, a refused digit's red flash; glazed clues,
// satin player tiles, matte open cells), the stone board or (detailed) the
// raised limestone plinth with its contact shadow, shadow-catching ground and
// four stone lanterns (flickering flames, halos, two lit by point lights),
// the baked contact occlusion over the grout, the breathing selection ring,
// the fireflies drifting round the plinth, the dusk backdrop image, and the
// camera framed into the part of the window the HUD panels leave free.
//
// From three.js r160: light intensities are ÷ π (the engine's convention, as
// r155+'s physically based lights); the RoomEnvironment reflections are each
// material's own envMap with the old envMapIntensity (scene.environment at
// minor 20 ignores per-material intensity); the post chain (UnrealBloomPass
// 0.75 / 0.55 / 0.9 on the linear frame, the display-space GradeShader after
// the output, FXAA / SMAA / MSAA) is renderer.bloom / grade / antialias; the
// key light's fitted shadow box is the engine's shadow `distance`; the
// procedural grain and contact-occlusion canvases are baked images
// (tools/bake-textures.mjs; the occlusion's alphaMap becomes the alpha of a
// black map). The digits were sprites in a second scene drawn after the post
// chain, never bloomed or tone mapped: here the same digit images are drawn
// on the 2D overlay at each tile's projected place and size (drawDigits), so
// they stay crisp white above the bloom.
import { frame, preferences } from "starhermit:engine";
import * as draw from "starhermit:draw";
import { OffscreenCanvas } from "starhermit:canvas";
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Points, PointsMaterial, Raycaster,
  RepeatWrapping, RingGeometry, RoomEnvironment, RoundedBoxGeometry, ShadowMaterial, SphereGeometry, Sprite, SpriteMaterial,
  SRGBColorSpace, TextureLoader, Vector2, Vector3, renderer, scene, type Texture,
} from "starhermit:scene";
import { fireflyCount, FIREFLY_MAX, type Look } from "./quality.ts";

const PI = Math.PI;
const SIZE = 9;
const CELL_SIZE = 1.0;
const GAP = 0.06;
const BOARD_SPAN = SIZE * CELL_SIZE + GAP * SIZE;
export const COLOR_EMPTY = 0x2b6cb0;
export const COLOR_GIVEN = 0xc05621;
export const COLOR_PLACED = 0x2f855a;
export const COLOR_NOTE = 0x6b46c1;
export const COLOR_INVALID = 0xe53e3e;
const RING_COLOR = new Color(0xf6e05e);

function cellX(idx: number): number { return ((idx % SIZE) - SIZE / 2 + 0.5) * CELL_SIZE; }
function cellZ(idx: number): number { return (Math.floor(idx / SIZE) - SIZE / 2 + 0.5) * CELL_SIZE; }

renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const camera = new PerspectiveCamera(45, 1, 0.1, 100);
renderer.camera = camera;
scene.background = new Color(0x1a2026);

// lighting: cool dusk sky fill, one warm low key light with fitted shadows, and a faint cool rim from behind
const hemi = new HemisphereLight(0xb4c8ea, 0x2a2119, 1.25 / PI);
scene.add(hemi);
const keyLight = new DirectionalLight(0xffe2bd, 1.8 / PI);
keyLight.position.set(-5, 11, 7);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 3;
keyLight.shadow.distance = 40;
scene.add(keyLight, keyLight.target);
const rimLight = new DirectionalLight(0x8fb2ff, 0.55 / PI);
rimLight.position.set(3, 5, -9);
scene.add(rimLight);

// -- textures ------------------------------------------------------------------------------------------
const loader = new TextureLoader();
function image(path: string, onLoad?: (t: Texture) => void): Texture {
  return loader.load(path, onLoad, undefined, (e: unknown) => console.warn(`${path}: ${e instanceof Error ? e.message : String(e)}`));
}
function radialTexture(inner: string, outer: string): Texture {
  const cv = new OffscreenCanvas(64, 64);
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(cv);
}
const grain = image("assets/textures/grain.png");
grain.wrapS = grain.wrapT = RepeatWrapping;

// -- the board ---------------------------------------------------------------------------------------
// The authored limestone scan multiplies into the base colour; until it loads the flat colour is what shows.
const boardMat = new MeshStandardMaterial({ color: 0x3a4750, roughness: 0.95 });
const boardMesh = new Mesh(new PlaneGeometry(BOARD_SPAN, BOARD_SPAN), boardMat);
boardMesh.rotation.x = -PI / 2;
boardMesh.receiveShadow = true;
scene.add(boardMesh);

// detailed: the board sits on a raised limestone plinth with a soft contact shadow beneath, and a
// shadow-catching ground for the key light
const pl = BOARD_SPAN + 0.8;
const plinthTop = new MeshStandardMaterial({ color: 0x55636d, roughness: 0.9 });
const plinthSide = new MeshStandardMaterial({ color: 0x5a6670, roughness: 0.95 });
const plinth = new Mesh(new BoxGeometry(pl, 0.5, pl), [plinthSide, plinthSide, plinthTop, plinthSide, plinthSide, plinthSide]);
plinth.position.y = -0.25;
plinth.receiveShadow = true;
plinth.castShadow = true;
scene.add(plinth);
const contactShadow = new Mesh(new PlaneGeometry(pl * 1.5, pl * 1.5),
  new MeshBasicMaterial({ map: radialTexture("rgba(0,0,0,0.75)", "rgba(0,0,0,0)"), transparent: true, depthWrite: false }));
contactShadow.rotation.x = -PI / 2;
contactShadow.position.y = -0.52;
scene.add(contactShadow);
const shadowCatcher = new Mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ opacity: 0.35 }));
shadowCatcher.rotation.x = -PI / 2;
shadowCatcher.position.y = -0.5;
shadowCatcher.receiveShadow = true;
scene.add(shadowCatcher);

image("assets/courtyard-stone.webp", (tex) => {
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 4;
  boardMat.map = tex;
  plinthTop.map = tex;
  const side = tex.clone();
  side.repeat.set(3, 0.18);
  plinthSide.map = side;
});
image("assets/sanctuary-backdrop.webp", (tex) => {
  tex.colorSpace = SRGBColorSpace;
  scene.background = tex;
});

// baked contact occlusion: darkens the grout between tiles and the plinth rim around the grid
const aoExtent = pl + 0.4;
const aoTex = image("assets/textures/contact-ao.png");
const aoOverlay = new Mesh(new PlaneGeometry(aoExtent, aoExtent),
  new MeshBasicMaterial({ color: 0x000000, map: aoTex, transparent: true, opacity: 0.55, depthWrite: false }));
aoOverlay.rotation.x = -PI / 2;
aoOverlay.position.y = 0.004;
aoOverlay.renderOrder = -1;
scene.add(aoOverlay);

// stone lanterns at the plinth's four corners; the two far ones carry lights
const lanternGroup = new Group();
const stone = new MeshStandardMaterial({ color: 0x5b646b, roughness: 0.85 });
const postGeom = new BoxGeometry(0.26, 0.42, 0.26);
const capGeom = new ConeGeometry(0.26, 0.2, 4);
const flameGeom = new SphereGeometry(0.075, 12, 8);
const lc = pl / 2 - 0.2;
const haloMat = new SpriteMaterial({
  map: radialTexture("rgba(255,170,80,0.55)", "rgba(255,140,40,0)"), color: 0xffffff,
  blending: AdditiveBlending, transparent: true, depthWrite: false,
});
const lanternFlames: { mesh: Mesh; phase: number }[] = [];
const lanternLights: { light: PointLight; phase: number }[] = [];
const LANTERN_BASE = 5 / PI;
for (const [x, z] of [[-lc, -lc], [lc, -lc], [-lc, lc], [lc, lc]] as const) {
  const post = new Mesh(postGeom, stone);
  post.position.set(x, 0.21, z);
  post.castShadow = true;
  const cap = new Mesh(capGeom, stone);
  cap.position.set(x, 0.62, z);
  cap.rotation.y = PI / 4;
  cap.castShadow = true;
  const flame = new Mesh(flameGeom, new MeshBasicMaterial({ color: new Color(0xff9a2e).multiplyScalar(1.8) }));
  flame.position.set(x, 0.5, z);
  const phase = x * 1.7 + z * 0.9;
  lanternFlames.push({ mesh: flame, phase });
  const halo = new Sprite(haloMat);
  halo.position.set(x, 0.5, z);
  halo.scale.setScalar(0.9);
  lanternGroup.add(post, cap, flame, halo);
  if (z < 0) {
    const light = new PointLight(0xff9f45, LANTERN_BASE, 7, 2);
    light.position.set(x, 0.7, z);
    lanternLights.push({ light, phase });
    lanternGroup.add(light);
  }
}
scene.add(lanternGroup);

// -- the tiles --------------------------------------------------------------------------------------
// Tile sides darken towards their base (the "high" ambient-occlusion tier).
function addBaseShade(geom: BufferGeometry): BufferGeometry {
  const pos = geom.getAttribute("position")!;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); // -0.25 .. 0.25
    const f = 0.5 + 0.5 * Math.min(1, Math.max(0, (y + 0.25) / 0.4));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = f;
  }
  geom.setAttribute("color", new BufferAttribute(col, 3));
  return geom;
}
const tileGeomPlain = addBaseShade(new BoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.5, CELL_SIZE * 0.94));
const tileGeomDetailed = addBaseShade(new RoundedBoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.5, CELL_SIZE * 0.94, 3, 0.07));
interface Tile {
  mesh: Mesh;
  plain: MeshStandardMaterial; detailed: MeshPhysicalMaterial; lambert: MeshLambertMaterial; satin: MeshStandardMaterial;
}
const tiles: Tile[] = [];
for (let idx = 0; idx < SIZE * SIZE; idx++) {
  const plain = new MeshStandardMaterial({ color: COLOR_EMPTY });
  const detailed = new MeshPhysicalMaterial({
    color: COLOR_EMPTY, roughness: 0.62, metalness: 0, roughnessMap: grain, bumpMap: grain, bumpScale: 0.6,
    clearcoat: 0.4, clearcoatRoughness: 0.28,
  });
  const lambert = new MeshLambertMaterial({ color: COLOR_EMPTY });
  const satin = new MeshStandardMaterial({ color: COLOR_EMPTY, roughness: 0.62, metalness: 0, roughnessMap: grain });
  const mesh = new Mesh(tileGeomPlain, plain);
  mesh.position.set(cellX(idx), 0.1, cellZ(idx));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.cell = idx;
  scene.add(mesh);
  tiles.push({ mesh, plain, detailed, lambert, satin });
}

// selection ring (hidden until a cell is selected); bright enough to bloom
const ringMat = new MeshBasicMaterial({ color: RING_COLOR.clone(), side: DoubleSide });
const selectedRing = new Mesh(new RingGeometry(CELL_SIZE * 0.5, CELL_SIZE * 0.62, 48), ringMat);
selectedRing.rotation.x = -PI / 2;
selectedRing.position.y = 0.4;
selectedRing.visible = false;
scene.add(selectedRing);

// fireflies drifting around the plinth (never over the grid itself), built at the largest budget
const fireflyBase: { x: number; y: number; z: number; p: number; s: number }[] = [];
const ffPos = new Float32Array(FIREFLY_MAX * 3);
const ffCol = new Float32Array(FIREFLY_MAX * 3);
{
  let fs = 0x0f1e5;
  const frnd = (): number => { fs = (fs * 1103515245 + 12345) & 0x7fffffff; return fs / 0x7fffffff; };
  for (let i = 0; i < FIREFLY_MAX; i++) {
    const a = frnd() * PI * 2, r = pl / 2 + 0.6 + frnd() * 4.5;
    const b = { x: Math.cos(a) * r, y: 0.3 + frnd() * 2.6, z: Math.sin(a) * r, p: frnd() * 100, s: 0.4 + frnd() * 0.8 };
    fireflyBase.push(b);
    ffPos[i * 3] = b.x; ffPos[i * 3 + 1] = b.y; ffPos[i * 3 + 2] = b.z;
    ffCol[i * 3] = 1; ffCol[i * 3 + 1] = 0.8; ffCol[i * 3 + 2] = 0.45;
  }
}
const ffGeom = new BufferGeometry();
ffGeom.setAttribute("position", new BufferAttribute(ffPos, 3));
ffGeom.setAttribute("color", new BufferAttribute(ffCol, 3));
const fireflies = new Points(ffGeom, new PointsMaterial({
  size: 0.2, map: radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)"), vertexColors: true,
  color: new Color(1, 0.85, 0.55).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: AdditiveBlending,
}));
fireflies.frustumCulled = false;
scene.add(fireflies);

// -- the digits -------------------------------------------------------------------------------------
// makeTextSprite's 128 px image (bold 96 px digit with a soft dark halo), one sheet of the nine digits at the
// look's label size.
let digitSheet: OffscreenCanvas | null = null;
let digitSize = 0;
function paintDigits(size: number): void {
  if (digitSheet && digitSize === size) return;
  digitSize = size;
  const cv = new OffscreenCanvas(size * 9, size);
  const ctx = cv.getContext("2d");
  ctx.font = "bold 96px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 8 * size / 128;
  ctx.shadowOffsetY = 3 * size / 128;
  ctx.fillStyle = "#ffffff";
  for (let d = 1; d <= 9; d++) {
    ctx.save();
    ctx.translate((d - 1) * size, 0);
    ctx.scale(size / 128, size / 128);
    ctx.fillText(String(d), 64, 64);
    ctx.restore();
  }
  digitSheet = cv;
}

// -- the round's state on the tiles ---------------------------------------------------------------------
export interface BoardView { board: readonly number[]; given: readonly boolean[]; notes: { has(i: number): boolean }; selected: number }
let view: BoardView | null = null;
let flash: { idx: number; until: number } | null = null;
let look: Look | null = null;

function tileColor(v: BoardView, idx: number): number {
  if (v.board[idx]) return v.given[idx] ? COLOR_GIVEN : COLOR_PLACED;
  return v.notes.has(idx) ? COLOR_NOTE : COLOR_EMPTY;
}
// Tile finish by state (detailed tiles only): clues are glazed, the player's digits satin, open cells matte stone.
function tileFinish(v: BoardView, idx: number): number {
  if (v.board[idx]) return v.given[idx] ? 0.9 : 0.45;
  return 0.12;
}
function paintTile(idx: number): void {
  if (!view) return;
  const t = tiles[idx]!;
  const hex = flash && flash.idx === idx ? COLOR_INVALID : tileColor(view, idx);
  for (const m of [t.plain, t.detailed, t.lambert, t.satin]) m.color.setHex(hex);
  const fin = tileFinish(view, idx);
  t.detailed.clearcoat = fin;
  t.satin.roughness = 0.78 - 0.45 * fin; // the same finish cue without a clear coat
}
/** The round's board (updateCellVisual for every cell, updateSelectionVisual). */
export function setBoard(v: BoardView): void {
  view = v;
  for (let i = 0; i < SIZE * SIZE; i++) paintTile(i);
  selectedRing.visible = v.selected !== -1;
  if (v.selected !== -1) selectedRing.position.set(cellX(v.selected), 0.4, cellZ(v.selected));
}
/** flashInvalid: the tile shows red for 220 ms. */
export function flashInvalid(idx: number): void {
  const prev = flash;
  flash = { idx, until: frame().time + 0.22 };
  if (prev && prev.idx !== idx) paintTile(prev.idx);
  paintTile(idx);
}

// -- graphics level ---------------------------------------------------------------------------------
let envTex: Texture | null = null;
const envMats: [MeshStandardMaterial | MeshPhysicalMaterial, number][] = [
  [boardMat, 1], [plinthTop, 0.3], [plinthSide, 0.3], [stone, 0.3],
  ...tiles.flatMap((t) => [[t.plain, 1], [t.detailed, 0.3], [t.satin, 0.3]] as [MeshStandardMaterial | MeshPhysicalMaterial, number][]),
];
/** applyGraphics: the look's shadows, detail, tile shading, occlusion, reflections, particles and post effects. */
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  const b = next.budget;
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  keyLight.castShadow = shadows;
  if (shadows) keyLight.shadow.mapSize = next.shadows;
  shadowCatcher.visible = shadows;

  const detailed = next.detailed;
  for (const t of tiles) {
    t.mesh.geometry = detailed ? tileGeomDetailed : tileGeomPlain;
    t.mesh.material = !detailed ? (b.material === "lambert" ? t.lambert : t.plain) : (b.material === "physical" ? t.detailed : t.satin);
  }
  boardMesh.visible = !detailed;
  plinth.visible = detailed;
  contactShadow.visible = detailed;
  lanternGroup.visible = detailed;
  lanternLights.forEach((l, i) => { l.light.visible = i < b.lanternLights; });
  paintDigits(b.label);

  aoOverlay.visible = next.ao !== "off";
  for (const t of tiles) for (const m of [t.plain, t.detailed, t.lambert, t.satin]) m.vertexColors = next.ao === "high";

  if (next.reflections && !envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  for (const [m, k] of envMats) {
    m.envMap = next.reflections ? envTex : null;
    m.envMapIntensity = k;
  }
  hemi.intensity = (next.reflections ? 0.75 : 1.25) / PI;

  fireflies.visible = next.particles !== "off";
  ffGeom.setDrawRange(0, fireflyCount(next));

  // UnrealBloomPass(0.75, 0.55, 0.9) on the linear frame: the lantern flames, fireflies and the ring bloom.
  renderer.bloom = next.bloom ? { strength: 0.4, radius: 0.55, threshold: 0.9, resolution: b.bloomRes } : null;
  // GradeShader after the output (display space): a 0.22 S-curve, saturation 1.06, cool shadows / warm highlights,
  // the 0.26 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.11, saturation: 1.06, shadows: [0.95, 0.98, 1.06], highlights: [1.05, 1.0, 0.95], split: [0.2, 0.8],
    vignette: { amount: 0.26, inner: 0.35, outer: 0.85 },
  } : null;
  renderer.antialias = next.antialias;
}

// -- camera -------------------------------------------------------------------------------------------
/** The window rectangle (px) not covered by the HUD panels (safeRect). */
const pf = { x: 0, y: 0, w: 0, h: 0 };
let fitKey = "";
export function setPlayfield(x: number, y: number, w: number, h: number): void { pf.x = x; pf.y = y; pf.w = w; pf.h = h; }

/** frameCamera: a view offset centres the board in the free rectangle and the camera pulls back until every
 * column and row fits with a margin; narrow rectangles get a steeper, more top-down view. */
function frameCamera(w: number, h: number): void {
  const sr = pf.w > 0 && pf.h > 0 ? pf : { x: 0, y: 0, w, h };
  camera.aspect = sr.w / sr.h;
  camera.setViewOffset(sr.w, sr.h, -sr.x, -sr.y, w, h);
  const vFov = (camera.fov * PI) / 180;
  const distV = (BOARD_SPAN * 0.75) / Math.tan(vFov / 2);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distH = (BOARD_SPAN * 0.6) / Math.tan(hFov / 2);
  let dist = Math.max(distV, distH, SIZE * CELL_SIZE * 1.05 + 3);
  const half = BOARD_SPAN / 2 + 0.4;
  const corners: Vector3[] = [];
  for (const x of [-half, half]) for (const z of [-half, half]) corners.push(new Vector3(x, 0.3, z));
  const v = new Vector3();
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

const ndc = new Vector2();
const raycaster = new Raycaster();
/** The cell under a window point (pickCell), or -1. */
export function pick(x: number, y: number): number {
  const f = frame();
  if (f.width <= 0 || f.height <= 0) return -1;
  ndc.set((x / f.width) * 2 - 1, -(y / f.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(tiles.map((t) => t.mesh), false);
  const o = hits[0]?.object;
  return o ? (o.userData.cell as number) : -1;
}

const pv = new Vector3();
/** A world point in window pixels. */
function toWindow(x: number, y: number, z: number): { x: number; y: number } {
  const f = frame();
  pv.set(x, y, z).project(camera);
  return { x: (pv.x + 1) / 2 * f.width, y: (1 - pv.y) / 2 * f.height };
}
/** Each cell's top face as a window rectangle (the accessibility targets and play-script clicks). */
export function cellRect(idx: number): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]] as const) {
    const p = toWindow(cellX(idx) + dx, 0.35, cellZ(idx) + dz);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const camRight = new Vector3();
/** The digits as makeTextSprite's sprites drew them: a 1 × 1 world-unit image facing the camera at y 0.55. */
export function drawDigits(): void {
  if (!view || !digitSheet) return;
  camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(0.5);
  const s = digitSize;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const d = view.board[i];
    if (!d) continue;
    const x = cellX(i), z = cellZ(i);
    const c = toWindow(x, 0.55, z);
    const e = toWindow(x + camRight.x, 0.55 + camRight.y, z + camRight.z);
    const half = Math.hypot(e.x - c.x, e.y - c.y);
    if (!(half > 0.5)) continue;
    draw.image(digitSheet, c.x - half, c.y - half, half * 2, half * 2, { source: { x: (d - 1) * s, y: 0, width: s, height: s } });
  }
}

// -- the frame ---------------------------------------------------------------------------------------
let animTime = 0;
const tmpColor = new Color();
/** Gentle ambient motion (animateScene): firefly drift, lantern flicker, a breathing ring; the camera fitted to the
 * playfield; a refused digit's flash ends. */
export function update(dt: number): void {
  const f = frame();
  if (f.width > 0 && f.height > 0) {
    const key = `${f.width}x${f.height}:${pf.x},${pf.y},${pf.w},${pf.h}`;
    if (key !== fitKey) { fitKey = key; frameCamera(f.width, f.height); }
  }
  if (flash && f.time >= flash.until) { const i = flash.idx; flash = null; paintTile(i); }
  if (preferences().reducedMotion) { ringMat.color.copy(RING_COLOR).multiplyScalar(1.4); return; }
  animTime += Math.min(0.25, Math.max(0, dt));
  const tm = animTime;
  ringMat.color.copy(tmpColor.copy(RING_COLOR).multiplyScalar(1.3 + 0.3 * Math.sin(tm * 2.4)));
  if (lanternGroup.visible) {
    for (const fl of lanternFlames) {
      fl.mesh.scale.setScalar(0.85 + 0.15 * Math.sin(tm * 7.1 + fl.phase) * Math.sin(tm * 3.3 + fl.phase * 2));
    }
    for (const l of lanternLights) l.light.intensity = LANTERN_BASE * (0.85 + 0.15 * Math.sin(tm * 6.3 + l.phase));
  }
  if (fireflies.visible && look) {
    const pos = ffGeom.getAttribute("position")!;
    const col = ffGeom.getAttribute("color")!;
    const n = fireflyCount(look);
    for (let i = 0; i < n; i++) {
      const b = fireflyBase[i]!;
      const ph = b.p + tm * b.s;
      ffPos[i * 3] = b.x + Math.sin(ph * 0.7) * 0.6;
      ffPos[i * 3 + 1] = b.y + Math.sin(ph * 1.3) * 0.25;
      ffPos[i * 3 + 2] = b.z + Math.cos(ph * 0.5) * 0.6;
      const glow = Math.max(0, Math.sin(ph * 1.9)) ** 2;
      ffCol[i * 3] = glow; ffCol[i * 3 + 1] = 0.8 * glow; ffCol[i * 3 + 2] = 0.45 * glow;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
