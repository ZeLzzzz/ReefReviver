import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight, floorSlope, insideRockAt } from "./bay";
import { squareRadius, wallness } from "./terrain";
import { stationPosition } from "./station";
import { pickNearestInCone } from "./vacuum";

const { trash, vacuum, station } = config;
const netSites = config.nets.sites;

export type TrashKind = "bottle" | "bag" | "can";
const KINDS: readonly TrashKind[] = ["bottle", "bag", "can"];

export interface TrashItem {
  id: number;
  kind: TrashKind;
  /** Where the item is now; it moves while being sucked in. */
  position: Vector3;
  /** Resting spot on the floor. */
  home: Vector3;
  /** Rotation around the vertical axis while lying on the floor. */
  rotation: number;
  state: "free" | "pulling" | "collected";
  /** 0..1 while pulling. */
  pull: number;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** True where an item may lie: in water deep enough, on gentle floor, clear of rocks, the start, the station and the sites. */
export function trashSpotOk(x: number, z: number): boolean {
  const { start } = config.rov;
  const { bay, reef } = config;
  if (squareRadius(x, z) > bay.wall.radius - bay.wall.width - 6 || wallness(x, z) > 0) return false;
  const floor = floorHeight(x, z);
  if (floor > bay.surfaceY - trash.minDepth) return false;
  if (floorSlope(x, z) > trash.maxSlope) return false;
  if (Math.hypot(x - start.x, z - start.z) < trash.clearOfStart) return false;
  if (Math.hypot(x - stationPosition.x, z - stationPosition.z) < station.zoneRadius + 3) return false;
  if (Math.hypot(x - bay.dock.x, z - bay.dock.z) < bay.dock.clear) return false;
  if (Math.hypot(x - bay.cave.x, z - bay.cave.z) < bay.cave.clear) return false;
  // REQ-003: no trash under a ghost net, where it would hide behind the net or stop the cutter.
  if (netSites.some((site) => Math.hypot(x - site.x, z - site.z) < trash.clearOfNets)) return false;
  // Nor on a reef site or a seagrass patch, where the seeds land.
  if ([...reef.frameSites, ...reef.seagrassPatches].some((site) => Math.hypot(x - site.x, z - site.z) < trash.clearOfSites)) return false;
  // Not inside or right against a rock, a boulder or an arch.
  return !insideRockAt(x, floor + trash.restHeight, z, 1.2);
}

/**
 * Lays the trash on the floor in small groups (D-066): always the same layout for the same seed, every item on a
 * good spot (see trashSpotOk) and apart from the others.
 */
export function generateTrash(seed: number = trash.seed): TrashItem[] {
  const random = mulberry32(seed);
  const reach = config.bay.wall.radius - config.bay.wall.width - 6;
  const items: TrashItem[] = [];
  const centres: { x: number; z: number }[] = [];
  let attempts = 0;
  while (items.length < trash.count && attempts++ < 20000) {
    const cx = (random() * 2 - 1) * reach;
    const cz = (random() * 2 - 1) * reach;
    if (!trashSpotOk(cx, cz)) continue;
    if (centres.some((c) => Math.hypot(cx - c.x, cz - c.z) < trash.groupSpacing)) continue;
    centres.push({ x: cx, z: cz });
    const wanted = Math.min(trash.groupSize, trash.count - items.length);
    let placed = 0;
    for (let tries = 0; placed < wanted && tries < 80; tries++) {
      const angle = random() * Math.PI * 2;
      const distance = tries === 0 ? 0 : Math.sqrt(random()) * trash.groupRadius;
      const x = cx + Math.cos(angle) * distance;
      const z = cz + Math.sin(angle) * distance;
      if (!trashSpotOk(x, z)) continue;
      if (items.some((other) => Math.hypot(x - other.home.x, z - other.home.z) < trash.spacing)) continue;
      const home = new Vector3(x, floorHeight(x, z) + trash.restHeight, z);
      items.push({
        id: items.length,
        kind: KINDS[items.length % KINDS.length],
        position: home.clone(),
        home,
        rotation: random() * Math.PI * 2,
        state: "free",
        pull: 0,
      });
      placed += 1;
    }
  }
  return items;
}

const easeIn = (t: number) => t * t;

/** The trash on the floor and the vacuum's pull on it. Pure: no rendering, no DOM. */
export class TrashField {
  readonly items: TrashItem[] = generateTrash();
  private cooldown = 0;

  get total(): number {
    return this.items.length;
  }

  /** Items on their way to the ROV; they already take up room in the tank. */
  get pulling(): number {
    return this.items.filter((item) => item.state === "pulling").length;
  }

  /**
   * Advances the pull. While `sucking`, starts pulling the nearest free item in front of the ROV, as long as
   * `freeSlots` (tank room not yet claimed) allows. Returns the items that reached the ROV this step.
   */
  update(dt: number, nozzle: Vector3, aim: Vector3, sucking: boolean, freeSlots: number): TrashItem[] {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (sucking && freeSlots > 0 && this.cooldown === 0) {
      const free = this.items.filter((item) => item.state === "free");
      const index = pickNearestInCone(
        nozzle,
        aim,
        free.map((item) => item.position),
      );
      if (index >= 0) {
        free[index].state = "pulling";
        this.cooldown = vacuum.interval;
      }
    }

    const arrived: TrashItem[] = [];
    for (const item of this.items) {
      if (item.state !== "pulling") continue;
      item.pull = Math.min(1, item.pull + dt / vacuum.pullDuration);
      item.position.lerpVectors(item.home, nozzle, easeIn(item.pull));
      if (item.pull >= 1) {
        item.state = "collected";
        arrived.push(item);
      }
    }
    return arrived;
  }

  /** Puts every item back on the floor, for a new dive. */
  reset(): void {
    this.cooldown = 0;
    for (const item of this.items) {
      item.state = "free";
      item.pull = 0;
      item.position.copy(item.home);
    }
  }
}
