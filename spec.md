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
| Players | 1, offline; scores compared only against the player's own local bests |
| Session length | 4–20 min per grid (Easy ≈ 4–8 min, Hard ≈ 12–25 min); resumable, so a session can be one cell long |
| Platforms | Desktop and mobile browsers; portrait and landscape |
| Rendering | Three.js (r160 ES modules) WebGL board on `#scene-canvas`, with all controls and readouts as real DOM over it; Graphics quality presets from Low to Ultra |
| Persistence | `localStorage` offline cache; with a StarHermit launch token the same doc also mirrors to the platform cloud-save slot |

### File map

| Path | Owns |
|---|---|
| `index.html` | Static DOM: top bar (title, frame-rate readout, Settings button), mode tablist, status panel, number pad, action row, overlay host, Settings dialog shell; the import map for `three` / `three/addons/`. All translatable nodes carry `data-i18n` / `data-i18n-aria-label`. |
| `main.js` | Everything stateful: game state, per-mode puzzle construction, scoring, persistence, the Three.js scene and its graphics settings (`applyGraphics`, `graphicsInfo`, post chain, adaptive resolution, ambient motion), input handling, the StarHermit hookup, and the `Game` QA surface. |
| `gfx.js` | Pure graphics quality model (no three.js): presets, categories and tiers, `detectPreset`, `resolve`, `choosePreset`, `presetTier`, `describe`. |
| `settings.js` | The Settings dialog's Graphics section: builds the controls, reflects saved/resolved settings, open/close, focus trap. Talks to `main.js` only through callbacks. |
| `platform.js` | StarHermit adapter over `starhermit-sdk.js`: profile nickname, `game:<slug>` cloud save (remote-preferred load, 2 s debounce, pagehide flush), settings KV, keyboard bindings, sign-in/invite helpers. Inert — no network, no account UI — without a token. |
| `starhermit-sdk.js` | Unmodified copy of the canonical StarHermit client (`window.StarHermit`); owns the launch token and its renewal. |
| `rules.js` | Pure, I/O-free Sudoku engine: `generateGrid`, `countSolutions`, `makePuzzle`, `solve`, `boxIndex`. Dual-exported (ESM + `module.exports`) so `tests/rules.mjs` can import it under Node. |
| `audio.js` | WebAudio bus, gesture unlock, sample loading/rotation, and a synth fallback per event. |
| `i18n.js` | Nine-locale string table, locale detection, `t(key, vars)`. |
| `style.css` | Panel/HUD layout, palette, the ≤700 px mobile reflow. |
| `score-script.js` | StarHermit platform script (`server=score-script.js`): range-checks a solved puzzle's score and posts it to the `high-score` leaderboard (canonical copy in the games repo's `tools/score-script.js`). |
| `server.js` | Local dev server: static host for the launch bundle, `vendor/three/*`, `sfx/*`, and `assets/*`. Serves nothing else. |
| `vendor/three/` | Three.js r160 (npm `three@0.160.1`): `three.module.js`, `LICENSE`, and the same-revision addons the game imports (`postprocessing/` EffectComposer, RenderPass, ShaderPass, OutputPass, UnrealBloomPass, SMAAPass and their deps; `shaders/` FXAA, SMAA, Copy, Output, LuminosityHighPass; `environments/RoomEnvironment.js`; `geometries/RoundedBoxGeometry.js`). Unmodified. |
| `starhermit.txt` | Platform manifest (`name`, `launch`, `owner`, `server`, `cover`, `control.*` keyboard actions). |
| `sfx/` | 19 authored Opus clips + `manifest.txt` (canonical), `manifest.md`, `manifest.json`. |
| `assets/` | Authored art: `courtyard-stone.webp`, `sanctuary-backdrop.webp`. |
| `tests/rules.mjs` | `npm test` — engine determinism, uniqueness, solving. |
| `tests/gfx.test.mjs` | `npm test` (`node --test`) — the graphics quality model. |
| `tests/e2e.mjs` | `npm run test:e2e` — full Playwright playthrough at desktop and mobile viewports. |
| `coverart.png`, `icon.png`, `favicon.svg` | Store/tab art. |

---

## 2. Design pillars

**1. The board is the room.** The playfield is a stone floor in a courtyard, lit and framed as a
place, not a diagram on a background. *Rules in:* a 3D perspective board, an authored dusk backdrop,
tiles with real thickness and a physical placement sound. *Rules out:* flat 2D cell borders, UI
chrome drawn inside the board, decorative particles competing with the digits.

**2. Refusal, not correction.** An illegal digit is never written and then marked wrong; it is
refused at entry with a red flash and a knock. *Rules in:* `isLegal` gating every placement, a
mistake counter, permanent legality of everything on the board. *Rules out:* a "check my grid"
button, error highlighting of placed digits, lives that end the round. The board is therefore always
a valid partial position, which is what keeps the courtyard calm rather than accusatory.

**3. Quiet, but never silent.** Every input answers within one frame with both a colour change and
a distinct sound; nothing in the mix is bright or urgent. *Rules in:* eight separate audio events,
four-clip rotation on the three most frequent ones, felt/stone/wood timbres. *Rules out:* music
beds, combo stingers, voice, any cue louder than the placement tap.

**4. Nothing hidden from the player.** Seeds, the score breakdown, the difficulty weight and the
solution-uniqueness guarantee are all inspectable or stated. *Rules in:* seeded generation, a
per-line results breakdown, a daily seed derived from the UTC date alone. *Rules out:* secret
difficulty adjustment, unexplained totals, any puzzle that has more than one solution.

**5. Resume beats restart.** The player should be able to close the tab mid-grid and lose nothing.
*Rules in:* every mutation writes the round to `localStorage`; a completed round restores with its
results overlay and a frozen score. *Rules out:* a separate "continue" menu, a session timer that
punishes stepping away (the clock stops on pause and on tab hide).

---

## 3. Player experience

**Target player.** Someone who already knows Sudoku and wants a calm, good-feeling place to play
it — plus a newcomer who can be taught the whole rule set in two lines.

**First 60 seconds.** The game opens directly on a playable Easy grid; there is no title screen and
no menu to clear. Teaching is ambient and complete on screen from frame one:

