import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight, rocks } from "./bay";
import type { Net } from "./nets";

const { cutter } = config;

export interface Sphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface NetHit {
  net: Net;
  /** Where the ray meets the net. */
  point: Vector3;
}

/** How finely the ray is walked to find the floor; a net is bigger than this, so no net slips through. */
const FLOOR_STEP = 0.25;

/**
 * Where the ray (`dir` is a unit vector) first enters or leaves an ellipsoid of half-sizes `radii` centred at
 * `centre`, turned by `yaw` around the vertical, or null. `domeOnly` keeps only hits on the upper half.
 * Returns the distance along the ray.
 */
function rayEllipsoid(origin: Vector3, dir: Vector3, centre: Vector3, radii: Vector3, yaw: number, domeOnly: boolean): number | null {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Into the ellipsoid's own frame, scaled so it becomes the unit sphere.
  const ox = origin.x - centre.x;
  const oy = origin.y - centre.y;
  const oz = origin.z - centre.z;
  const px = (ox * cos - oz * sin) / radii.x;
  const py = oy / radii.y;
  const pz = (ox * sin + oz * cos) / radii.z;
  const vx = (dir.x * cos - dir.z * sin) / radii.x;
  const vy = dir.y / radii.y;
  const vz = (dir.x * sin + dir.z * cos) / radii.z;
  const a = vx * vx + vy * vy + vz * vz;
  const b = px * vx + py * vy + pz * vz;
  const c = px * px + py * py + pz * pz - 1;
  const discriminant = b * b - a * c;
  if (discriminant < 0 || a === 0) return null;
  const root = Math.sqrt(discriminant);
  for (const t of [(-b - root) / a, (-b + root) / a]) {
    if (t <= 0) continue;
    if (domeOnly && py + t * vy < 0) continue;
    return t;
  }
  return null;
}

const tmpCentre = new Vector3();
const tmpRadii = new Vector3();

function raySphere(origin: Vector3, dir: Vector3, sphere: Sphere): number | null {
  tmpCentre.set(sphere.x, sphere.y, sphere.z);
  tmpRadii.set(sphere.r, sphere.r, sphere.r);
  return rayEllipsoid(origin, dir, tmpCentre, tmpRadii, 0, false);
}

/**
 * The net the crosshair points at: the first thing the ray from `origin` along `dir` meets must be a net,
 * and the spot must be within the cutter's range of the ROV. If the first thing is an animal, trash, a rock
 * or the floor (`blockers` are spheres for animals and trash), nothing is hit (AC-5).
 */
export function aimedNet(origin: Vector3, dir: Vector3, rov: Vector3, nets: readonly Net[], blockers: readonly Sphere[]): NetHit | null {
  let net: Net | null = null;
  let distance = Infinity;
  for (const candidate of nets) {
    if (candidate.cut) continue;
    tmpRadii.set(candidate.width, candidate.height, candidate.length);
    const t = rayEllipsoid(origin, dir, candidate.center, tmpRadii, candidate.yaw, true);
    if (t !== null && t < distance) {
      net = candidate;
      distance = t;
    }
  }
  if (!net) return null;

  const point = new Vector3().copy(dir).multiplyScalar(distance).add(origin);
  if (point.distanceTo(rov) > cutter.range) return null;

  for (const blocker of blockers) {
    const t = raySphere(origin, dir, blocker);
    if (t !== null && t < distance) return null;
  }
  for (const rock of rocks) {
    tmpCentre.set(rock.x, rock.y, rock.z);
    tmpRadii.set(rock.size, rock.height, rock.size);
    const t = rayEllipsoid(origin, dir, tmpCentre, tmpRadii, 0, false);
    if (t !== null && t < distance) return null;
  }
  for (let t = FLOOR_STEP; t < distance; t += FLOOR_STEP) {
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    if (origin.y + dir.y * t < floorHeight(x, z)) return null;
  }
  return { net, point };
}

/**
 * The cutter's progress on one net (AC-1, AC-4). Holding the button while aimed at the same net fills it over
 * `cutter.seconds`; letting go, or aiming away, empties it at once and the net stays whole.
 */
export class Cutter {
  private seconds = 0;
  private target: number | null = null;

  /** 0..1 */
  get progress(): number {
    return Math.min(1, this.seconds / cutter.seconds);
  }

  /** Advances by `dt`. Returns the id of the net that was just cut, or null. */
  update(dt: number, firing: boolean, aimedAt: number | null): number | null {
    if (!firing || aimedAt === null) {
      this.reset();
      return null;
    }
    if (aimedAt !== this.target) {
      this.target = aimedAt;
      this.seconds = 0;
    }
    this.seconds += dt;
    if (this.seconds < cutter.seconds) return null;
    this.reset();
    return aimedAt;
  }

  reset(): void {
    this.seconds = 0;
    this.target = null;
  }
}
