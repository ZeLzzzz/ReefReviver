import { config } from "../config";
import { floorHeight, floorSlope, headland, inland, TERRAIN_STEP } from "./terrain";
import { insideShed, landObstacles } from "./land";
import { mulberry32 } from "./nature";
import { counterPosition } from "./station";

const { land, bay, station } = config;
const tuning = land.beachDecor;
const { dock } = bay;

export type BeachKind = "scallop" | "clam" | "spiral" | "fragment" | "coconut" | "green-coconut";
export interface BeachItem {
  kind: BeachKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  shade: number;
  normal: [number, number, number];
}

/** Barycentric height and normal of the visible sand, rather than the curved height field below its mesh. */
export function beachSurface(x: number, z: number): { y: number; normal: [number, number, number] } {
  const step = TERRAIN_STEP;
  const x0 = Math.floor((x + bay.halfSize) / step) * step - bay.halfSize;
  const z0 = Math.floor((z + bay.halfSize) / step) * step - bay.halfSize;
  const u = (x - x0) / step;
  const v = (z - z0) / step;
  const a = floorHeight(x0, z0), b = floorHeight(x0 + step, z0), c = floorHeight(x0, z0 + step), d = floorHeight(x0 + step, z0 + step);
  const lower = u + v <= 1;
  const dx = (lower ? b - a : d - c) / step;
  const dz = (lower ? c - a : d - b) / step;
  const length = Math.hypot(dx, 1, dz);
  const y = lower ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  return { y, normal: [-dx / length, 1 / length, -dz / length] };
}

export function beachDecorSpotOk(x: number, z: number, radius: number): boolean {
  if (x < -bay.halfSize + TERRAIN_STEP || Math.abs(z) > tuning.halfLength) return false;
  if (floorHeight(x, z) < bay.surfaceY + 0.12 || headland(x, z) > 0 || floorSlope(x, z) > tuning.maxSlope) return false;
  if (insideShed(x, z, tuning.structureClear + radius)) return false;
  if (Math.hypot(x - counterPosition.x, z - counterPosition.z) < station.zoneRadius + 0.6 + radius) return false;
  // Keep the walking route from the dock to the counter clear as well as the dock itself.
  if (x > station.x + station.halfX && Math.abs(z - dock.z) < dock.halfWidth + 1 + radius) return false;
  return !landObstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + Math.max(land.radius, radius + 0.12));
}

export function generateBeachItems(seed = tuning.seed): BeachItem[] {
  const random = mulberry32(seed);
  const items: BeachItem[] = [];
  const shells: BeachKind[] = ["scallop", "clam", "spiral", "fragment"];
  const place = (kind: BeachKind, x: number, z: number, size: number): boolean => {
    const radius = size * 0.53;
    if (!beachDecorSpotOk(x, z, radius)) return false;
    if (items.some((item) => Math.hypot(x - item.x, z - item.z) < (size + item.size) * 0.45)) return false;
    const surface = beachSurface(x, z);
    if (surface.y <= bay.surfaceY + 0.08) return false;
    items.push({ kind, x, y: surface.y + 0.006, z, normal: surface.normal, size, yaw: random() * Math.PI * 2, shade: random() });
    return true;
  };
  const shell = (x: number, z: number) => {
    const fromWater = inland(x, z);
    if (fromWater < tuning.minInland || fromWater > tuning.maxInland) return;
    const pick = random();
    const kind = shells[pick < 0.4 ? 0 : pick < 0.72 ? 1 : pick < 0.88 ? 2 : 3];
    const size = tuning.shellSize[0] + Math.pow(random(), 1.5) * (tuning.shellSize[1] - tuning.shellSize[0]);
    place(kind, x, z, kind === "fragment" ? size * 0.7 : size);
  };
  for (let patch = 0; patch < tuning.shellPatches; patch++) {
    const z = -tuning.halfLength + (patch + 0.5) * tuning.halfLength * 2 / tuning.shellPatches + (random() - 0.5) * 2;
    const depth = 2.6 + Math.sin(z * 0.13) * 0.75 + (patch % 3 === 0 ? 2 : 0);
    const x = inland(0, z) - depth;
    const count = tuning.shellsPerPatch[0] + Math.floor(random() * (tuning.shellsPerPatch[1] - tuning.shellsPerPatch[0]));
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const spread = Math.sqrt(random());
      shell(x + Math.cos(angle) * spread * 1.1, z + Math.sin(angle) * spread * 2.1);
    }
  }
  for (let i = 0; i < tuning.looseShells; i++) {
    const z = (random() * 2 - 1) * tuning.halfLength;
    shell(inland(0, z) - tuning.minInland - random() * (tuning.maxInland - tuning.minInland), z);
  }
  land.palms.forEach((palm, index) => {
    const bend = Math.tan(palm.lean) * palm.height * 0.72;
    const turn = 0.5 * Math.sin(index * 2.3);
    const cx = palm.x + Math.cos(turn) * bend;
    const cz = palm.z - Math.sin(turn) * bend;
    let placed = 0;
    for (let attempt = 0; placed < tuning.coconutsPerPalm && attempt < 80; attempt++) {
      const angle = random() * Math.PI * 2;
      const distance = 0.6 + Math.sqrt(random()) * tuning.coconutSpread;
      const size = tuning.coconutSize[0] + random() * (tuning.coconutSize[1] - tuning.coconutSize[0]);
      if (place(placed % 3 === 0 ? "green-coconut" : "coconut", cx + Math.cos(angle) * distance, cz + Math.sin(angle) * distance, size)) placed++;
    }
  });
  return items;
}

export const beachItems: readonly BeachItem[] = generateBeachItems();

/** Decorations leave space around the current dive's collectible trash. */
export function beachItemsClearOf(trash: readonly { x: number; z: number }[]): BeachItem[] {
  return beachItems.filter((item) => !trash.some((p) => Math.hypot(item.x - p.x, item.z - p.z) < tuning.trashClear + item.size * 0.53));
}
