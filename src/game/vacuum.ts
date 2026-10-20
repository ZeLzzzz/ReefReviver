import { Vector3 } from "three";
import { config } from "../config";

const { vacuum } = config;
const COS_CONE = Math.cos(vacuum.coneHalfAngle);

type Point = { x: number; y: number; z: number };

const offset = new Vector3();

/** Whether a point lies within the vacuum's range and cone around `aim` (a unit vector) from `origin`. */
export function inVacuumCone(origin: Vector3, aim: Vector3, point: Point): boolean {
  offset.set(point.x - origin.x, point.y - origin.y, point.z - origin.z);
  const distance = offset.length();
  if (distance > vacuum.range) return false;
  if (distance < 1e-6) return true;
  return offset.dot(aim) / distance >= COS_CONE;
}

/**
 * Index of the nearest candidate inside the cone, or -1. Callers pass trash positions and nothing else,
 * so rocks, animals and coral can never be sucked (AC-7).
 */
export function pickNearestInCone(origin: Vector3, aim: Vector3, candidates: readonly Point[]): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!inVacuumCone(origin, aim, c)) continue;
    const distance = Math.hypot(c.x - origin.x, c.y - origin.y, c.z - origin.z);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}
