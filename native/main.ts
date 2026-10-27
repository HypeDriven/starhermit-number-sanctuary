// Number Sanctuary on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (rules.js) and the round
// (src/round.js) are the browser build's pure logic, shared with the node
// tests; this module is what main.js did around them on the page: the round
// (modes and their difficulty, the Daily's UTC-date grid, the round clock,
// pause, the results with the score breakdown, personal bests, posting a
// solved puzzle to the high-score board), the save that survives leaving,
// and input (the keyboard and gamepad actions, taps and clicks on the board,
// the number pad and action buttons), plus the page's DOM UI as
// starhermit:ui (the top bar with the mode tabs and Settings, the status and
// controls panels, the pause and results overlays, the Settings dialog with
// the account section, toasts) and the scene (render.ts).
//
// Time is the runtime's fixed steps: the round clock advances by them while a
// round runs unpaused, so a hidden window or slow frames never cost time.
import "./i18n.ts";
import {
  clipboard, frame, onFixedUpdate, onOverlay, onQuit, onStart, onSuspend, onUpdate, openMenu,
} from "starhermit:engine";
import { bindingLabel, onAction, onPointerButton, onTouch, type ActionEvent } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import * as audio from "./audio.ts";
import { Game, type Doc, type Mode, type Round, type RoundEvent } from "./game.ts";
import { T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { initStyles } from "./style.ts";

const SIZE = 9;
const MODES: Mode[] = ["learn", "journey", "daily", "practice", "challenge"];

// ------------------------------------------------------------------ state
const rand = Game.makeRng((Date.now() ^ 0x5EED) >>> 0);
let round: Round = Game.newRound("learn", 1); // replaced in onStart
let best: Record<string, number> = {};
let paused = false;
let settingsOpen = false;
let settingsOpenedFrame = 0;
let touched = false; // the player acted since start (a late account save then keeps this round)
let lbLine: [string, Record<string, string | number>?] | null = null;
let postedSeed: string | null = null;
let padDigit = 5;
let padActive = false; // the gamepad's chosen pad digit shows once it is used
let toast: { text: string; until: number } | null = null;
let shownProgress = 0;

function nowSec(): number { return frame().time; }
function showToast(text: string): void { toast = { text, until: nowSec() + 3.2 }; }

function buildDoc(): Doc { return { best, round: Game.roundDoc(round) }; }
function boardView(): render.BoardView { return round; }
/** refresh(): the scene shows the round, the save is written. */
function refresh(): void {
  render.setBoard(boardView());
  platform.saveDoc();
}

// ------------------------------------------------------------------ actions
function answer(ev: RoundEvent): void {
  switch (ev) {
    case "select": audio.play("select"); break;
    case "place": audio.play("place"); touched = true; break;
    case "invalid": audio.play("invalid"); render.flashInvalid(round.selected); break;
    case "mistake": audio.play("invalid"); render.flashInvalid(round.selected); touched = true; break;
    case "erase": audio.play("erase"); touched = true; break;
    case "none": case "note": case "clear": touched = true; break;
    case "hint": audio.play("hint"); touched = true; break;
    case "solve": touched = true; finishRound(); break;
    default: break;
  }
  if (ev) refresh();
}
const playing = (): boolean => !paused && !round.gameOver;
function selectCell(idx: number): void { if (!paused) answer(Game.select(round, idx)); }
function enterDigit(d: number): void { if (!paused) answer(Game.enterDigit(round, d)); }
function eraseCell(): void { if (!paused) answer(Game.eraseCell(round)); }
function toggleNote(): void { if (!paused) answer(Game.toggleNote(round)); }
function showHint(): void { if (!paused) answer(Game.hint(round)); }
function moveSelection(dr: number, dc: number): void { if (!paused) answer(Game.moveSelection(round, dr, dc)); }

function finishRound(): void {
  const p = Game.scoreParts(round);
  const key = round.difficulty;
  if (best[key] == null || p.total > best[key]!) best[key] = p.total;
  audio.play("solve");
  lbLine = null;
  // Signed in only: a solved puzzle (every mode but Learn) goes to the high-score board, once per round.
  const id = `${round.mode}:${round.puzzleSeed}:${round.moves}:${round.hints}:${round.mistakes}`;
  if (round.mode !== "learn" && platform.signedIn() && postedSeed !== id) {
    postedSeed = id;
    lbLine = ["lb.posting"];
    void platform.postLeaderboard(Math.max(0, p.total)).then((r) => {
      lbLine = !r.posted ? ["lb.notPosted"] : r.rank ? ["lb.rank", { rank: r.rank }] : ["lb.posted"];
    });
  }
}
function clearBoard(): void {
  answer(Game.clearBoard(round));
  paused = false;
  lbLine = null;
}
/** restartRound: a new puzzle of the mode (the Daily's own grid again). */
function restartRound(): void {
  round = Game.newRound(round.mode, Game.nextSeed(round.mode, rand, platform.nowMs()));
  paused = false;
  lbLine = null;
  touched = true;
  refresh();
}
function setMode(m: Mode): void {
  audio.play("mode");
  round = Game.newRound(m, Game.nextSeed(m, rand, platform.nowMs()));
  paused = false;
  lbLine = null;
  touched = true;
  refresh();
}
function setPaused(next: boolean): void {
  if (round.gameOver || next === paused) return;
  paused = next;
  audio.play(next ? "pause" : "resume");
  refresh();
}
function toggleMute(): void { platform.setMuted(!platform.isMuted()); }
function openSettings(): void {
  if (playing()) setPaused(true);
  settingsOpen = true;
  settingsOpenedFrame = frame().frame;
}

// ------------------------------------------------------------------ input
const DIRS: Record<string, [number, number]> = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
function onGameAction(e: ActionEvent): void {
  if (!e.pressed || settingsOpen || frame().overlayOpen) return;
  const a = e.action;
  const fromPad = e.source === "gamepad";
  if (DIRS[a]) {
    // Keys go to the board unless a widget has the keyboard's focus; the pad's D-pad plays the board while a round
    // runs (it navigates the buttons when paused or solved).
    if (fromPad ? !playing() : ui.focused() !== null) return;
    if (fromPad) ui.setFocus(null);
    const [dr, dc] = DIRS[a]!;
    moveSelection(dr, dc);
    return;
  }
  if (a.startsWith("digit")) { enterDigit(Number(a.slice(5))); return; }
  switch (a) {
    case "erase": eraseCell(); break;
    case "prevdigit": padActive = true; padDigit = padDigit === 1 ? 9 : padDigit - 1; break;
    case "nextdigit": padActive = true; padDigit = padDigit === 9 ? 1 : padDigit + 1; break;
    case "place":
      if (!fromPad && ui.focused() !== null) return; // Enter on a focused button is the button's
      if (fromPad && !playing()) return; // South activates the focused button there
      padActive = true;
      enterDigit(padDigit);
      break;
    case "note": toggleNote(); break;
    case "hint": showHint(); break;
    case "clear": clearBoard(); break;
    case "restart": restartRound(); break;
    case "pause": setPaused(!paused); break;
    case "mute": toggleMute(); break;
    case "menu": if (playing()) setPaused(true); break;
  }
}
onAction(onGameAction);

// Presses on the board: queued and decided after the UI is built (ui.pointerOver() is then this frame's).
const presses: { x: number; y: number }[] = [];
let lastTouch = -10;
let pointerUpFrame = -1;
onPointerButton((e) => {
  if (!e.pressed) pointerUpFrame = frame().frame;
  if (e.button !== 0 || !e.pressed || nowSec() - lastTouch < 0.6) return;
  presses.push({ x: e.x, y: e.y });
});
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = nowSec();
  if (e.phase === "end") pointerUpFrame = frame().frame;
  if (e.phase === "start") presses.push({ x: e.x, y: e.y });
});

