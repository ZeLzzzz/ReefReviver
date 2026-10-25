import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../../src/audio/engine";
import { EFFECTS } from "../../src/audio/recipes";
import type { EffectName } from "../../src/audio/types";
import { config } from "../../src/config";
import { FakeContext, settle } from "./fake-audio";

const { audio } = config;
const effectNames = Object.keys(EFFECTS) as EffectName[];

function setup(options: { loadMusic?: () => Promise<ArrayBuffer>; random?: () => number } = {}) {
  const ctx = new FakeContext();
  const createContext = vi.fn(() => ctx as unknown as AudioContext);
  const warn = vi.fn();
  const engine = new AudioEngine({ createContext, loadMusic: options.loadMusic ?? (async () => new ArrayBuffer(8)), random: options.random ?? (() => 0.5), warn, debug: true });
  return { ctx, engine, createContext, warn };
}

async function started(options: Parameters<typeof setup>[0] = {}) {
  const env = setup(options);
  env.engine.start();
  await settle();
  return env;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("starting (REQ-026 AC-1)", () => {
  it("makes nothing and plays nothing before a click: no context, and effects and scenes are ignored", () => {
    const { engine, createContext } = setup();
    engine.scene({ above: false, clarity: 0 });
    engine.play("trashIn");
    engine.loop("vacuum", 1);
    expect(createContext).not.toHaveBeenCalled();
    expect(engine.debug().state).toBe("none");
    expect(engine.debug().started).toBe(false);
  });

  it("a click makes the context but starts no music and no ambience; only Mulai does", async () => {
    const { engine, ctx } = setup();
    engine.unlock();
    expect(engine.debug().state).toBe("running");
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.oscillators).toHaveLength(0);
    engine.start();
    await settle();
    expect(engine.debug().started).toBe(true);
    // The music plus the three ambience layers (rumble, waves, wind).
    expect(ctx.sources).toHaveLength(4);
    expect(engine.debug().music.state).toBe("playing");
  });

  it("wakes a context the browser left suspended", () => {
    const { engine, ctx } = setup();
    ctx.state = "suspended";
    engine.unlock();
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("starts the music once, however often Mulai is pressed", async () => {
    const { engine, ctx } = await started();
    engine.start();
    await settle();
    expect(ctx.sources).toHaveLength(4);
  });
});

describe("the music (REQ-026 AC-4)", () => {
  it("loops the decoded track through the low-pass filter, without a gap", async () => {
    const { ctx } = await started();
    const music = ctx.sources.find((source) => source.buffer?.duration === 16.67)!;
    expect(music.loop).toBe(true);
    expect(music.to).toEqual([ctx.musicFilter]);
    expect(ctx.musicFilter.type).toBe("lowpass");
    expect(ctx.musicFilter.to).toEqual([ctx.musicBus]);
    expect(music.started).toHaveLength(1);
  });

  it("is muffled before the Bloom, clears while it runs and stays clear after it", async () => {
    const { engine } = await started();
    engine.scene({ above: false, clarity: 0 });
    expect(engine.debug().music.cutoffTarget).toBe(audio.music.muffledHz);
    const cutoffs = [0, 0.25, 0.5, 0.75, 1].map((clarity) => {
      engine.scene({ above: false, clarity });
      return engine.debug().music.cutoffTarget as number;
    });
    expect(cutoffs).toEqual([...cutoffs].sort((a, b) => a - b));
    expect(cutoffs[0]).toBe(audio.music.muffledHz);
    expect(cutoffs[4]).toBe(audio.music.clearHz);
    // The game keeps reporting clarity 1 after the Bloom: it stays clear.
    engine.scene({ above: true, clarity: 1 });
    expect(engine.debug().music.cutoffTarget).toBe(audio.music.clearHz);
    // A new dive is murky again.
    engine.scene({ above: false, clarity: 0 });
    expect(engine.debug().music.cutoffTarget).toBe(audio.music.muffledHz);
  });

  it("smooths the filter instead of jumping", async () => {
    const { engine, ctx } = await started();
    engine.scene({ above: false, clarity: 0.5 });
    expect(ctx.musicFilter.frequency.glides.at(-1)?.tc).toBe(audio.music.glide);
  });

  it("does not touch the filter again while nothing changes (no per-frame scheduling)", async () => {
    const { engine, ctx } = await started();
    engine.scene({ above: false, clarity: 0.3 });
    const count = ctx.musicFilter.frequency.glides.length;
    for (let i = 0; i < 100; i++) engine.scene({ above: false, clarity: 0.3 });
    expect(ctx.musicFilter.frequency.glides).toHaveLength(count);
  });
});

describe("ambience (REQ-026 AC-2)", () => {
  it("is the sea under water and the waves and wind above it, crossfading smoothly", async () => {
    const { engine, ctx } = await started();
    engine.scene({ above: false, clarity: 0 });
    let mix = engine.debug().ambience;
    expect(mix.under).toBe(audio.ambience.level);
    expect(mix.above).toBe(0);
    engine.scene({ above: true, clarity: 0 });
    mix = engine.debug().ambience;
    expect(mix.under).toBe(0);
    expect(mix.above).toBe(audio.ambience.level);
    const crossfades = [...ctx.gains.flatMap((gain) => gain.gain.glides)].filter((glide) => glide.tc === audio.ambience.crossfade);
    expect(crossfades.length).toBeGreaterThanOrEqual(2);
  });

  it("flips back when the view goes under again, and only as the view says", async () => {
    const { engine } = await started();
    engine.scene({ above: true, clarity: 0 });
    engine.scene({ above: false, clarity: 0 });
    expect(engine.debug().ambience.under).toBe(audio.ambience.level);
    expect(engine.debug().ambience.above).toBe(0);
  });

  it("lets bubbles rise now and then under water, never above and never while paused", async () => {
    const { engine, ctx } = await started();
    const oscillators = () => ctx.oscillators.length;
    engine.scene({ above: true, clarity: 0 });
    ctx.currentTime = 10;
    engine.scene({ above: true, clarity: 0 });
    const before = oscillators();
    expect(engine.debug().fired).not.toContain("bubbles");
    engine.scene({ above: false, clarity: 0 });
    expect(oscillators()).toBeGreaterThan(before);
    expect(engine.debug().fired).toContain("bubbles");
    // The next burst waits for its gap.
    const after = oscillators();
    ctx.currentTime += audio.ambience.under.bubbles.gapMin / 2;
    engine.scene({ above: false, clarity: 0 });
    expect(oscillators()).toBe(after);
    // Paused: none, however long it is.
    engine.setPhase("quiet");
    ctx.currentTime += 100;
    engine.scene({ above: false, clarity: 0 });
    expect(oscillators()).toBe(after);
  });
});

describe("effects (REQ-026 AC-3)", () => {
  it.each(effectNames)("%s makes sound from code: every layer is an oscillator or filtered noise, started and routed to the world", async (name) => {
    const { engine, ctx } = await started();
    const oscillators = ctx.oscillators.length;
    const sources = ctx.sources.length;
    const spec = EFFECTS[name];
    ctx.currentTime = 5;
    engine.play(name);
    const tones = spec.layers.filter((layer) => layer.kind === "tone").length;
    expect(ctx.oscillators.length - oscillators).toBe(tones);
    expect(ctx.sources.length - sources).toBe(spec.layers.length - tones);
    const made = [...ctx.oscillators.slice(oscillators), ...ctx.sources.slice(sources)];
    for (const node of made) expect(node.started[0]).toBeGreaterThanOrEqual(5);
    expect(engine.debug().fired).toContain(name);
  });

  it("covers everything the requirement lists", () => {
    for (const name of [
      "trashIn", "tankFull", "netCut", "animalFreed", "seedShot", "planted", "logbookEntry", "deposit", "pickup",
      "footstepSand", "footstepDock", "leaveSub", "boardSub", "click", "bloom",
    ] as EffectName[]) {
      expect(effectNames).toContain(name);
    }
  });

  it("sends the menu's click through the menu bus, so it still sounds while the game is paused; the rest go through the world bus", async () => {
    const { engine, ctx } = await started();
    ctx.currentTime = 1;
    const gainsBefore = ctx.gains.length;
    engine.play("click");
    engine.play("trashIn");
    const gains = ctx.gains.slice(gainsBefore);
    const clickLayers = EFFECTS.click.layers.length;
    expect(gains.slice(0, clickLayers).every((gain) => gain.to[0] === ctx.menuBus)).toBe(true);
    expect(gains.slice(clickLayers).every((gain) => gain.to[0] === ctx.worldBus)).toBe(true);
  });

  it("plays the click on the title screen after a click even before Mulai", () => {
    const { engine, ctx } = setup();
    engine.unlock();
    engine.play("click");
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    expect(engine.debug().fired).toEqual(["click"]);
  });

  it("drops a repeat inside the effect's gap, and plays it again after", async () => {
    const { engine, ctx } = await started();
    ctx.currentTime = 1;
    engine.play("trashIn");
    const count = ctx.oscillators.length;
    engine.play("trashIn");
    expect(ctx.oscillators).toHaveLength(count);
    ctx.currentTime += EFFECTS.trashIn.gap! + 0.01;
    engine.play("trashIn");
    expect(ctx.oscillators.length).toBeGreaterThan(count);
  });

  it("starts a delayed effect later", async () => {
    const { engine, ctx } = await started();
    ctx.currentTime = 2;
    const from = ctx.oscillators.length;
    engine.play("tankFull", 0.12);
    expect(ctx.oscillators[from].started[0]).toBeCloseTo(2.125, 3);
  });

  it("varies the pitch a little each time, never by more than the effect's jitter", async () => {
    const low = await started({ random: () => 0 });
    const high = await started({ random: () => 1 });
    low.ctx.currentTime = high.ctx.currentTime = 1;
    low.engine.play("trashIn");
    high.engine.play("trashIn");
    const pitch = (ctx: FakeContext) => ctx.oscillators.at(-EFFECTS.trashIn.layers.filter((l) => l.kind === "tone").length)!.frequency.value;
    expect(pitch(high.ctx) / pitch(low.ctx)).toBeGreaterThan(1);
    expect(pitch(high.ctx) / pitch(low.ctx)).toBeLessThan((1 + EFFECTS.trashIn.jitter!) / (1 - EFFECTS.trashIn.jitter!) + 0.001);
  });

  it("holds the vacuum's sound while the button is down and lets it go after", async () => {
    const { engine, ctx } = await started();
    const gains = ctx.gains.length;
    engine.loop("vacuum", 0);
    expect(ctx.gains).toHaveLength(gains); // nothing is built for a sound never used
    engine.loop("vacuum", 1);
    expect(engine.debug().loops.vacuum).toBe(1);
    const loop = ctx.gains[gains];
    expect(loop.gain.value).toBe(1);
    expect(loop.to).toEqual([ctx.worldBus]);
    expect(engine.debug().fired).toContain("vacuum");
    engine.loop("vacuum", 0);
    expect(loop.gain.value).toBe(0);
    expect(engine.debug().loops.vacuum).toBe(0);
    expect(loop.gain.glides.at(-1)?.tc).toBe(audio.loops.vacuum.glide);
  });

  it("raises the Scanner's pitch as the scan fills", async () => {
    const { engine, ctx } = await started();
    engine.loop("scan", 0.1);
    const tone = ctx.oscillators.find((oscillator) => oscillator.type === "sine" && oscillator.frequency.value >= audio.loops.scan.baseHz)!;
    const early = tone.frequency.value;
    engine.loop("scan", 0.9);
    expect(tone.frequency.value).toBeGreaterThan(early);
    expect(tone.frequency.value).toBeLessThanOrEqual(audio.loops.scan.baseHz + audio.loops.scan.rangeHz);
    engine.loop("scan", 0);
    expect(engine.debug().loops.scan).toBe(0);
  });
});

describe("muting (REQ-026 AC-5)", () => {
  it("M silences everything at once through the master and brings it back", async () => {
    const { engine } = await started();
    expect(engine.debug().targets.master).toBe(1);
    engine.setMuted(true);
    expect(engine.settings.muted).toBe(true);
    expect(engine.debug().gains.master).toBe(0);
    engine.setMuted(false);
    expect(engine.debug().gains.master).toBe(1);
  });

  it("makes no new sounds while muted, but keeps the settings", async () => {
    const { engine, ctx } = await started();
    engine.setMuted(true);
    ctx.currentTime = 3;
    const count = ctx.oscillators.length;
    engine.play("trashIn");
    expect(ctx.oscillators).toHaveLength(count);
    expect(engine.settings.music).toBe(audio.volume.music);
  });

  it("holds the choice for the life of the engine, as across Main lagi (AC-6)", () => {
    const { engine } = setup();
    engine.setMuted(true);
    engine.setMusicVolume(0.2);
    expect(engine.settings).toEqual({ music: 0.2, effects: audio.volume.effects, muted: true });
  });

  it("remembers the mute even before any sound exists", () => {
    const { engine, createContext } = setup();
    engine.setMuted(true);
    expect(engine.settings.muted).toBe(true);
    expect(createContext).not.toHaveBeenCalled();
    engine.start();
    expect(engine.debug().gains.master).toBe(0);
  });
});

describe("volumes (REQ-026 AC-6)", () => {
  it("start at music 60 % and effects 80 %", () => {
    expect(setup().engine.settings).toEqual({ music: 0.6, effects: 0.8, muted: false });
  });

  it("apply at once, each to its own bus", async () => {
    const { engine, ctx } = await started();
    const effects = engine.debug().gains.effects as number;
    engine.setMusicVolume(0.5);
    expect(engine.debug().gains.music).toBeCloseTo(0.5 ** audio.volumeCurve * audio.music.level, 6);
    expect(engine.debug().gains.effects).toBe(effects);
    expect(ctx.musicBus.gain.glides.at(-1)?.tc).toBe(audio.fast);
    engine.setEffectsVolume(1);
    expect(engine.debug().gains.effects).toBeCloseTo(audio.effectsLevel, 6);
    engine.setMusicVolume(0);
    expect(engine.debug().gains.music).toBe(0);
  });

  it("keeps the volume between 0 and 1", () => {
    const { engine } = setup();
    engine.setMusicVolume(7);
    engine.setEffectsVolume(-3);
    expect(engine.settings).toMatchObject({ music: 1, effects: 0 });
  });
});

describe("pause, Logbook, end screen and other tabs (REQ-026 AC-7)", () => {
  it("stops the ambience, effects and held sounds and quietens the music while quiet, and brings them back", async () => {
    const { engine } = await started();
    const full = engine.debug().gains.music as number;
    engine.setPhase("quiet");
    const quiet = engine.debug();
    expect(quiet.gains.world).toBe(0);
    expect(quiet.gains.music).toBeCloseTo(full * audio.music.quiet, 6);
    expect(quiet.gains.music).toBeGreaterThan(0);
    expect(quiet.gains.master).toBe(1);
    engine.setPhase("playing");
    expect(engine.debug().gains.world).toBe(1);
    expect(engine.debug().gains.music).toBeCloseTo(full, 6);
  });

  it("fades with the pause time constant, not abruptly", async () => {
    const { engine, ctx } = await started();
    engine.setPhase("quiet");
    expect(ctx.worldBus.gain.glides.at(-1)).toEqual({ value: 0, tc: audio.fade });
  });

  it("still clicks in the pause menu", async () => {
    const { engine, ctx } = await started();
    engine.setPhase("quiet");
    ctx.currentTime = 4;
    const count = ctx.oscillators.length;
    engine.play("click");
    expect(ctx.oscillators.length).toBeGreaterThan(count);
    expect(engine.debug().gains.effects).toBeGreaterThan(0);
  });

  it("goes silent when the tab is not in front, suspends the context after the gain is down, and resumes when it is back", async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await started();
    engine.setInactive(true);
    expect(engine.debug().gains.master).toBe(0);
    expect(ctx.suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(audio.suspendDelayMs + 1);
    expect(ctx.suspend).toHaveBeenCalledOnce();
    engine.setInactive(false);
    expect(ctx.resume).toHaveBeenCalled();
    expect(engine.debug().gains.master).toBe(1);
  });

  it("does not suspend if the tab comes back before the delay", async () => {
    vi.useFakeTimers();
    const { engine, ctx } = await started();
    engine.setInactive(true);
    engine.setInactive(false);
    vi.advanceTimersByTime(audio.suspendDelayMs * 3);
    expect(ctx.suspend).not.toHaveBeenCalled();
  });

  it("stays silent after a click wakes it up in a tab that is not in front", async () => {
    const { engine, ctx } = await started();
    engine.setInactive(true);
    ctx.state = "suspended";
    ctx.resume.mockClear();
    engine.unlock();
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("stays muted through a trip to another tab", async () => {
    const { engine } = await started();
    engine.setMuted(true);
    engine.setInactive(true);
    engine.setInactive(false);
    expect(engine.debug().gains.master).toBe(0);
  });
});

describe("when something fails (REQ-026 AC-8)", () => {
  it("goes on without sound when the browser has no Web Audio: a warning, never a throw", () => {
    const warn = vi.fn();
    const engine = new AudioEngine({ createContext: () => null, warn });
    expect(() => {
      engine.unlock();
      engine.start();
      engine.play("trashIn");
      engine.loop("vacuum", 1);
      engine.scene({ above: true, clarity: 1 });
      engine.setPhase("quiet");
      engine.setInactive(true);
      engine.setMuted(true);
      engine.setMusicVolume(0.3);
    }).not.toThrow();
    expect(engine.available).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    // The sliders still hold their values for the Sound view.
    expect(engine.settings).toMatchObject({ music: 0.3, muted: true });
  });

  it("goes on without music when the file cannot be loaded; the ambience and effects work", async () => {
    const { engine, ctx, warn } = await started({ loadMusic: async () => Promise.reject(new Error("HTTP 404")) });
    expect(engine.debug().music.state).toBe("failed");
    expect(warn).toHaveBeenCalledOnce();
    expect(engine.available).toBe(true);
    // Rumble, waves and wind only.
    expect(ctx.sources).toHaveLength(3);
    ctx.currentTime = 1;
    engine.play("trashIn");
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    engine.scene({ above: true, clarity: 1 });
    expect(engine.debug().ambience.above).toBe(audio.ambience.level);
  });

  it("goes on without music when the file cannot be decoded", async () => {
    const { engine, ctx, warn } = setup();
    ctx.decode = () => Promise.reject(new Error("EncodingError"));
    engine.start();
    await settle();
    expect(engine.debug().music.state).toBe("failed");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("goes silent for good, with one warning, if a call into the browser throws", async () => {
    const { engine, ctx, warn } = await started();
    ctx.createOscillator = () => {
      throw new Error("boom");
    };
    expect(() => engine.play("trashIn")).not.toThrow();
    expect(engine.available).toBe(false);
    expect(() => {
      engine.play("trashIn");
      engine.scene({ above: false, clarity: 0 });
      engine.setMuted(true);
    }).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not make the page's unhandled rejections noisy when the preloaded file fails", async () => {
    const { engine, warn } = setup({ loadMusic: () => Promise.reject(new Error("offline")) });
    engine.preload();
    await settle();
    expect(warn).not.toHaveBeenCalled();
    engine.start();
    await settle();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("uses the preloaded bytes instead of fetching again", async () => {
    const loadMusic = vi.fn(async () => new ArrayBuffer(8));
    const { engine } = setup({ loadMusic });
    engine.preload();
    engine.start();
    await settle();
    expect(loadMusic).toHaveBeenCalledOnce();
    expect(engine.debug().music.state).toBe("playing");
  });
});
