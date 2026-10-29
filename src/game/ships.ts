import { config } from "../config";
import { mulberry32 } from "./nature";

const { ships: tuning } = config;

export type ShipKind = keyof typeof tuning.kinds;
export const SHIP_KINDS = Object.keys(tuning.kinds) as ShipKind[];

/** A ship on its lane out at sea (REQ-035). */
export interface Ship {
  id: number;
  kind: ShipKind;
  /** Where the lane is: its nearest point lies `lane` m from the middle of the bay, `bearing` radians from north toward east. */
  bearing: number;
  lane: number;
  /** How far along the lane the ship is, in metres from its nearest point; it runs toward +along (`direction` 1) or back. */
  along: number;
  direction: 1 | -1;
}

/**
 * Where to draw a ship (D-133): its offset from the camera on the ground plane (east = +x, north = -z), `scale` times its
 * real offset, so it lies on the real line of sight; its heading; and its real distance from the camera.
 */
export interface ShipPlace {
  x: number;
  z: number;
  /** The model faces +Z; this turns it to the way it goes. */
  yaw: number;
  distance: number;
}

const range = (random: () => number, [low, high]: readonly [number, number]) => low + random() * (high - low);

/** How far along its lane a ship goes before it is removed, deep in the haze: where it is `end` m from the bay's middle. */
export function laneReach(lane: number): number {
  return Math.sqrt(Math.max(0, tuning.end ** 2 - lane ** 2));
}

/** Where the ship really is, from the middle of the bay. With the lane due east, `along` grows to the south. */
export function shipPosition(ship: Ship): { x: number; z: number } {
  const nx = Math.sin(ship.bearing), nz = -Math.cos(ship.bearing);
  const tx = Math.cos(ship.bearing), tz = Math.sin(ship.bearing);
  return { x: nx * ship.lane + tx * ship.along, z: nz * ship.lane + tz * ship.along };
}

export function shipPlace(ship: Ship, camera: { x: number; z: number } = { x: 0, z: 0 }): ShipPlace {
  const { x, z } = shipPosition(ship);
  const dx = x - camera.x, dz = z - camera.z;
  return {
    x: dx * tuning.scale,
    z: dz * tuning.scale,
    yaw: Math.atan2(Math.cos(ship.bearing) * ship.direction, Math.sin(ship.bearing) * ship.direction),
    distance: Math.hypot(dx, dz),
  };
}

/**
 * REQ-035 (D-130, D-133): the ships passing far out at sea. At most `maxShips` at a time; a new one comes `spawn` seconds
 * after there is room, of a kind picked by weight, on a lane and in a direction picked by chance. A dive starts with one
 * already out at sea. While the camera is above the water and a ship is in sight, a horn is due every `horn.interval`.
 */
export class ShipTraffic {
  ships: Ship[] = [];
  private random: () => number = Math.random;
  private nextId = 1;
  private untilSpawn = 0;
  private untilHorn = 0;

  /** A new dive: one ship out at sea near the middle of its lane, the next a while later. */
  reset(seed: number): void {
    this.random = mulberry32(seed);
    this.ships = [];
    const first = this.spawn();
    first.along = (this.random() * 2 - 1) * tuning.startAlong * laneReach(first.lane);
    this.untilSpawn = range(this.random, tuning.spawn);
    this.untilHorn = range(this.random, tuning.horn.interval);
  }

  /** Moves the ships on; returns true when a horn sounds now (only while `above` and a ship is in sight of `camera`). */
  update(dt: number, above: boolean, camera: { x: number; z: number } = { x: 0, z: 0 }): boolean {
    for (const ship of this.ships) ship.along += ship.direction * tuning.kinds[ship.kind].speed * dt;
    this.ships = this.ships.filter((ship) => ship.direction * ship.along < laneReach(ship.lane));
    if (this.ships.length < tuning.maxShips) {
      this.untilSpawn -= dt;
      if (this.untilSpawn <= 0) {
        this.spawn();
        this.untilSpawn = range(this.random, tuning.spawn);
      }
    }
    if (!above || !this.ships.some((ship) => shipPlace(ship, camera).distance < tuning.horn.sight)) return false;
    this.untilHorn -= dt;
    if (this.untilHorn > 0) return false;
    this.untilHorn = range(this.random, tuning.horn.interval);
    return true;
  }

  /** For the tests: the next horn in `seconds`. */
  hurryHorn(seconds: number): void {
    this.untilHorn = seconds;
  }

  private spawn(): Ship {
    let pick = this.random() * SHIP_KINDS.reduce((sum, kind) => sum + tuning.kinds[kind].weight, 0);
    const kind = SHIP_KINDS.find((candidate) => (pick -= tuning.kinds[candidate].weight) < 0) ?? SHIP_KINDS[0];
    const direction = this.random() < 0.5 ? 1 : -1;
    const lane = range(this.random, tuning.kinds[kind].lane);
    const bearing = (range(this.random, tuning.bearing) * Math.PI) / 180;
    // It enters at the end it comes from, just inside the haze.
    const ship: Ship = { id: this.nextId++, kind, bearing, lane, along: -direction * (laneReach(lane) - 1), direction };
    this.ships.push(ship);
    return ship;
  }
}
