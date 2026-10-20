import type { Vector3 } from "three";
import { config } from "../config";
import { floorHeight } from "./bay";

const { station } = config;

/** The recycling station's centre on the floor (D-011). */
export const stationPosition = { x: station.x, y: floorHeight(station.x, station.z), z: station.z } as const;

/** True when `p` is inside the deposit zone: a circle on the floor, open upward to `zoneHeight`. */
export function inStationZone(p: Vector3): boolean {
  if (Math.hypot(p.x - stationPosition.x, p.z - stationPosition.z) > station.zoneRadius) return false;
  return p.y <= stationPosition.y + station.zoneHeight;
}

/** Straight-line distance on the ground plane from `p` to the station, in metres. */
export function distanceToStation(p: Vector3): number {
  return Math.hypot(p.x - stationPosition.x, p.z - stationPosition.z);
}