// ------------------------------------------------------------------ layout helpers
interface Layout { lw: number; lh: number; sc: number; phone: boolean; short: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const lw = Math.max(1, f.width / sc), lh = Math.max(1, f.height / sc);
  // style.css: (max-height: 520px) and (orientation: landscape) slims the side panels; (max-width: 700px) stacks
  // the top bar and moves the controls to the bottom. A short landscape window keeps the side panels.
  const short = lh <= 520 && lw > lh;
  return { lw, lh, sc, phone: !short && lw <= 700, short };
}
function tw(text: string, style: string | (string | ui.Style)[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style }).width / ui.preferences().scale;
}
/** Text up to `width` wide: one label when it fits, else a wrapped paragraph. */
function para(text: string, width: number, cls: string, size?: number): void {
  const st: (string | ui.Style)[] = size ? [cls, { text: { size } }] : [cls];
  if (tw(text, st) <= width) ui.style(...st).label(text);
  else ui.style(...st).paragraph(text, width);
}
/** Actions run after the frame's UI is built (a state change mid-build would confuse later widgets). */
const pending: (() => void)[] = [];
function later(fn: () => void): void { pending.push(fn); }
interface BtnOpts { width?: number; height?: number; size?: number; selected?: boolean; id?: string; padX?: number }
function button(label: string, cls: string, act: () => void, o: BtnOpts = {}): void {
  const st: ui.Style = {};
  if (o.width != null) st.width = o.width;
  if (o.height != null) st.minHeight = o.height;
  if (o.size != null) st.text = { size: o.size };
  if (o.padX != null) st.padding = { top: 4, bottom: 4, start: o.padX, end: o.padX };
  const opts: ui.ButtonOptions = {};
  if (o.selected != null) opts.selected = o.selected;
  const u = o.id ? ui.style(cls, st).id(o.id) : ui.style(cls, st);
  if (u.button(label, opts)) later(act);
}
/** "Mark (N)": the authored key in a button label replaced by the action's effective binding (reflectKeys). */
const KEY_GLYPHS: Record<string, string> = { Escape: "Esc", "Arrow Up": "↑", "Arrow Down": "↓", "Arrow Left": "←", "Arrow Right": "→" };
function keyed(key: string, action: string): string {
  let k = "";
  try { k = bindingLabel(action); } catch { k = ""; }
  k = KEY_GLYPHS[k] ?? k;
  return T(key).replace(/\(([^)]*)\)\s*$/, k ? `(${k})` : "").trim();
}
function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ the page
/** Window-pixel rectangles of the HUD built this frame (the camera keeps the board out from under them). */
let panelRects: ui.Rect[] = [];
let topH = 0;

