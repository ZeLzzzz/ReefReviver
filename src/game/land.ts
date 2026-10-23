import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight, floorSlope } from "./bay";
import type { MoveInput } from "./rov";
import { inland, wallness } from "./terrain";

const { land, bay } = config;
const { shore } = bay;

/** Where the player stands after getting out, facing inland, and where the submarine is left floating (D-079, D-080). */
export interface AshoreSpot {
  landing: { x: number; z: number; yaw: number };
  park: { x: number; z: number };
}

/** Something on the land the player cannot walk through: a palm trunk or a rock, as a circle on the ground. */
export interface LandObstacle {
  x: number;
  z: number;
  radius: number;
}

/** Palm trunks and rocks; REQ-016 adds the shed and the dock. */
export const landObstacles: readonly LandObstacle[] = [
  ...land.palms.map((palm) => ({ x: palm.x, z: palm.z, radius: 0.3 })),
  ...land.rocks.map((rock) => ({ x: rock.x, z: rock.z, radius: rock.radius })),
];

/** True where a walking player can stand: ground no deeper than wading depth, not too steep, not the rock wall, clear of trees and rocks. */
export function standable(x: number, z: number): boolean {
  const edge = bay.halfSize - 2;
  if (Math.abs(x) > edge || Math.abs(z) > edge) return false;
  if (floorHeight(x, z) < bay.surfaceY - land.wadeDepth) return false;
  if (floorSlope(x, z) > land.maxSlope || wallness(x, z) > 0.3) return false;
  return !landObstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + land.radius);
}

/**
 * Whether the submarine at (x, z) is close enough to the west shore to go ashore (within `ashoreRange` of the
 * waterline, on the open beach between the rock walls), and if so where the player lands and the submarine is left.
 */
export function ashoreSpot(x: number, z: number): AshoreSpot | null {
  if (Math.abs(z) > shore.openHalf - 20) return null;
  const s = inland(x, z);
  if (s > 0 || s < -land.ashoreRange) return null;
  const waterline = x + s;
  // Alongside the beach: from the waterline out into the bay until the water is deep enough to float in.
  let parkX = waterline;
  while (floorHeight(parkX, z) > bay.surfaceY - land.parkDepth && parkX < waterline + land.ashoreRange + 10) parkX += 0.25;
  // On the beach: a few metres inland, further if a tree or a rock is in the way.
  let landX = waterline - land.landingInland;
  while (!standable(landX, z) && landX > waterline - 20) landX -= 0.5;
  if (!standable(landX, z)) return null;
  return { landing: { x: landX, z, yaw: -Math.PI / 2 }, park: { x: parkX, z } };
}

/** The player on foot: feet on the ground, looking along yaw and pitch (yaw as for the ROV: 0 faces +Z). */
export interface Walker {
  position: Vector3;
  yaw: number;
  pitch: number;
}

export function createWalker(x: number, z: number, yaw: number): Walker {
  return { position: new Vector3(x, floorHeight(x, z), z), yaw, pitch: 0 };
}

/** Mouse movement in pixels: right turns right, up looks up (same feel as steering the submarine). */
export function lookWalker(walker: Walker, dx: number, dy: number): void {
  walker.yaw -= dx * config.rov.mouseSensitivity;
  walker.pitch = Math.min(land.maxPitch, Math.max(land.minPitch, walker.pitch - dy * config.rov.mouseSensitivity));
}

/**
 * Walks along the ground: WASD at walking speed, no running or jumping (D-084). A step that would end in deep water,
 * on a cliff, in a tree or a rock is tried along x and along z alone, so the player slides along what stops them.
 */
export function stepWalker(walker: Walker, input: MoveInput, dt: number): void {
  const fx = Math.sin(walker.yaw);
  const fz = Math.cos(walker.yaw);
  // Right of the facing direction, as rightVector() for the ROV.
  let dx = fx * input.forward - fz * input.strafe;
  let dz = fz * input.forward + fx * input.strafe;
  const length = Math.hypot(dx, dz);
  if (length > 0) {
    dx = (dx / length) * land.walkSpeed * dt;
    dz = (dz / length) * land.walkSpeed * dt;
    const { x, z } = walker.position;
    if (standable(x + dx, z + dz)) walker.position.set(x + dx, 0, z + dz);
    else if (dx !== 0 && standable(x + dx, z)) walker.position.set(x + dx, 0, z);
    else if (dz !== 0 && standable(x, z + dz)) walker.position.set(x, 0, z + dz);
    else walker.position.set(x, 0, z);
  }
  walker.position.y = floorHeight(walker.position.x, walker.position.z);
}

/** The player's eyes, where the first-person camera sits. */
export function eyePosition(walker: Walker, out = new Vector3()): Vector3 {
  return out.set(walker.position.x, walker.position.y + land.eyeHeight, walker.position.z);
}

/** Whether the player on foot is close enough to the floating submarine to get in (D-080). */
export function canBoard(walker: Walker, sub: Vector3): boolean {
  return Math.hypot(walker.position.x - sub.x, walker.position.z - sub.z) <= land.boardRange;
}
