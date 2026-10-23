import { config } from "../config";
import { Vector3 } from "three";
import { floorGradient, floorHeight, squareRadius, wallness } from "./terrain";

export { floorHeight, floorSlope } from "./terrain";

const { bay, station, reef, nets } = config;

export interface Rock {
  x: number;
  y: number;
  z: number;
  /** Horizontal radius; the rock is flattened to `height` vertically. */
  size: number;
  height: number;
  rotation: number;
}

/** One tier of a flat-topped boulder: an upright cylinder from `baseY` up by `height`. */
export interface Tier {
  baseY: number;
  radius: number;
  height: number;
}

/** A big flat-topped rock in two tiers, the narrower one on top (REQ-011 AC-1). */
export interface Boulder {
  x: number;
  z: number;
  tiers: readonly Tier[];
}

/**
 * A rock arch: half a ring standing on the floor. The ring's centre is at (x, y, z), a little under the floor,
 * its rock is a tube `tube` thick around a circle of `radius`, and the opening faces along (sin yaw, cos yaw).
 */
export interface Arch {
  x: number;
  y: number;
  z: number;
  yaw: number;
  radius: number;
  tube: number;
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

/** The lowest floor under a circle of `radius` around (x, z), so whatever stands there never floats. */
function lowestFloor(x: number, z: number, radius: number): number {
  let lowest = floorHeight(x, z);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    lowest = Math.min(lowest, floorHeight(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius));
  }
  return lowest;
}

function makeBoulder(spec: { x: number; z: number; radius: number; height: number }): Boulder {
  const baseY = lowestFloor(spec.x, spec.z, spec.radius) - 0.5;
  const lowerTop = floorHeight(spec.x, spec.z) + spec.height * 0.6;
  const upperRadius = spec.radius * 0.62;
  return {
    x: spec.x,
    z: spec.z,
    tiers: [
      { baseY, radius: spec.radius, height: lowerTop - baseY },
      { baseY: lowerTop - 0.05, radius: upperRadius, height: spec.height * 0.4 + 0.05 },
    ],
  };
}

export const boulders: readonly Boulder[] = bay.boulders.map(makeBoulder);

function makeArch(spec: { x: number; z: number; yaw: number; radius: number; tube: number }): Arch {
  // Both feet are buried, so the ring's centre sits under the lower one.
  const ax = Math.cos(spec.yaw);
  const az = -Math.sin(spec.yaw);
  const feet = Math.min(floorHeight(spec.x + ax * spec.radius, spec.z + az * spec.radius), floorHeight(spec.x - ax * spec.radius, spec.z - az * spec.radius));
  return { ...spec, y: Math.min(feet, floorHeight(spec.x, spec.z)) - 0.5 };
}

export const arches: readonly Arch[] = bay.arches.map(makeArch);

function makeRock(x: number, z: number, size: number, rotation: number): Rock {
  return { x, y: lowestFloor(x, z, size * 0.7) + size * 0.2, z, size, height: size * 0.6, rotation };
}

/** Places that must stay free of rocks: where the ROV starts, the station, the dock, the cave and every site. */
function keptClear(x: number, z: number, size: number): boolean {
  const { start } = config.rov;
  const near = (px: number, pz: number, distance: number) => Math.hypot(x - px, z - pz) < distance + size;
  if (near(start.x, start.z, 10)) return true;
  if (near(station.x, station.z, station.padRadius + station.padBlend + 3)) return true;
  if (near(bay.dock.x, bay.dock.z, bay.dock.clear)) return true;
  if (near(bay.cave.x, bay.cave.z, bay.cave.clear)) return true;
  const siteClear = bay.padRadius + bay.padBlend + 2;
  for (const site of [...reef.frameSites, ...reef.seagrassPatches, ...nets.sites]) if (near(site.x, site.z, siteClear)) return true;
  for (const boulder of bay.boulders) if (near(boulder.x, boulder.z, boulder.radius + 3)) return true;
  for (const arch of bay.arches) if (near(arch.x, arch.z, arch.radius + arch.tube + 3)) return true;
  return false;
}