function topBar(L: Layout): void {
  const pad = L.phone ? 10 : L.short ? 10 : 18;
  const padY = L.phone ? 8 : L.short ? 4 : 10;
  const inner = L.lw - 2 * pad;
  const titleSize = L.phone ? 18 : L.short ? 16 : 20;
  const settingsSize = L.short ? 12 : 13;
  const modeSize = L.short ? 13 : 14;
  const modeStyle: (string | ui.Style)[] = ["mode-btn", { text: { size: modeSize }, ...(L.short ? { padding: { top: 4, bottom: 4, start: 8, end: 8 } } : {}) }];
  const fits = (): boolean => {
    let need = tw(T("app.title"), ["title", { text: { size: titleSize } }]) + 12 + tw(T("settings.button"), ["settings-btn", { text: { size: settingsSize } }], "button") + 24;
    for (const m of MODES) need += tw(T(`mode.${m}`), modeStyle, "button") + (L.short ? 6 : 8);
    return need <= inner;
  };
  const r = ui.place("topbar", "top", () => {
    const titleRow = (): void => {
      ui.style("title", { text: { size: titleSize } }).label(T("app.title"));
      button(T("settings.button"), "settings-btn", openSettings, { size: settingsSize, height: L.phone ? 34 : undefined, id: "settings" });
    };
    const modeBtn = (m: Mode, width?: number): void => {
      // a fixed-width tab whose label would not fit (a long translation) takes smaller type
      const label = T(`mode.${m}`);
      const need = width ? tw(label, modeStyle, "button") : 0;
      const size = width && need > width ? Math.max(10, Math.floor(modeSize * width / need)) : modeSize;
      button(label, "mode-btn", () => setMode(m),
        { selected: round.mode === m, size, id: `mode-${m}`, ...(width ? { width } : {}), ...(L.phone || L.short ? { height: L.phone ? 36 : 34 } : {}),
          ...(L.short ? { padX: 8 } : {}) });
    };
    if (L.phone) {
      ui.column("topbar-col", () => {
        ui.row("title-row", titleRow, { width: inner, justify: "space-between", align: "center", spacing: 12 });
        const w3 = (inner - 10) / 3, w2 = (inner - 5) / 2;
        ui.column(T("aria.modes"), () => {
          ui.row("modes-1", () => { for (const m of MODES.slice(0, 3)) modeBtn(m, w3); }, { spacing: 5 });
          ui.row("modes-2", () => { for (const m of MODES.slice(3)) modeBtn(m, w2); }, { spacing: 5 });
        }, { spacing: 5, role: "radiogroup" });
      }, { spacing: 8 });
    } else if (!fits()) {
      // too narrow for one row (a small landscape window): the tabs share a second row
      ui.column("topbar-col", () => {
        ui.row("title-row", titleRow, { width: inner, justify: "space-between", align: "center", spacing: 12 });
        const w5 = (inner - 4 * 5) / 5;
        ui.row(T("aria.modes"), () => { for (const m of MODES) modeBtn(m, w5); }, { spacing: 5, role: "radiogroup" });
      }, { spacing: 4 });
    } else {
      ui.row("topbar-row", () => {
        ui.row("title-row", titleRow, { spacing: 12, align: "center" });
        ui.row(T("aria.modes"), () => { for (const m of MODES) modeBtn(m); }, { spacing: L.short ? 6 : 8, role: "radiogroup", align: "center" });
      }, { width: inner, justify: "space-between", align: "center" });
    }
  }, { style: "topbar", width: L.lw, padding: { top: padY, bottom: padY, start: pad, end: pad } });
  topH = r.height;
}

