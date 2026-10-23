import { Vector3 } from "three";
import { config } from "../config";
import { bendAt, farFromCave, halfWidthAt, massifRise, roofAbove, smooth } from "./cave-shape";
import { floorHeight } from "./terrain";

// REQ-014: the cave. The rock massif stands on the sea floor like a heightfield with a roof: in every column (x, z) the
// floor is at `floor`, the air under the tunnel's roof reaches `roof`, the rock lies between `roof` and `top`, and
// above `top` it is open water again. Where there is no tunnel, `roof` is the floor: the rock is solid to `top`.
// The same functions give the meshes (cave-model.ts), what stops the vehicle, the camera and the tools, and the
// darkness, so they always agree.

const { cave } = config.bay;

/** What an "inside rock" estimate returns far from any rock. */
const FAR = 99;
/** Below this the air under the roof is too thin to count as a tunnel: the column is solid rock up to its top. */
const MIN_GAP = 0.05;
/** The step for the slopes of the rock's surfaces, in metres. */
const SLOPE_STEP = 0.2;

/** One column of the cave: where the floor, the roof's underside and the massif's top are, and how thick the roof is. */
export interface Column {
  floor: number;
  roof: number;
  top: number;
}

const probeColumn: Column = { floor: 0, roof: 0, top: 0 };

export function caveColumn(x: number, z: number, out: Column = probeColumn): Column {
  const a = x - cave.x;
  const floor = floorHeight(x, z);
  out.floor = floor;
  out.roof = floor + roofAbove(a, z - cave.z - bendAt(a));
  out.top = floor + massifRise(x, z);
  return out;
}

const lower = new Vector3();
const here: Column = { floor: 0, roof: 0, top: 0 };
const east: Column = { floor: 0, roof: 0, top: 0 };
const west: Column = { floor: 0, roof: 0, top: 0 };
const south: Column = { floor: 0, roof: 0, top: 0 };
const north: Column = { floor: 0, roof: 0, top: 0 };

/**
 * How far (m, an estimate good to the first order: the height gap divided by the slope) the point is from the
 * cave's rock; negative inside it, `FAR` when there is none about. Writes the direction away from the rock to `normal`.
 */
export function caveDistance(x: number, y: number, z: number, normal: Vector3 = lower): number {
  normal.set(0, 1, 0);
  if (farFromCave(x, z, 1)) return FAR;
  const column = caveColumn(x, z, here);
  if (column.top - column.floor <= 0.02) return FAR;
  const hollow = column.roof - column.floor > MIN_GAP;
  // Open water over a roof that is gone (the mouths): no rock here.
  if (hollow && column.top <= column.roof) return FAR;
  const underside = hollow && column.roof - y >= y - column.top;
  const gap = underside ? column.roof - y : y - column.top;
  if (gap > 6) {
    normal.set(0, underside ? -1 : 1, 0);
    return gap;
  }
  caveColumn(x + SLOPE_STEP, z, east);
  caveColumn(x - SLOPE_STEP, z, west);
  caveColumn(x, z + SLOPE_STEP, south);
  caveColumn(x, z - SLOPE_STEP, north);
  const key = underside ? "roof" : "top";
  const gx = (east[key] - west[key]) / (2 * SLOPE_STEP);
  const gz = (south[key] - north[key]) / (2 * SLOPE_STEP);
  // The surface y = f(x, z): the rock is above f on the underside and below it on the top.
  if (underside) normal.set(gx, -1, gz);
  else normal.set(-gx, 1, -gz);
  const length = normal.length();
  normal.divideScalar(length);
  return gap / length;
}

/** True when a sphere of `margin` at (x, y, z) touches the cave's rock: what stops the camera, the cutter and the shots. */
export function caveSolidAt(x: number, y: number, z: number, margin = 0): boolean {
  return caveDistance(x, y, z) < margin;
}

const push = new Vector3();

/**
 * Pushes a sphere out of the cave's rock, the walls and roof, along their normals, and takes away the velocity
 * that pointed into them, so the vehicle stops there instead of passing through (REQ-014 AC-5). The roof's hole is
 * not an opening for it: it is narrower than the vehicle, so it is left sealed.
 */
export function pushOutOfCave(p: Vector3, v: Vector3, radius: number): void {
  if (farFromCave(p.x, p.z, radius)) return;
  for (let i = 0; i < 3; i++) {
    const d = caveDistance(p.x, p.y, p.z, push);
    if (d >= radius) return;
    p.addScaledVector(push, radius - d);
    const inward = v.dot(push);
    if (inward < 0) v.addScaledVector(push, -inward);
  }
}

/**
 * How deep in the cave a point is, 0 (outside) to 1: under the roof of the tunnel, fading in over the first metre or
 * so of roof at the mouths and next to the walls. It drives the darkness and the vehicle's lamp.
 */
export function caveLevel(x: number, y: number, z: number): number {
  if (farFromCave(x, z)) return 0;
  const column = caveColumn(x, z, here);
  const gap = column.roof - column.floor;
  const thick = column.top - column.roof;
  if (gap < 0.3 || thick <= 0 || y >= column.roof) return 0;
  return smooth(0, 1.2, thick) * smooth(0.3, 1, gap);
}

