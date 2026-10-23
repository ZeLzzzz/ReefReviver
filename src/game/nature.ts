import { config } from "../config";
import type { LogbookId } from "../logbook/entries";
import { arches, boulders, corals, floorHeight, floorSlope, rocks } from "./bay";
import { allSpots } from "./layout";
import { generateMeadows, type Meadow } from "./seagrass";
import { squareRadius, wallness } from "./terrain";

const { nature, bay, rov, scanner } = config;

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type { Blade, Meadow } from "./seagrass";

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

/** REQ-019: the natural seagrass meadows on the shallow sand off the west beach (see seagrass.ts). */
export const meadows: readonly Meadow[] = generateMeadows(mulberry32(nature.meadows.seed));

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
  /** The ground within `r` of (x, z), not a sphere (REQ-019 AC-6). */
  flat?: boolean;
}

/** The coral clusters open the coral entry, the meadows the seagrass entry (D-074, D-089). */
export const naturalTargets: readonly NaturalTarget[] = [
  ...corals.map((c) => ({ x: c.x, y: c.y + c.height * 0.4, z: c.z, r: c.radius + 0.3, entry: "coral" as const })),
  ...meadows.map((m) => ({ x: m.x, y: m.y + scanner.meadowHeight, z: m.z, r: m.radius * scanner.meadowReach, entry: "seagrass" as const, flat: true })),
];
