import { config } from "../config";
import type { LogbookId } from "../logbook/entries";
import { arches, boulders, corals, floorHeight, floorSlope, insideRockAt, rocks } from "./bay";
import { allSpots } from "./layout";
import { generateMeadows, type Meadow } from "./seagrass";
import { inland, squareRadius, wallness } from "./terrain";

const { nature, bay, rov, scanner, station } = config;

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

/** What a piece of decoration is (REQ-021): tropical algae, a barrel sponge or a sea fan. */
export type DecorKind = "halimeda" | "padina" | "sargassum" | "sponge" | "fan";

/** Something decorative on the floor (REQ-013 AC-4, REQ-021): passable, never a target, grown where its kind grows. */
export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  z: number;
  /** Metres: the kind's model at size 1 is scaled by this. */
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

/** REQ-019: the natural seagrass meadows on the shallow sand off the west beach (see seagrass.ts). */
export const meadows: readonly Meadow[] = generateMeadows(mulberry32(nature.meadows.seed));

/** The kinds in the order they are laid out, so the same seed always lays out the same bay. */
const DECOR_KINDS: readonly DecorKind[] = ["halimeda", "padina", "sargassum", "sponge", "fan"];

const depthOf = (y: number): number => bay.surfaceY - y;

/** The top of a boulder's flat upper tier, if (x, z) lies on it: hard ground that is shallow (REQ-021 AC-2). */
function boulderTop(x: number, z: number): number | null {
  for (const boulder of boulders) {
    const upper = boulder.tiers[boulder.tiers.length - 1];
    if (Math.hypot(x - boulder.x, z - boulder.z) < upper.radius - 0.5) return upper.baseY + upper.height;
  }
  return null;
}

/** Within `reach` m of a small rock's edge, a boulder's edge or an arch's ring: the hard ground around them (REQ-021 AC-2 to AC-4). */
const nearRock = (x: number, z: number, reach: number): boolean => rocks.some((r) => Math.hypot(x - r.x, z - r.z) < r.size + reach);
const nearBoulder = (x: number, z: number, reach: number): boolean => boulders.some((b) => Math.hypot(x - b.x, z - b.z) < b.tiers[0].radius + reach);
const nearArch = (x: number, z: number, reach: number): boolean => arches.some((a) => Math.abs(Math.hypot(x - a.x, z - a.z) - a.radius) < a.tube + reach);

/**
 * The height at which a piece of `kind` stands at (x, z), or null where it does not grow (REQ-021 AC-2 to AC-4). Algae grow on
 * hard ground that is shallow (a boulder's top, around the rocks and arches) and on the shallow shelf in the west, and sargassum
 * only down to its own depth. Sponges grow on rocks, boulders and slopes, never on flat sand. Sea fans grow deeper than
 * `fanDepth`, on boulders, arches and slopes.
 */
function standsAt(kind: DecorKind, x: number, z: number): number | null {
  const tuning = nature.decor;
  const reach = tuning.hardReach;
  const floor = floorHeight(x, z);
  if (kind === "sponge") {
    const hard = nearRock(x, z, reach) || nearBoulder(x, z, reach);
    return depthOf(floor) >= tuning.spongeDepth && (hard || floorSlope(x, z) >= tuning.slope) ? floor : null;
  }
  if (kind === "fan") {
    const hard = nearBoulder(x, z, reach) || nearArch(x, z, reach);
    return depthOf(floor) > tuning.fanDepth && (hard || floorSlope(x, z) >= tuning.slope) ? floor : null;
  }
  const cap = kind === "sargassum" ? tuning.sargassumDepth : tuning.algaeDepth;
  const top = boulderTop(x, z);
  if (top !== null) return depthOf(top) >= tuning.shallow && depthOf(top) <= cap ? top : null;
  const depth = depthOf(floor);
  const s = inland(x, z);
  const shelf = s < 0 && s > -bay.shore.shelfWidth;
  const hard = nearRock(x, z, reach) || nearBoulder(x, z, reach) || nearArch(x, z, reach);
  return depth >= tuning.shallow && depth <= cap && (shelf || hard) ? floor : null;
}

