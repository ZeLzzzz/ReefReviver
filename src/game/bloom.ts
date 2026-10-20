import { config } from "../config";

const { bloom, water, phase1, reef } = config;

/** What the Bloom needs from the game (REQ-005 AC-1, AC-4). */
export interface BloomProgress {
  cleanliness: number;
  framesPlanted: number;
  patchesPlanted: number;
}

export type BloomCondition = "clean" | "frames" | "seagrass";

/** The conditions that are not met yet, in the order the goal lists show them (AC-4). */
export function unmetConditions(progress: BloomProgress): BloomCondition[] {
  const unmet: BloomCondition[] = [];
  if (progress.cleanliness < phase1.cleanTarget) unmet.push("clean");
  if (progress.framesPlanted < reef.frameSites.length) unmet.push("frames");
  if (progress.patchesPlanted < reef.seagrassPatches.length) unmet.push("seagrass");
  return unmet;
}

/** D-015: cleanliness 80 % or more, all three frames planted and both seagrass patches planted. */
export function bloomReady(progress: BloomProgress): boolean {
  return unmetConditions(progress).length === 0;
}

export const smoothstep = (t: number): number => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};

export const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Blends two 0xRRGGBB colours channel by channel; every channel moves one way only, so no flicker (AC-7). */
export function lerpHex(from: number, to: number, t: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(lerp(a, b, t)) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** How the water looks at one moment: the colour of the water and fog, the view distance and the light. */
export interface WaterLook {
  color: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiIntensity: number;
  sunIntensity: number;
  snowOpacity: number;
  surfaceColor: number;
}

/** The water at `clarity`: 0 is the murky bay, 1 is crystal clear (AC-1). Smooth and one-directional (AC-7). */
export function waterAt(clarity: number): WaterLook {
  const t = Math.min(1, Math.max(0, clarity));
  const from = water.murky;
  const to = bloom.clear;
  return {
    color: lerpHex(from.color, to.color, t),
    fogNear: lerp(from.fogNear, to.fogNear, t),
    fogFar: lerp(from.fogFar, to.fogFar, t),
    hemiSky: lerpHex(from.hemiSky, to.hemiSky, t),
    hemiIntensity: lerp(from.hemiIntensity, to.hemiIntensity, t),
    sunIntensity: lerp(from.sunIntensity, to.sunIntensity, t),
    snowOpacity: lerp(from.snowOpacity, to.snowOpacity, t),
    surfaceColor: lerpHex(from.surfaceColor, to.surfaceColor, t),
  };
}

export type BloomState = "idle" | "running" | "done";
export type BloomEvent = "started" | "finished";

/**
 * The Bloom's clock. It starts the moment the conditions hold, runs `bloom.seconds` of game time and then stays
 * done: it happens once per session (AC-6). Pure; the game feeds it the frame time only while playing, so a
 * pause freezes it.
 */
export class Bloom {
  state: BloomState = "idle";
  /** Linear 0..1 over the transition. */
  progress = 0;

  /** Smoothly eased progress: what the water, coral and seagrass blend by. */
  get clarity(): number {
    return smoothstep(this.progress);
  }

  /** Advances by `dt` seconds; `ready` says whether the conditions hold. Returns what happened, if anything. */
  update(dt: number, ready: boolean): BloomEvent | null {
    if (this.state === "done") return null;
    let event: BloomEvent | null = null;
    if (this.state === "idle") {
      if (!ready) return null;
      this.state = "running";
      event = "started";
    }
    this.progress = Math.min(1, this.progress + dt / bloom.seconds);
    if (this.progress >= 1) {
      this.state = "done";
      return "finished";
    }
    return event;
  }

  /** A new dive: murky again, nothing has happened. */
  reset(): void {
    this.state = "idle";
    this.progress = 0;
  }
}