/** The vehicle's lamp: lit once the cave level reaches `lampOn`, and kept lit until it falls under `lampOff`. */
export function caveLamp(lit: boolean, level: number): boolean {
  return lit ? level >= cave.lamp.lampOff : level >= cave.lamp.lampOn;
}

/** A point on the tunnel's centre line, at flying height. */
export interface PathPoint {
  x: number;
  y: number;
  z: number;
}

/** How high above the floor a vehicle flies through the tunnel's middle, in metres. */
export const FLY_HEIGHT = 1.9;

function centre(a: number): PathPoint {
  const x = cave.x + a;
  const z = cave.z + bendAt(a);
  return { x, y: floorHeight(x, z) + FLY_HEIGHT, z };
}

/** The roof's thickness (m) over the tunnel's centre line `a` metres east of the cave's centre. */
function roofThickness(a: number): number {
  const x = cave.x + a;
  const z = cave.z + bendAt(a);
  const floor = floorHeight(x, z);
  return floor + massifRise(x, z) - (floor + roofAbove(a, 0));
}

function findMouths(): { west: number; east: number } {
  let first: number | null = null;
  let last: number | null = null;
  for (let a = -cave.halfLength; a <= cave.halfLength; a += 0.05) {
    if (roofThickness(a) < cave.mouthRoof) continue;
    first ??= a;
    last = a;
  }
  if (first === null || last === null) throw new Error("the cave has no roof");
  return { west: first, east: last };
}

const mouthA = findMouths();

/** The cave as the rest of the game sees it. */
export interface CaveInfo {
  /** The two mouths, west then east, at flying height: the first point of the tunnel with a roof over it. */
  mouths: [PathPoint, PathPoint];
  /** The tunnel's length between its mouths along its centre line, in metres. */
  length: number;
  /** The centre line from one mouth to the other, every metre or so, at flying height. */
  path: PathPoint[];
  /** The roof hole: its centre (x, z), where the roof's underside and the massif's top are above it, and its radius. */
  hole: { x: number; z: number; under: number; top: number; radius: number };
}

function buildInfo(): CaveInfo {
  const path: PathPoint[] = [];
  let length = 0;
  let previous = centre(mouthA.west);
  path.push(previous);
  const steps = Math.ceil(mouthA.east - mouthA.west);
  for (let i = 1; i <= steps; i++) {
    const point = centre(mouthA.west + ((mouthA.east - mouthA.west) * i) / steps);
    length += Math.hypot(point.x - previous.x, point.z - previous.z);
    path.push(point);
    previous = point;
  }
  const x = cave.x;
  const z = cave.z + bendAt(0);
  const floor = floorHeight(x, z);
  return {
    mouths: [path[0], path[path.length - 1]],
    length,
    path,
    hole: { x, z, under: floor + roofAbove(0, 0), top: floor + massifRise(x, z), radius: cave.hole.radius },
  };
}

export const caveInfo: CaveInfo = buildInfo();

/** True when a point is within the tunnel's mouths along its length and under its roof: in the cave. */
export function inCave(x: number, y: number, z: number): boolean {
  return caveLevel(x, y, z) >= cave.lamp.lampOn;
}

/**
 * Where about 6 pieces of trash lie on the tunnel floor in one dive (D-074): `trash.groups` small groups, each in its
 * own part of the tunnel, spaced `spacing` apart, in the middle of the floor where the roof is high.
 */
export function caveTrashSpots(random: () => number, spacing: number): { x: number; z: number }[] {
  const { groups, groupSize, groupRadius, edgeGap } = cave.trash;
  const from = mouthA.west + edgeGap;
  const to = mouthA.east - edgeGap;
  const spots: { x: number; z: number }[] = [];
  const place = (a: number, u: number) => ({ x: cave.x + a, z: cave.z + bendAt(a) + u });
  for (let g = 0; g < groups; g++) {
    const sectionFrom = from + ((to - from) * g) / groups;
    const sectionTo = from + ((to - from) * (g + 1)) / groups;
    const centreA = sectionFrom + (sectionTo - sectionFrom) * (0.2 + 0.6 * random());
    const centreU = (random() * 2 - 1) * 0.35 * halfWidthAt(centreA);
    let placed = 0;
    for (let tries = 0; placed < groupSize && tries < 200; tries++) {
      const angle = random() * Math.PI * 2;
      const distance = tries === 0 ? 0 : Math.sqrt(random()) * groupRadius;
      const a = centreA + Math.cos(angle) * distance;
      const u = centreU + Math.sin(angle) * distance;
      if (a < from || a > to || Math.abs(u) > 0.55 * halfWidthAt(a)) continue;
      const spot = place(a, u);
      if (spots.some((other) => Math.hypot(spot.x - other.x, spot.z - other.z) < spacing)) continue;
      spots.push(spot);
      placed += 1;
    }
    // Whatever the random stream gave, a group is always complete: fill it along the tunnel's floor, a step at a time.
    for (let k = 1; placed < groupSize && k < 60; k++) {
      const a = centreA + Math.ceil(k / 2) * spacing * 1.1 * (k % 2 === 0 ? -1 : 1);
      if (a < from || a > to) continue;
      const spot = place(a, centreU);
      if (Math.abs(centreU) > 0.55 * halfWidthAt(a) || spots.some((other) => Math.hypot(spot.x - other.x, spot.z - other.z) < spacing)) continue;
      spots.push(spot);
      placed += 1;
    }
  }
  return spots;
}
