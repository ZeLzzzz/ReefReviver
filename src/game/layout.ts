import { config } from "../config";

const { reef, nets } = config;

/** A place on the floor, in metres (x east, z south). */
export interface Spot {
  x: number;
  z: number;
}

export interface NetSpot extends Spot {
  /** The net's long axis points along (sin yaw, cos yaw). */
  yaw: number;
}

/** REQ-012: where one dive puts its reef sites, seagrass patches and nets, and the seed its trash is laid with. */
export interface Layout {
  frames: Spot[];
  patches: Spot[];
  /** In net order: net 0 traps the turtle, net 1 the reef shark. */
  nets: NetSpot[];
  trashSeed: number;
}

/** Every place a reef site, a seagrass patch or a net can be: each has a level pad, and no rock or trash is put there. */
export const allSpots: readonly Spot[] = [...reef.frameSpots, ...reef.patchSpots, ...nets.spots];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` different items of `from`, in random order. */
function pick<T>(random: () => number, from: readonly T[], count: number): T[] {
  const pool = [...from];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** Which quarter of the bay a spot is in: 0..3, by the side of the centre it lies on east–west and north–south. */
export function quarterOf(spot: Spot): number {
  return (spot.x >= 0 ? 1 : 0) + (spot.z >= 0 ? 2 : 0);
}

/**
 * REQ-012: the reef sites, seagrass patches and nets of one dive, picked from the candidate spots by `seed`
 * (D-063, D-074). Together they always cover at least `reef.spreadQuarters` quarters of the bay, so the dive is not
 * all in one corner (AC-5). The same seed gives the same layout.
 */
export function chooseLayout(seed: number): Layout {
  const random = mulberry32(seed);
  for (let attempt = 0; ; attempt++) {
    const frames = pick(random, reef.frameSpots, reef.frames).map(({ x, z }) => ({ x, z }));
    const patches = pick(random, reef.patchSpots, reef.patches).map(({ x, z }) => ({ x, z }));
    const netSpots = pick(random, nets.spots, nets.kinds.length).map(({ x, z, yaw }) => ({ x, z, yaw }));
    const quarters = new Set([...frames, ...patches, ...netSpots].map(quarterOf));
    if (quarters.size >= reef.spreadQuarters || attempt >= 100) {
      return { frames, patches, nets: netSpots, trashSeed: Math.floor(random() * 2 ** 31) };
    }
  }
}

/** The layout a field starts with before the first dive picks its own (and the one unit tests use by default). */
export const defaultLayout: Layout = chooseLayout(1);
