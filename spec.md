# Number Sanctuary — Game Design Document

Running specification. Present tense; describes the game as it ships today. Anything the design
calls for that the code does not yet do is confined to §17.

---

## 1. Overview

**Pitch.** A nine-by-nine logic grid laid out as a lamp-lit stone courtyard at dusk, where every
digit you set is a tile pressed into the floor and the wrong digit is refused before it lands.

| | |
|---|---|
| Genre | Single-player constraint/deduction puzzle (Sudoku ruleset) |
| Players | 1; personal bests per difficulty, and a high-score leaderboard for signed-in players |
| Session length | 4–20 min per grid (Easy ≈ 4–8 min, Hard ≈ 12–25 min); resumable, so a session can be one cell long |
| Platforms | StarHermit engine script game: natively in the StarHermit client, in browsers through the engine's web runtime; desktop and phones, portrait and landscape |
| Engine | StarHermit engine 1.28.0, host API 1.30 (`starhermit.txt`: `engine.version=1.28.0`, `engine.minor=30`, capabilities `platform, storage, clipboard`) |
| Rendering | `starhermit:scene` (three.js r185-parity scene graph) for the courtyard; `starhermit:ui` for the top bar, panels, overlays and dialog; `starhermit:draw` for the board digits |
| Persistence | The engine's `saves` store (device + the player's cloud slot); the Mute choice in the engine's game `settings` |

### File map

