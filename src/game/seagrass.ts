import { config } from "../config";
import { floorHeight, insideRockAt } from "./bay";
import { allSpots } from "./layout";
import { inland } from "./terrain";

const { nature, bay } = config;
const { meadows: setup } = nature;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A leaf of seagrass in a meadow: where it stands, which way it faces, how tall and wide it is, when it shows. */
export interface Blade {
  x: number;
  y: number;
  z: number;
  yaw: number;
  lean: number;
  height: number;
  /** Across the leaf, in metres (REQ-019 AC-2: a flat ribbon, wider on an Enhalus). */
  width: number;
  /** 0.6..1.1: how bright this leaf is against the others. */
  shade: number;
  /** True for the tall, wide leaves of an Enhalus clump in the shallowest part (AC-2). */
  enhalus: boolean;
  /** 0..1: blades below `nature.meadows.sparse` show before the Bloom; the rest grow in with it. */
  order: number;
}

/** REQ-013 AC-8, REQ-019 AC-1: a natural seagrass meadow on the shallow sand (D-086, D-089, D-102). Not a planting patch. */
export interface Meadow {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** Shapes the meadow's ragged edge. */
  phase: number;
  blades: Blade[];
}

/**
 * How thickly seagrass grows at (x, z) in a meadow, 0 (none) to 1 (full) (REQ-019 AC-1, AC-5): thinning toward the
 * meadow's ragged edge and toward both ends of the 1-7 m depth band, and none near the dock or a planting spot, so a
 * patch stays bare sand until it is planted. The blades and the sand under them both follow it.
 */
export function meadowWeight(meadow: { x: number; z: number; radius: number; phase: number }, x: number, z: number): number {
  const angle = Math.atan2(z - meadow.z, x - meadow.x);
  const edge = meadow.radius * (1 + 0.16 * Math.sin(3 * angle + meadow.phase) + 0.09 * Math.sin(5 * angle + 2 * meadow.phase));
  const radial = 1 - smoothstep(0.55, 1, Math.hypot(x - meadow.x, z - meadow.z) / edge);
  if (radial <= 0) return 0;
  const depth = bay.surfaceY - floorHeight(x, z);
  const inBand = smoothstep(setup.minDepth, setup.minDepth + 0.8, depth) * (1 - smoothstep(setup.maxDepth - 1.5, setup.maxDepth, depth));
  if (inBand <= 0) return 0;
  const dock = smoothstep(setup.dockClear - 2, setup.dockClear, Math.hypot(x - bay.dock.x, z - bay.dock.z));
  let clear = dock;
  for (const spot of allSpots) {
    if (clear <= 0) return 0;
    clear *= smoothstep(setup.spotClear - 1.5, setup.spotClear, Math.hypot(x - spot.x, z - spot.z));
  }
  return radial * inBand * clear;
}

/** Where on the shelf the floor is `depth` metres under the surface, as metres out from the waterline. */
function metresOffshore(depth: number): number {
  const t = 1 - Math.sqrt(1 - depth / -bay.shore.shelfDepth);
  return t * bay.shore.shelfWidth;
}

/**
 * The centres of the meadows, strung along the open shore in order, one after the other with small gaps and a hole
 * for the dock (AC-1): their sizes, how far out they lie and the gaps between them come from `random`.
 */
function placeMeadows(random: () => number): Omit<Meadow, "blades">[] {
  const reach = bay.shore.openHalf - 8;
  const radii = Array.from({ length: setup.count }, () => setup.minRadius + random() * (setup.maxRadius - setup.minRadius));
  const holes = 2 * setup.dockClear;
  const free = 2 * reach - holes - radii.reduce((sum, r) => sum + 2 * r, 0);
  // Not enough room for the wanted sizes: shrink them all alike.
  const shrink = free < setup.count ? Math.max(0.5, 1 + (free - setup.count) / (2 * reach)) : 1;
  const sized = radii.map((r) => r * shrink);
  const weights = sized.map(() => 0.4 + random() * 1.2);
  const room = Math.max(0, free) / weights.reduce((sum, w) => sum + w, 0);
  const found: Omit<Meadow, "blades">[] = [];
  let z = -reach;
  sized.forEach((radius, i) => {
    z += radius;
    // The dock's clear zone is skipped, not planted over.
    if (z + radius > bay.dock.z - setup.dockClear && z - radius < bay.dock.z + setup.dockClear) z = bay.dock.z + setup.dockClear + radius;
    const depth = setup.centreDepth.min + random() * (setup.centreDepth.max - setup.centreDepth.min);
    const x = inland(0, z) + metresOffshore(depth);
    found.push({ x, y: floorHeight(x, z), z, radius, phase: random() * Math.PI * 2 });
    z += radius + weights[i] * room;
  });
  return found;
}

