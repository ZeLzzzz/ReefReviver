import { config } from "../config";
import { caveFloorWeight } from "./cave-shape";
import { allSpots } from "./layout";

const { bay, station, land } = config;
const { shore, area, headland: headlandSpec } = bay;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A smooth round bump: 1 at the centre, falling to 0 at `radius` and staying 0 beyond. */
function bump(dx: number, dz: number, radius: number): number {
  const d2 = (dx * dx + dz * dz) / (radius * radius);
  if (d2 >= 1) return 0;
  const k = 1 - d2;
  return k * k;
}

/** The rolling floor out in the bay, with its hills and valleys (D-061). Hill tops flatten toward `hillCap`. */
function seabedHeight(x: number, z: number): number {
  let h =
    bay.baseDepth +
    1.6 * Math.sin(x * 0.043 + 0.7) * Math.cos(z * 0.037 - 0.3) +
    0.9 * Math.sin(x * 0.081 - z * 0.066 + 1.3) +
    0.35 * Math.sin(x * 0.21 + z * 0.17) * Math.cos(z * 0.23 - x * 0.11);
  for (const hill of bay.hills) h += hill.height * bump(x - hill.x, z - hill.z, hill.radius);
  for (const valley of bay.valleys) h -= valley.depth * bump(x - valley.x, z - valley.z, valley.radius);
  // Within 2 m of the cap the rise slows down and never reaches it, so the tops are rounded plateaus.
  const knee = bay.hillCap - 2;
  if (h > knee) h = knee + 2 * (1 - Math.exp(-(h - knee) / 2));
  return h;
}

/** Metres inland from the waterline of the west shore: positive on the land, negative out in the bay. */
export function inland(x: number, z: number): number {
  return shore.waterlineX + shore.wiggle * Math.sin(z * 0.031 + 0.6) + 2 * Math.sin(z * 0.07) - x;
}

/** The shore's own profile: the shelf rising to the waterline, then the land above it, closed by a cliff at the west (REQ-015). */
function shoreHeight(s: number, x: number, z: number): number {
  if (s >= 0) {
    const cliff = land.cliffHeight * smoothstep(land.cliffX, land.cliffX - land.cliffWidth, x + Math.sin(z * 0.09) * 1.5);
    return Math.min(shore.landHeight, s * shore.landRise) + 0.4 * Math.sin(x * 0.13) * Math.sin(z * 0.11) * Math.min(1, s / 6) + cliff;
  }
  const t = Math.min(1, -s / shore.shelfWidth);
  return shore.shelfDepth * t * (2 - t);
}

/** The "radius" of the rounded square the dive area follows: constant along it, like a circle's radius. */
export function squareRadius(x: number, z: number): number {
  const n = area.shape;
  return Math.pow(Math.abs(x) ** n + Math.abs(z) ** n, 1 / n);
}

/** How far from the dive area's edge things the game places keep: `margin` more than the area's own `inset` (REQ-022). */
export function areaReach(margin = 0): number {
  return area.radius - area.inset - margin;
}

/**
 * How much of a headland's rock stands here, 0 (none) to 1 (solid) (REQ-022, D-105): a ridge along z = +-headland.z from the
 * cliff behind the beach out to the sea, rounded at its tip, that closes both ends of the west beach.
 */
export function headland(x: number, z: number): number {
  const beyondTip = Math.max(0, x - headlandSpec.tipX);
  const d = Math.hypot(beyondTip, Math.abs(z) - headlandSpec.z);
  return 1 - smoothstep(headlandSpec.core, headlandSpec.core + headlandSpec.fall, d);
}

/** True where the game may place things: inside the dive area by `margin` m more than its inset, and not on a headland. */
export function inDiveArea(x: number, z: number, margin = 0): boolean {
  return squareRadius(x, z) <= areaReach(margin) && headland(x, z) <= 0;
}

/** The sea floor out in the bay, dropping away outside the dive area into deep water (REQ-022 AC-1). */
function openSeaHeight(x: number, z: number): number {
  const drop = smoothstep(area.radius - area.dropFrom, area.radius + area.dropWidth, squareRadius(x, z));
  return seabedHeight(x, z) - area.dropDepth * drop;
}

/** The floor before anything is levelled: seabed, shore and headlands. */
function naturalFloorHeight(x: number, z: number): number {
  const s = inland(x, z);
  const fromShore = smoothstep(-shore.shelfWidth - shore.blendWidth, -shore.shelfWidth, s);
  let h = openSeaHeight(x, z) * (1 - fromShore) + shoreHeight(s, x, z) * fromShore;
  const w = headland(x, z);
  if (w > 0) {
    // The ridge is highest at the cliff and comes down toward its tip, with an uneven top.
    const taper = 1 - 0.55 * smoothstep(-150, headlandSpec.tipX, x);
    const top = headlandSpec.top * taper + 1.5 * Math.sin(x * 0.19 + z * 0.07) + Math.sin(z * 0.23 - x * 0.05);
    // Ledges on the face: a bulge that is strongest halfway up.
    const ledge = 2 * Math.sin(x * 0.3 + z * 0.21) * w * (1 - w);
    h = h + (Math.max(h, top) - h) * w + ledge;
  }
  return h;
}

/** A level pad: everything within `radius` sits at the natural floor height of the centre. */
interface Pad {
  x: number;
  z: number;
  radius: number;
  blend: number;
  y: number;
}

function pad(x: number, z: number, radius: number, blend: number): Pad {
  return { x, z, radius, blend, y: naturalFloorHeight(x, z) };
}

/** The shed, and every spot for a reef site, a seagrass patch or a net, stand on level ground. */
const pads: readonly Pad[] = [
  pad(station.x, station.z, station.padRadius, station.padBlend),
  // REQ-012: every spot a reef site, a seagrass patch or a net can be picked for.
  ...allSpots.map((site) => pad(site.x, site.z, bay.padRadius, bay.padBlend)),
];

/**
 * Height of the sea floor (or the land) at (x, z). Shared by the terrain mesh, collision, placement and the
 * minimap, so they always agree.
 */
export function floorHeight(x: number, z: number): number {
  let h = naturalFloorHeight(x, z);
  for (const p of pads) {
    const distance = Math.hypot(x - p.x, z - p.z);
    if (distance >= p.radius + p.blend) continue;
    const k = smoothstep(p.radius, p.radius + p.blend, distance);
    h = p.y + (h - p.y) * k;
  }
  // REQ-014: the floor along the cave's tunnel is level.
  const tunnel = caveFloorWeight(x, z);
  if (tunnel > 0) h += (bay.cave.floorY - h) * tunnel;
  return h;
}

const SLOPE_STEP = 0.5;

/** The floor's rise per metre along x and along z at (x, z). */
export function floorGradient(x: number, z: number): { x: number; z: number } {
  return {
    x: (floorHeight(x + SLOPE_STEP, z) - floorHeight(x - SLOPE_STEP, z)) / (2 * SLOPE_STEP),
    z: (floorHeight(x, z + SLOPE_STEP) - floorHeight(x, z - SLOPE_STEP)) / (2 * SLOPE_STEP),
  };
}

/** How steep the floor is at (x, z): rise per metre in the steepest direction. */
export function floorSlope(x: number, z: number): number {
  const g = floorGradient(x, z);
  return Math.hypot(g.x, g.z);
}
