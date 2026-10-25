import { config } from "../config";
import type { EffectName } from "./types";

/** A pitched layer: an oscillator that sweeps from `from` to `to` Hz. */
export interface ToneLayer {
  kind: "tone";
  wave: OscillatorType;
  from: number;
  to?: number;
  /** Seconds after the sound starts. */
  at?: number;
  dur: number;
  /** The peak gain. */
  gain: number;
  /** Seconds to rise to the peak. */
  attack?: number;
}

/** A hissing layer: the shared noise through a filter whose cutoff sweeps from `from` to `to` Hz. */
export interface NoiseLayer {
  kind: "noise";
  filter: BiquadFilterType;
  from: number;
  to?: number;
  q?: number;
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
}

export type Layer = ToneLayer | NoiseLayer;

export interface EffectSpec {
  /** The shortest time between two plays of the sound. */
  gap?: number;
  /** The most the pitch varies by chance, as a fraction. */
  jitter?: number;
  layers: readonly Layer[];
}

export const EFFECTS: Record<EffectName, EffectSpec> = config.audio.effects;

const SILENCE = 0.0001;

/** One white-noise buffer; every noise source loops it from its own random point (cheap, and made once). */
export function createNoise(ctx: BaseAudioContext, random: () => number = Math.random): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * config.audio.noiseSeconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = random() * 2 - 1;
  return buffer;
}

/** Rises to `peak` in `attack` seconds from `start`, then falls exponentially to silence at `start + dur`. */
function envelope(param: AudioParam, start: number, dur: number, peak: number, attack: number): void {
  const rise = Math.min(attack, dur * 0.9);
  param.setValueAtTime(SILENCE, start);
  param.linearRampToValueAtTime(Math.max(peak, SILENCE), start + rise);
  param.exponentialRampToValueAtTime(SILENCE, start + dur);
}

/**
 * Plays an effect into `out`, starting at `when` (seconds on `ctx`'s clock). Builds a few short-lived nodes that free
 * themselves when they stop, so it costs nothing between sounds. Returns the time the sound ends.
 */
export function playEffect(ctx: BaseAudioContext, out: AudioNode, spec: EffectSpec, noise: AudioBuffer, when: number, random: () => number = Math.random): number {
  // One pitch shift for the whole sound, so its layers stay in tune with each other.
  const shift = 1 + (random() * 2 - 1) * (spec.jitter ?? 0);
  let end = when;
  for (const layer of spec.layers) {
    const start = when + (layer.at ?? 0);
    const stop = start + layer.dur;
    const gain = ctx.createGain();
    envelope(gain.gain, start, layer.dur, layer.gain, layer.attack ?? 0.005);
    gain.connect(out);
    if (layer.kind === "tone") {
      const oscillator = ctx.createOscillator();
      oscillator.type = layer.wave;
      oscillator.frequency.setValueAtTime(layer.from * shift, start);
      if (layer.to) oscillator.frequency.exponentialRampToValueAtTime(layer.to * shift, stop);
      oscillator.connect(gain);
      oscillator.start(start);
      oscillator.stop(stop + 0.05);
    } else {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter;
      filter.Q.value = layer.q ?? 0.7;
      filter.frequency.setValueAtTime(layer.from * shift, start);
      if (layer.to) filter.frequency.exponentialRampToValueAtTime(layer.to * shift, stop);
      source.connect(filter);
      filter.connect(gain);
      source.start(start, random() * Math.max(0, noise.duration - layer.dur - 0.1));
      source.stop(stop + 0.05);
    }
    end = Math.max(end, stop);
  }
  return end;
}