1. The right panel's info list states the two things a player needs: *"Click a cell (or use the
   arrow keys), then a number."* and *"Orange tiles are fixed clues; green tiles are yours."*
   Colour is therefore explained before it is used.
2. Every action button carries its keyboard shortcut in its own label — `Mark (N)`, `Hint (H)`,
   `Clear (C)`, `Restart (R)`, `Pause (P)`, `Mute (M)` — so the keyboard layer teaches itself.
3. The first tap on the board rings a select tick and drops a yellow ring; the cell readout below
   the status line names the cell in words ("Cell row 4, column 7: empty"). Selection is confirmed
   twice, visually and in text.
4. The first digit either sinks in with a wooden tap and turns green, or is knocked back with a red
   flash. Two attempts teach the whole rules contract.

**Session shape.** Open → the saved grid is already there → 20–50 placements interleaved with
scanning → occasional `H` when a scan stalls → completion overlay → `R` for the next grid.

**The emotional beat.** When the last digit lands the placement tap is replaced by the temple-bell
bloom, all 81 tiles repaint, the ring disappears and the score stops moving. The game gets quieter
at the win, not louder.

---

## 4. Core loop and rules contract

### Board and entities

An 81-cell grid indexed `0..80`, `row = floor(i/9)`, `col = i%9`, `box = boxIndex(r,c)` =
`floor(r/3)*3 + floor(c/3)` (`rules.js`). Four parallel arrays in `main.js` hold the state:
`grid` (the full solution), `board` (current values, `0` = empty), `given` (fixed-clue flags), and
`notes` (a `Set` of cell indices flagged by the player). A cell is exactly one of: a clue
(`given[i]`), a player digit (`board[i] && !given[i]`), a marked empty (`notes.has(i)`), or empty.

### Puzzle construction — `buildPuzzle` (main.js), `rules.js`

1. `generateGrid(seed)` fills all 81 cells by ordered backtracking with a mulberry32-shuffled
   candidate list per cell. Same seed ⇒ byte-identical grid.
2. `makePuzzle(grid, seed, target)` walks a seeded shuffle of `0..80` and clears a cell only when
   `countSolutions(p, 2) === 1` still holds afterwards, stopping at `target` removals. The puzzle
   therefore has **exactly one solution at every step of construction**, and `removed ≤ target`.
3. `target` comes from difficulty: **easy 40, medium 50, hard 56** — so Easy ships 41 clues, and
   Hard 25 or slightly more where a removal was rejected.

### Legal actions

| Action | Precondition | Owner |
|---|---|---|
| Select cell `i` | not paused, not solved | `selectCell` |
| Enter digit `d` (1–9) | a cell is selected, that cell is not a clue | `enterDigit` |
| Erase | selected, not a clue | `eraseCell` |
| Toggle mark | selected, cell empty | `toggleNote` |
| Hint | not paused, not solved | `showHint` |
| Clear / Restart | always | `clearBoard` / `restartRound` |
| Pause / Resume | not solved | `setPaused` |
| Mute | always | `setMuted` |

### Resolution order for a digit entry — `enterDigit` (main.js)

1. Reject outright if paused, solved, or nothing selected.
2. If the cell is a clue → `playInvalid`, red flash, **no mistake counted** (mis-aimed input is not
   a logic error).
3. If the cell already holds `d` → the entry is treated as an erase (re-pressing a digit removes it).
4. `isLegal(cell, d)` scans the cell's row, column and box against the *current board* — not the
   solution. Failure → `mistakes++`, `playInvalid`, red flash for 220 ms, refresh, stop.
5. Success → `applyDigit` (increments `moves` only when the cell was empty, clears any mark),
   `playPlace`, repaint the tile.
6. `isSolved()` re-validates all 27 groups from scratch. True → `finishRound()`. False → `refresh()`.

`refresh()` is the single presentation sync point: it moves the selection ring, renders, rewrites
the status line and cell readout, sets the progress bar, dims number-pad digits already used nine
times, updates the Mark button's `aria-pressed`, and writes the save.

### Scoring — `scoreParts` (main.js)

All values are integers; formatting happens only in the overlay and status line.

```
weight        = easy 10 | medium 20 | hard 30
placed        = weight × moves
mistakePenalty= −5 × mistakes
hintPenalty   = −25 × hints
solveBonus    = (solved ? 100 × weight / 10 : 0)      → 100 / 200 / 300
timeBonus     = (solved ? max(0, 600 − elapsedSeconds) : 0)
total         = placed + mistakePenalty + hintPenalty + solveBonus + timeBonus
```

**Worked example.** Journey (medium, weight 20), a grid with 50 blanks. The player fills all 50
cells — one of them via a hint, which also counts as a move — makes 3 refused entries, and finishes
at 7:12 (432 s).

```
placed          = 20 × 50            = +1000
mistakePenalty  = −5 × 3             =   −15
hintPenalty     = −25 × 1            =   −25
solveBonus      = 100 × 20 / 10      =  +200
timeBonus       = max(0, 600 − 432)  =  +168
total                                 = 1328
```

The results overlay prints exactly those six lines. `best[difficulty]` keeps the highest total per
difficulty and appears in the status line as `· Best 1328`. Note the incentive shape: a hint costs
25 but returns `weight` for the move it fills, so on Hard a hint is net positive in points and net
negative in time — priced as a real but survivable trade.

### Progress

`computeProgress()` = (player-owned cells holding the *correct* digit) ÷ (player-owned cells). It
uses the solution, so a legal-but-wrong digit does not advance the bar. This is the one place the
game reads `grid` during play, and it is why the bar can move backwards.

### Terminal state

The only terminal state is **solved**. There is no loss condition: mistakes are counted and priced
but never end a round, and the clock has no limit. `finishRound()` freezes `completedElapsed`,
records the best, plays `playSolve`, repaints all 81 tiles, drops the selection, and opens the
results overlay. A solved round survives reload with an unchanged score.

### Tie-breaks

Only local bests exist, compared as a single integer per difficulty; a new total must be strictly
greater to replace the stored one, so an equal repeat leaves the record's earlier timestamp intact.

