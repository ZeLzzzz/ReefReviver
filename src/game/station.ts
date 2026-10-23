import type { Vector3 } from "three";
import { config } from "../config";
import { floorHeight } from "./bay";

const { station, bay } = config;

/** REQ-016: the recycling shed's centre on the (levelled) ground of the land (D-078). */
export const stationPosition = { x: station.x, y: floorHeight(station.x, station.z), z: station.z } as const;

/** The counter's zone: a circle on the ground in front of the shed's east wall, facing the sea. */
export const counterPosition = { x: station.x + station.zoneDx, z: station.z } as const;

/** True when `p` (the player's feet) is in the counter's zone on the land. Nothing under the water ever is (AC-4). */
export function inStationZone(p: Vector3): boolean {
  if (p.y < bay.surfaceY - 1) return false;
  return Math.hypot(p.x - counterPosition.x, p.z - counterPosition.z) <= station.zoneRadius;
}

/** Straight-line distance on the ground plane from `p` to the shed, in metres. */
export function distanceToStation(p: Vector3): number {
  return Math.hypot(p.x - stationPosition.x, p.z - stationPosition.z);
}
