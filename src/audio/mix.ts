import { config } from "../config";
import type { AudioSettings, Phase } from "./types";

const { audio } = config;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** A slider position (0..1) as a gain: the curve makes the slider feel even to the ear (AC-6). */
export function volumeGain(volume: number): number {
  return clamp01(volume) ** audio.volumeCurve;
}

/** Where each bus's gain should be, for the player's settings, the phase and whether the tab is in front (AC-5, AC-6, AC-7). */
export interface BusTargets {
  /** 0 when muted or when the tab is not in front: all sound stops. */
  master: number;
  music: number;
  /** The effects slider; the ambience and the effects both pass through it. */
  effects: number;
  /** The game's own sounds (ambience, effects, held sounds): off while paused. The menu's clicks do not pass through it. */
  world: number;
}

export function busTargets(settings: AudioSettings, phase: Phase, inactive: boolean): BusTargets {
  return {
    master: settings.muted || inactive ? 0 : 1,
    music: volumeGain(settings.music) * audio.music.level * (phase === "quiet" ? audio.music.quiet : 1),
    effects: volumeGain(settings.effects) * audio.effectsLevel,
    world: phase === "playing" ? 1 : 0,
  };
}

/**
 * The music's low-pass cutoff in Hz for the Bloom's clarity (AC-4): murky water at 0, clear at 1. The ear hears pitch
 * in ratios, so the cutoff moves by a constant ratio per step.
 */
export function musicCutoff(clarity: number): number {
  const { muffledHz, clearHz } = audio.music;
  return muffledHz * (clearHz / muffledHz) ** clamp01(clarity);
}

/** How much of each ambience is heard (AC-2): the sea under water, the waves and wind above it. */
export function ambienceMix(above: boolean): { under: number; above: number } {
  return above ? { under: 0, above: 1 } : { under: 1, above: 0 };
}