### RNG and seeding

Two independent mulberry32 streams. `rules.js` derives its own from the puzzle seed (and
`seed ^ 0x9E3779B9` for the removal order) so generation is reproducible from the seed alone;
`main.js` keeps a presentation-side stream, seeded at boot from `Date.now() ^ 0x5EED`, used solely
to pick the next puzzle seed. Daily bypasses it entirely: `nextSeed()` returns
`UTCyear*10000 + UTCmonth*100 + UTCday`, so every player on a given UTC day gets the same grid.
Puzzle seeds are saved and re-fed to `buildPuzzle` on restore — the board is regenerated, not
serialised.

### Undo and hints

There is no undo stack. Erase (Backspace / Delete / `0` / the Erase button / re-pressing the same
digit) is the reversal primitive, and `Clear` empties every player cell while keeping the puzzle.
`showHint` fills the selected cell if it is player-owned and currently wrong or empty, otherwise
the first such cell in index order; it writes the solution digit, so a hint can never be refused.

---

## 5. Modes and progression

Five tabs, always visible in the top bar. Choosing one plays `playMode`, sets the difficulty, and
starts a fresh round immediately (`setActiveMode` → `restartRound`).

| Mode | Difficulty | Target removals | Seed source |
|---|---|---|---|
| Learn | Easy | 40 | fresh per round |
| Journey | Medium | 50 | fresh per round |
| Daily | Hard | 56 | UTC date |
| Practice | Easy | 40 | fresh per round |
| Challenge | Hard | 56 | fresh per round |

**Difficulty curve.** Difficulty is purely clue count, and clue count is what changes solution
depth: 41 clues on Easy leave most cells resolvable by single-candidate scanning; 25–31 on Hard
force cross-referencing between boxes. Score weight rises with it (10 → 20 → 30), and the solve
bonus scales identically.

**Daily content.** One Hard grid per UTC day, identical for everyone, immutable because it is a
pure function of the date. Restarting inside Daily rebuilds the same grid rather than a new one.

**Unlocks.** None. Every mode and difficulty is available at first load; the only progression the
game keeps is `best[difficulty]`.

---

## 6. Controls and interaction

### Desktop

| Input | Effect |
|---|---|
| Click a board tile | Select it (raycast against the 81 tile meshes) |
| Click off the board | Clear the selection |
| `1`–`9` | Place that digit; pressing the digit already in the cell erases it |
| `Backspace`, `Delete`, `0` | Erase the selected cell |
| `↑ ↓ ← →` / `W A S D` | Move the selection one cell, clamped at the edges; from no selection, jumps to the centre (index 40) |
| `N` / `U` | Toggle the mark on the selected empty cell |
| `H` | Hint |
| `C` | Clear all player digits |
| `R` | New round |
| `P` | Toggle pause |
| `Esc` | Pause (never unpauses — resume is deliberate); closes the Settings dialog when it is open |
| `M` | Toggle mute |

Modifier-held keys (`Ctrl`/`Meta`/`Alt`) are ignored so browser shortcuts survive. `Enter`/`Space`
on a focused `<button>` is left to the browser so the DOM controls behave normally. Keys typed into
an `INPUT`/`TEXTAREA` are ignored. While the Settings dialog is open the game ignores every
shortcut: the dialog owns the keyboard (Tab cycles inside it, `Esc` closes it and returns focus to the
button that opened it).

### Mobile

Tap the canvas to select; tap the number pad to place; tap `Erase`. The pad reflows to five columns
below 700 px with the wide Erase key on the same row, and every button keeps a ≥34 px min-height
(pad keys 38 px). The pointer path is `pointerdown` on the canvas, so a tap registers without
waiting for a click; the same handler serves mouse and touch.

### Input locking

Input is locked in exactly two states: `paused` and `gameOver`. Both are checked at the top of every
mutating action rather than by covering the canvas, so the overlay never has to trap events. There
is no animation-driven lock — the 220 ms invalid flash is cosmetic and accepts input throughout.

### Feedback contract

Every input produces, in the same frame: a sound (§9), a colour change on the affected tile or
button, and a rewritten status line. Selection additionally moves the ring and rewrites the cell
readout. Rejection additionally flashes `#e53e3e` for 220 ms.

---

## 7. Screens and UI flow

There is one screen. The game boots straight into play, and the only screen-level states are three
overlay conditions layered over the live board:

```
boot ──▶ playing ⇄ paused
           │
           └──▶ solved (results overlay, board still visible and frozen)
                  │
                  └── R / mode tab ──▶ playing
```

**Settings dialog.** The top bar's **Settings** button and a **Settings** button in the pause
overlay open a modal dialog (`#settings`, `role="dialog"`) with a **Graphics** section. Opening it
pauses a running round, so the clock never runs while the player adjusts graphics; closing it (Close,
`Esc`, or a click on the dimmed backdrop) leaves the pause overlay up for a deliberate Resume. The
panel is capped to the viewport and scrolls inside itself, so it fits portrait and short-landscape
phones.

`boot` restores a saved round when one validates (`restoreRound`), otherwise builds a new one. A
saved round that was already solved re-enters `solved` and re-opens the results overlay with the
stored score. `visibilitychange → hidden` forces `paused`, which stops the clock.

**Desktop layout.** Full-bleed canvas; the status panel is absolutely positioned top-left (300 px),
the controls panel top-right (260 px); overlays are centred with a 320 px minimum width.

**Large screens.** `ui-scale.js` sets `--ui-scale` (1 up to a 1600×1000 viewport, then
`min(w/1600, h/1000)`, capped at 2.5); the top bar, both panels, the overlay, the Settings dialog
and the toast are CSS-`zoom`ed by it, while the full-viewport canvas stays unzoomed and
`frameCamera` keeps the board inside the area the larger panels leave free.

**Mobile portrait (≤700 px).** The top bar stacks and the five mode tabs wrap to a full-width row.
The status panel becomes a full-width strip at the top; the cell readout and the info list are
hidden to protect vertical space. The controls panel moves to the bottom, full width, capped at 46%
of viewport height with its own scroll. Overlays shrink to `100% − 24px`.

