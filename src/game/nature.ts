import { config } from "../config";
import type { LogbookId } from "../logbook/entries";
import { arches, boulders, corals, floorHeight, floorSlope, insideRockAt, rocks } from "./bay";
import { allSpots } from "./layout";
import { squareRadius, wallness } from "./terrain";

const { nature, bay, rov, scanner } = config;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A blade of seagrass in a meadow: where it stands, which way it faces, how tall it grows, when it shows. */
export interface Blade {
  x: number;
  y: number;
  z: number;
  yaw: number;
  lean: number;
  height: number;
  /** 0..1: blades below `nature.meadows.sparse` show before the Bloom; the rest grow in with it. */
  order: number;
}

/** REQ-013 AC-8: a natural seagrass meadow on the sand (D-086, D-089). Not a planting patch. */
export interface Meadow {
  x: number;
  y: number;
  z: number;
  radius: number;
  blades: Blade[];
}

/** Something decorative on the floor (AC-4): passable, scattered over the bay. */
export interface Decor {
  kind: "sponge" | "fan" | "algae";
  x: number;
  y: number;
  z: number;
  size: number;
  yaw: number;
  seed: number;
}

/** Out in the bay's water: not the shore's shallows, not the rock wall, not the cave's hill. */
function inOpenBay(x: number, z: number, margin: number): boolean {
  const reach = bay.wall.radius - bay.wall.width - margin;
  if (squareRadius(x, z) > reach || wallness(x, z) > 0) return false;
  if (Math.hypot(x - bay.cave.x, z - bay.cave.z) < bay.cave.clear) return false;
  if (Math.hypot(x - bay.dock.x, z - bay.dock.z) < bay.dock.clear + margin) return false;
  return Math.hypot(x - rov.start.x, z - rov.start.z) > 12;
}

/** Clear of the boulders, the arches, the rocks and the coral by `margin` metres. */
function clearOfRock(x: number, z: number, margin: number): boolean {
  if (boulders.some((b) => Math.hypot(x - b.x, z - b.z) < b.tiers[0].radius + margin)) return false;
  if (arches.some((a) => Math.hypot(x - a.x, z - a.z) < a.radius + a.tube + margin)) return false;
  if (rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.size + margin)) return false;
  return !corals.some((c) => Math.hypot(x - c.x, z - c.z) < c.radius + margin);
}

function generateMeadows(): Meadow[] {
  const { meadows } = nature;
  const random = mulberry32(meadows.seed);
  const reach = bay.wall.radius - bay.wall.width - 10;
  const found: Meadow[] = [];
  let attempts = 0;
  while (found.length < meadows.count && attempts++ < 20000) {
    const x = (random() * 2 - 1) * reach;
    const z = (random() * 2 - 1) * reach;
    const radius = meadows.minRadius + random() * (meadows.maxRadius - meadows.minRadius);
    const y = floorHeight(x, z);
    // On the sand of the valleys and flats: deep enough and nearly level.
    if (!inOpenBay(x, z, radius) || y > bay.surfaceY - 11 || floorSlope(x, z) > 0.25) continue;
    // Never on a spot a planting patch, a reef site or a net can be picked for (REQ-012).
    if (allSpots.some((spot) => Math.hypot(x - spot.x, z - spot.z) < radius + bay.padRadius + 4)) continue;
    if (!clearOfRock(x, z, radius * 0.6)) continue;
    if (found.some((m) => Math.hypot(x - m.x, z - m.z) < radius + m.radius + 6)) continue;
    const count = Math.round(Math.PI * radius * radius * meadows.bladesPerSquareMetre);
    const blades: Blade[] = [];
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius;
      const bx = x + Math.cos(angle) * distance;
      const bz = z + Math.sin(angle) * distance;
      if (insideRockAt(bx, floorHeight(bx, bz) + 0.2, bz, 0.2)) continue;
      blades.push({ x: bx, y: floorHeight(bx, bz), z: bz, yaw: random() * Math.PI * 2, lean: (random() - 0.5) * 0.4, height: 0.6 + random() * 0.6, order: random() });
    }
    found.push({ x, y, z, radius, blades });
  }
  return found;
}

export const meadows: readonly Meadow[] = generateMeadows();

function generateDecor(): Decor[] {
  const { decor } = nature;
  const random = mulberry32(decor.seed);
  const reach = bay.wall.radius - bay.wall.width - 6;
  const items: Decor[] = [];
  const wanted: [Decor["kind"], number][] = [
    ["sponge", decor.sponges],
    ["fan", decor.fans],
    ["algae", decor.algae],
  ];
  for (const [kind, count] of wanted) {
    let placed = 0;
    for (let attempts = 0; placed < count && attempts < 20000; attempts++) {
      const x = (random() * 2 - 1) * reach;
      const z = (random() * 2 - 1) * reach;
      const y = floorHeight(x, z);
      if (!inOpenBay(x, z, 2) || y > bay.surfaceY - 5) continue;
      if (allSpots.some((spot) => Math.hypot(x - spot.x, z - spot.z) < bay.padRadius + 2)) continue;
      if (!clearOfRock(x, z, 1)) continue;
      // Algae turf grows on the gentle hill tops; sponges and fans on the slopes and rock edges.
      if (kind === "algae" && floorSlope(x, z) > 0.4) continue;
      const size = kind === "sponge" ? 0.5 + random() * 0.5 : kind === "fan" ? 0.7 + random() * 0.6 : 0.4 + random() * 0.4;
      items.push({ kind, x, y, z, size, yaw: random() * Math.PI * 2, seed: items.length });
      placed++;
    }
  }
  return items;
}

export const decor: readonly Decor[] = generateDecor();

/** A natural thing the Scanner can open an entry from after the Bloom (AC-5, AC-8). */
export interface NaturalTarget {
  x: number;
  y: number;
  z: number;
  r: number;
  entry: LogbookId;
}

/** The coral clusters open the coral entry, the meadows the seagrass entry (D-074, D-089). */
export const naturalTargets: readonly NaturalTarget[] = [
  ...corals.map((c) => ({ x: c.x, y: c.y + c.height * 0.4, z: c.z, r: c.radius + 0.3, entry: "coral" as const })),
  ...meadows.map((m) => ({ x: m.x, y: m.y + scanner.seagrassHeight, z: m.z, r: Math.min(m.radius * 0.7, 5), entry: "seagrass" as const })),
];