function statusLine(): string {
  const bestTxt = best[round.difficulty] != null ? T("status.best", { best: best[round.difficulty]! }) : "";
  return T("status.line", {
    difficulty: T(`diff.${round.difficulty}`), filled: Game.filledCount(round), score: Game.computeScore(round),
    mistakes: round.mistakes, time: fmtTime(Game.elapsedSeconds(round)),
  }) + bestTxt;
}
function cellValue(i: number): string {
  if (round.board[i]) return round.given[i] ? T("cell.fixed", { digit: round.board[i]! }) : String(round.board[i]);
  return round.notes.has(i) ? T("cell.marked") : T("cell.empty");
}
function cellName(i: number): string {
  return T("cell.at", { row: Math.floor(i / SIZE) + 1, col: (i % SIZE) + 1, value: cellValue(i) });
}
function progressBar(width: number): void {
  const p = Game.computeProgress(round);
  const pct = Math.round(p * 100);
  ui.widget(T("panel.progress"), {
    role: "meter", value: p, min: 0, max: 1, size: { width, height: 8 }, description: T("progress.complete", { pct }),
    draw: (r) => {
      draw.box(r.x, r.y, r.width, r.height, "bar");
      if (shownProgress > 0.001) draw.box(r.x, r.y, Math.max(r.height, r.width * shownProgress), r.height, "bar-fill");
    },
  });
}
function playerLine(width: number, size: number): void {
  const st = platform.syncState();
  if (st === null) return;
  const name = platform.displayName();
  para(`${name} · ${T(`sync.${st}`)}`, width, "readout", size);
}

