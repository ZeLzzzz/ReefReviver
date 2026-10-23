import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight, floorSlope } from "./bay";
import type { MoveInput } from "./rov";
import { inland, wallness } from "./terrain";

const { land, bay, station } = config;
const { shore, dock } = bay;

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

/** Palm trunks, rocks, and the sorting bins beside the shed's counter (REQ-016). */
export const landObstacles: readonly LandObstacle[] = [
  ...land.palms.map((palm) => ({ x: palm.x, z: palm.z, radius: 0.3 })),
  ...land.rocks.map((rock) => ({ x: rock.x, z: rock.z, radius: rock.radius })),
  { x: station.x + station.halfX + 0.6, z: station.z + station.halfZ - 1.25, radius: 1.1 },
];

/** REQ-016 AC-7: inside the recycling shed's walls (grown by `margin`). */
export function insideShed(x: number, z: number, margin = 0): boolean {
  return Math.abs(x - station.x) < station.halfX + margin && Math.abs(z - station.z) < station.halfZ + margin;
}

/** REQ-016: on the dock's deck, which the player can walk out on over the water. */
export function onDock(x: number, z: number): boolean {
  return x >= dock.landX && x <= dock.seaX && Math.abs(z - dock.z) <= dock.halfWidth;
}

/** The height the player's feet rest at: the ground, or the dock's deck where it is higher. */
export function groundHeight(x: number, z: number): number {
  const floor = floorHeight(x, z);
  return onDock(x, z) ? Math.max(floor, bay.surfaceY + dock.deckY) : floor;
}

/**
 * True where a walking player can stand: on the dock, or ground no deeper than wading depth, not too steep, not the
 * rock wall, clear of the shed, the trees and the rocks.
 */
export function standable(x: number, z: number): boolean {
  const edge = bay.halfSize - 2;
  if (Math.abs(x) > edge || Math.abs(z) > edge) return false;
  if (insideShed(x, z, land.radius)) return false;
  if (onDock(x, z)) return true;
  if (floorHeight(x, z) < bay.surfaceY - land.wadeDepth) return false;
  if (floorSlope(x, z) > land.maxSlope || wallness(x, z) > 0.3) return false;
  return !landObstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + land.radius);
}

/**
 * Whether the submarine at (x, z) is close enough to the west shore to go ashore (within `ashoreRange` of the
 * waterline, on the open beach between the rock walls), and if so where the player lands and the submarine is left.
 */
export function ashoreSpot(x: number, z0: number): AshoreSpot | null {
  if (Math.abs(z0) > shore.openHalf - 20) return null;
  // Beside the dock, never under it (REQ-016): the submarine comes alongside, and the player lands level with it.
  const clearOfDock = dock.halfWidth + land.dockGap;
  const z = Math.abs(z0 - dock.z) < clearOfDock ? dock.z + (z0 >= dock.z ? clearOfDock : -clearOfDock) : z0;
  const s = inland(x, z0);
  if (s > 0 || s < -land.ashoreRange) return null;
  // The waterline where the player lands, which may be a little to the side of the submarine (beside the dock).
  const waterline = x + inland(x, z);
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
  return { position: new Vector3(x, groundHeight(x, z), z), yaw, pitch: 0 };
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
  walker.position.y = groundHeight(walker.position.x, walker.position.z);
}

/** The player's eyes, where the first-person camera sits. */
export function eyePosition(walker: Walker, out = new Vector3()): Vector3 {
  return out.set(walker.position.x, walker.position.y + land.eyeHeight, walker.position.z);
}

/** Whether the player on foot is close enough to the floating submarine to get in (D-080). */
export function canBoard(walker: Walker, sub: Vector3): boolean {
  return Math.hypot(walker.position.x - sub.x, walker.position.z - sub.z) <= land.boardRange;
}