/** Scatters the small rocks over the floor of the bay, away from the shore's shallows and the rock wall. */
function generateRocks(): Rock[] {
  const random = mulberry32(bay.rockSeed);
  const reach = bay.wall.radius - bay.wall.width - 4;
  const rocks: Rock[] = [];
  let attempts = 0;
  while (rocks.length < bay.rockCount && attempts++ < 20000) {
    const x = (random() * 2 - 1) * reach;
    const z = (random() * 2 - 1) * reach;
    const size = 1.2 + random() * 1.8;
    const rotation = random() * Math.PI;
    if (squareRadius(x, z) > reach || wallness(x, z) > 0) continue;
    if (floorHeight(x, z) > -6) continue;
    if (keptClear(x, z, size)) continue;
    if (rocks.some((other) => Math.hypot(x - other.x, z - other.z) < size + other.size + 2)) continue;
    rocks.push(makeRock(x, z, size, rotation));
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

const archPoint = new Vector3();

/** The point on the arch's core circle (upper half only) nearest to `p`, written to `archPoint`. */
function nearestOnArch(p: Vector3, arch: Arch): Vector3 {
  const ax = Math.cos(arch.yaw);
  const az = -Math.sin(arch.yaw);
  const u = (p.x - arch.x) * ax + (p.z - arch.z) * az;
  const up = p.y - arch.y;
  const angle = up >= 0 ? Math.atan2(up, u) : u >= 0 ? 0 : Math.PI;
  const along = Math.cos(angle) * arch.radius;
  return archPoint.set(arch.x + ax * along, arch.y + Math.sin(angle) * arch.radius, arch.z + az * along);
}

/** Pushes a sphere out of the arch's rock, the tube around its core circle. */
function pushOutOfArch(p: Vector3, v: Vector3, arch: Arch, radius: number): void {
  if (Math.hypot(p.x - arch.x, p.z - arch.z) > arch.radius + arch.tube + radius) return;
  const core = nearestOnArch(p, arch);
  let dx = p.x - core.x;
  let dy = p.y - core.y;
  let dz = p.z - core.z;
  const reach = arch.tube + radius;
  let d = Math.hypot(dx, dy, dz);
  if (d >= reach) return;
  if (d === 0) {
    dx = 0;
    dy = 1;
    dz = 0;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  p.set(core.x + nx * reach, core.y + ny * reach, core.z + nz * reach);
  const inward = v.x * nx + v.y * ny + v.z * nz;
  if (inward < 0) v.set(v.x - inward * nx, v.y - inward * ny, v.z - inward * nz);
}

/** An installed reef frame (REQ-004): an upright cylinder on the floor, solid for the ROV like the station. */
export interface FrameColumn {
  x: number;
  z: number;
  baseY: number;
  radius: number;
  height: number;
}

let frameColumns: readonly FrameColumn[] = [];

/** Replaces the list of installed frames the ROV cannot pass through. */
export function setFrameColumns(columns: readonly FrameColumn[]): void {
  frameColumns = columns;
}

/** REQ-016: the posts the dock's deck stands on, from the floor up through the surface; solid for the submarine. */
export interface DockPost {
  x: number;
  z: number;
  baseY: number;
  radius: number;
  height: number;
}

function dockPosts(): DockPost[] {
  const { dock } = bay;
  const posts: DockPost[] = [];
  for (let x = dock.landX + 1; x <= dock.seaX; x += 3) {
    for (const side of [-1, 1]) {
      const z = dock.z + side * dock.halfWidth;
      const baseY = floorHeight(x, z) - 0.5;
      posts.push({ x, z, baseY, radius: 0.16, height: dock.deckY - baseY });
    }
  }
  return posts;
}

export const posts: readonly DockPost[] = dockPosts();

/**
 * Where the water is too shallow for a sphere of `radius` (the shore and the rock walls rise to and above the
 * surface), moves it sideways downhill until it fits, and stops its motion uphill.
 */
function keepInDeepEnoughWater(p: Vector3, v: Vector3, radius: number): void {
  const limit = bay.surfaceY - 2 * radius - (radius > 0 ? 0.4 : 0);
  let moved = false;
  let gx = 0;
  let gz = 0;
  for (let i = 0; i < 6; i++) {
    const excess = floorHeight(p.x, p.z) - limit;
    if (excess <= 0) break;
    const g = floorGradient(p.x, p.z);
    const slope = Math.hypot(g.x, g.z);
    if (slope < 1e-3) break;
    gx = g.x / slope;
    gz = g.z / slope;
    const step = excess / slope + 0.05;
    p.x -= gx * step;
    p.z -= gz * step;
    moved = true;
  }
  if (!moved) return;
  const uphill = v.x * gx + v.z * gz;
  if (uphill > 0) {
    v.x -= uphill * gx;
    v.z -= uphill * gz;
  }
}

/** Pushes a sphere out of the floor along the floor's normal, so it slides along slopes and walls. */
function pushOutOfFloor(p: Vector3, v: Vector3, radius: number): void {
  const h = floorHeight(p.x, p.z);
  if (p.y - h >= radius + 4) return;
  const g = floorGradient(p.x, p.z);
  const length = Math.hypot(g.x, 1, g.z);
  const nx = -g.x / length;
  const ny = 1 / length;
  const nz = -g.z / length;
  const distance = (p.y - h) * ny;
  if (distance < radius) {
    const push = radius - distance;
    p.set(p.x + nx * push, p.y + ny * push, p.z + nz * push);
    const inward = v.x * nx + v.y * ny + v.z * nz;
    if (inward < 0) v.set(v.x - inward * nx, v.y - inward * ny, v.z - inward * nz);
  }
  const floor = floorHeight(p.x, p.z) + radius;
  if (p.y < floor) {
    p.y = floor;
    if (v.y < 0) v.y = 0;
  }
}

/**
 * Keeps a sphere of `radius` inside the water: above the floor and below the surface, out of the shore's
 * shallows and the rock walls, and outside every rock, boulder, arch, the dock's posts (REQ-016) and the
 * installed frames. Velocity into a limit is removed, so the ROV stops there (REQ-001 AC-4, REQ-011 AC-3).
 */
export function constrainToBay(p: Vector3, v: Vector3, radius: number = config.rov.radius): void {
  for (const rock of rocks) pushOutOfRock(p, v, rock, radius);
  for (const boulder of boulders) for (const tier of boulder.tiers) pushOutOfCylinder(p, v, boulder.x, boulder.z, tier.baseY, tier, radius);
  for (const arch of arches) pushOutOfArch(p, v, arch, radius);
  for (const post of posts) pushOutOfCylinder(p, v, post.x, post.z, post.baseY, post, radius);
  for (const frame of frameColumns) pushOutOfCylinder(p, v, frame.x, frame.z, frame.baseY, frame, radius);

  keepInDeepEnoughWater(p, v, radius);
  pushOutOfFloor(p, v, radius);
  keepInDeepEnoughWater(p, v, radius);

  const ceiling = bay.surfaceY - radius;
  if (p.y > ceiling) {
    p.y = ceiling;
    if (v.y > 0) v.y = 0;
  }
  // The terrain mesh ends here; the walls and the land stop everything long before (no invisible wall).
  const edge = bay.halfSize - 2;
  p.x = Math.min(edge, Math.max(-edge, p.x));
  p.z = Math.min(edge, Math.max(-edge, p.z));
}

function insideCylinder(x: number, y: number, z: number, cx: number, cz: number, baseY: number, cylinder: { radius: number; height: number }, margin: number): boolean {
  return y > baseY - margin && y < baseY + cylinder.height + margin && Math.hypot(x - cx, z - cz) < cylinder.radius + margin;
}

const probe = new Vector3();

/** True when a sphere of `margin` at (x, y, z) is inside a rock, a boulder or an arch. */
export function insideRockAt(x: number, y: number, z: number, margin = 0): boolean {
  for (const rock of rocks) {
    const rx = rock.size + margin;
    const ry = rock.height + margin;
    const dx = (x - rock.x) / rx;
    const dy = (y - rock.y) / ry;
    const dz = (z - rock.z) / rx;
    if (dx * dx + dy * dy + dz * dz < 1) return true;
  }
  for (const boulder of boulders) for (const tier of boulder.tiers) if (insideCylinder(x, y, z, boulder.x, boulder.z, tier.baseY, tier, margin)) return true;
  for (const arch of arches) {
    if (Math.hypot(x - arch.x, z - arch.z) > arch.radius + arch.tube + margin) continue;
    if (nearestOnArch(probe.set(x, y, z), arch).distanceTo(probe) < arch.tube + margin) return true;
  }
  return false;
}

/**
 * True when a sphere of `margin` at (x, y, z) touches the land or the floor, or is inside a rock, a boulder or
 * an arch: what blocks the camera (REQ-011 AC-4) and a line of sight (the cutter, the scanner).
 */
export function terrainSolidAt(x: number, y: number, z: number, margin = 0): boolean {
  return y < floorHeight(x, z) + margin || insideRockAt(x, y, z, margin);
}

/** True when a point is inside the terrain, a rock, a dock post, an installed frame, or above the water (a shot ends there). */
export function isSolidAt(x: number, y: number, z: number): boolean {
  if (y > bay.surfaceY) return true;
  if (terrainSolidAt(x, y, z)) return true;
  if (posts.some((post) => insideCylinder(x, y, z, post.x, post.z, post.baseY, post, 0))) return true;
  return frameColumns.some((frame) => insideCylinder(x, y, z, frame.x, frame.z, frame.baseY, frame, 0));
}

/** True when the floor at (x, z) is under water at least `depth` deep: what the ROV can reach, roughly. */
export function underWater(x: number, z: number, depth = 0): boolean {
  return floorHeight(x, z) < bay.surfaceY - depth;
}