function statusPanel(L: Layout): void {
  const y = topH / L.sc + 8;
  // A phone's status strip spans the window; a small landscape window's spans the room left of the controls.
  const strip = L.phone || (L.short && L.lw < 700);
  if (strip) {
    const w = L.phone ? L.lw - 16 : L.lw - 8 - 8 - 210 - 8;
    const r = ui.id("status").place(T("aria.statusPanel"), { anchor: "top-start", x: 8, y }, () => {
      para(statusLine(), w - 20, "status-text", 12);
      playerLine(w - 20, 12);
      ui.column("progress-wrap", () => progressBar(w - 20), { padding: { top: 4 } });
    }, { style: "panel", width: w, padding: { top: 6, bottom: 6, start: 10, end: 10 }, spacing: 4 });
    panelRects.push(r);
    return;
  }
  const w = L.short ? 190 : 300;
  const padX = L.short ? 10 : 16, padY = L.short ? 8 : 14;
  const inner = w - 2 * padX;
  const r = ui.id("status").place(T("aria.statusPanel"), { anchor: "top-start", x: L.short ? 8 : 18, y: topH / L.sc + (L.short ? 8 : 18) }, () => {
    ui.style("panel-h", L.short ? { text: { size: 13 } } : {}).heading(T("panel.status"));
    para(statusLine(), inner, "status-text", L.short ? 12 : undefined);
    if (!L.short) para(round.selected === -1 ? T("cell.none") : cellName(round.selected), inner, "readout");
    playerLine(inner, 12);
    ui.column("progress-wrap", () => {
      ui.style("progress-label").label(T("panel.progress"));
      progressBar(inner);
    }, { spacing: 6, padding: { top: 6 } });
  }, { style: "panel", width: w, padding: { top: padY, bottom: padY, start: padX, end: padX }, spacing: L.short ? 4 : 6 });
  panelRects.push(r);
}

function padButton(d: number, width: number, height: number, size: number): void {
  const exhausted = Game.digitCount(round, d) >= SIZE;
  button(String(d), exhausted ? "pad-dim" : "pad-btn", () => { padDigit = d; enterDigit(d); },
    { width, height, size, selected: padActive && padDigit === d, id: `pad-${d}` });
}
function eraseButton(width: number, height: number): void {
  // named "Erase selected cell" for screen readers (the old aria-label), showing "Erase"
  const text = T("btn.erase");
  if (ui.style("pad-wide", { width, minHeight: height }).id("pad-erase").button(T("aria.erase"), { content: () => ui.style("pad-wide-text").label(text) })) later(eraseCell);
}
function actionButtons(width: number, perRow: number, height: number, size: number, gap: number): void {
  const list: [string, () => void, boolean?][] = [
    [keyed("btn.mark", "note"), toggleNote, round.selected !== -1 && round.notes.has(round.selected)],
    [keyed("btn.hint", "hint"), showHint],
    [keyed("btn.clear", "clear"), clearBoard],
    [keyed("btn.restart", "restart"), restartRound],
    [keyed("btn.pause", "pause"), () => setPaused(!paused)],
    [keyed(platform.isMuted() ? "btn.unmute" : "btn.mute", "mute"), toggleMute, platform.isMuted()],
  ];
  const ids = ["act-note", "act-hint", "act-clear", "act-restart", "act-pause", "act-mute"];
  const w = (width - gap * (perRow - 1)) / perRow;
  ui.column("actions", () => {
    for (let r = 0; r * perRow < list.length; r++) {
      ui.row(`actions-${r}`, () => {
        for (let k = r * perRow; k < Math.min(list.length, (r + 1) * perRow); k++) {
          const [label, act, on] = list[k]!;
          button(label, "action-btn", act, { width: w, height, size, selected: !!on, id: ids[k]! });
        }
      }, { spacing: gap });
    }
  }, { spacing: gap });
}

