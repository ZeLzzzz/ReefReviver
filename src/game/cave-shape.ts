import { config } from "../config";

// The cave's shape that does not depend on the sea floor (REQ-014): the tunnel's centre line, width and height, and
// the rock massif's rise. terrain.ts levels the floor with it, and cave.ts builds the solid rock from it. Heights
// here are above the floor, so the rock follows the floor wherever it is.

const { cave } = config.bay;
const { tunnel } = cave;

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** 0 at `edge0`, 1 at `edge1` (either order), smooth between. */
export function smooth(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A round bump: 1 at the centre, 0 from |t| = 1 on. */
function bump(t: number): number {
  return Math.abs(t) >= 1 ? 0 : (1 - t * t) ** 2;
}

/** How far the tunnel's centre line is north or south of the cave's centre, `a` metres along it (east of the centre). */
export function bendAt(a: number): number {
  return tunnel.bend * Math.sin((a / tunnel.bendPeriod) * Math.PI * 2);
}

/** Half the tunnel's width at `a`: wider in the middle chamber, and a little uneven all along. */
export function halfWidthAt(a: number): number {
  return tunnel.halfWidth + tunnel.chamberHalfWidth * bump(a / tunnel.chamberHalf) + 0.3 * Math.sin(a * 0.45 + 0.5);
}

/** The tunnel's height at `a`: taller in the middle chamber, and a little uneven all along. */
export function heightAt(a: number): number {
  return tunnel.height + tunnel.chamberHeight * bump(a / tunnel.chamberHalf) + 0.35 * Math.sin(a * 0.37 + 1);
}

/** How high the tunnel's roof is above the floor, `u` metres sideways of the centre line: an arch, 0 at the walls. */
export function roofAbove(a: number, u: number): number {
  const half = halfWidthAt(a);
  if (Math.abs(u) >= half) return 0;
  return heightAt(a) * Math.sqrt(1 - (u / half) ** 2) * (1 + 0.05 * Math.sin(1.3 * a + 2.1 * u));
}

/** How far the rock massif's top stands above the floor at (x, z): 0 off the mound, `rise` on its plateau. */
export function massifRise(x: number, z: number): number {
  const ra = (x - cave.x) / cave.halfLength;
  const rb = (z - cave.z) / cave.halfWidth;
  const angle = Math.atan2(rb, ra);
  // An uneven rim, so the mound is not a clean oval.
  const radius = Math.hypot(ra, rb) * (1 + 0.07 * Math.sin(3 * angle + 0.5) + 0.04 * Math.sin(5 * angle - 1));
  const k = smooth(1, cave.plateau, radius);
  if (k === 0) return 0;
  const lumps = 0.5 * Math.sin(0.31 * x + 0.17 * z + 1) + 0.5 * Math.sin(0.23 * x - 0.29 * z);
  return (cave.rise + cave.lumps * lumps) * k;
}

/** How far (m) from the cave's centre the massif can reach each way along x and along z: outside, nothing is cave. */
export const reachX = cave.halfLength / 0.89 + 1;
export const reachZ = cave.halfWidth / 0.89 + 1;

/** True when (x, z) is far enough from the cave that none of it, nor its light, can be near (`margin` more). */
export function farFromCave(x: number, z: number, margin = 0): boolean {
  return Math.abs(x - cave.x) > reachX + margin || Math.abs(z - cave.z) > reachZ + margin;
}

/**
 * How much of the natural floor at (x, z) is replaced by the tunnel's level floor (REQ-014): 1 along the tunnel,
 * falling to 0 beyond its walls and past its ends.
 */
export function caveFloorWeight(x: number, z: number): number {
  const a = x - cave.x;
  if (Math.abs(a) > cave.floorHalf + cave.floorBlend) return 0;
  const u = z - cave.z - bendAt(a);
  const half = halfWidthAt(a);
  return (1 - smooth(half + 0.5, half + 5.5, Math.abs(u))) * (1 - smooth(cave.floorHalf, cave.floorHalf + cave.floorBlend, Math.abs(a)));
}
