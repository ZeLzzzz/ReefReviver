import { config } from "../config";
import type { Arch, Boulder, Coral, Rock } from "./bay";
import { floorHeight, floorSlope, squareRadius, wallness } from "./terrain";

const { bay } = config;
const spec = config.nature.coral;

/** The colony shapes: 0 branching, 1 table, 2 brain (a boulder), 3 finger, and 4 a big massive Porites head. */
export type ColonyKind = 0 | 1 | 2 | 3 | 4;

/** How wide a colony of size 1 is (a fraction of its size), by shape. */
export const FOOTPRINT: readonly number[] = [0.9, 1, 1, 0.7, 1];
/** How tall a colony of size 1 stands (a fraction of its size), by shape. */
export const TOP: readonly number[] = [1, 0.4, 0.6, 1, 0.425];

/** One coral colony: `size` m across or tall (the larger), standing with its base at (x, y, z). */
export interface Colony {
  x: number;
  y: number;
  z: number;
  size: number;
  kind: ColonyKind;
  yaw: number;
  /** Which of the six pastel colours it takes after the Bloom. */
  colour: number;
  /** 0.85 to 1: a little variety in how bright it is. */
  shade: number;
  /** Squashes or stretches it a little (0.85 to 1.15 of its height). */
  stretch: number;
  /** Index into the reef list. */
  reef: number;
}

/** REQ-020: a stretch of reef. The belt is one reef; a patch reef (a gosong) grows on a hill top, a boulder or an arch. */
export interface Reef {
  kind: "belt" | "patch";
  host: "shelf" | "hill" | "boulder" | "arch";
  x: number;
  z: number;
  /** About how wide it is across (m). */
  width: number;
  colonies: number;
}

export interface ReefSet {
  colonies: Colony[];
  reefs: Reef[];
  /** What the submarine, the camera and the seeds meet: blobs that hug the colonies, and the big heads. */
  corals: Coral[];
}

/** What the generator needs from the bay (passed in, so this module never imports the bay at run time). */
export interface ReefContext {
  random: () => number;
  boulders: readonly Boulder[];
  arches: readonly Arch[];
  rocks: readonly Rock[];
  keptClear(x: number, z: number, size: number, options?: { startClear?: number; ignoreRocks?: boolean }): boolean;
  lowestFloor(x: number, z: number, radius: number): number;
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Colonies placed so far, found by position so that neighbours can keep their distance. */
class Crowd {
  private readonly cells = new Map<number, { x: number; z: number; width: number }[]>();
  private readonly cell = 2.5;

  private key(i: number, j: number): number {
    return (i + 5000) * 20000 + (j + 5000);
  }

  /** True when a colony `width` wide at (x, z) would sit closer to another than `crowd` of their widths. */
  crowded(x: number, z: number, width: number): boolean {
    const i = Math.floor(x / this.cell);
    const j = Math.floor(z / this.cell);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const other of this.cells.get(this.key(i + di, j + dj)) ?? []) {
          if (Math.hypot(x - other.x, z - other.z) < spec.crowd * (width + other.width) * 0.5) return true;
        }
      }
    }
    return false;
  }

  add(x: number, z: number, width: number): void {
    const key = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    const list = this.cells.get(key);
    if (list) list.push({ x, z, width });
    else this.cells.set(key, [{ x, z, width }]);
  }
}

/** Where along the belt the reef is (1) and where there is sand between two stretches (0). */
function beltStretch(x: number, z: number): number {
  const phase = (z / spec.belt.gapPeriod) * Math.PI * 2;
  const along = 0.5 + 0.3 * Math.sin(phase + 0.9) + 0.2 * Math.sin(phase * 2.3 + x * 0.07);
  return smooth(0.28, 0.6, along);
}

/** How well the belt grows at this depth: best at `peakDepth` (the shelf's edge), fading `spread` m of depth either side. */
function beltDepthWeight(depth: number): number {
  const { peakDepth, spread } = spec.belt;
  return Math.exp(-(((depth - peakDepth) / spread) ** 2));
}