let controlsNatural = 0;
function controlsPanel(L: Layout): void {
  if (L.phone) {
    const w = L.lw - 16, inner = w - 20;
    const gap = 6;
    const bw = (inner - 4 * gap) / 5;
    const stageH = L.lh - topH / L.sc;
    const maxH = stageH * 0.46;
    const body = (): void => {
      const r = ui.column("controls-body", () => {
        ui.column(T("aria.numberPad"), () => {
          ui.row("pad-1", () => { for (let d = 1; d <= 5; d++) padButton(d, bw, 38, 16); }, { spacing: gap });
          ui.row("pad-2", () => { for (let d = 6; d <= 9; d++) padButton(d, bw, 38, 16); eraseButton(bw, 38); }, { spacing: gap });
        }, { spacing: gap });
        actionButtons(controlsNatural > maxH - 16 ? inner - 14 : inner, 3, 32, 11, 5);
      }, { spacing: 6 });
      controlsNatural = r.height / L.sc;
    };
    const r = ui.id("controls").place(T("aria.controlsPanel"), { anchor: "bottom-start", x: 8, y: 8 }, () => {
      if (controlsNatural > maxH - 16) ui.scrollArea("controls-scroll", { width: inner, height: maxH - 16 }, body);
      else body();
    }, { style: "panel", width: w, padding: { top: 8, bottom: 8, start: 10, end: 10 } });
    panelRects.push(r);
    return;
  }
  const w = L.short ? 210 : 260;
  const padX = L.short ? 10 : 16, padY = L.short ? 8 : 14;
  const inner = w - 2 * padX;
  const gap = 6;
  const top = topH / L.sc + (L.short ? 8 : 18);
  const body = (bodyW: number): void => {
    const r = ui.column("controls-body", () => {
      ui.style("panel-h", L.short ? { text: { size: 13 } } : {}).heading(T("panel.controls"));
      const bw = (bodyW - 2 * gap) / 3;
      const bh = L.short ? 36 : 40, fs = L.short ? 15 : 18;
      ui.column(T("aria.numberPad"), () => {
        for (let r0 = 0; r0 < 3; r0++) ui.row(`pad-${r0}`, () => { for (let c = 1; c <= 3; c++) padButton(r0 * 3 + c, bw, bh, fs); }, { spacing: gap });
        eraseButton(bodyW, bh);
      }, { spacing: gap });
      ui.column("actions-wrap", () => actionButtons(bodyW, 2, 34, L.short ? 11 : 12, gap), { padding: { top: 4 } });
      if (!L.short) {
        ui.column("info", () => {
          para(T("info.select"), bodyW, "info");
          para(T("info.colors"), bodyW, "info");
        }, { spacing: 2, padding: { top: 4 } });
      }
    }, { spacing: L.short ? 4 : 8 });
    controlsNatural = r.height / L.sc;
  };
  if (L.short) {
    const h = L.lh - top - 8;
    const scroll = controlsNatural > h - 2 * padY;
    const r = ui.id("controls").place(T("aria.controlsPanel"), { anchor: "top-end", x: 8, y: top }, () => {
      if (scroll) ui.scrollArea("controls-scroll", { width: inner, height: h - 2 * padY }, () => body(inner - 14));
      else body(inner);
    }, { style: "panel", width: w, height: h, padding: { top: padY, bottom: padY, start: padX, end: padX } });
    panelRects.push(r);
  } else {
    const r = ui.id("controls").place(T("aria.controlsPanel"), { anchor: "top-end", x: 18, y: top }, () => body(inner),
      { style: "panel", width: w, padding: { top: padY, bottom: padY, start: padX, end: padX } });
    panelRects.push(r);
  }
}

/** The pause and results overlays (renderPaused / renderResults), centred over the board. */
function overlay(L: Layout): void {
  if (!paused && !round.gameOver) return;
  const w = L.phone ? L.lw - 24 : Math.max(320, Math.min(420, L.lw - 24));
  const padX = L.phone ? 16 : 28, padY = L.phone ? 16 : 18;
  const inner = w - 2 * padX;
  const r = ui.place("overlay", "center", () => {
    if (round.gameOver) {
      const p = Game.scoreParts(round);
      ui.style("overlay-h").heading(T("overlay.complete"));
      const rows: [string, number, boolean][] = [
        [T("score.placed"), p.placed, false],
        [T("score.mistakes", { n: round.mistakes }), p.mistakePenalty, false],
        [T("score.hints", { n: round.hints }), p.hintPenalty, false],
        [T("score.solve"), p.solveBonus, false],
        [T("score.time", { time: fmtTime(Game.elapsedSeconds(round)) }), p.timeBonus, false],
        [T("score.total"), p.total, true],
      ];
      ui.column("score-list", () => {
        for (const [k, v, total] of rows) {
          if (total) ui.widget("rule", { role: "none", size: { width: inner, height: 7 }, draw: (rr) => draw.box(rr.x, rr.y + rr.height - 1, rr.width, 1, "rule") });
          ui.row(k, () => {
            ui.style(total ? "score-total" : "score-k").label(k);
            ui.style(total ? "score-total" : "score-k").label(String(v));
          }, { width: inner, justify: "space-between", spacing: 24 });
        }
      }, { spacing: 6, padding: { top: 6 } });
      if (lbLine) para(T(lbLine[0], lbLine[1]), inner, "hint-line");
      para(T("overlay.again"), inner, "hint-line");
    } else {
      ui.style("overlay-h").heading(T("overlay.paused"));
      para(T("overlay.pausedHint"), inner, "hint-line");
      ui.row("overlay-actions", () => {
        button(T("btn.resume"), "overlay-btn", () => setPaused(false), { id: "resume" });
        button(T("settings.button"), "overlay-btn", openSettings, { id: "pause-settings" });
      }, { spacing: 8, padding: { top: 6 } });
    }
  }, { style: "overlay", width: w, align: "center", spacing: 10, padding: { top: padY, bottom: padY, start: padX, end: padX } });
  panelRects.push(r);
}

