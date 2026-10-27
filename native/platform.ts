// The game's data and the StarHermit platform, on the runtime's modules (the
// browser build's platform.js over starhermit-sdk.js plus main.js's
// localStorage cache):
// - the save document { best, round } (personal bests per difficulty and the
//   round in progress, src/round.js roundDoc) is the game's save
//   (starhermit:storage `saves`, schema 1: on the device and in the player's
//   cloud slot), written on every change as main.js wrote localStorage and the
//   cloud mirror; two devices' saves merge on a conflict (mergeSaveDocs, the
//   browser build's saveconflict merge). The slot the browser build wrote
//   through the JS SDK (game:<slug>, the same JSON) shows as foreign: it is
//   merged in and replaced once;
// - the Mute toggle is the game's own setting (`settings` "muted", synced with
//   the account); the browser build's settings KV (muted, graphics) is
//   migrated (muted) and removed (graphics and language are the runtime's
//   Options now);
// - the player (the status panel's name and save line), the invite link, the
//   platform's clock (the Daily's UTC date) and posting a solved puzzle's
//   total through score-script.js (a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did) with the
//   player's rank on the high-score board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions,
  type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store } from "starhermit:storage";
import { mergeSaveDocs, normalizeDoc, readForeign } from "../src/round.js";

export interface SaveDoc { best: Record<string, number>; round: unknown }

let lastSavedAt = 0;
let current: () => SaveDoc = () => ({ best: {}, round: null });
let adoptFn: (doc: SaveDoc) => boolean = () => false;

/** main.ts: what the live document is, and how a document from elsewhere is merged into it (whether it changed). */
export function bind(getDoc: () => SaveDoc, adopt: (doc: SaveDoc) => boolean): void {
  current = getDoc;
  adoptFn = adopt;
}

function write(opts: { replaceForeign?: boolean } = {}): void {
  try {
    saves.save(current() as unknown as JsonValue, { schema: 1, ...opts });
    lastSavedAt = saves.load()?.savedAt ?? lastSavedAt;
  } catch (e) { console.warn(`save: ${String(e)}`); }
}
/** Saves the live document (device at once, the account debounced by the runtime). */
export function saveDoc(): void { write(); }
export function flush(): void { void saves.flush().catch(() => undefined); }

saves.onConflict((localSave, remote) => ({ merged: mergeSaveDocs(localSave?.data ?? null, remote.data) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adoptFn(normalizeDoc(cur.data) as SaveDoc)) write();
  }
});
/** The browser build's cloud document: merged with this device's, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  const doc = readForeign(old.text) as SaveDoc | null;
  if (doc) adoptFn(doc);
  write({ replaceForeign: true });
}

/** The device's save (normalised), read once at start. */
export function loadDoc(): SaveDoc {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  return normalizeDoc(cur?.data ?? null) as SaveDoc;
}

/** The status panel's save line (platform.js onSync): saving | synced | error; null for a guest. */
export function syncState(): "saving" | "synced" | "error" | null {
  if (!player()) return null;
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "foreign" || st === "uploading" || st === "conflict" || saves.status() === "pending") return "saving";
  return "synced";
}

// --- the Mute toggle --------------------------------------------------------------------------------
let muted = false;
const muteListeners = new Set<(m: boolean) => void>();
export function onMutedChange(fn: (m: boolean) => void): void { muteListeners.add(fn); }
export function isMuted(): boolean { return muted; }
export function setMuted(m: boolean): void {
  if (muted === m) return;
  muted = m;
  try { store.set("muted", m); } catch (e) { console.warn(`muted: ${String(e)}`); }
  for (const fn of muteListeners) fn(m);
}
function readMuted(): void {
  let v: JsonValue | undefined;
  try { v = store.get("muted"); } catch { return; }
  if (typeof v === "boolean" && v !== muted) { muted = v; for (const fn of muteListeners) fn(v); }
}
// The browser build patched { muted, graphics } into the account's settings KV (and sh-language.js its
// ui.language): muted carries over unless set here since, then every legacy key is removed.
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  if (keys.includes("muted")) {
    const v = store.legacy("muted");
    let mine: JsonValue | undefined;
    try { mine = store.get("muted"); } catch { mine = undefined; }
    if (typeof v === "boolean" && mine === undefined) setMuted(v);
  }
  for (const key of keys) store.removeLegacy(key);
}

/** Reads the game's options and migrates the old ones (from onStart). */
export function initPlatform(): void {
  readMuted();
  store.onChange((key) => { if (key === "muted") readMuted(); });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player and the clock ------------------------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName || ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
const signOutListeners = new Set<() => void>();
export function onSignedOut(fn: () => void): void { signOutListeners.add(fn); }
let wasSignedIn = false;
function refreshPlayer(): void {
  invite = null;
  board = undefined;
  const now = !!player();
  if (wasSignedIn && !now) for (const fn of signOutListeners) fn();
  wasSignedIn = now;
  if (!now) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

/** Now in ms by the platform's clock when it has answered, else the device's (the Daily's UTC date). */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}

// --- the leaderboard ---------------------------------------------------------------------------------
let board: Leaderboard | null | undefined;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board !== undefined) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}

/** Signed in only: post a solved puzzle's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
