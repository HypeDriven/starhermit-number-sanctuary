// Sound, as the browser build's audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, a sound bank in sequence
// so the same clip never repeats back to back. They play on the runtime's
// "effects" bus (Options › Audio owns the volumes and the mute); the game's own
// Mute button (M) is the engine's game mute on top (main.ts), as before. The
// synthesized beeps the browser build played while a sample was still decoding
// are not ported: every clip loads at once from onStart, and an event whose
// clips are still loading is silent.
import { loadClip, SoundBank } from "starhermit:audio";

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

const banks = new Map<string, SoundBank>();

/** Loads every clip at once (onStart). */
export function loadSfx(): void {
  for (const [event, names] of Object.entries(EVENT_SAMPLES)) {
    void Promise.all(names.map((name) => loadClip(`sfx/${name}.opus`).catch((e: unknown) => {
      console.warn(`sfx ${name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }))).then((loaded) => {
      const clips = loaded.filter((c) => c !== null);
      if (clips.length) banks.set(event, new SoundBank({ clips, order: "sequence", bus: "effects" }));
    });
  }
}

/** Plays the event's next clip in rotation (audio.js tryPlaySample). */
export function play(event: SfxEvent): void {
  try { banks.get(event)?.play(); }
  catch { /* the mixer is full this frame: skip it */ }
}