/** REQ-020 AC-1 to AC-3: the reef belt, the patch reefs and the big Porites heads, and the blobs they are solid as. */
export function generateReefs(ctx: ReefContext): ReefSet {
  const { random, boulders, arches, rocks } = ctx;
  const colonies: Colony[] = [];
  const reefs: Reef[] = [];
  const heads: { x: number; z: number; radius: number }[] = [];
  const crowd = new Crowd();
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];

  const kindOf = (): ColonyKind => {
    let r = random();
    for (let k = 0; k < spec.shapes.length; k++) {
      r -= spec.shapes[k];
      if (r < 0) return k as ColonyKind;
    }
    return 0;
  };
  const sizeOf = () => spec.minSize + (spec.maxSize - spec.minSize) * Math.pow(random(), spec.sizeSkew);
  /** Neighbouring colonies share a colour more than chance would give (a patch of one colour). */
  const colourAt = (x: number, z: number) => {
    const n = 0.5 + 0.25 * Math.sin(x * 0.21 + 1) + 0.25 * Math.sin(z * 0.17 - x * 0.09 + 2);
    return Math.floor((n * 0.7 + random() * 0.3) * 6) % 6;
  };
  const nearRock = (x: number, z: number, width: number) => rocks.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.size + width * 0.5);
  const nearHead = (x: number, z: number, width: number) => heads.some((head) => Math.hypot(x - head.x, z - head.z) < head.radius + width * 0.5 + 0.1);

  /** Tries one colony of `size` at (x, z), its base at y; false when it is crowded or in the way of a rock or a head. */
  const tryColony = (x: number, y: number, z: number, size: number, reef: number): boolean => {
    const kind = kindOf();
    const width = size * FOOTPRINT[kind];
    if (crowd.crowded(x, z, width) || nearHead(x, z, width) || nearRock(x, z, width)) return false;
    crowd.add(x, z, width);
    colonies.push({ x, y, z, size, kind, yaw: random() * Math.PI * 2, colour: colourAt(x, z), shade: 0.85 + 0.15 * random(), stretch: 0.85 + 0.3 * random(), reef });
    return true;
  };

  const depthAt = (x: number, z: number) => bay.surfaceY - floorHeight(x, z);
  const startClear = spec.belt.startClear;

  // The belt: on the floor of the shelf's edge, in stretches with sand between them.
  const inBelt = (x: number, z: number, width: number) => {
    if (squareRadius(x, z) > bay.wall.radius - bay.wall.width - 8 || wallness(x, z) > 0) return false;
    const depth = depthAt(x, z);
    if (depth < spec.belt.minDepth || depth > spec.belt.maxDepth) return false;
    return floorSlope(x, z) <= spec.maxSlope && !ctx.keptClear(x, z, width * 0.5, { startClear });
  };
  const beltBox = { x0: bay.shore.waterlineX + 2, x1: bay.shore.waterlineX + 56, z: bay.shore.openHalf - 4 };

  // Big Porites heads first, so that the colonies grow around them. Two on the belt: one as near the start as the
  // clearance allows (so it is seen at the start), one far along; the rest on patch reefs (below).
  const beltReef = reefs.length;
  reefs.push({ kind: "belt", host: "shelf", x: bay.shore.waterlineX + 20, z: 0, width: 2 * beltBox.z, colonies: 0 });
  const headSites: { x: number; z: number; radius: number; reef: number; base: number }[] = [];
  const floorUnder = (x: number, z: number, radius: number) => ctx.lowestFloor(x, z, radius * 0.8);
  const beltSites: { x: number; z: number; radius: number }[] = [];
  for (let attempt = 0; attempt < 6000 && beltSites.length < 400; attempt++) {
    const x = beltBox.x0 + random() * (beltBox.x1 - beltBox.x0);
    const z = (random() * 2 - 1) * beltBox.z;
    const radius = spec.porites.minRadius + random() * (spec.porites.maxRadius - spec.porites.minRadius);
    const depth = depthAt(x, z);
    if (beltStretch(x, z) < 0.5 || beltDepthWeight(depth) < 0.8 || !inBelt(x, z, radius * 2 + 1)) continue;
    beltSites.push({ x, z, radius });
  }
  // The first two heads are the nearest ones the start's camera sees well ahead (within 35 degrees of the heading), one on
  // each side of it, so the start already shows the belt's landmarks.
  const { start } = config.rov;
  const forward = { x: Math.sin(start.yaw), z: Math.cos(start.yaw) };
  const eye = { x: start.x - forward.x * config.camera.distance, z: start.z - forward.z * config.camera.distance };
  const bearing = (site: { x: number; z: number }) => {
    const dx = site.x - eye.x;
    const dz = site.z - eye.z;
    return Math.acos((dx * forward.x + dz * forward.z) / Math.hypot(dx, dz));
  };
  const sideOf = (site: { x: number; z: number }) => Math.sign((site.x - eye.x) * forward.z - (site.z - eye.z) * forward.x);
  const nearStart = (site: { x: number; z: number }) => Math.hypot(site.x - start.x, site.z - start.z);
  const ahead = beltSites.filter((site) => bearing(site) < (35 * Math.PI) / 180).sort((a, b) => nearStart(a) - nearStart(b));
  const first = ahead[0];
  if (first) headSites.push({ ...first, reef: beltReef, base: floorUnder(first.x, first.z, first.radius) });
  const second = ahead.find((site) => first && sideOf(site) !== sideOf(first));
  if (second) headSites.push({ ...second, reef: beltReef, base: floorUnder(second.x, second.z, second.radius) });
  while (headSites.length < spec.porites.onBelt && beltSites.length > 0) {
    const site = pick(beltSites);
    if (headSites.every((head) => Math.hypot(head.x - site.x, head.z - site.z) >= spec.porites.spacing)) headSites.push({ ...site, reef: beltReef, base: floorUnder(site.x, site.z, site.radius) });
    else if (random() < 0.002) break;
  }

  // The patch reefs: on every arch's crown, on some boulders' tops and on some hill tops.
  type Patch = { host: "hill" | "boulder" | "arch"; x: number; z: number; width: number; boulder?: Boulder; arch?: Arch };
  const patches: Patch[] = [];
  const widthOf = () => spec.patches.minWidth + random() * (spec.patches.maxWidth - spec.patches.minWidth);
  for (const arch of arches.slice(0, spec.patches.arches)) {
    patches.push({ host: "arch", x: arch.x, z: arch.z, width: arch.radius * 2, arch });
  }
  const shuffled = <T>(items: readonly T[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  let boulderPatches = 0;
  for (const boulder of shuffled(boulders)) {
    if (boulderPatches >= spec.patches.boulders) break;
    const radius = boulder.tiers[0].radius;
    if (ctx.keptClear(boulder.x, boulder.z, radius, { ignoreRocks: true })) continue;
    patches.push({ host: "boulder", x: boulder.x, z: boulder.z, width: radius * 2, boulder });
    boulderPatches++;
  }
  for (const hill of shuffled(bay.hills)) {
    if (patches.length >= spec.patches.count) break;
    // The top of the hill: the highest floor near its centre.
    let best: { x: number; z: number; y: number } = { x: hill.x, z: hill.z, y: floorHeight(hill.x, hill.z) };
    for (let dx = -6; dx <= 6; dx += 2) {
      for (let dz = -6; dz <= 6; dz += 2) {
        const y = floorHeight(hill.x + dx, hill.z + dz);
        if (y > best.y + 0.05) best = { x: hill.x + dx, z: hill.z + dz, y };
      }
    }
    const width = widthOf();
    if (squareRadius(best.x, best.z) > bay.wall.radius - bay.wall.width - 8 || wallness(best.x, best.z) > 0) continue;
    if (-best.y < spec.belt.minDepth || -best.y > 14 || ctx.keptClear(best.x, best.z, width * 0.5)) continue;
    patches.push({ host: "hill", x: best.x, z: best.z, width });
  }
  const corals: Coral[] = [];
  // Porites heads on the first patch reefs that are not arches.
  let patchHeads = spec.porites.count - headSites.length;
  patches.forEach((patch, i) => {
    if (patch.host === "arch" || patchHeads <= 0) return;
    const limit = patch.boulder ? patch.boulder.tiers[1].radius * 0.5 : patch.width * 0.2;
    const radius = Math.min(spec.porites.minRadius + random() * (spec.porites.maxRadius - spec.porites.minRadius), limit);
    const upper = patch.boulder?.tiers[1];
    const base = upper ? upper.baseY + upper.height - 0.15 : floorUnder(patch.x, patch.z, radius);
    headSites.push({ x: patch.x, z: patch.z, radius, reef: beltReef + 1 + i, base });
    patchHeads--;
  });

  for (const site of headSites) {
    heads.push(site);
    colonies.push({ x: site.x, y: site.base, z: site.z, size: site.radius * 2, kind: 4, yaw: random() * Math.PI * 2, colour: colourAt(site.x, site.z), shade: 1, stretch: 1, reef: site.reef });
    corals.push({ x: site.x, y: site.base, z: site.z, radius: site.radius, height: site.radius * 0.85, seed: 0 });
  }

  // Fill the belt.
  for (let attempt = 0; attempt < spec.belt.attempts; attempt++) {
    const x = beltBox.x0 + random() * (beltBox.x1 - beltBox.x0);
    const z = (random() * 2 - 1) * beltBox.z;
    const depth = depthAt(x, z);
    const want = beltStretch(x, z) * beltDepthWeight(depth) * spec.belt.cover;
    if (want <= 0 || random() > want) continue;
    const size = sizeOf();
    if (!inBelt(x, z, size)) continue;
    tryColony(x, floorHeight(x, z) - 0.05, z, size, beltReef);
  }

  // Fill the patch reefs.
  patches.forEach((patch, i) => {
    const reef = beltReef + 1 + i;
    reefs.push({ kind: "patch", host: patch.host, x: patch.x, z: patch.z, width: patch.width, colonies: 0 });
    if (patch.arch) {
      const { arch } = patch;
      const ax = Math.cos(arch.yaw);
      const az = -Math.sin(arch.yaw);
      const wx = Math.sin(arch.yaw);
      const wz = Math.cos(arch.yaw);
      for (let attempt = 0; attempt < 900; attempt++) {
        const angle = Math.PI * (0.28 + 0.44 * random());
        const side = (random() * 2 - 1) * 0.95;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        const reach = arch.tube * Math.cos(side);
        const out = arch.tube * Math.sin(side);
        const x = arch.x + ax * (nx * arch.radius + nx * reach) + wx * out;
        const z = arch.z + az * (nx * arch.radius + nx * reach) + wz * out;
        const y = arch.y + ny * (arch.radius + reach) - 0.12;
        tryColony(x, y, z, Math.min(sizeOf(), 0.9), reef);
      }
      return;
    }
    // A hill top: an irregular ellipse, packed in the middle and loose at the edge. A boulder: its two flat tops.
    const radius = patch.boulder ? patch.boulder.tiers[0].radius : patch.width * 0.5;
    const rotation = random() * Math.PI;
    const stretch = patch.boulder ? 1 : 0.6 + 0.4 * random();
    const wobble = [random() * Math.PI * 2, random() * Math.PI * 2];
    const groundAt = (x: number, z: number): number | null => {
      if (!patch.boulder) return floorHeight(x, z) - 0.05;
      const [lower, upper] = patch.boulder.tiers;
      const d = Math.hypot(x - patch.boulder.x, z - patch.boulder.z);
      if (d < upper.radius - 0.35) return upper.baseY + upper.height - 0.1;
      if (d > upper.radius + 0.45 && d < lower.radius - 0.35) return lower.baseY + lower.height - 0.1;
      return null;
    };
    const attempts = Math.ceil(Math.PI * radius * radius * stretch * 9);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random());
      const edge = patch.boulder ? 1 : 1 + 0.16 * Math.sin(angle * 3 + wobble[0]) + 0.1 * Math.sin(angle * 5 + wobble[1]);
      if (!patch.boulder && random() > 1 - smooth(0.55, 1, r / edge)) continue;
      const lx = Math.cos(angle) * r * radius;
      const lz = Math.sin(angle) * r * radius * stretch;
      const x = patch.x + lx * Math.cos(rotation) - lz * Math.sin(rotation);
      const z = patch.z + lx * Math.sin(rotation) + lz * Math.cos(rotation);
      const y = groundAt(x, z);
      if (y === null || !patchSpot(x, z, patch)) continue;
      // Bigger colonies toward the middle.
      const size = Math.min(spec.maxSize, Math.max(spec.minSize, sizeOf() * (0.75 + 0.35 * (1 - r))));
      tryColony(x, y, z, size, reef);
    }
  });

  function patchSpot(x: number, z: number, patch: Patch): boolean {
    if (patch.boulder) return true;
    return squareRadius(x, z) < bay.wall.radius - bay.wall.width - 8 && wallness(x, z) <= 0 && !ctx.keptClear(x, z, 0.5);
  }

  for (const colony of colonies) reefs[colony.reef].colonies++;
  corals.push(...blobs(colonies));
  corals.forEach((coral, i) => (coral.seed = i));
  return { colonies, reefs, corals };
}