/** Clear of the planting spots and the nets (all in `allSpots`) with their pads, and of the shed on the land (REQ-021 AC-6). */
function clearOfPlaces(x: number, z: number): boolean {
  if (allSpots.some((spot) => Math.hypot(x - spot.x, z - spot.z) < bay.padRadius + bay.padBlend + 3)) return false;
  return Math.hypot(x - station.x, z - station.z) >= station.padRadius + station.padBlend + 4;
}

/** The hard ground that stands up from the floor: the rocks, boulders and arches, each with its centre and its edge's reach. */
const hardFeatures: readonly { x: number; z: number; edge: number }[] = [
  ...rocks.map((r) => ({ x: r.x, z: r.z, edge: r.size })),
  ...boulders.map((b) => ({ x: b.x, z: b.z, edge: b.tiers[0].radius })),
  ...arches.map((a) => ({ x: a.x, z: a.z, edge: a.radius + a.tube })),
];

/**
 * A random spot near one of the hard features, so the hard ground gets its share of the decoration: the shelf is much
 * larger than all of them together, so spots drawn over the whole bay would mostly land on the shelf.
 */
function nearAFeature(random: () => number): { x: number; z: number } {
  const feature = hardFeatures[Math.floor(random() * hardFeatures.length)];
  const angle = random() * Math.PI * 2;
  const distance = random() * (feature.edge + 2 * nature.decor.hardReach);
  return { x: feature.x + Math.cos(angle) * distance, z: feature.z + Math.sin(angle) * distance };
}

/**
 * Lays every piece of decoration once from the seed (REQ-021): each kind where it grows, out in the open bay (clear of the
 * wall, the cave, the dock and the start), never on a planting spot, a net or the shed, never inside a rock, and never
 * touching another piece. Half the spots are drawn near the rocks, boulders and arches, the rest over the whole bay. The
 * draws come in the same order for the same seed, so the bay is the same on every run.
 */
function generateDecor(): Decor[] {
  const tuning = nature.decor;
  const random = mulberry32(tuning.seed);
  const reach = bay.wall.radius - bay.wall.width - 6;
  const items: Decor[] = [];
  for (const kind of DECOR_KINDS) {
    const spec = tuning[kind];
    let placed = 0;
    for (let attempts = 0; placed < spec.count && attempts < 40000; attempts++) {
      const near = random() < 0.5;
      const anchor = near ? nearAFeature(random) : { x: (random() * 2 - 1) * reach, z: (random() * 2 - 1) * reach };
      const { x, z } = anchor;
      const size = spec.size[0] + random() * (spec.size[1] - spec.size[0]);
      const turn = random() * Math.PI * 2;
      const y = standsAt(kind, x, z);
      if (y === null || !clearOfPlaces(x, z) || !inOpenBay(x, z, 2) || insideRockAt(x, y + 0.2, z, 0.2)) continue;
      if (items.some((other) => Math.hypot(x - other.x, z - other.z) < other.size * tuning[other.kind].reach + size * spec.reach + tuning.gap)) continue;
      // Every sea fan turns its fan to the same current (AC-4).
      items.push({ kind, x, y, z, size, yaw: kind === "fan" ? tuning.current : turn, seed: items.length });
      placed++;
    }
  }
  return items;
}

export const decor: readonly Decor[] = generateDecor();

/**
 * REQ-021 AC-6: the pieces that cover none of these spots (this dive's trash). A piece covers whatever lies within its own
 * reach plus `clearOfTrash`, so no item of trash is hidden under decoration.
 */
export function decorClearOf(spots: readonly { x: number; z: number }[]): Decor[] {
  const tuning = nature.decor;
  return decor.filter((item) => {
    const cover = item.size * tuning[item.kind].reach + tuning.clearOfTrash;
    return spots.every((spot) => Math.hypot(spot.x - item.x, spot.z - item.z) >= cover);
  });
}

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
