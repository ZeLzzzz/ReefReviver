import { describe, expect, it } from "vitest";
import { ambienceMix, busTargets, musicCutoff, volumeGain } from "../../src/audio/mix";
import { createNoise, EFFECTS, playEffect } from "../../src/audio/recipes";
import { config } from "../../src/config";
import { FakeContext, FakeGain } from "./fake-audio";

const { audio } = config;
const settings = { music: 0.6, effects: 0.8, muted: false };

describe("volumes (REQ-026 AC-6)", () => {
  it("start at 60 % music and 80 % effects", () => {
    expect(audio.volume).toEqual({ music: 0.6, effects: 0.8 });
  });

  it("maps the slider to a gain that is 0 at 0, full at 1 and rises evenly between", () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(1)).toBe(1);
    const steps = [0, 0.2, 0.4, 0.6, 0.8, 1].map(volumeGain);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("keeps stray values in range", () => {
    expect(volumeGain(-2)).toBe(0);
    expect(volumeGain(9)).toBe(1);
    expect(volumeGain(Number.NaN)).toBe(0);
  });
});

describe("bus targets (REQ-026 AC-5, AC-6, AC-7)", () => {
  it("plays everything at the player's volumes while playing", () => {
    const targets = busTargets(settings, "playing", false);
    expect(targets).toEqual({ master: 1, music: volumeGain(0.6) * audio.music.level, effects: volumeGain(0.8) * audio.effectsLevel, world: 1 });
  });

  it("mutes all sound with the master, whatever else is set", () => {
    expect(busTargets({ ...settings, muted: true }, "playing", false).master).toBe(0);
    expect(busTargets({ ...settings, muted: true }, "quiet", true).master).toBe(0);
  });

  it("stops all sound when the tab is not in front", () => {
    expect(busTargets(settings, "playing", true).master).toBe(0);
  });

  it("stops the game's own sounds while paused and keeps the music, more quietly", () => {
    const playing = busTargets(settings, "playing", false);
    const quiet = busTargets(settings, "quiet", false);
    expect(quiet.world).toBe(0);
    expect(quiet.master).toBe(1);
    expect(quiet.music).toBeGreaterThan(0);
    expect(quiet.music).toBeCloseTo(playing.music * audio.music.quiet, 9);
    expect(quiet.effects).toBe(playing.effects);
  });
});

describe("the music's filter (REQ-026 AC-4)", () => {
  it("is muffled at clarity 0 and clear at 1, and opens steadily between", () => {
    expect(musicCutoff(0)).toBe(audio.music.muffledHz);
    expect(musicCutoff(1)).toBeCloseTo(audio.music.clearHz, 6);
    let last = 0;
    for (let clarity = 0; clarity <= 1.0001; clarity += 0.05) {
      const cutoff = musicCutoff(clarity);
      expect(cutoff).toBeGreaterThanOrEqual(last);
      last = cutoff;
    }
  });

  it("is audibly muffled before the Bloom (a murky low-pass well under 1 kHz) and out of the way after it", () => {
    expect(audio.music.muffledHz).toBeLessThan(1000);
    expect(audio.music.clearHz).toBeGreaterThan(15000);
  });

  it("stays in range for stray clarity values", () => {
    expect(musicCutoff(-1)).toBe(audio.music.muffledHz);
    expect(musicCutoff(3)).toBeCloseTo(audio.music.clearHz, 6);
  });
});

describe("ambience mix (REQ-026 AC-2)", () => {
  it("is the sea under water and the waves and wind above", () => {
    expect(ambienceMix(false)).toEqual({ under: 1, above: 0 });
    expect(ambienceMix(true)).toEqual({ under: 0, above: 1 });
  });
});

describe("the effect recipes (REQ-026 AC-3)", () => {
  const entries = Object.entries(EFFECTS);

  it("have layers that fit: positive length, a gain that cannot clip alone, pitches a speaker can play", () => {
    for (const [name, spec] of entries) {
      expect(spec.layers.length, name).toBeGreaterThan(0);
      for (const layer of spec.layers) {
        expect(layer.dur, name).toBeGreaterThan(0);
        expect(layer.gain, name).toBeGreaterThan(0);
        expect(layer.gain, name).toBeLessThanOrEqual(0.6);
        expect(layer.at ?? 0, name).toBeGreaterThanOrEqual(0);
        expect(layer.from, name).toBeGreaterThan(20);
        expect(layer.from, name).toBeLessThan(20000);
        if (layer.to !== undefined) {
          expect(layer.to, name).toBeGreaterThan(20);
          expect(layer.to, name).toBeLessThan(20000);
        }
        if (layer.attack !== undefined) expect(layer.attack, name).toBeLessThan(layer.dur);
      }
      if (spec.jitter !== undefined) expect(spec.jitter, name).toBeLessThan(0.3);
    }
  });

  it("keep the loudest moment of a sound with several layers under full scale", () => {
    for (const [name, spec] of entries) {
      const sum = spec.layers.reduce((total, layer) => total + layer.gain, 0);
      expect(sum, name).toBeLessThan(1.6);
    }
  });

  it("have one shared noise buffer as long as the config says", () => {
    const noise = createNoise(new FakeContext() as unknown as BaseAudioContext, () => 0.75);
    expect(noise.duration).toBeCloseTo(audio.noiseSeconds, 3);
  });

  it("play into the bus they are given, and report when they end", () => {
    const ctx = new FakeContext();
    const out = new FakeGain();
    const noise = createNoise(ctx as unknown as BaseAudioContext);
    const end = playEffect(ctx as unknown as BaseAudioContext, out as unknown as AudioNode, EFFECTS.animalFreed, noise, 10, () => 0.5);
    const last = EFFECTS.animalFreed.layers.at(-1)!;
    expect(end).toBeCloseTo(10 + (last.at ?? 0) + last.dur, 6);
    expect(ctx.gains.every((gain) => gain.to[0] === out)).toBe(true);
    expect(ctx.oscillators).toHaveLength(EFFECTS.animalFreed.layers.length);
  });
});