/** Settings: the account section (sign in or invite) and the runtime's Options (graphics, sound, language,
 * controls — what the old dialog's Graphics section and the page helpers did). Opening it pauses a running round. */
function settingsDialog(L: Layout): void {
  if (!settingsOpen) return;
  const w = Math.min(460, L.lw - 16);
  const inner = w - 32 - 2;
  const still = ui.dialog("settings-dialog", "", true, () => {
    ui.column("settings-body", () => {
      ui.row("settings-head", () => {
        ui.style("dialog-h").heading(T("settings.title"));
        button(T("settings.close"), "action-btn", () => { settingsOpen = false; }, { id: "settings-close", width: Math.max(80, tw(T("settings.close"), "action-btn", "button") + 28) });
      }, { width: inner, justify: "space-between", align: "center" });
      ui.column("account", () => {
        ui.style("section-h").heading(T("account.title"));
        if (!platform.signedIn()) {
          para(T("account.signInHint"), inner, "account-hint");
          button(T("account.signIn"), "account-btn", () => { settingsOpen = false; void requestSignIn().catch(() => undefined); }, { id: "sign-in" });
        } else {
          button(T("account.invite"), "account-btn", copyInvite, { id: "invite" });
        }
      }, { spacing: 6, padding: { top: 6 } });
      ui.widget("settings-rule", { role: "none", size: { width: inner, height: 1 }, draw: (rr) => draw.box(rr.x, rr.y, rr.width, 1, "rule") });
      button(T("settings.options"), "account-btn", () => { settingsOpen = false; openMenu(); }, { id: "options", width: inner });
    }, { width: inner, spacing: 10 });
  });
  // The Escape that opened it (from the pause key path) must not close it at once.
  if (!still && frame().frame > settingsOpenedFrame + 1) settingsOpen = false;
}
function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) { showToast(T("account.copyFailed")); return; }
  try { clipboard.writeText(link); showToast(T("account.copied")); } catch { showToast(T("account.copyFailed")); }
}

function toasts(L: Layout): void {
  if (!toast) return;
  if (nowSec() > toast.until) { toast = null; return; }
  const text = toast.text;
  ui.place("toast", { anchor: "bottom", y: 16 }, () => {
    para(text, Math.min(420, L.lw * 0.9) - 34, "toast-text");
  }, { style: "toast", align: "center" });
}

/** The 81 tiles as accessible buttons over the board (screen readers, play scripts, browser automation). */
function boardTargets(): void {
  if (paused && !round.gameOver) return;
  ui.id("board").column(T("aria.board"), () => {
    for (let i = 0; i < SIZE * SIZE; i++) ui.id(`cell-${i}`).target(cellName(i), render.cellRect(i));
  }, { width: 0, height: 0 });
}

