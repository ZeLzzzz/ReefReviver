import type { config } from "../config";

/** Every sound the game plays once, named by its entry in `config.audio.effects` (REQ-026 AC-3). */
export type EffectName = keyof typeof config.audio.effects;

/** The sounds held while the button is down (the vacuum, the Scanner). */
export type LoopName = keyof typeof config.audio.loops;

/** What the player has set (AC-5, AC-6). Nothing here is saved: a refresh starts again (D-021). */
export interface AudioSettings {
  /** 0..1 on the slider. */
  music: number;
  effects: number;
  muted: boolean;
}

/**
 * `playing`: ambience, effects and the music at full volume. `quiet`: the pause menu, the Logbook and the end screen,
 * where ambience and effects stop and the music plays more quietly (AC-7).
 */
export type Phase = "playing" | "quiet";

/** What the game tells the sound every frame: whether the view is above the water (AC-2), and the Bloom's clarity (AC-4). */
export interface SceneLook {
  above: boolean;
  clarity: number;
}

/** What the game uses of the sound: it fires the effects and keeps the ambience and music in step with the scene. */
export interface GameAudio {
  /** Plays an effect once, `delay` seconds from now. */
  play(effect: EffectName, delay?: number): void;
  /** Keeps a held sound going at `level` (0 is off). The Scanner's level is the scan's progress, which raises its pitch. */
  loop(name: LoopName, level: number): void;
  /** Called every frame. */
  scene(look: SceneLook): void;
}

/** What the screens use of the sound. */
export interface AppAudio {
  /** False once it is known that this browser cannot make sound (AC-8). */
  readonly available: boolean;
  readonly settings: Readonly<AudioSettings>;
  /** Called on a click: browsers allow sound only after the player has interacted. */
  unlock(): void;
  /** Mulai: the music and the ambience start (AC-1). */
  start(): void;
  setPhase(phase: Phase): void;
  /** The tab or window is not in front: all sound stops until it is (AC-7). */
  setInactive(inactive: boolean): void;
  setMuted(muted: boolean): void;
  setMusicVolume(volume: number): void;
  setEffectsVolume(volume: number): void;
  play(effect: EffectName): void;
}

/** Stands in where no sound is wanted: the unit tests, and a game made without the engine. */
export const silentAudio: GameAudio & AppAudio = {
  available: false,
  settings: { music: 0, effects: 0, muted: false },
  unlock() {},
  start() {},
  setPhase() {},
  setInactive() {},
  setMuted() {},
  setMusicVolume() {},
  setEffectsVolume() {},
  play() {},
  loop() {},
  scene() {},
};