**Mobile landscape.** Same rules (the breakpoint is width-based, so a 844×390 landscape phone uses
the desktop layout with the board framed narrower by `frameCamera`).

**Never cut off.** `frameCamera()` recomputes camera distance from both the vertical and horizontal
FOV on every resize and takes the larger, so all nine columns stay on screen at any aspect ratio.
The board must never be clipped; panels may overlay its corners because the camera pulls back
further than the board's span. The mode tabs, number pad and Erase key must stay fully reachable —
hence the bottom panel's own scroll rather than letting it grow past the viewport.

---

## 8. Art direction

### Palette (exact values from `style.css` and `main.js`)

| Role | Hex | Where |
|---|---|---|
| Page ground | `#1a2026` | `body` |
| Chrome / top bar | `#232b33` | `.topbar` |
| Panel ground | `rgba(20,26,32,0.85)` | `.panel` |
| Rule / inactive button | `#3a4550` | borders, `.mode-btn`, `.pad-btn` |
| Primary text | `#e8edf2` | body text |
| Secondary text | `#9aa7b4` / `#cfd8e0` | readout, labels / info list |
| Clue tile & active tab | `#c05621` (`0xc05621`) | fixed givens |
| Player tile & progress fill | `#2f855a` (`0x2f855a`) | placed digits |
| Empty tile | `#2b6cb0` | unfilled cells |
| Marked tile & pressed toggle | `#6b46c1` | notes, `aria-pressed` |
| Selection ring & focus outline | `#f6e05e` | ring mesh, `:focus-visible` |
| Rejection flash | `#e53e3e` | 220 ms tile flash |
| Courtyard floor | `0x3a4750` | board plane, multiplied by the stone scan |

Tile states are separated by hue and, secondarily, by lightness (`#c05621` is markedly lighter than
`#2f855a`), but the real guarantee for colour-vision deficiency is that every state is also stated
in words in the cell readout.

### Shape language

Everything is a rectangle with a soft radius. Tiles are boxes of `0.94 × 0.5 × 0.94` units — thick
enough to read as inset paving rather than painted squares. The only curve in the game is the
selection ring (`RingGeometry`, inner 0.5, outer 0.62), which is why it reads instantly as "the
cursor" against a field of squares. Panels use 8 px radii, buttons 6 px.

### Typography

System sans (`Arial, Helvetica, sans-serif`) throughout; 20 px bold title with 1 px tracking, 16 px
panel headings, 14 px body, 12 px secondary. Board digits are drawn into a 128 px canvas at
`bold 96px Arial`, white, centred, cached per digit and shared across all sprites that show it —
one texture per digit, not per cell.

### Motion

Gameplay motion is the progress bar's 200 ms width ease, the 220 ms rejection flash, and the
camera reframe on resize. Ambient motion (Graphics presets above Low): the selection ring breathes,
the lantern flames flicker, and fireflies drift and pulse around the plinth — never over the grid.
Ambient motion stops under `prefers-reduced-motion: reduce` (the ring holds a steady glow). The `requestAnimationFrame` loop keeps the canvas
current and ticks the HUD clock at ~2 Hz, early-returning while the document is hidden. No camera
drift and no tile animation; the Low preset has no particles or post-processing, which is what lets
the game run at full rate on software WebGL (as the e2e proves under SwiftShader).

**Reduced motion.** Ambient motion honours `prefers-reduced-motion`. The gameplay motions (one
200 ms bar tween and one colour flash) do not yet branch on it (see §17).

### Graphics

Lighting is a cool dusk hemisphere fill, one warm key directional light from the front-left and a
faint cool rim light from behind, rendered with ACES filmic tone mapping into sRGB output. Board
digits are drawn in a separate last pass straight to the canvas — never tone-mapped, bloomed or
darkened — and their sprites carry a soft dark halo, so they keep full contrast at every setting.
Optional effects: key-light PCF soft shadows (1024²/2048²/4096², frustum fitted to the plinth;
the scene is static, so the shadow map re-renders only when settings change); contact ambient
occlusion baked into a grout/rim overlay under the tiles (On), plus tiles darkening towards their
base (High) — the board never moves, so this costs nothing per frame; bloom limited to emissive
highlights (threshold 0.9: selection ring, lantern flames, fireflies); a colour grade (gentle
S-curve, slight saturation, warm highlights / cool shadows) with vignette; FXAA, SMAA or MSAA;
image-based reflections from a PMREM-filtered `RoomEnvironment`; fireflies (36 or 110); and
**Detail** — Plain is the original boxes on a flat stone plane, Detailed is rounded tiles with a
clearcoat finish by state (clues glazed, the player's digits satin, open cells matte) and procedural
grain in roughness and bump, a raised limestone plinth with a soft contact shadow, and four stone
lanterns whose far pair casts warm flickering light. Post-processing (EffectComposer: RenderPass →
UnrealBloom → OutputPass → grade → SMAA/FXAA) runs only when bloom, grade, FXAA or SMAA is on;
otherwise the scene renders straight to the canvas with its own MSAA.

The Settings dialog's **Graphics** section offers a quality preset — Auto (the default, shown as
"Auto (detected: <tier>)"; chosen from the WebGL unmasked renderer string: software renderers get
Low, discrete GPUs and Apple M-series get High, everything else Balanced, and touch/mobile devices
are capped at Balanced), Low, Balanced, High, Ultra — a render scale slider (50–200% of the
preset's), one select per effect (Shadows, Ambient occlusion, Bloom, Colour grade, Anti-aliasing,
Reflections, Fireflies, Detail; "From preset (<tier>)" by default), Adaptive resolution (on by
default: every 90 frames, an average over 26 ms steps the resolution down 10% to a 60% floor and
under 14 ms steps it back up 5%) and Show frame rate (a readout in the top bar), plus a summary
line "GPU name · cost summary · W×H px". Choosing a preset clears the per-effect overrides.
Changes apply immediately without a reload and persist in `localStorage['number-sanctuary:gfx']`.
Pixel ratio is min(devicePixelRatio, preset cap) × preset scale × render scale × adaptive scale,
with caps Low 1, Balanced 1.5, High/Ultra 2 (Ultra also renders at 125%), so Low never draws more
pixels than the game did before presets existed. If the post-processing chain cannot be built or
fails to render, the game renders without it and the panel says so. The body carries
`data-gfx-preset`, `data-gfx-auto` and one `data-gfx-<category>` attribute per effect for tests.