/** safeRect: the window rectangle the panels leave free (each panel hugs one edge). */
function playfield(L: Layout): void {
  const f = frame();
  const w = f.width, h = f.height - topH;
  let l = 0, t = 0, r = w, b = h;
  for (const p of panelRects.slice(0, 2)) {
    if (!p.width || !p.height) continue;
    const e = { l: p.x, t: p.y - topH, r: p.x + p.width, b: p.y + p.height - topH };
    if (e.r - e.l > w * 0.6) { if (e.t < h * 0.5) t = Math.max(t, e.b); else b = Math.min(b, e.t); }
    else if (e.l < w * 0.5) l = Math.max(l, e.r); else r = Math.min(r, e.l);
  }
  // Too narrow between the side panels (a small landscape window): the board takes the room left of the controls,
  // its far corner under the short status panel (the browser build fell back to the whole width, under the controls).
  if (r - l < w * 0.4) { l = 0; if (r < w * 0.4) r = w; }
  if (b - t < h * 0.4) { t = Math.min(t, h * 0.3); b = Math.max(b, h * 0.7); }
  void L;
  render.setPlayfield(l, topH + t, r - l, b - t);
}

function insideHud(x: number, y: number): boolean {
  if (y < topH) return true;
  return panelRects.some((p) => x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height);
}

// ------------------------------------------------------------------ lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const key = `${f.quality}:${f.levelIndex}`;
  if (key === lookKey) return;
  lookKey = key;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

/** A document from elsewhere (another device, the browser build's cloud save): bests always merge; its round
 * replaces this one only while the player has not touched the board since start. */
function adopt(doc: Doc): boolean {
  const local = buildDoc();
  const merged = Game.mergeSaveDocs(local, doc);
  let changed = JSON.stringify(merged.best) !== JSON.stringify(best);
  best = merged.best;
  if (merged.round !== local.round && !touched) {
    const r = Game.restoreRound(merged.round);
    if (r) {
      round = r;
      round.selected = -1;
      paused = false;
      changed = true;
    }
  }
  if (changed) render.setBoard(boardView());
  return changed;
}

onStart(() => {
  initStyles();
  const doc = platform.loadDoc();
  best = doc.best;
  const restored = doc.round ? Game.restoreRound(doc.round) : null;
  round = restored ?? Game.newRound("learn", Game.nextSeed("learn", rand, platform.nowMs()));
  // A solved round restores with its results and frozen score (not posted again).
  if (round.gameOver) postedSeed = `${round.mode}:${round.puzzleSeed}:${round.moves}:${round.hints}:${round.mistakes}`;
  platform.bind(buildDoc, adopt);
  platform.onMutedChange((m) => audio.setMuted(m));
  platform.onSignedOut(() => showToast(T("account.signedOut")));
  platform.initPlatform();
  audio.setMuted(platform.isMuted());
  render.setBoard(boardView());
  platform.saveDoc();
});

onFixedUpdate((step) => {
  if (playing() && !settingsOpen && !frame().overlayOpen) round.elapsedMs += step * 1000;
});

// The page hidden or the runtime's Options opened over the game pauses a running round (visibilitychange).
onSuspend(() => { if (playing()) { paused = true; } platform.saveDoc(); platform.flush(); });
onOverlay((open) => { if (open && playing()) setPaused(true); });
onQuit(() => platform.saveDoc());

onUpdate((dt) => {
  const f = frame();
  applyLook();
  audio.update();
  const L = layoutNow();
  panelRects = [];
  topBar(L);
  statusPanel(L);
  controlsPanel(L);
  overlay(L);
  boardTargets();
  settingsDialog(L);
  toasts(L);
  playfield(L);
  // the progress bar's 0.2 s ease-out (style.css transition)
  const p = Game.computeProgress(round);
  shownProgress += (p - shownProgress) * Math.min(1, dt / 0.08);
  if (Math.abs(p - shownProgress) < 0.002) shownProgress = p;

  const tapped = pointerUpFrame === f.frame;
  const acts = pending.splice(0);
  for (const fn of acts) fn();
  // A tap on a button leaves the keys with the board (minor 20 keeps keys with a focused widget).
  if (acts.length && tapped && !settingsOpen) ui.setFocus(null);

  for (const q of presses.splice(0)) {
    if (settingsOpen || ui.pointerOver() || insideHud(q.x, q.y)) continue;
    const cell = render.pick(q.x, q.y);
    if (cell >= 0) selectCell(cell);
    else if (round.selected !== -1) { round.selected = -1; refresh(); }
  }
  render.update(dt);
  render.drawDigits();
});