/**
 * The solid shape of the reefs: the colonies of one reef within one `cell` m square (and one metre of height) are hugged
 * by one flattened half-ellipsoid. The big heads are their own shape (added by the caller), so they are left out here.
 */
function blobs(colonies: readonly Colony[]): Coral[] {
  const groups = new Map<string, Colony[]>();
  for (const colony of colonies) {
    if (colony.kind === 4) continue;
    const key = `${colony.reef}|${Math.floor(colony.x / spec.cell)}|${Math.floor(colony.z / spec.cell)}|${Math.round(colony.y)}`;
    const list = groups.get(key);
    if (list) list.push(colony);
    else groups.set(key, [colony]);
  }
  const out: Coral[] = [];
  for (const list of groups.values()) {
    const x = list.reduce((sum, c) => sum + c.x, 0) / list.length;
    const z = list.reduce((sum, c) => sum + c.z, 0) / list.length;
    // Based on the lowest colony, so the floor under the blob is never below its base.
    const y = Math.min(...list.map((c) => c.y));
    let radius = 0;
    let top = 0;
    for (const c of list) {
      radius = Math.max(radius, Math.hypot(c.x - x, c.z - z) + c.size * FOOTPRINT[c.kind] * 0.45);
      top = Math.max(top, c.y - y + c.size * TOP[c.kind]);
    }
    out.push({ x, y, z, radius: Math.min(spec.cell, Math.max(0.9, radius)), height: Math.max(0.45, top * 0.85), seed: 0 });
  }
  return out;
}
