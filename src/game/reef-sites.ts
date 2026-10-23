import { config } from "../config";
import { floorHeight, type FrameColumn } from "./bay";
import { defaultLayout, type Layout } from "./layout";

const { reef } = config;

/** What a marker shows: nothing built yet, work started, or finished. Never colour alone (D-022). */
export type SiteStatus = "empty" | "started" | "planted";

export interface FrameSite {
  x: number;
  y: number;
  z: number;
  installed: boolean;
  /** Coral fragments attached so far. */
  fragments: number;
}

export interface PatchSite {
  x: number;
  y: number;
  z: number;
  /** Seagrass seeds planted so far. */
  seeds: number;
}

/** What a moving shot touched: an installed frame or a seagrass patch (the floor is solid either way). */
export interface ShotTarget {
  kind: "frame" | "patch";
  index: number;
}

/** D-044: one kind of "bibit", and what it does depends on what it hits. */
export type ShotResult =
  | { kind: "miss" }
  | { kind: "coral"; site: number; planted: boolean }
  | { kind: "seed"; patch: number; planted: boolean };

export function framePlanted(site: FrameSite): boolean {
  return site.installed && site.fragments >= reef.fragmentsPerFrame;
}

export function patchPlanted(site: PatchSite): boolean {
  return site.seeds >= reef.seedsPerPatch;
}

export function frameStatus(site: FrameSite): SiteStatus {
  if (!site.installed) return "empty";
  return framePlanted(site) ? "planted" : "started";
}

export function patchStatus(site: PatchSite): SiteStatus {
  if (patchPlanted(site)) return "planted";
  return site.seeds > 0 ? "started" : "empty";
}

/**
 * The three reef sites and two seagrass patches of a dive (REQ-012: at its layout's spots) and how far each one is. Pure state: the Session counts the
 * progress and the score, the model draws it.
 */
export class ReefField {
  readonly frames: FrameSite[];
  readonly patches: PatchSite[];

  constructor(layout: Layout = defaultLayout) {
    this.frames = layout.frames.map(({ x, z }) => ({ x, y: floorHeight(x, z), z, installed: false, fragments: 0 }));
    this.patches = layout.patches.map(({ x, z }) => ({ x, y: floorHeight(x, z), z, seeds: 0 }));
  }

  /** Empties every site for a new dive, moving them to the new layout's spots when one is given (REQ-012). */
  reset(layout?: Layout): void {
    if (layout) {
      layout.frames.forEach(({ x, z }, i) => Object.assign(this.frames[i], { x, y: floorHeight(x, z), z }));
      layout.patches.forEach(({ x, z }, i) => Object.assign(this.patches[i], { x, y: floorHeight(x, z), z }));
    }
    for (const frame of this.frames) {
      frame.installed = false;
      frame.fragments = 0;
    }
    for (const patch of this.patches) patch.seeds = 0;
  }

  /** The nearest reef site without a frame within the interaction distance of (x, z), or -1. */
  emptySiteNear(x: number, z: number): number {
    let best = -1;
    let bestDistance: number = reef.interactRadius;
    this.frames.forEach((frame, i) => {
      if (frame.installed) return;
      const distance = Math.hypot(x - frame.x, z - frame.z);
      if (distance <= bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  install(index: number): void {
    this.frames[index].installed = true;
  }

  /** The installed frames as solid columns for the ROV and the shots. */
  columns(): FrameColumn[] {
    return this.frames
      .filter((frame) => frame.installed)
      .map((frame) => ({ x: frame.x, z: frame.z, baseY: frame.y, radius: reef.frame.radius, height: reef.frame.height }));
  }

  /** The frame or patch a shot at this point is touching, or null. A site without a frame is not a target. */
  targetAt(x: number, y: number, z: number): ShotTarget | null {
    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i];
      if (!frame.installed) continue;
      if (Math.hypot(x - frame.x, z - frame.z) <= reef.frame.radius && y >= frame.y - 0.2 && y <= frame.y + reef.frame.height) {
        return { kind: "frame", index: i };
      }
    }
    for (let i = 0; i < this.patches.length; i++) {
      const patch = this.patches[i];
      if (Math.hypot(x - patch.x, z - patch.z) <= reef.patchRadius && y <= floorHeight(x, z) + 0.05) {
        return { kind: "patch", index: i };
      }
    }
    return null;
  }

  /** A shot arrives at a target (AC-4, AC-5): a planted frame or patch takes nothing and the shot is lost (AC-6). */
  land(target: ShotTarget): ShotResult {
    if (target.kind === "frame") {
      const frame = this.frames[target.index];
      if (!frame.installed || framePlanted(frame)) return { kind: "miss" };
      frame.fragments += 1;
      return { kind: "coral", site: target.index, planted: framePlanted(frame) };
    }
    const patch = this.patches[target.index];
    if (patchPlanted(patch)) return { kind: "miss" };
    patch.seeds += 1;
    return { kind: "seed", patch: target.index, planted: patchPlanted(patch) };
  }
}