| Preset | Shadows | AO | Bloom | Grade | AA | Reflections | Fireflies | Detail | DPR cap |
|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | off | MSAA | off | off | plain | 1 |
| Balanced | 1024² | on | on | on | FXAA | on | 36 | detailed | 1.5 |
| High | 2048² | on | on | on | SMAA | on | 110 | detailed | 2 |
| Ultra | 4096² | high | on | on | MSAA | on | 110 | detailed | 2 (×1.25) |

### The hero

The board. The camera sits at roughly 0.75 × distance in Y and 0.72 in Z, framing the grid as a
floor seen from a standing height. The backdrop is deliberately dark, low-contrast and out of focus
so it establishes place without pulling the eye off the digits.

### Visual assets the design calls for

- A weathered pale limestone material for the courtyard floor, flat-lit and free of any marking, so
  it multiplies into the base colour without adding readable detail that competes with the digits.
- A dusk courtyard backdrop with a low horizon, distant colonnade, still water, and only two small
  warm lights — dark enough to sit behind a bright board without contest.

Both ship (§15).

---

## 9. Audio direction

**Mix philosophy.** Object sounds, not game sounds. Every cue is something a hand could do to a
physical board: wood, stone, glass, brass, cloth, felt. Nothing is pitched as a reward, and the
loudest event (the completion bloom) is a bell allowed to decay rather than a stinger.

**Buses.** One gain node between every source and the destination (`audio.js`). Mute sets its gain
to 0 and `setVolume` clamps to `[0,1]`; there is no per-category submix because there is only one
category. There is no music and no ambience bed — the courtyard is silent between actions, which is
what makes the placement tap land.

**Unlock and fallback.** The AudioContext resumes on the first `pointerdown` or `keydown`; sample
fetches start only after that. Until a clip has decoded — and permanently if it 404s or fails to
decode — the event is carried by a sine `beep()` fallback, so no input is ever silent. Before the
first gesture nothing is played or created (the solve chime of a results screen restored at boot is
skipped), which keeps the browser's autoplay warning out of the console. The three
high-frequency events rotate round-robin through four clips each so a run of placements never
repeats a sample back to back.

### SFX event table

`sfx/manifest.txt` is generated from this table and is the canonical on-disk record.

| Event id (`audio.js`) | File | Description | Usage context |
|---|---|---|---|
| `playPlace` | `place-wood-tap.opus` | Soft tap of a wooden number tile set onto a board | A legal digit lands in the selected cell |
| `playPlace` | `place-stone-set.opus` | Smooth stone tile on a wooden tabletop, rounded click with a low thud | Rotation variant |
| `playPlace` | `place-peg-thunk.opus` | Muted thunk of a peg seating into a board hole | Rotation variant |
| `playPlace` | `place-glass-tick.opus` | Delicate tick of a glass token on wood | Rotation variant |
| `playInvalid` | `invalid-wood-knock.opus` | Dull knock on a hollow wooden box | Digit clashes with row/column/box, or the player types over a clue |
| `playInvalid` | `invalid-dull-thud.opus` | Felt mallet on wood, low and gentle | Rotation variant |
| `playInvalid` | `invalid-rubber-bounce.opus` | Soft rubber ball bouncing once on wood | Rotation variant |
| `playInvalid` | `invalid-dice-rattle.opus` | Two dice shaken once in a wooden cup | Rotation variant |
| `playSelect` | `select-switch-tick.opus` | Crisp tick of a small metal switch | A cell becomes selected (tap or arrow key) |
| `playSelect` | `select-pen-click.opus` | Retractable pen button | Rotation variant |
| `playSelect` | `select-brass-chime.opus` | Tiny brass bell, quick decay | Rotation variant |
| `playSelect` | `select-cork-pop.opus` | Small cork pop | Rotation variant |
| `playSolve` | `solve-bloom-chime.opus` | Three temple bells struck together, blooming over stone | The grid completes; results overlay opens |
| `playSolve` | `solve-bowl-swell.opus` | Singing bowl struck softly, swelling and decaying | Rotation variant |
| `playHint` | `hint-glass-shimmer.opus` | Airy shimmer of a fingertip on a glass rim | A hint reveals one digit |
| `playErase` | `erase-brush-sweep.opus` | Dry brush wiping chalk dust from slate | A player digit or mark is removed |
| `playPause` | `pause-stone-close.opus` | Stone slab settling closed, muffled hush | Pause overlay opens (P / Esc / button / tab hidden) |
| `playResume` | `resume-stone-open.opus` | Stone slab sliding open, gentle airy release | Play resumes |
| `playMode` | `mode-cloth-turn.opus` | Heavy linen page turning over wood | A mode tab is chosen, before the new round builds |

All clips: MOSS-SoundEffect v2.0, 48 kHz mono Opus, 96 kbps VBR, loudness-normalised to −20 LUFS,
100 inference steps, 1–2 s.

---

## 10. Localization

**Shipping locales** (`i18n.js`, `LOCALES`): `en-US` (base), `en-GB`, `es-419`, `es-ES`, `de-DE`,
`fr-FR`, `fr-CA`, `pt-BR`, `it-IT`.

**Where strings live.** One table in `i18n.js`. `en-US` is complete; every other locale is a partial
override merged over it, so a missing key degrades to English rather than to a blank node.
Regional pairs are built by `Object.assign` from their parent (`es-419` from `es-ES`, `fr-CA` from
`fr-FR`, `en-GB` from `en-US`) and override only what genuinely differs — *Aide* vs *Indice*,
*pencilled* vs *marked*, `tú`- vs `usted`-neutral imperatives.

**Selection order.** `?lang=` query parameter (which is also persisted) → `localStorage`
`number-sanctuary:lang` → `navigator.languages` in order → `en-US`. Matching is exact-tag first,
then a Latin-American Spanish region list mapped to `es-419`, then any locale sharing the base
language. `document.documentElement.lang` and `document.title` are set from the resolved locale at
boot, and the active tag is exposed on `Game.state.locale`.

