import { Vector3 } from "three";
import { config } from "../config";
import type { LogbookId } from "../logbook/entries";
import type { Animal } from "./animals";
import { floorHeight } from "./bay";
import { raySphere, terrainBlocks, type Sphere } from "./cutter";
import { framePlanted, patchPlanted, type FrameSite, type PatchSite } from "./reef-sites";
import type { NaturalTarget } from "./nature";
import type { SeaCreature } from "./sea-life";

const { scanner } = config;

/** Something the crosshair can scan: a sphere around it, the Logbook entry it opens, and whether it is still in a net (AC-7). */
export interface ScanTarget extends Sphere {
  entry: LogbookId;
  trapped: boolean;
  /**
   * REQ-019 AC-6: a patch of ground of radius `r` around (x, z), not a sphere: the ray meets it where it comes down to
   * `scanner.meadowHeight` above the floor, so it is hit from directly above, from inside a sphere's reach, and
   * on a sloping shelf alike. `y` is only where the crosshair is aimed at it.
   */
  flat?: boolean;
}

export interface ScanHit {
  entry: LogbookId;
  trapped: boolean;
  /** Where the ray meets the target. */
  point: Vector3;
}

/** What one frame of scanning produced: an entry opened (AC-1), a repeat (AC-6) or a trapped animal (AC-7). */
export type ScanEvent = { kind: "scanned"; entry: LogbookId } | { kind: "known" } | { kind: "trapped" };

const GROUND_STEP = 0.2;
const GROUND_REACH = 40;

/** Where the unit ray `dir` from `origin` first comes down to the leaves' height over the ground of a `flat` target, or null. */
function groundDistance(origin: Vector3, dir: Vector3, target: ScanTarget): number | null {
  // The stretch of the ray (by t) that lies over the disc: where its path on the ground is inside the circle.
  const ox = origin.x - target.x;
  const oz = origin.z - target.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let from = 0;
  let to = GROUND_REACH;
  if (a < 1e-9) {
    if (ox * ox + oz * oz > target.r * target.r) return null;
  } else {
    const b = ox * dir.x + oz * dir.z;
    const c = ox * ox + oz * oz - target.r * target.r;
    const discriminant = b * b - a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    from = Math.max(0, (-b - root) / a);
    to = Math.min(GROUND_REACH, (-b + root) / a);
  }
  const above = (t: number) => origin.y + dir.y * t - floorHeight(origin.x + dir.x * t, origin.z + dir.z * t) - scanner.meadowHeight;
  if (above(from) <= 0) return from;
  let last = from;
  for (let t = from + GROUND_STEP; t < to + GROUND_STEP; t += GROUND_STEP) {
    const now = Math.min(t, to);
    if (above(now) <= 0) {
      // Narrow the step down to the crossing.
      let low = last;
      let high = now;
      for (let i = 0; i < 8; i++) {
        const mid = (low + high) / 2;
        if (above(mid) <= 0) high = mid;
        else low = mid;
      }
      return high;
    }
    last = now;
  }
  return null;
}

/** How far along the unit ray `dir` from `origin` the target is first met, or null. */
function hitDistance(origin: Vector3, dir: Vector3, target: ScanTarget): number | null {
  return target.flat ? groundDistance(origin, dir, target) : raySphere(origin, dir, target);
}

/**
 * Everything that can be scanned now. The freed or trapped turtle and reef shark, the sea life that has a Logbook
 * entry (`seaScale` is how far it has grown in, so a creature that is still appearing is a smaller target), and the
 * planted coral frames and seagrass patches, and the natural coral and seagrass meadows (REQ-013). The yellowtail
 * has no entry and is left out (D-038).
 */
