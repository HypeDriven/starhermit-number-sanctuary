// Sound, as the browser build's audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, rotating round-robin so
// the same clip never repeats back to back. They play on the runtime's
// "effects" bus (Options › Audio owns the volumes and the mute); the game's
// own Mute button (M) silences them on top, as before. The synthesized beeps
// the browser build played while a sample was still decoding are not ported:
// every clip loads at once from onStart, and a clip still loading is silent.
import { loadClip, play as playClip, type AudioClip } from "starhermit:audio";

const EVENT_SAMPLES: Record<string, string[]> = {
  place: ["place-wood-tap", "place-stone-set", "place-peg-thunk", "place-glass-tick"],
  invalid: ["invalid-wood-knock", "invalid-dull-thud", "invalid-rubber-bounce", "invalid-dice-rattle"],
  select: ["select-switch-tick", "select-pen-click", "select-brass-chime", "select-cork-pop"],
  solve: ["solve-bloom-chime", "solve-bowl-swell"],
  hint: ["hint-glass-shimmer"],
  erase: ["erase-brush-sweep"],
  pause: ["pause-stone-close"],
  resume: ["resume-stone-open"],
  mode: ["mode-cloth-turn"],
};
export type SfxEvent = keyof typeof EVENT_SAMPLES;

const clips = new Map<string, AudioClip>();
const rotation = new Map<string, number>();
let muted = false;

export function setMuted(m: boolean): void { muted = m; }

/** Loads every clip at once (onStart). */
export function loadSfx(): void {
  for (const names of Object.values(EVENT_SAMPLES)) for (const name of names) {
    loadClip(`sfx/${name}.opus`).then(
      (c) => { clips.set(name, c); },
      (e: unknown) => { console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`); },
    );
  }
}

/** Plays the event's next clip in rotation (audio.js tryPlaySample). */
export function play(event: SfxEvent): void {
  const names = EVENT_SAMPLES[event];
  if (!names) return;
  const i = (rotation.get(event) ?? 0) % names.length;
  rotation.set(event, i + 1);
  if (muted) return;
  const clip = clips.get(names[i]!);
  if (!clip) return;
  try { playClip(clip, { bus: "effects" }); }
  catch { /* the mixer is full this frame: skip it */ }
}