**Application.** `applyStaticStrings()` walks `[data-i18n]` (textContent) and
`[data-i18n-aria-label]` (aria-label) once at boot; dynamic text — the status line, cell readout,
mute button label, and both overlays — calls `t()` at build time with `{name}` interpolation.

**Settings strings.** The Settings dialog and every Graphics label, tier, summary fragment and
the post-processing note are localized in all nine locales (`settings.*`, `gfx.*` keys); acronyms
(FXAA/SMAA/MSAA) and the GPU name stay as-is.

**Expansion allowance.** Panels are fixed-width (300 px / 260 px) and buttons are flex-sized, so
strings must fit roughly 1.4× the English length. Action-button labels keep their Latin shortcut
letter untranslated in parentheses (`Aiuto (H)`), because the key binding does not change with the
locale.

---

## 11. Accessibility

- **Keyboard-only path.** Arrow keys or WASD move the selection from any state (with no selection,
  they jump to the centre cell); digits place, Backspace erases, and every action has a single-key
  shortcut. A player can start, solve and restart a grid without ever touching the pointer.
- **Focus.** `:focus-visible` draws a 3 px `#f6e05e` outline with 2 px offset on every button. The
  mode tablist uses roving `tabindex` (`0` on the active tab, `-1` on the rest) with
  `aria-selected` maintained by `setActiveMode`.
- **Live regions.** `#status-text` and `#cell-readout` are `aria-live="polite"`, so the score line
  and the spoken description of the selected cell ("Cell row 4, column 7: 6 (fixed)") are announced
  as they change. The overlay is `role="status" aria-live="polite"`, so pause and the full results
  breakdown are read out when they appear.
- **Progress.** `#progress-bar` is a `role="progressbar"` with `aria-valuemin/max/now` and an
  `aria-valuetext` of `"NN% complete"`, labelled by `#progress-label`.
- **The canvas is not the interface.** `#scene-canvas` carries `aria-hidden="true"`; nothing that a
  screen reader needs exists only in WebGL. Cell contents, selection and score all have DOM text.
- **Toggle state.** Mark and Mute expose `aria-pressed`, kept in sync on every refresh.
- **Contrast.** Body text `#e8edf2` on `#1a2026` is ~14:1; secondary `#9aa7b4` on the panel ground
  is ~6:1. Board digits are white on saturated mid-tones.
- **Target sizes.** Pad buttons ≥40 px desktop / 38 px mobile; action buttons ≥34 px; mode tabs
  36 px on mobile. Board cells are far larger than any of these at every framing.
- **Reduced motion.** Ambient graphics motion (fireflies, flicker, ring breathing) stops under
  `prefers-reduced-motion`; the gameplay motion budget is a 200 ms bar tween and a 220 ms colour
  flash — see §17.
- **Settings dialog.** Every control is a native `<select>`, range or checkbox with a `<label>`;
  it opens with focus on Quality, traps Tab, closes on `Esc` and returns focus to its opener.

---

## 12. StarHermit integration

**Used.**
- `starhermit.txt` manifest: `name=Number Sanctuary`, `launch=index.html`, `owner`, `server=score-script.js`,
  `cover=coverart.png`, per the platform's manifest convention (https://wiki.starhermit.com/).
- `score-script.js` is registered as the game's platform script; it only range-checks and posts
  scores. `server.js` is the local dev static host for the launch bundle. It binds `STARHERMIT_PORT` (or `PORT`, defaulting to 80), and serves an
  explicit allow-list: the bundle files (including `starhermit-sdk.js`) plus `sfx/*.{opus,json}` and `assets/*.{webp,png,glb}`
  matched against strict regexes. `tests/`, `tools/` and dotfiles are unreachable by construction.
- `coverart.png` (1200×675) and `icon.png` (256×256) supply the platform's store presentation.

**Used (hosted mode), and why.** All platform traffic goes through the shared SDK
`starhermit-sdk.js` (unmodified canonical copy, loaded before `main.js` as `window.StarHermit`);
`platform.js` adapts it. Without a token nothing is requested.
- *Launch token* — `StarHermit.init()` reads `#game_token=` (library launch) or `#access_token=`
  (direct sign-in return) once and strips it; the slug is the `game_scope` claim. The SDK renews
  the token before expiry; if renewal is refused the player line hides, a "signed out — playing
  locally" toast shows, Settings re-offers sign-in and play continues on localStorage.
- *Sign-in* — Settings → Account shows **Sign in with StarHermit** on `*.starhermit.com` without a
  token; hidden when signed in and when running locally (the section then hides entirely).
- *Nickname* — the profile nickname (fallback `Player ` + id prefix) shows with a cloud-sync
  status in the status panel.
- *Cloud save* — the `{best, round}` doc mirrors to the `game:<slug>` slot (remote wins on
  conflict, 2 s debounce, pagehide flush); localStorage stays the offline cache.
- *Settings KV* — mute, the Graphics settings and the locale are patched to the per-player settings
  store on change and applied at boot (the account value wins).
- *Invite* — signed in, Settings → Account shows **Invite a friend**, which copies
  `StarHermit.inviteLink()` to the clipboard and confirms with a toast.
- *Controls* — keyboard input is routed by `KeyboardEvent.code` through
  `StarHermit.loadBindings()` (platform rebinds over the `control.*` defaults in
  `starhermit.txt`); the action buttons' key hints show the effective keys.

- *Leaderboard* — one board, `high-score` (integer, higher is better, 0–100,000). Every solved
  puzzle outside Learn posts its total (floored at 0) through `StarHermit.submitScores` (a
  practice session whose `score-script.js` posts it), and the results overlay shows
  "Leaderboard rank: #N" (or posted / not posted). Standalone play posts nothing and shows no line.

Account and leaderboard strings are localized in all nine locales (`i18n.js` `account.*`, `lb.*`).

**Not used.** Achievements, matchmaking, friends/invite picker, chat, replays, realtime and voice —
the game is single-player; the only platform session is the short practice session that posts a
score, and no host or launch token is ever persisted.

