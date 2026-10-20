import { config } from "../config";
import type { Vector3 } from "three";

const { bay } = config;

function naturalFloorHeight(x: number, z: number): number {
  const towardSouth = (z / bay.boundaryRadius) * bay.southSlope;
  const bumps = 0.9 * Math.sin(x * 0.11) * Math.cos(z * 0.09) + 0.5 * Math.sin(x * 0.23 + z * 0.19);
  return bay.floorDepth - towardSouth + bumps;
}

const { station } = config;
const stationFloor = naturalFloorHeight(station.x, station.z);

/**
 * Height of the sea floor at (x, z). Shared by the floor mesh and collision, so they always agree.
 * It is level around the recycling station, so the deposit zone sits flat on the floor.
 */
export function floorHeight(x: number, z: number): number {
  const natural = naturalFloorHeight(x, z);
  const distance = Math.hypot(x - station.x, z - station.z);
  if (distance >= station.padRadius + station.padBlend) return natural;
  const k = Math.min(1, Math.max(0, (distance - station.padRadius) / station.padBlend));
  const blend = k * k * (3 - 2 * k);
  return stationFloor + (natural - stationFloor) * blend;
}

/** Distance from the bay's centre to the cliff face at this angle and height; never closer than cliffRadius - cliffJag. */
export function cliffFaceRadius(angle: number, y: number): number {
  const jag = 0.5 * Math.sin(angle * 9 + y * 0.35) + 0.3 * Math.sin(angle * 23 - y * 0.8) + 0.2 * Math.sin(angle * 41 + y * 1.7);
  return bay.cliffRadius + bay.cliffJag * jag;
}

export interface Rock {
  x: number;
  y: number;
  z: number;
  /** Horizontal radius; the rock is flattened to `height` vertically. */
  size: number;
  height: number;
  rotation: number;
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

function makeRock(x: number, z: number, size: number, rotation: number): Rock {
  return { x, y: floorHeight(x, z) + size * 0.2, z, size, height: size * 0.6, rotation };
}

function generateRocks(): Rock[] {
  const random = mulberry32(bay.rockSeed);
  const { start } = config.rov;
  const rocks: Rock[] = [];
  while (rocks.length < bay.rockCount) {
    const angle = random() * Math.PI * 2;
    const distance = 10 + random() * (bay.boundaryRadius - 14);
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    // Keep the start position clear.
    if (Math.hypot(x - start.x, z - start.z) < 8) continue;
    rocks.push(makeRock(x, z, 1.2 + random() * 1.8, random() * Math.PI));
  }
  return rocks;
}

export const rocks: readonly Rock[] = generateRocks();

function pushOutOfRock(p: Vector3, v: Vector3, rock: Rock, radius: number): void {
  // Treat the rock as an ellipsoid grown by the ROV's radius.
  const rx = rock.size + radius;
  const ry = rock.height + radius;
  const dx = (p.x - rock.x) / rx;
  const dy = (p.y - rock.y) / ry;
  const dz = (p.z - rock.z) / rx;
  const d = Math.hypot(dx, dy, dz);
  if (d >= 1 || d === 0) return;
  p.set(rock.x + (dx / d) * rx, rock.y + (dy / d) * ry, rock.z + (dz / d) * rx);
  // Remove the velocity component pointing into the rock.
  const nx = dx / rx;
  const ny = dy / ry;
  const nz = dz / rx;
  const length = Math.hypot(nx, ny, nz);
  const inward = (v.x * nx + v.y * ny + v.z * nz) / length;
  if (inward < 0) v.set(v.x - (inward * nx) / length, v.y - (inward * ny) / length, v.z - (inward * nz) / length);
}

/** Pushes a sphere out of an upright cylinder standing on the floor at `baseY`: sideways, or onto its top if that is closer. */
function pushOutOfCylinder(p: Vector3, v: Vector3, x: number, z: number, baseY: number, cylinder: { radius: number; height: number }, radius: number): void {
  const top = baseY + cylinder.height;
  if (p.y >= top + radius || p.y <= baseY - radius) return;
  const dx = p.x - x;
  const dz = p.z - z;
  const distance = Math.hypot(dx, dz);
  const reach = cylinder.radius + radius;
  if (distance >= reach) return;
  if (top + radius - p.y < reach - distance || distance === 0) {
    p.y = top + radius;
    if (v.y < 0) v.y = 0;
    return;
  }
  const nx = dx / distance;
  const nz = dz / distance;
  p.x = x + nx * reach;
  p.z = z + nz * reach;
  const inward = v.x * nx + v.z * nz;
  if (inward < 0) {
    v.x -= inward * nx;
    v.z -= inward * nz;
  }
}

/**
 * Keeps a sphere of `radius` inside the water: above the floor, below the surface, within the bay
 * boundary and outside every rock and the recycling station (D-041). Velocity into a limit is removed,
 * so the ROV stops there (REQ-001 AC-4).
 */
export function constrainToBay(p: Vector3, v: Vector3, radius: number = config.rov.radius): void {
  for (const rock of rocks) pushOutOfRock(p, v, rock, radius);
  pushOutOfCylinder(p, v, station.x, station.z, stationFloor, station.body, radius);
  pushOutOfCylinder(p, v, station.x + station.mast.dx, station.z + station.mast.dz, stationFloor, station.mast, radius);

  const distance = Math.hypot(p.x, p.z);
  if (distance > bay.boundaryRadius) {
    const nx = p.x / distance;
    const nz = p.z / distance;
    p.x = nx * bay.boundaryRadius;
    p.z = nz * bay.boundaryRadius;
    const outward = v.x * nx + v.z * nz;
    if (outward > 0) {
      v.x -= outward * nx;
      v.z -= outward * nz;
    }
  }

  const floor = floorHeight(p.x, p.z) + radius;
  if (p.y < floor) {
    p.y = floor;
    if (v.y < 0) v.y = 0;
  }
  const ceiling = bay.surfaceY - radius;
  if (p.y > ceiling) {
    p.y = ceiling;
    if (v.y > 0) v.y = 0;
  }
}
