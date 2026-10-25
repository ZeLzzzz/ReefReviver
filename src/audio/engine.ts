import { config } from "../config";
import { ambienceMix, busTargets, musicCutoff } from "./mix";
import { createNoise, EFFECTS, playEffect, type EffectSpec } from "./recipes";
import type { AppAudio, AudioSettings, EffectName, GameAudio, LoopName, Phase, SceneLook } from "./types";

const { audio } = config;

/** The effects that belong to the menus, not to the world: they still sound while the game is paused. */
const MENU_EFFECTS: readonly EffectName[] = ["click"];

export interface EngineOptions {
  /** The browser's AudioContext, or null when it has none (AC-8). */
  createContext?: () => AudioContext | null;
  /** The bytes of the music file; rejects when it cannot be loaded (AC-8). */
  loadMusic?: () => Promise<ArrayBuffer>;
  random?: () => number;
  /** Where the engine reports what went wrong; the game goes on without sound. */
  warn?: (message: string, error?: unknown) => void;
  /** For the browser tests: keep a log of the effects played and tap the output to read its level. */
  debug?: boolean;
}

function browserContext(): AudioContext | null {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? new Context({ latencyHint: "interactive" }) : null;
}

async function fetchMusic(): Promise<ArrayBuffer> {
  const url = new URL(audio.music.url, document.baseURI).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** The nodes, built when the first click lets the browser make sound. */
interface Graph {
  ctx: AudioContext;
  master: GainNode;
  musicBus: GainNode;
  musicFilter: BiquadFilterNode;
  effectsBus: GainNode;
  worldBus: GainNode;
  menuBus: GainNode;
  noise: AudioBuffer;
  analyser: AnalyserNode | null;
}

interface Ambience {
  under: GainNode;
  above: GainNode;
}

interface Loop {
  gain: GainNode;
  /** The Scanner's pitch. */
  frequency: AudioParam | null;
}

/**
 * The game's sound (REQ-026): one AudioContext with a bus for the music, one for the effects and the ambience, a master
 * that mutes. The effects and the ambience are made here with Web Audio (D-026); the music is one file. If the browser
 * has no Web Audio, or something in it fails, the engine warns once and goes silent: it never throws into the game (AC-8).
 */
export class AudioEngine implements GameAudio, AppAudio {
  /** The player's choices; they live as long as the page does and are never saved (D-021, AC-6). */
  readonly settings: AudioSettings = { music: audio.volume.music, effects: audio.volume.effects, muted: false };
  private readonly createContext: () => AudioContext | null;
  private readonly loadMusic: () => Promise<ArrayBuffer>;
  private readonly random: () => number;
  private readonly warn: (message: string, error?: unknown) => void;
  private readonly debugging: boolean;
  private graph: Graph | null = null;
  private ambience: Ambience | null = null;
  private readonly loops = new Map<LoopName, Loop>();
  private readonly loopLevels: Record<LoopName, number> = { vacuum: 0, scan: 0 };
  private musicBytes: Promise<ArrayBuffer> | null = null;
  private music: "none" | "loading" | "playing" | "failed" = "none";
  private failed = false;
  private started = false;
  private phase: Phase = "playing";
  private inactive = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private look: SceneLook = { above: false, clarity: 0 };
  private nextBubble = 0;
  private readonly targets = new Map<string, number>();
  private readonly lastPlayed = new Map<EffectName, number>();
  private readonly fired: string[] = [];

  constructor(options: EngineOptions = {}) {
    this.createContext = options.createContext ?? browserContext;
    this.loadMusic = options.loadMusic ?? fetchMusic;
    this.random = options.random ?? Math.random;
    this.warn = options.warn ?? ((message, error) => console.warn(message, error ?? ""));
    this.debugging = options.debug ?? false;
  }

  get available(): boolean {
    return !this.failed;
  }

  /** Starts fetching the music so it is ready when Mulai is pressed. A failure is reported when the music is wanted. */
  preload(): void {
    this.musicBytes ??= this.loadMusic();
    this.musicBytes.catch(() => {});
  }

  /** A click: makes (or wakes) the context, which browsers allow only after the player has interacted. */
  unlock(): void {
    this.guard(() => {
      const graph = this.ensure();
      if (graph && !this.inactive && graph.ctx.state === "suspended") void graph.ctx.resume().catch(() => {});
    });
  }

  /** AC-1: Mulai starts the music and the ambience; before that the title screen is silent. */
  start(): void {
    this.guard(() => {
      const graph = this.ensure();
      if (!graph || this.started) return;
      this.unlock();
      this.started = true;
      this.ambience = this.buildAmbience(graph);
      this.applyAmbience();
      this.applyCutoff();
      void this.startMusic(graph);
    });
  }

  setPhase(phase: Phase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    this.guard(() => this.applyBuses(audio.fade));
  }

  /** AC-7: a tab or window that is not in front stops all sound, and the context sleeps until it is back. */
  setInactive(inactive: boolean): void {
    if (inactive === this.inactive) return;
    this.inactive = inactive;
    this.guard(() => {
      const graph = this.graph;
      if (!graph) return;
      if (this.suspendTimer) clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
      this.applyBuses(audio.fast);
      if (inactive) {
        this.suspendTimer = setTimeout(() => this.inactive && void graph.ctx.suspend().catch(() => {}), audio.suspendDelayMs);
      } else {
        void graph.ctx.resume().catch(() => {});
      }
    });
  }

  /** AC-5. */
  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.guard(() => this.applyBuses(audio.fast));
  }

  /** AC-6: the slider's position, 0..1; it applies at once. */
  setMusicVolume(volume: number): void {
    this.settings.music = Math.min(1, Math.max(0, volume));
    this.guard(() => this.applyBuses(audio.fast));
  }

  setEffectsVolume(volume: number): void {
    this.settings.effects = Math.min(1, Math.max(0, volume));
    this.guard(() => this.applyBuses(audio.fast));
  }

  /** AC-3. A repeat inside the effect's `gap` is dropped; a muted or sleeping engine logs the effect but makes no sound. */
  play(effect: EffectName, delay = 0): void {
    this.guard(() => {
      const graph = this.graph;
      if (!graph) return;
      const spec = EFFECTS[effect];
      const now = graph.ctx.currentTime;
      if (now - (this.lastPlayed.get(effect) ?? -Infinity) < (spec.gap ?? 0)) return;
      this.lastPlayed.set(effect, now);
      this.log(effect);
      if (this.settings.muted || this.inactive) return;
      const bus = MENU_EFFECTS.includes(effect) ? graph.menuBus : graph.worldBus;
      playEffect(graph.ctx, bus, spec, graph.noise, now + delay + 0.005, this.random);
    });
  }

  /** AC-3: the vacuum while the button is held, the Scanner while it scans. */
  loop(name: LoopName, level: number): void {
    this.guard(() => {
      const graph = this.graph;
      if (!graph || !this.started) return;
      const on = level > 0;
      let loop = this.loops.get(name);
      if (!loop && !on) return;
      loop ??= this.buildLoop(graph, name);
      if (on && this.loopLevels[name] <= 0) this.log(name);
      this.loopLevels[name] = level;
      const { glide, peak } = name === "vacuum" ? { glide: audio.loops.vacuum.glide, peak: 1 } : { glide: audio.loops.scan.glide, peak: audio.loops.scan.gain };
      this.glide(`loop.${name}`, loop.gain.gain, on ? peak : 0, glide);
      if (loop.frequency) this.glide("loop.scan.pitch", loop.frequency, audio.loops.scan.baseHz + audio.loops.scan.rangeHz * Math.min(1, level), glide);
    });
  }

  /** Every frame: the ambience follows the view above or under water (AC-2), the music's filter follows the Bloom (AC-4). */
  scene(look: SceneLook): void {
    this.look = look;
    if (!this.started) return;
    this.guard(() => {
      this.applyAmbience();
      this.applyCutoff();
      this.bubble();
    });
  }

  /** For the browser tests: the engine's state as plain data. */
  debug() {
    const graph = this.graph;
    const value = (param: AudioParam | undefined) => (param ? param.value : null);
    const target = (key: string) => this.targets.get(key) ?? null;
    return {
      available: this.available,
      state: graph ? graph.ctx.state : "none",
      started: this.started,
      phase: this.phase,
      inactive: this.inactive,
      muted: this.settings.muted,
      volumes: { music: this.settings.music, effects: this.settings.effects },
      gains: { master: value(graph?.master.gain), music: value(graph?.musicBus.gain), effects: value(graph?.effectsBus.gain), world: value(graph?.worldBus.gain) },
      targets: { master: target("master"), music: target("music"), effects: target("effects"), world: target("world") },
      music: { state: this.music, cutoff: value(graph?.musicFilter.frequency), cutoffTarget: target("cutoff") },
      ambience: { under: target("ambience.under"), above: target("ambience.above"), underValue: value(this.ambience?.under.gain), aboveValue: value(this.ambience?.above.gain) },
      loops: { ...this.loopLevels },
      fired: [...this.fired],
      level: this.level(),
    };
  }

  /** The RMS of the output since the last look, 0..1 (needs `debug`). */
  private level(): number | null {
    const analyser = this.graph?.analyser;
    if (!analyser) return null;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.sqrt(sum / samples.length);
  }

  private log(name: string): void {
    if (!this.debugging) return;
    this.fired.push(name);
    if (this.fired.length > 200) this.fired.shift();
  }

  /** Runs a piece of the engine; if the browser's audio throws, the engine warns once and goes silent (AC-8). */
  private guard(run: () => void): void {
    if (this.failed) return;
    try {
      run();
    } catch (error) {
      this.fail("Sound stopped working; the game goes on without it.", error);
    }
  }

  private fail(message: string, error?: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.warn(message, error);
  }

  private ensure(): Graph | null {
    if (this.graph || this.failed) return this.graph;
    const ctx = this.createContext();
    if (!ctx) {
      this.fail("This browser has no Web Audio; the game goes on without sound.");
      return null;
    }
    const gain = (): GainNode => ctx.createGain();
    const master = gain();
    const musicBus = gain();
    const musicFilter = ctx.createBiquadFilter();
    const effectsBus = gain();
    const worldBus = gain();
    const menuBus = gain();
    musicFilter.type = "lowpass";
    musicFilter.Q.value = audio.music.q;
    musicFilter.connect(musicBus);
    musicBus.connect(master);
    worldBus.connect(effectsBus);
    menuBus.connect(effectsBus);
    effectsBus.connect(master);
    master.connect(ctx.destination);
    let analyser: AnalyserNode | null = null;
    if (this.debugging) {
      analyser = ctx.createAnalyser();
      master.connect(analyser);
    }
    this.graph = { ctx, master, musicBus, musicFilter, effectsBus, worldBus, menuBus, noise: createNoise(ctx, this.random), analyser };
    this.applyBuses(0);
    this.set("cutoff", musicFilter.frequency, musicCutoff(this.look.clarity));
    return this.graph;
  }

  /** Puts a parameter at a value at once, and remembers it as the target. */
  private set(key: string, param: AudioParam, value: number): void {
    this.targets.set(key, value);
    param.value = value;
  }

  /** Moves a parameter toward a value with time constant `tc` seconds; a value it is already heading for costs nothing. */
  private glide(key: string, param: AudioParam, value: number, tc: number): void {
    const previous = this.targets.get(key);
    if (previous === value) return;
    if (previous === undefined) return this.set(key, param, value);
    this.targets.set(key, value);
    param.setTargetAtTime(value, this.graph!.ctx.currentTime, tc);
  }

  private applyBuses(tc: number): void {
    const graph = this.graph;
    if (!graph) return;
    const targets = busTargets(this.settings, this.phase, this.inactive);
    this.glide("master", graph.master.gain, targets.master, audio.fast);
    this.glide("music", graph.musicBus.gain, targets.music, tc);
    this.glide("effects", graph.effectsBus.gain, targets.effects, tc);
    this.glide("world", graph.worldBus.gain, targets.world, tc);
  }

  private applyCutoff(): void {
    if (this.graph) this.glide("cutoff", this.graph.musicFilter.frequency, musicCutoff(this.look.clarity), audio.music.glide);
  }

  private applyAmbience(): void {
    if (!this.ambience) return;
    const mix = ambienceMix(this.look.above);
    this.glide("ambience.under", this.ambience.under.gain, mix.under * audio.ambience.level, audio.ambience.crossfade);
    this.glide("ambience.above", this.ambience.above.gain, mix.above * audio.ambience.level, audio.ambience.crossfade);
  }

  /** A looping noise through a filter into `out`, whose strength swells at `lfoHz` by `depth` of `level`. */
  private noiseLayer(graph: Graph, out: AudioNode, filterType: BiquadFilterType, hz: number, q: number, level: number, lfoHz: number, depth: number): void {
    const { ctx } = graph;
    const source = ctx.createBufferSource();
    source.buffer = graph.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = hz;
    filter.Q.value = q;
    const strength = ctx.createGain();
    strength.gain.value = level;
    source.connect(filter);
    filter.connect(strength);
    strength.connect(out);
    source.start(0, this.random() * graph.noise.duration);
    if (depth > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const swing = ctx.createGain();
      swing.gain.value = level * depth;
      lfo.connect(swing);
      swing.connect(strength.gain);
      lfo.start();
    }
  }

  private buildAmbience(graph: Graph): Ambience {
    const { ctx } = graph;
    const under = ctx.createGain();
    const above = ctx.createGain();
    under.gain.value = 0;
    above.gain.value = 0;
    this.targets.set("ambience.under", 0);
    this.targets.set("ambience.above", 0);
    under.connect(graph.worldBus);
    above.connect(graph.worldBus);
    const { rumble } = audio.ambience.under;
    this.noiseLayer(graph, under, "lowpass", rumble.cutoff, 0.7, rumble.gain, rumble.swellHz, rumble.depth);
    const { waves, wind } = audio.ambience.above;
    this.noiseLayer(graph, above, "lowpass", waves.cutoff, 0.7, waves.gain, waves.swellHz, waves.depth);
    this.noiseLayer(graph, above, "bandpass", wind.hz, wind.q, wind.gain, wind.gustHz, wind.depth);
    return { under, above };
  }

  /** A burst of bubbles now and then, only under water and only while the game is going. */
  private bubble(): void {
    const graph = this.graph;
    if (!graph || !this.ambience || this.look.above || this.phase !== "playing" || graph.ctx.state !== "running") return;
    const now = graph.ctx.currentTime;
    if (now < this.nextBubble) return;
    const { bubbles } = audio.ambience.under;
    this.nextBubble = now + bubbles.gapMin + this.random() * (bubbles.gapMax - bubbles.gapMin);
    if (this.settings.muted || this.inactive) return;
    const spec: EffectSpec = { jitter: bubbles.jitter, layers: bubbles.layers };
    const count = 1 + Math.floor(this.random() * bubbles.count);
    for (let i = 0; i < count; i++) playEffect(graph.ctx, this.ambience.under, spec, graph.noise, now + 0.005 + i * bubbles.spacing, this.random);
    this.log("bubbles");
  }

  private buildLoop(graph: Graph, name: LoopName): Loop {
    const { ctx } = graph;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    this.targets.set(`loop.${name}`, 0);
    gain.connect(graph.worldBus);
    let frequency: AudioParam | null = null;
    if (name === "vacuum") {
      const { noiseHz, noiseQ, noiseGain, humHz, humCutoff, humGain } = audio.loops.vacuum;
      this.noiseLayer(graph, gain, "bandpass", noiseHz, noiseQ, noiseGain, 0, 0);
      const hum = ctx.createOscillator();
      hum.type = "sawtooth";
      hum.frequency.value = humHz;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = humCutoff;
      const strength = ctx.createGain();
      strength.gain.value = humGain;
      hum.connect(lowpass);
      lowpass.connect(strength);
      strength.connect(gain);
      hum.start();
    } else {
      const { baseHz, tremoloHz, tremoloDepth } = audio.loops.scan;
      const tone = ctx.createOscillator();
      tone.type = "sine";
      tone.frequency.value = baseHz;
      frequency = tone.frequency;
      // A tremolo: the level swings between 1 - depth and 1.
      const tremolo = ctx.createGain();
      tremolo.gain.value = 1 - tremoloDepth / 2;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = tremoloHz;
      const swing = ctx.createGain();
      swing.gain.value = tremoloDepth / 2;
      lfo.connect(swing);
      swing.connect(tremolo.gain);
      tone.connect(tremolo);
      tremolo.connect(gain);
      tone.start();
      lfo.start();
    }
    const loop = { gain, frequency };
    this.loops.set(name, loop);
    return loop;
  }

  /** AC-4: decodes the file and loops it, without a gap, through the filter. If it cannot be loaded the game goes on without it (AC-8). */
  private async startMusic(graph: Graph): Promise<void> {
    this.music = "loading";
    try {
      this.musicBytes ??= this.loadMusic();
      const bytes = await this.musicBytes;
      const buffer = await graph.ctx.decodeAudioData(bytes.slice(0));
      const source = graph.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(graph.musicFilter);
      source.start();
      this.music = "playing";
    } catch (error) {
      this.music = "failed";
      this.warn("The music could not be loaded; the game goes on without it.", error);
    }
  }
}
