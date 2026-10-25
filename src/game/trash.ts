import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight, floorSlope, insideRockAt } from "./bay";
import { caveTrashSpots } from "./cave";
import { insideShed, landObstacles, standable } from "./land";
import { areaReach, headland, inDiveArea, inland } from "./terrain";
import { counterPosition, stationPosition } from "./station";
import { pickNearestInCone } from "./vacuum";

const { trash, vacuum, station } = config;
const { beach } = trash;
const { dock } = config.bay;

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
  /** "pulling": sucked in by the vacuum; "lifting" (REQ-017): picked up by hand on the beach. */
  state: "free" | "pulling" | "lifting" | "collected";
  /** 0..1 while pulling or lifting. */
  pull: number;
  /** REQ-017: lies on the sand of the west beach, picked up on foot, never sucked by the vacuum. */
  onBeach: boolean;
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
  if (!inDiveArea(x, z, 6)) return false;
  const floor = floorHeight(x, z);
  if (floor > bay.surfaceY - trash.minDepth) return false;
  if (floorSlope(x, z) > trash.maxSlope) return false;
  if (Math.hypot(x - start.x, z - start.z) < trash.clearOfStart) return false;
  if (Math.hypot(x - stationPosition.x, z - stationPosition.z) < station.zoneRadius + 3) return false;
  if (Math.hypot(x - bay.dock.x, z - bay.dock.z) < bay.dock.clear) return false;
  if (Math.hypot(x - bay.cave.x, z - bay.cave.z) < bay.cave.clear) return false;
  // REQ-003: no trash under a ghost net, where it would hide behind the net or stop the cutter; nor on a reef site or a
  // seagrass patch, where the seeds land. REQ-012: kept clear of every spot one could be on.
  if (config.nets.spots.some((site) => Math.hypot(x - site.x, z - site.z) < trash.clearOfNets)) return false;
  if ([...reef.frameSpots, ...reef.patchSpots].some((site) => Math.hypot(x - site.x, z - site.z) < trash.clearOfSites)) return false;
  // Not inside or right against a rock, a boulder or an arch.
  return !insideRockAt(x, floor + trash.restHeight, z, 1.2);
}

/**
 * REQ-017 AC-8: true where an item may lie on the beach: dry sand between the waterline and `maxInland` m inland, within
 * `halfLength` m of the beach's centre, somewhere the player can stand, and clear of the shed, its counter, the dock, the
 * palms, the rocks, the sorting bins, the cliffs at both ends and the steep slopes.
 */
export function beachSpotOk(x: number, z: number): boolean {
  const s = inland(x, z);
  if (s < beach.minInland || s > beach.maxInland || Math.abs(z) > beach.halfLength) return false;
  if (!standable(x, z) || headland(x, z) > 0 || floorSlope(x, z) > trash.maxSlope) return false;
  if (insideShed(x, z, beach.clearOfShed)) return false;
  if (Math.hypot(x - counterPosition.x, z - counterPosition.z) < station.zoneRadius + beach.clearOfShed) return false;
  if (x >= dock.landX - beach.clearOfDock && Math.abs(z - dock.z) <= dock.halfWidth + beach.clearOfDock) return false;
  return !landObstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + beach.clearOfObstacles);
}

/**
 * REQ-017 AC-1: where the beach's items lie: `beach.groups` small groups along the beach, as even in size as can be,
 * every spot good (see beachSpotOk) and apart from the others.
 */
function beachSpots(random: () => number): { x: number; z: number }[] {
  const spots: { x: number; z: number }[] = [];
  const centres: { x: number; z: number }[] = [];
  const [fewest, most] = beach.groups;
  const groups = fewest + Math.floor(random() * (most - fewest + 1));
  for (let attempts = 0; centres.length < groups && spots.length < beach.count && attempts < 5000; attempts++) {
    const cz = (random() * 2 - 1) * beach.halfLength;
    const cx = inland(0, cz) - (beach.minInland + random() * (beach.maxInland - beach.minInland));
    if (!beachSpotOk(cx, cz)) continue;
    if (centres.some((c) => Math.hypot(cx - c.x, cz - c.z) < beach.groupSpacing)) continue;
    centres.push({ x: cx, z: cz });
    const wanted = Math.ceil((beach.count - spots.length) / (groups - centres.length + 1));
    let placed = 0;
    for (let tries = 0; placed < wanted && tries < 80; tries++) {
      const angle = random() * Math.PI * 2;
      const distance = tries === 0 ? 0 : Math.sqrt(random()) * beach.groupRadius;
      const x = cx + Math.cos(angle) * distance;
      const z = cz + Math.sin(angle) * distance;
      if (!beachSpotOk(x, z)) continue;
      if (spots.some((other) => Math.hypot(x - other.x, z - other.z) < beach.spacing)) continue;
      spots.push({ x, z });
      placed += 1;
    }
  }
  return spots;
}