export function collectScanTargets(
  animals: readonly Animal[],
  creatures: readonly SeaCreature[],
  seaScale: number,
  frames: readonly FrameSite[],
  patches: readonly PatchSite[],
  natural: readonly NaturalTarget[] = [],
): ScanTarget[] {
  const targets: ScanTarget[] = [];
  for (const animal of animals) {
    const { x, y, z } = animal.position;
    targets.push({ x, y, z, r: scanner.radius[animal.species], entry: animal.species, trapped: animal.state === "trapped" });
  }
  if (seaScale > 0) {
    for (const creature of creatures) {
      if (!creature.scannable || !creature.logbookId) continue;
      const { x, y, z } = creature.position;
      targets.push({ x, y, z, r: scanner.radius[creature.species as "clownfish" | "mantaRay" | "dolphin"] * seaScale, entry: creature.logbookId, trapped: false });
    }
  }
  for (const frame of frames) {
    if (framePlanted(frame)) targets.push({ x: frame.x, y: frame.y + scanner.coralHeight, z: frame.z, r: scanner.radius.coral, entry: "coral", trapped: false });
  }
  for (const patch of patches) {
    if (!patchPlanted(patch)) continue;
    targets.push({ x: patch.x, y: patch.y + scanner.seagrassHeight, z: patch.z, r: scanner.radius.seagrass, entry: "seagrass", trapped: false });
    // REQ-019: the patches lie in shallow water, where a camera over one is inside the sphere: its ground is a target too.
    targets.push({ x: patch.x, y: patch.y + scanner.meadowHeight, z: patch.z, r: config.reef.patchRadius, entry: "seagrass", trapped: false, flat: true });
  }
  // REQ-013: the natural coral clusters and seagrass meadows open the coral and seagrass entries too (D-074, D-089).
  for (const target of natural) targets.push({ ...target, trapped: false });
  return targets;
}

/**
 * The target the crosshair points at: the nearest one the ray from `origin` along `dir` (a unit vector) meets, no
 * further than the scanner's range from the ROV, with no rock or floor in between. Anything else gives null.
 */
export function aimedScanTarget(origin: Vector3, dir: Vector3, rov: Vector3, targets: readonly ScanTarget[]): ScanHit | null {
  let best: ScanTarget | null = null;
  let distance = Infinity;
  for (const target of targets) {
    const t = hitDistance(origin, dir, target);
    if (t !== null && t < distance) {
      best = target;
      distance = t;
    }
  }
  if (!best) return null;
  const point = new Vector3().copy(dir).multiplyScalar(distance).add(origin);
  if (point.distanceTo(rov) > scanner.range) return null;
  if (terrainBlocks(origin, dir, distance)) return null;
  return { entry: best.entry, trapped: best.trapped, point };
}

/**
 * The scanner's progress on one target (AC-1, AC-5). Holding the aim on the same entry fills it over
 * `scanner.seconds`; aiming away or letting go empties it at once. A trapped animal, or an entry already in the
 * Logbook, gives its message once when the aim arrives and no progress (AC-6, AC-7). Aiming from one clownfish to
 * another keeps the progress, because it is the same entry.
 */
export class Scanner {
  private seconds = 0;
  private key: string | null = null;
  /** The aimed target has been dealt with (scanned, known or trapped); nothing more happens until the aim leaves it. */
  private settled = false;

  /** 0..1 */
  get progress(): number {
    return this.settled ? 0 : Math.min(1, this.seconds / scanner.seconds);
  }

  /** Advances by `dt`. `known` is the set of entries already in the Logbook. Returns what happened, or null. */
  update(dt: number, scanning: boolean, aimedAt: ScanHit | null, known: ReadonlySet<LogbookId>): ScanEvent | null {
    if (!scanning || !aimedAt) {
      this.reset();
      return null;
    }
    const key = aimedAt.trapped ? `trapped:${aimedAt.entry}` : aimedAt.entry;
    if (key !== this.key) {
      this.key = key;
      this.seconds = 0;
      this.settled = aimedAt.trapped || known.has(aimedAt.entry);
      if (aimedAt.trapped) return { kind: "trapped" };
      if (this.settled) return { kind: "known" };
    }
    if (this.settled) return null;
    this.seconds += dt;
    if (this.seconds < scanner.seconds) return null;
    this.seconds = 0;
    this.settled = true;
    return { kind: "scanned", entry: aimedAt.entry };
  }

  reset(): void {
    this.seconds = 0;
    this.key = null;
    this.settled = false;
  }
}