| Path | Owns |
|---|---|
| `starhermit.txt` | Manifest: name, description, owner, `server=score-script.js`, cover, `launch=index.html`, `engine.*`, `control.*` keyboard actions with groups, `engine.gamepad.*`. |
| `native/main.ts` | Entry (`engine.entry`): the round and its actions, input (actions, pointer, touch), the UI built every frame (top bar, status panel, controls panel, pause/results overlay, Settings dialog, toasts, the board's accessible targets), layout breakpoints, the HUD-free playfield for the camera, lifecycle. |
| `native/render.ts` | The courtyard scene (tiles, board/plinth, lanterns, fireflies, ring, backdrop), tile states and the refused-digit flash, the graphics look per level (shadows, detail, shading, baked occlusion, reflections, bloom, grade, anti-aliasing), camera framing (`frameCamera`), picking, tile rectangles, the digits on the 2D overlay. |
| `native/quality.ts` | The four looks (the browser build's gfx.js presets and budgets) keyed by the runtime's quality tier and level index. |
| `native/platform.ts` | Save document (load, save, conflict merge, foreign migration of the browser build's cloud save), the Mute setting and legacy settings migration, player/sync line, invite link, platform clock, leaderboard posting through `score-script.js`. |
| `native/audio.ts` | The authored one-shots per event with round-robin rotation, loaded one at a time once the mixer runs. |
| `native/i18n.ts` | `T(key, vars)` over `lang/strings.js` in the runtime's interface language. |
| `native/style.ts` | Registers `assets/ui-style.json`, the theme, focus ring and dialog look. |
| `native/game.ts` | Typed facade over `src/round.js`. |
| `src/round.js` | Pure round logic (no I/O): modes → difficulty, seeds, legality, actions, scoring, progress, the save document (`roundDoc`, `restoreRound`, `mergeSaveDocs`, `readForeign`). Shared with node tests and `tools/gen-plays.mjs`. |
| `rules.js` | Pure Sudoku engine: `generateGrid`, `countSolutions`, `makePuzzle`, `solve`, `boxIndex`. |
| `lang/strings.js` | The nine-locale string tables (keyed, en-US complete). |
| `assets/` | `courtyard-stone.webp`, `sanctuary-backdrop.webp`, baked `textures/grain.png` and `textures/contact-ao.png`, `ui-style.json`. |
| `sfx/` | 19 authored Opus clips + manifests (manifests are left out of the package). |
| `score-script.js` | Platform script (`server=`): range-checks a solved puzzle's score and posts it to `high-score`. |
| `server.js` | Local dev static server for the packaged folder plus `/api/v1/time` (not in the package). |
| `index.html`, `starhermit-files.json` | The web loader and file index written by `npm run package` (never edited by hand). |
| `tools/` | `package-web.mjs`, `css.mjs` (+ `ui-style.css`), `bake-textures.mjs`, `gen-plays.mjs`, `browser-play.mjs`. |
| `tests/` | `rules.mjs`, `round.test.mjs`, `i18n.test.mjs`, `native.mjs` + `native/*.play`. |

---

## 2. Design pillars

**1. The board is the room.** The playfield is a stone floor in a courtyard, lit and framed as a
place, not a diagram on a background: a 3D perspective board, an authored dusk backdrop, tiles with
real thickness and a physical placement sound.

**2. Refusal, not correction.** An illegal digit is never written and then marked wrong; it is
refused at entry with a red flash and a knock. The board is always a valid partial position.

**3. Quiet, but never silent.** Every input answers within one frame with a colour change and a
distinct object sound; nothing in the mix is bright or urgent. No music bed.

**4. Nothing hidden from the player.** Seeds, the score breakdown, the difficulty weight and the
solution-uniqueness guarantee are all inspectable or stated.

**5. Resume beats restart.** Every mutation writes the save; a completed round restores with its
results and a frozen score. The clock stops on pause, when the window or tab is hidden, and while
the runtime's Options are open.

---

## 3. Player experience

The game opens directly on a playable Easy (Learn) grid — or the saved round — with no title screen.
The controls panel's info lines say *"Click a cell (or use the arrow keys), then a number."* and
*"Orange tiles are fixed clues; green tiles are yours."*; every action button carries its current key
in its label (`Mark (N)`, `Hint (H)` …, following the player's rebinds). The first tap rings a select
tick and drops a yellow ring; the status panel names the cell in words. The first digit either sinks
in with a wooden tap and turns green, or is knocked back with a red flash. When the last digit lands
the temple-bell bloom plays, all tiles repaint, the ring disappears and the score stops moving.

---

## 4. Core loop and rules contract

### Board and entities

An 81-cell grid indexed `0..80`, `row = floor(i/9)`, `col = i%9`, `box = floor(r/3)*3 + floor(c/3)`.
A round (`src/round.js`) holds `grid` (the solution), `board` (current values, 0 empty), `given`
(clue flags), `notes` (a set of marked cells), `selected`, `mistakes`, `moves`, `hints`, `elapsedMs`,
`gameOver` and `completedElapsed`. A cell is a clue, a player digit, a marked empty, or empty.

### Puzzle construction

1. `generateGrid(seed)` fills all 81 cells by ordered backtracking with a mulberry32-shuffled
   candidate list per cell. Same seed ⇒ identical grid.
2. `makePuzzle(grid, seed, target)` clears cells in a seeded order only while `countSolutions(p, 2)
   === 1` still holds, stopping at `target` removals: every puzzle has exactly one solution.
3. `target` by difficulty: **easy 40, medium 50, hard 56**.

### Legal actions

| Action | Precondition |
|---|---|
| Select cell | not paused, not solved |
| Enter digit 1–9 | a cell is selected and it is not a clue |
| Erase | selected, not a clue |
| Toggle mark | selected, cell empty |
| Hint | not paused, not solved |
| Clear / Restart / mode tab | always |
| Pause / Resume | not solved |
| Mute | always |

### Resolution of a digit entry (`enterDigit`)

1. Nothing happens if paused, solved, or nothing selected.
2. A clue → invalid sound and red flash, **no mistake counted**.
3. The cell already holds `d` → treated as an erase.
4. `isLegal(cell, d)` checks the row, column and box against the *current board*. Failure →
   `mistakes++`, invalid sound, red flash for 220 ms.
5. Success → the digit is set (`moves++` when the cell was empty; its mark is cleared), place sound.
6. `isSolved()` re-validates all 27 groups; true ends the round.

### Scoring (`scoreParts`)

```
weight        = easy 10 | medium 20 | hard 30
placed        = weight × moves
mistakePenalty= −5 × mistakes
hintPenalty   = −25 × hints
solveBonus    = (solved ? 100 × weight / 10 : 0)      → 100 / 200 / 300
timeBonus     = (solved ? max(0, 600 − elapsedSeconds) : 0)
total         = placed + mistakePenalty + hintPenalty + solveBonus + timeBonus
```

The results overlay prints exactly those six lines. `best[difficulty]` keeps the highest total per
difficulty and appears in the status line as `· Best N`.

### Progress, terminal state, clock

Progress = player cells holding the *correct* digit ÷ player cells (it can move backwards). The only
terminal state is solved; there is no loss condition. The round clock (`elapsedMs`) advances by the
runtime's fixed steps while a round runs unpaused, the Settings dialog is closed and the runtime's
Options are closed; the solve freezes it.

### RNG and seeding

`rules.js` derives its own streams from the puzzle seed. `native/main.ts` keeps a mulberry32 stream
seeded at start from `Date.now() ^ 0x5EED` to pick the next puzzle seed. Daily bypasses it: the seed
is `UTCyear*10000 + UTCmonth*100 + UTCday` of the platform's clock (`serverNow()`, falling back to the
device's UTC date offline), so every player gets the same grid that day. Saves keep the seed and the
player's digits; the puzzle is regenerated on restore.

### Undo and hints

No undo stack. Erase (Backspace / Delete / `0` / the Erase button / re-pressing the digit) reverses a
cell; Clear empties every player cell, zeroes the counters and restarts the clock. A hint fills the
selected cell if it is a player cell that is empty or wrong, else the first such cell, selects it and
counts a hint (and a move when the cell was empty).

---

## 5. Modes and progression

Five tabs, always visible in the top bar. Choosing one plays the mode sound and starts a fresh round.

| Mode | Difficulty | Target removals | Seed source |
|---|---|---|---|
| Learn | Easy | 40 | fresh per round |
| Journey | Medium | 50 | fresh per round |
| Daily | Hard | 56 | UTC date |
| Practice | Easy | 40 | fresh per round |
| Challenge | Hard | 56 | fresh per round |

Restart in Daily rebuilds the same grid. There are no unlocks; the only progression is the bests.

---

## 6. Controls and interaction

Actions are declared in `starhermit.txt` (grouped *Digits*, *Selection*, *Round*); players rebind
keys and pad buttons in the runtime's Options (F1).

| Action | Keys | Gamepad | Effect |
|---|---|---|---|
| `digit1`–`digit9` | `1`–`9`, numpad | — | Place that digit (the cell's own digit erases) |
| `erase` | Backspace, Delete, `0`, numpad 0 | West | Erase the selected cell |
| `up` `down` `left` `right` | arrows, WASD | D-pad, left stick | Move the selection, clamped; from none, the centre cell |
| `prevdigit` / `nextdigit` | `[` / `]` | LB / RB | Choose the number pad's digit (highlighted on the pad) |
| `place` | Enter | South | Place the chosen pad digit |
| `note` | N, U | North | Toggle the mark on the selected empty cell |
| `hint` | H | Select | Hint |
| `clear` | C | LT | Clear all player digits |
| `restart` | R | RT | New round of the mode |
| `pause` | P | Start | Toggle pause |
| `menu` | Escape | East | Pause (never unpauses) |
| `mute` | M | right stick press | Toggle the game's sound |

**Pointer and touch.** A click or tap on a tile selects it (raycast against the 81 tiles); one on the
board's surroundings clears the selection. Presses on panels, the top bar, overlays and the dialog go
to the UI. The number pad, Erase and the six action buttons do the same as their keys; mode tabs
switch modes.

**Keys and UI focus.** At minor 20 the keys go to the board unless a widget has keyboard focus (Tab
or the gamepad gives the UI focus). A tap or click on a button gives the keys back to the board.
Enter on a focused button activates that button rather than placing a digit. While a round runs the
D-pad moves the selection; paused or solved, it navigates the buttons (South activates).

**Input locking.** Selection and entries are locked while paused or solved (checked in each action).
The 220 ms flash is cosmetic and accepts input throughout. The Settings dialog is modal.

---

## 7. Screens and UI flow

One screen with overlay states over the live board:

```
start ──▶ playing ⇄ paused (overlay: Resume, Settings)
             │
             └──▶ solved (results overlay over the frozen board)
                    └── R / Restart / mode tab ──▶ playing
```

**Top bar.** Title, **Settings**, and the five mode tabs (a radio group; the active tab orange).
**Status panel.** "Status", the status line (`Easy · 41/81 · Score 0 · Mistakes 0 · 0:04 · Best N`),
the selected cell in words, the player's name and save state when signed in, and the progress bar.
**Controls panel.** "Controls", the 3×3 number pad (a digit placed nine times dims) with Erase, the
six action buttons (Mark and Mute show pressed when on), and the two info lines.
**Overlays.** Paused: heading, hint line, Resume and Settings buttons. Results: "Sanctuary complete",
the score breakdown, the leaderboard line when posting, "Press R for a new round."
**Settings dialog.** Opening it pauses a running round. Account: *Sign in with StarHermit* with its
hint for guests (the runtime's sign-in), *Invite a friend* when signed in (copies the invite link,
toast). Then *Options: graphics, sound, language, controls*, which opens the runtime's Options.
Close or Escape closes it; the pause overlay stays for a deliberate Resume.
**Toasts.** Invite copied / failed; signed out — playing locally.

**Layouts** (logical size, after the player's interface scale):
- *Desktop:* status panel top-left (300 px), controls top-right (260 px), 18 px from the edges.
- *Phone portrait (≤ 700 px wide):* the top bar stacks (title + Settings, tabs 3 + 2); a status strip
  (no heading/readout) under it; the controls at the bottom, full width, pad in five columns with
  Erase beside 9, actions three per row, capped at 46% of the stage with its own scroll.
- *Short landscape (≤ 520 px tall):* slim panels (190 / 210 px), the controls full height with a
  scroll area; below 700 px wide the status becomes a strip left of the controls and the tabs move to
  a second top-bar row when they do not fit.

**Never cut off.** `frameCamera` fits the whole board into the rectangle the panels leave free (a view
offset centres it there; narrow rectangles get a steeper view), recomputed whenever the window or the
panels change.

---

## 8. Art direction

### Palette

| Role | Hex |
|---|---|
| Page ground / backdrop fallback | `#1a2026` |
| Top bar | `#232b33` |
| Panel ground | `rgba(20,26,32,0.85)` |
| Inactive button | `#3a4550` / action `#2d3742` |
| Primary / secondary text | `#e8edf2` / `#9aa7b4`, info `#cfd8e0` |
| Clue tile, active tab | `#c05621` |
| Player tile, progress fill | `#2f855a` |
| Empty tile | `#2b6cb0` |
| Marked tile, pressed toggle | `#6b46c1` |
| Selection ring, focus ring | `#f6e05e` |
| Rejection flash | `#e53e3e` |

Every tile state is also stated in words (the status panel's cell line and the tiles' accessible names).

### Shape, type, motion

Tiles are `0.94 × 0.5 × 0.94` boxes (rounded on detailed looks); the selection ring is the only
curve. Text is the system sans (`sans-serif`, Arial on Windows): 20 px bold title with 1 px tracking,
16 px headings, 14 px body, 12 px secondary. Board digits are the browser build's 128 px canvas digit
(bold 96 px, white, soft dark halo; 256 px on Ultra) drawn on the 2D overlay at each tile's projected
place and size, so they are never bloomed, tone mapped or darkened. Motion: the progress bar eases,
the 220 ms flash, the breathing ring, flickering lantern flames and lights, drifting fireflies; the
runtime's reduced-motion option stops the ambient motion (the ring holds a steady glow).

### Graphics

Cool dusk hemisphere fill, a warm key directional light (front-left) with PCF shadows, a faint cool
rim light, ACES filmic tone mapping. Light intensities are three.js r160's ÷ π (the engine's
convention). The look follows the runtime's graphics level (Options › Graphics: Auto or a level;
the runtime owns render scale, pixel-ratio cap, adaptive resolution, the frame-rate limit and its
readout):

| Tier | Shadows | Baked AO | Bloom | Grade | AA | Reflections | Fireflies | Detail | Tile shading |
|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | off | MSAA | off | off | plain board | Lambert |
| Balanced | 1024² | on | on | on | FXAA | on | ⅓ of 80 | plinth + lanterns | Standard satin |
| High | 2048² | on | on | on | SMAA | on | 110 | + 2 lantern lights | Physical clear-coat glaze |
| Ultra | 4096² | high | on | on | MSAA | on | 160 | + 2 lantern lights | as High, 256 px digits |

Fireflies scale up within a tier with the level index (≤ 2×, at most 320). Detail: Plain is boxes on a
flat stone plane; Detailed is rounded tiles with a finish by state (clues glazed, player digits satin,
open cells matte), grain in roughness and bump, a limestone plinth with a soft contact shadow and a
shadow-catching ground, and four stone lanterns. Baked contact occlusion darkens the grout and rim
(an overlay; "high" also darkens tile bases). Reflections are a PMREM-filtered `RoomEnvironment` as
each PBR material's own envMap with the old intensities (0.3 on plinth, lanterns and detailed tiles).
Bloom: strength 0.4, radius 0.55, threshold 0.9 (the browser build's 0.75 bloomed the ring and
fireflies more on the engine than on three.js; 0.4 matches the old screenshots). Grade: display-space
contrast 0.11 (the old 0.22 S-curve), saturation 1.06, cool shadows / warm highlights, vignette 0.26.

---

## 9. Audio direction

Object sounds, not game sounds: wood, stone, glass, brass, cloth, felt; no music or ambience bed. The
clips play on the runtime's *effects* bus (Options › Audio owns volumes, mute and the voice limit);
the game's Mute (M) silences its effects on top and is remembered (game setting `muted`, synced with
the account). Clips load once the mixer runs (natively at once, in browsers after the first press),
one at a time; an event whose clip is still loading is silent. Place, invalid and select rotate
through four clips each.

| Event | Files | When |
|---|---|---|
| place | `place-wood-tap`, `place-stone-set`, `place-peg-thunk`, `place-glass-tick` | a legal digit lands |
| invalid | `invalid-wood-knock`, `invalid-dull-thud`, `invalid-rubber-bounce`, `invalid-dice-rattle` | a refused digit (clash or clue) |
| select | `select-switch-tick`, `select-pen-click`, `select-brass-chime`, `select-cork-pop` | a cell is selected |
| solve | `solve-bloom-chime`, `solve-bowl-swell` | the grid completes |
| hint | `hint-glass-shimmer` | a hint reveals a digit |
| erase | `erase-brush-sweep` | a digit or mark is removed |
| pause / resume | `pause-stone-close` / `resume-stone-open` | pause opens / play resumes |
| mode | `mode-cloth-turn` | a mode tab is chosen |

All clips: MOSS-SoundEffect v2.0, 48 kHz mono Opus, −20 LUFS (`sfx/manifest.txt` is canonical).

---

## 10. Localization

Nine locales (`lang/strings.js`): `en-US` (complete), `en-GB`, `es-419`, `es-ES`, `de-DE`, `fr-FR`,
`fr-CA`, `pt-BR`, `it-IT`; regional tables override only what differs (*Pencil* vs *Mark*, *Aide* vs
*Indice*). The language is the runtime's interface language (Options › Language, else the account's
or device's); every string is drawn through `T()` each frame, so a change shows on the next frame
without touching the round. Action labels keep their key in parentheses, replaced by the effective
binding. `tests/i18n.test.mjs` checks that every key the client uses exists in every full locale with
its placeholders, and that no row is unused.

---

## 11. Accessibility

- **Keyboard-only and gamepad-only paths** cover every action (§6).
- **Focus ring:** a 3 px `#f6e05e` ring 2 px out on every focusable widget.
- **The board is in the accessibility tree:** each tile is a button target named "Cell row R, column
  C: value" (value `empty`, `marked, empty`, a digit, or `N (fixed)`), inside a group named *Sudoku
  board*; screen readers, the browser's ARIA mirror and play scripts reach tiles by name.
- **Panels** are named *Status and progress* and *Controls and info*; the progress bar is a meter
  ("Progress", "NN% complete"); Erase is named *Erase selected cell*; mode tabs are radios; Mark and
  Mute are toggles shown selected when on.
- **Runtime options** (interface size, text size, high contrast, reduced motion) apply over the
  game's styles; the layout is computed in logical pixels after the interface scale.
- **Target sizes:** pad ≥ 40 px desktop / 38 px phone, actions ≥ 34 / 32 px, tabs 36 px on phones.

---

## 12. StarHermit integration

- **Manifest:** `name`, `description`, `owner`, `server=score-script.js`, `cover=cover.jpg`,
  `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.28.0`,
  `engine.minor=30`, `engine.capabilities=platform,storage,clipboard`, the actions and pad defaults.
- **Player:** `player()`; signed in from the first frame in the client, or after the runtime's sign-in
  (Settings › Sign in). The status panel shows the display name and the save state (*Saving to cloud…*
  / *Cloud save synced* / *Cloud sync failed*). Signing out shows a toast; play continues locally.
- **Save:** `{ best, round }` (schema 1) through `saves.save` after every change (device at once,
  account debounced by the runtime), and on suspend/quit. Conflicts merge (`mergeSaveDocs`): bests
  keep the higher value per difficulty; the same puzzle's further-along round wins (finished first,
  then more filled cells, ties local); different puzzles keep the local round. An account save that
  replaces the device's later in the session merges its bests, and its round only while the player
  has not acted since start.
- **Migration from the browser build:** its cloud slot (`game:<slug>`, the JS SDK's zipped
  `save.json` with the same `{ best, round }` JSON) shows as foreign; it is read from
  `saves.foreign().text`, merged in and replaced once (`replaceForeign`). Its settings KV (`muted`,
  `graphics`, language keys) is read through `settings.legacy`: `muted` becomes the game's Mute
  unless set since; all legacy keys are then removed. Guests' old browser `localStorage` (round and
  graphics) cannot migrate.
- **Leaderboard:** one board, `high-score` (integer, higher is better, 0–100,000). A solved puzzle
  outside Learn, signed in, opens a practice session whose socket sends `{ type: 'result', scores:
  { 'high-score': max(0, total) } }`; `score-script.js` range-checks and posts it (server-authoritative
  per platform policy: the client only proposes the total) and acknowledges; the results show
  *Posting score…*, then *Leaderboard rank: #N*, *Score posted…* or *Score not posted…*. A restored
  solved round is not posted again.
- **Invite:** `inviteLink()` fetched ahead; *Invite a friend* copies it (`clipboard`).
- **Clock:** `serverTime()` at start, `serverNow()` for the Daily's date.
- **Not used:** achievements, rooms, matchmaking, chat, replays, voice.

---

## 13. Technical architecture

- **Pure logic** (`rules.js`, `src/round.js`, `lang/strings.js`) is plain ES modules imported by the
  engine client (`allowJs`) and the node tests unchanged.
- **Frame order** (`onUpdate`): apply the look for the current graphics level, pump audio loads, build
  the UI (top bar, status, controls, overlay, board targets, dialog, toasts), compute the playfield,
  run the button actions collected during the build, decide queued board presses (after the UI so
  `ui.pointerOver()` is this frame's), update the scene, draw the digits.
- **Fixed steps** advance the round clock; nothing else simulates.
- **Determinism:** a round is `(mode, seed)`; the Daily is a function of the date, which lets
  `tools/gen-plays.mjs` write a script that solves today's Daily through the UI.
- **Budgets:** 81 tile meshes (four materials each, swapped by tier), ~110 scene objects, one digit
  sheet canvas, two baked textures, two authored images, 19 clips.

---

## 14. Testing and acceptance criteria

`npm test` runs:
- `tests/rules.mjs` — generation is complete, reproducible and uniquely solvable for removal targets
  40/50/56 across five seeds; invalid puzzles count 0 solutions and do not solve.
- `tests/round.test.mjs` — mode → difficulty and clue counts, the Daily seed, refusals and mistakes,
  erase-by-same-digit, marks, hints, clear, the score breakdown and the solve, restore from a saved
  round, `mergeSaveDocs`, and reading the browser build's cloud save text.
- `tests/i18n.test.mjs` — key coverage and placeholders in all locales.
- `tests/native.mjs` — the web index matches the files (`npm run package` ran last), `tsc` (no
  `skipLibCheck`), `starhermit check .` with zero warnings, and signed-out render checks of
  `tests/native/menus.play` (desktop: selection, mark, pause/resume, Settings dialog, mute, mode
  switch, restart, hints to the results, new round, clear), `phone.play` (390×844 @3: touch a tile,
  Hint, Erase, Mark, pad digits, Practice solved by Hint taps), `landscape.play` (844×390 @3:
  Challenge solved by keys, pad-digit choice and Enter) and today's generated Daily (every open tile
  clicked by name and its digit typed or clicked on the pad; no mistakes, no hints).

`npm run test:browser` (`tools/browser-play.mjs`) serves the packaged folder and plays it in Chrome on
the GPU (`~/games/tools/gpu-chrome.mjs`) at 1366×768, 390×844 @3 and 844×390 @3: keyboard selection
and marks, a tile by its accessible target, Hint, a reload that restores the round, pause, the
Settings dialog, solving by hints to the results, mode switches. Any console error or warning, the
runtime's error screen or an unfinished round fails it.

---

## 15. Asset inventory

| Path | Purpose | Source |
|---|---|---|
| `assets/sanctuary-backdrop.webp` | Scene background: dusk courtyard, colonnade, still water | FLUX.2 klein, 1280×720 WebP |
| `assets/courtyard-stone.webp` | Limestone multiplied into the board and plinth | FLUX.2 klein, 768² WebP |
| `assets/textures/grain.png` | Tile roughness/bump grain (128²) | baked by `tools/bake-textures.mjs` from the browser build's painter |
| `assets/textures/contact-ao.png` | Contact occlusion overlay (512², alpha) | baked likewise (the old canvas used `filter: blur`) |
| `assets/ui-style.json` | UI styles | `npm run css` from `tools/ui-style.css` |
| `sfx/*.opus` (19) | Event clips (§9) | MOSS-SFX v2.0 |
| `cover.jpg`, `coverart.png`, `icon.png`, `favicon.*` | Platform presentation | prior passes |

---

## 16. Known limitations

- **Marks are per-cell, not per-digit.**
- **The five modes differ only by difficulty** (Learn has no lessons, Journey no ladder, Challenge no
  constraints, Practice equals Learn).
- **No undo stack;** Clear also zeroes the counters and restarts the clock.
- **Progress can go backwards** (it measures correct cells against the solution).
- **Hints reveal rather than teach.**
- **No cap on mistakes or time.**
- **Solo leaderboard scores are client-proposed** and range-checked by `score-script.js` (0–100,000),
  not re-derived on the server from the moves.
- **Guests' browser-build progress** (their `localStorage`) does not carry over; signed-in players'
  cloud saves do.
- **The old Settings › Graphics per-effect overrides** (shadows, bloom, … one by one) are not offered:
  the runtime's Options choose a graphics level, which picks the look.
- **The synthesized beeps** the browser build played while a sample was still decoding are gone; the
  first presses of a session can be silent until the clips load.

---

## 17. Design intent not yet implemented

1. **Per-digit pencil notes** inside empty tiles.
2. **Mode-specific rules** — Learn lessons, a Journey ladder, Challenge constraints.
3. **Reduced-motion gameplay feedback** — a persistent border instead of the 220 ms flash.
4. **Hero lantern model** beside the board.