/** The leaves of one shoot at (x, z): a tuft of ribbons, or an Enhalus clump in the shallowest water. */
function shoot(random: () => number, x: number, z: number, enhalus: boolean, out: Blade[]): void {
  const y = floorHeight(x, z) - 0.02;
  const { leaf } = setup;
  const spec = enhalus ? setup.enhalus : leaf;
  const leaves = enhalus ? setup.enhalus.leaves : leaf.minLeaves + Math.floor(random() * (leaf.maxLeaves - leaf.minLeaves + 1));
  for (let i = 0; i < leaves; i++) {
    const angle = random() * Math.PI * 2;
    const near = random() * 0.05;
    const bx = x + Math.cos(angle) * near;
    const bz = z + Math.sin(angle) * near;
    const height = spec.minHeight + random() * (spec.maxHeight - spec.minHeight);
    const lean = 0.1 + random() * (spec.lean - 0.1);
    const shade = (enhalus ? 0.75 : 0.9) + random() * 0.25;
    const width = spec.width * (0.85 + 0.3 * random());
    const order = random();
    if (insideRockAt(bx, y + 0.2, bz, 0.2)) continue;
    out.push({ x: bx, y, z: bz, yaw: random() * Math.PI * 2, lean, height, width, shade, enhalus, order });
  }
}

/**
 * The natural meadows (REQ-019): their places along the shallow sand off the west beach, and every leaf in them,
 * laid out once from the seed. Each meadow is filled with shoots at random, kept with the chance `meadowWeight` gives.
 */
export function generateMeadows(random: () => number): Meadow[] {
  return placeMeadows(random).map((place) => {
    const blades: Blade[] = [];
    const reach = place.radius * 1.3;
    const shoots = Math.round(Math.PI * reach * reach * setup.shootsPerSquareMetre);
    for (let i = 0; i < shoots; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * reach;
      const x = place.x + Math.cos(angle) * distance;
      const z = place.z + Math.sin(angle) * distance;
      const keep = random();
      const clump = random();
      if (keep >= meadowWeight(place, x, z)) continue;
      shoot(random, x, z, bay.surfaceY - floorHeight(x, z) < setup.enhalus.depth && clump < setup.enhalus.chance, blades);
    }
    return { ...place, blades };
  });
}

const currentLength = Math.hypot(setup.sway.current.x, setup.sway.current.z);

/** The way the current runs along the floor: a unit vector (x, z) that the leaf tips are pushed toward (AC-2). */
export const currentDirection = { x: setup.sway.current.x / currentLength, z: setup.sway.current.z / currentLength };

/**
 * How far the current bends a leaf's tip along `currentDirection` at time `t`, as a fraction of the leaf's length
 * (REQ-019 AC-2): nothing at the root (`tip` 0), most at the tip (`tip` 1), a slow swell travelling along the
 * current. Never negative, never more than `amplitude`, and smooth in time, so the leaves sway without flicker. The
 * vertex shader in seagrass-model.ts makes the same bend (plus a smaller sideways sway).
 */
export function currentBend(x: number, z: number, tip: number, t: number): number {
  const { amplitude, period, waveLength } = setup.sway;
  const phase = (2 * Math.PI * t) / period - ((x * currentDirection.x + z * currentDirection.z) * 2 * Math.PI) / waveLength;
  return amplitude * tip * tip * (0.55 + 0.45 * Math.sin(phase));
}