---

## 13. Technical architecture

**Module responsibilities.** `rules.js` is pure with no DOM or global dependencies, which lets
`tests/rules.mjs` exercise it under plain Node; `gfx.js` is likewise pure and tested under Node.
`main.js` is the only module holding mutable game state and the only one touching Three.js;
`settings.js` touches only the Settings dialog's DOM. `audio.js` and `i18n.js` never read game state.
`platform.js` owns all StarHermit I/O and is driven only by `main.js`. Dependencies run strictly
one way: `main.js → {rules, audio, i18n, platform, gfx, settings}` and `settings → gfx`.

**Determinism and replay.** A round is fully described by `(seed, difficulty)`; the solution and the
clue set are regenerated from the seed on every load rather than stored. `generateGrid` and
`makePuzzle` use their own seeded mulberry32 streams and no global RNG, so the same seed reproduces
the same grid on any machine — which is what makes the Daily identical for everyone and what
`tests/rules.mjs` asserts directly.

**Persistence.** `localStorage['number-sanctuary:v1']` holds `{ best, round }`, written on every
`refresh()` and on `pagehide`. `round` carries mode, difficulty, seed, counters, the board, the
`given` mask, marks and elapsed seconds. `restoreRound` validates the mode, difficulty and array
lengths, rebuilds the puzzle from the seed, then re-applies only the player's digits over the
regenerated clues — a corrupted or stale save is rejected and a fresh round is built instead. Every
storage access is wrapped in `try/catch`, so private mode or a full quota degrades to a non-resuming
but fully playable game. `localStorage['number-sanctuary:lang']` holds the language override and
`localStorage['number-sanctuary:gfx']` the graphics settings (`{ preset, render_scale, adaptive,
show_fps, <category>: tier }`; absent keys mean Auto / from preset); neither is mirrored to the cloud. In
hosted mode the same doc is zipped (stored entry, CRC32) + base64'd into the single platform
cloud-save slot: `PUT` is debounced ~2 s and flushed on `pagehide`/`visibilitychange`, and at boot
a differing remote doc wins over the local cache (boot waits at most 1.5 s; a slower load still
wins when it arrives unless the board was changed meanwhile, and nothing is PUT before it resolves). Without a token none of
this runs — localStorage alone is the whole story.

**Performance budgets.** 81 tile meshes + 81 sprites + 1 plane + 1 ring ≈ 165 objects, one shared
box geometry, one material per tile, and one cached texture per distinct digit (≤9 textures for the
whole game). No per-frame allocation in `animate`; the HUD string is rebuilt at most twice a second;
`render()` is called on demand from `refresh()` as well as per frame. The pixel ratio is capped per
preset (§8 Graphics) and never exceeds 3; the shadow map renders only on settings changes.
The whole scene renders at full rate under SwiftShader in CI, which is the effective floor.

**How the e2e drives the real UI.** `tests/e2e.mjs` serves the repo over a loopback HTTP server and
drives headless Chrome. Every *action* is a real user action: `page.mouse.click` /
`page.touchscreen.tap` on canvas coordinates, real `page.keyboard.press`, real clicks on
`.mode-btn`, `.pad-btn` and `.action-btn`. The game's own module is imported **read-only** for two
things: `Game.state` to assert outcomes, and `Game.project(idx)` to convert a cell index to page
coordinates through the live camera — so the test clicks exactly where the player sees the cell, and
skips cells the current viewport pushes off-canvas. Any `pageerror` or non-allow-listed console
error fails the pass.

---

## 14. Testing and acceptance criteria

**`npm test` → `tests/rules.mjs`** asserts, across five seeds including `0xFFFFFFFF`:
generated grids are complete and uniquely solvable; generation is reproducible for a seed; for
removal targets 40/50/56 the reported `removed` equals the actual blank count, is `> 0` and `≤`
target, the puzzle still has exactly one solution, and `solve()` returns the original grid; and that
a grid with a duplicated digit, an empty array, and an all-10s array each yield `countSolutions = 0`
and `solve = null`.

**`npm test` → `tests/gfx.test.mjs`** (`node --test`) asserts `detectPreset` on sample GPU strings
(SwiftShader/llvmpipe → Low, GeForce/Apple M → High, Intel → Balanced, mobile capped at Balanced),
`resolve()` for Auto, explicit presets, per-effect overrides, invalid values and the 50–200%
render-scale clamp, that choosing a preset clears overrides while keeping scale and toggles, and
the `describe()` summary.

**`npm run test:e2e` → `tests/e2e.mjs`** runs 15 desktop steps (1280×800) and 14 mobile steps
(390×844, touch): boot shows the title, the canvas, five mode tabs, an Easy status line and exactly
41 clues consistent with the solution; the mode tabs move difficulty Easy→Medium→Hard→Easy; a canvas
click selects the centre cell; a keyboard digit fills a cell and advances progress and score; a
row-clashing digit is refused and increments mistakes; the pad places and erases; `N` toggles a
mark; `H` fills one correct cell and counts a hint; `P` opens the overlay, the Resume button closes
it, and mute toggles via both button and `M`; arrows move the selection to the expected indices; a
reload restores mode, seed and board; `C` removes only player digits and resets counters; `R`
produces a different seed with reset counters; and through the visible Settings button the Graphics
section fits the viewport, pauses the round, shows "Auto (detected: Low)" under SwiftShader, applies
Low then High (checked via `data-gfx-*` on `<body>` and the summary line), a Bloom override, the
render-scale slider and the frame-rate toggle live, keeps them across a reload, clears overrides
when Ultra is chosen, and returns to Auto. Any console error **or warning** fails a pass. Desktop additionally solves all 81 cells through the
UI, reaches the results overlay, and verifies the score is frozen and survives a reload.

**QA bar (agents/qa.md) as checkable statements.**
1. *Instructions on first play* — the info list states cell-then-number and the clue/player colour
   split before the first input; every action button carries its shortcut. ✔
2. *Every implemented feature usable in the browser* — the e2e reaches every one of them (mode tabs,
   selection, keyboard and pad entry, rejection, mark, hint, pause/resume, mute, clear, restart,
   persistence, completion) through the visible UI. ✔
