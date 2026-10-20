import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight, rocks } from "./bay";
import { stationPosition } from "./station";
import { pickNearestInCone } from "./vacuum";

const { trash, vacuum, station } = config;

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

/** Scatters the trash over the floor: always the same layout, clear of rocks, the start and the station. */
export function generateTrash(): TrashItem[] {
  const random = mulberry32(trash.seed);
  const { start } = config.rov;
  const items: TrashItem[] = [];
  let attempts = 0;
  while (items.length < trash.count && attempts++ < 20000) {
    const angle = random() * Math.PI * 2;
    const distance = trash.minRadius + random() * (trash.maxRadius - trash.minRadius);
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    if (Math.hypot(x - start.x, z - start.z) < trash.clearOfStart) continue;
    if (Math.hypot(x - stationPosition.x, z - stationPosition.z) < station.zoneRadius + 3) continue;
    if (rocks.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.size + 1.2)) continue;
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