/**
 * Lays the trash on the floor in small groups (D-066): always the same layout for the same seed, every item on a
 * good spot (see trashSpotOk) and apart from the others. REQ-014: the first few lie on the cave's tunnel floor
 * (the cave itself is kept clear of the rest); the dive's seed moves them about in it. REQ-017: the last
 * `beach.count` lie on the sand of the west beach, laid after the others so the sea's items stay where they were.
 */
export function generateTrash(seed: number = trash.seed): TrashItem[] {
  const random = mulberry32(seed);
  const reach = areaReach(6);
  const items: TrashItem[] = [];
  const centres: { x: number; z: number }[] = [];
  const add = (x: number, z: number, onBeach = false) => {
    const home = new Vector3(x, floorHeight(x, z) + trash.restHeight, z);
    items.push({
      id: items.length,
      kind: KINDS[items.length % KINDS.length],
      position: home.clone(),
      home,
      rotation: random() * Math.PI * 2,
      state: "free",
      pull: 0,
      onBeach,
    });
  };
  const seaCount = trash.count - beach.count;
  for (const spot of caveTrashSpots(random, trash.spacing)) add(spot.x, spot.z);
  let attempts = 0;
  while (items.length < seaCount && attempts++ < 20000) {
    const cx = (random() * 2 - 1) * reach;
    const cz = (random() * 2 - 1) * reach;
    if (!trashSpotOk(cx, cz)) continue;
    if (centres.some((c) => Math.hypot(cx - c.x, cz - c.z) < trash.groupSpacing)) continue;
    centres.push({ x: cx, z: cz });
    // A last single item would lie alone: split the final six as 3 and 3 instead of 5 and 1.
    const left = seaCount - items.length;
    const wanted = left === trash.groupSize + 1 ? Math.ceil(left / 2) : Math.min(trash.groupSize, left);
    let placed = 0;
    for (let tries = 0; placed < wanted && tries < 80; tries++) {
      const angle = random() * Math.PI * 2;
      const distance = tries === 0 ? 0 : Math.sqrt(random()) * trash.groupRadius;
      const x = cx + Math.cos(angle) * distance;
      const z = cz + Math.sin(angle) * distance;
      if (!trashSpotOk(x, z)) continue;
      if (items.some((other) => Math.hypot(x - other.home.x, z - other.home.z) < trash.spacing)) continue;
      add(x, z);
      placed += 1;
    }
  }
  for (const spot of beachSpots(random)) add(spot.x, spot.z, true);
  return items;
}

/**
 * REQ-017 AC-2, AC-5: the beach item the player on foot aims at: free, no further than `beach.reach` m from their feet
 * on the ground, and the crosshair's ray from the eye along `aim` (a unit vector) passes within `beach.aimRadius` of
 * it. When several qualify, the one the ray passes closest to.
 */
export function aimedBeachItem(feet: Vector3, eye: Vector3, aim: Vector3, items: readonly TrashItem[]): TrashItem | null {
  let best: TrashItem | null = null;
  let bestMiss: number = beach.aimRadius;
  const toItem = new Vector3();
  for (const item of items) {
    if (!item.onBeach || item.state !== "free") continue;
    if (Math.hypot(item.position.x - feet.x, item.position.z - feet.z) > beach.reach) continue;
    toItem.copy(item.position).sub(eye);
    const along = toItem.dot(aim);
    if (along <= 0) continue;
    const miss = toItem.addScaledVector(aim, -along).length();
    if (miss <= bestMiss) {
      best = item;
      bestMiss = miss;
    }
  }
  return best;
}

const easeIn = (t: number) => t * t;

/** The trash on the floor and the vacuum's pull on it. Pure: no rendering, no DOM. */
export class TrashField {
  readonly items: TrashItem[];

  constructor(seed: number = trash.seed) {
    this.items = generateTrash(seed);
  }
  private cooldown = 0;

  get total(): number {
    return this.items.length;
  }

  /** Items on their way to the ROV; they already take up room in the tank. (The beach's count at once.) */
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
      // REQ-017 AC-6: the beach's items are only picked up on foot, never sucked, not even from the shallows.
      const free = this.items.filter((item) => item.state === "free" && !item.onBeach);
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
      if (item.state === "lifting") {
        item.pull = Math.min(1, item.pull + dt / beach.liftSeconds);
        item.position.copy(item.home);
        item.position.y += beach.liftHeight * easeIn(item.pull);
        if (item.pull >= 1) item.state = "collected";
        continue;
      }
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

  /** REQ-017 AC-2: the player picked a beach item up; it lifts off the sand and is gone within `beach.liftSeconds`. */
  lift(item: TrashItem): void {
    if (item.state === "free" && item.onBeach) item.state = "lifting";
  }

  /** Puts every item back on the floor for a new dive; REQ-012: a new seed lays them somewhere else. */
  reset(seed?: number): void {
    this.cooldown = 0;
    if (seed !== undefined) {
      generateTrash(seed).forEach((fresh, i) => {
        const item = this.items[i];
        item.home.copy(fresh.home);
        item.rotation = fresh.rotation;
      });
    }
    for (const item of this.items) {
      item.state = "free";
      item.pull = 0;
      item.position.copy(item.home);
    }
  }
}