3. *No console errors or warnings* — both passes fail on any `pageerror`, console error or console
   warning outside the allow-listed GPU/SwiftShader noise, with Low, High and Ultra all rendered. ✔
4. *Nothing cut off, desktop and mobile* — `frameCamera` guarantees all nine columns fit at any
   aspect; the ≤700 px layout moves the controls to a scrollable bottom sheet and drops the two
   optional text blocks. Screenshots are captured at every stage of both passes. ✔
5. *Play through the whole game* — the desktop pass fills all 81 cells and reaches results. ✔

---

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/sanctuary-backdrop.webp` | Scene background: dusk courtyard, colonnade, still water | FLUX.2 klein, seed 40712, 1536×864 → 1280×720 WebP q80 (13 KB) | generated in this pass; wired as `scene.background` |
| `assets/courtyard-stone.webp` | Limestone scan multiplied into the board plane material | FLUX.2 klein, seed 40711, 1024² → 768² WebP q80 (59 KB) | generated in this pass; wired as `boardMat.map`, 3×3 repeat |
| `sfx/place-wood-tap.opus` … `place-glass-tick.opus` (4) | `playPlace` rotation | MOSS-SFX v2.0 | shipped |
| `sfx/invalid-wood-knock.opus` … `invalid-dice-rattle.opus` (4) | `playInvalid` rotation | MOSS-SFX v2.0 | shipped |
| `sfx/select-switch-tick.opus` … `select-cork-pop.opus` (4) | `playSelect` rotation | MOSS-SFX v2.0 | shipped |
| `sfx/solve-bloom-chime.opus`, `sfx/solve-bowl-swell.opus` | `playSolve` completion bloom | MOSS-SFX v2.0 | generated in this pass; wired |
| `sfx/hint-glass-shimmer.opus` | `playHint` | MOSS-SFX v2.0 | generated in this pass; wired |
| `sfx/erase-brush-sweep.opus` | `playErase` | MOSS-SFX v2.0 | generated in this pass; wired |
| `sfx/pause-stone-close.opus`, `sfx/resume-stone-open.opus` | `playPause` / `playResume` | MOSS-SFX v2.0 | generated in this pass; wired |
| `sfx/mode-cloth-turn.opus` | `playMode` | MOSS-SFX v2.0 | generated in this pass; wired |
| `sfx/manifest.txt` | Canonical file → event → description → context map | authored | shipped |
| `sfx/manifest.json` / `manifest.md` | Generator input / readable mirror, kept in sync with `.txt` | authored | shipped |
| `coverart.png` | 1200×675 platform cover | prior FLUX pass | shipped |
| `icon.png`, `favicon.svg` | 256² platform icon, tab icon | authored | shipped |
| `vendor/three/` | Three.js r160 ES module build + same-revision addons | npm `three@0.160.1` | vendored, shipped |
| — | Hero 3D prop (courtyard lantern beside the board) | TRELLIS | not generated; the Detailed graphics tier builds procedural stone lanterns instead. Loading a GLB needs `GLTFLoader` vendored from the same r160 addons |
| — | Character animation | Kimodo | not applicable: no humanoid in the game |

Board digits are drawn at runtime into a 128 px canvas per digit (`makeTextSprite`), not shipped as
image assets, because they must stay crisp at any camera distance and must match the localized font
stack.

---

## 16. Known limitations

- **Marks are per-cell, not per-digit.** `N` flags a cell purple; it cannot record "this cell is 3
  or 7". Serious players will want candidate digits.
- **The five modes differ only by difficulty.** Learn has no lessons, Journey has no authored
  progression or mastery stages, Challenge imposes no constraints, and Practice is Learn with a
  different tab highlighted. The mode tabs currently function as a difficulty selector with five
  labels.
- **No undo stack.** Erase and Clear are the only reversals; `Clear` also zeroes the mistake and
  hint counters and restarts the clock, so it is a soft restart rather than a rewind.
- **Progress can go backwards.** The bar measures correct cells against the solution, so placing a
  legal-but-wrong digit does not raise it and erasing a correct one lowers it. This is intentional
  but reads as a bug on first encounter.
- **Hints reveal rather than teach.** `H` writes the answer into a cell; it never names the
  technique that would have found it, which undercuts the Learn mode's premise.
- **Restoring a round re-derives the puzzle.** `restoreRound` calls `buildPuzzle`, which re-runs
  generation and the uniqueness-checked removal loop — on Hard this is the slowest thing the game
  does (hundreds of milliseconds) and it happens before the first paint on reload.
- **No cap on mistakes and no timer pressure.** Nothing stops a player brute-forcing all nine digits
  into each cell; the score falls but the round never ends.
- **The board plane texture is largely hidden.** The 81 tiles cover most of the floor, so the
  limestone scan reads only at the board's rim.
- **`package.json` lists `three` (^0.185) as a dependency** that the browser build does not use;
  the game ships the vendored r160 under `vendor/three/`.
- **Ambient occlusion is baked, not screen-space.** The r160 GTAO pass produced a large black
  artefact on this scene, and the board is static, so contact occlusion is baked into the scene
  instead; it does not react to the lanterns or the selection ring.

---

## 17. Design intent not yet implemented

1. **Per-digit pencil notes** — up to nine small candidate digits rendered inside an empty tile,
   replacing the current single per-cell mark.
2. **Mode-specific rules** — scripted Learn lessons that require the player to perform each
   technique, an authored Journey ladder with mastery checks, and Challenge constraints (move caps,
   speed targets, no-hint runs).
3. **`prefers-reduced-motion` branch for gameplay feedback** — drop the progress-bar transition and
   replace the 220 ms rejection flash with a persistent border until the next input (ambient
   graphics motion already honours it).
4. **Hero lantern model** — a TRELLIS-generated stone lantern beside the board, which needs a
   `GLTFLoader` vendored from the same r160 addons as `vendor/three/`.
5. **In-game language picker** — the nine locales are selectable today only via `?lang=` or the
   browser's own language order; a control in the top bar is the intended surface.

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.
