// Sound, as the browser build's audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, rotating round-robin so
// the same clip never repeats back to back. They play on the runtime's
// "effects" bus (Options › Audio owns the volumes and the mute); the game's
// own Mute button (M) silences them on top, as before. The synthesized beeps
// the browser build played while a sample was still decoding are not ported:
// clips load once the mixer runs (natively at once, in a browser after the
// first press), one at a time, and a clip still loading is silent.
import { context, loadClip, play as playClip, type AudioClip } from "starhermit:audio";

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
const queue: string[] = [];
let loading = false;
let wanted = false;
let muted = false;

export function setMuted(m: boolean): void { muted = m; }

function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }

/** Each frame: once the mixer runs, the clips load one at a time. */
export function update(): void {
  if (context.state !== "running") return;
  if (!wanted) {
    wanted = true;
    for (const names of Object.values(EVENT_SAMPLES)) for (const n of names) load(n);
  }
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then(
    (c) => { clips.set(name, c); loading = false; },
    (e: unknown) => { console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`); loading = false; },
  );
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
  catch { clips.delete(names[i]!); load(names[i]!); } // a clip the mixer lost: load it again
}
