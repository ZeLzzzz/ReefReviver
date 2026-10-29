import { config } from "../config";
import { mulberry32 } from "./nature";
import { floorHeight, floorSlope, OUTER_TERRAIN_STEP, TERRAIN_STEP } from "./terrain";

const { bay, land } = config;
const tuning = land.backdrop;

export interface ForestTree {
  x: number;
  y: number;
  z: number;
  height: number;
  yaw: number;
  variant: number;
  shade: number;
}

// These sites are away from the stitched seam: forest on the coarse west mesh, lighthouse on the detailed headland.
function surfaceHeight(x: number, z: number, step: number): number {
  const x0 = Math.floor((x + bay.halfSize) / step) * step - bay.halfSize;
  const z0 = Math.floor((z + bay.halfSize) / step) * step - bay.halfSize;
  const u = (x - x0) / step, v = (z - z0) / step;
  const a = floorHeight(x0, z0), b = floorHeight(x0 + step, z0);
  const c = floorHeight(x0, z0 + step), d = floorHeight(x0 + step, z0 + step);
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function generateForest(seed = tuning.forest.seed): ForestTree[] {
  const random = mulberry32(seed);
  const { spacing, westX, eastX, halfLength } = tuning.forest;
  const trees: ForestTree[] = [];
  for (let gx = westX + spacing / 2; gx < eastX; gx += spacing) {
    for (let gz = -halfLength + spacing / 2; gz < halfLength; gz += spacing) {
      const x = gx + (random() - 0.5) * spacing * 0.8;
      const z = gz + (random() - 0.5) * spacing * 0.8;
      if (x > eastX || Math.abs(z) > halfLength) continue;
      const grove = Math.sin(x * 0.061 + z * 0.034) * Math.cos(z * 0.052 - x * 0.018);
      if (random() > 0.52 + grove * 0.43 || floorSlope(x, z) > 1.6) continue;
      // Open views behind the house and between two groves expose the more distant ridges.
      if (x > -196 && (Math.abs(z - 8) < 14 || Math.abs(z + 67) < 8)) continue;
      trees.push({
        x, y: surfaceHeight(x, z, OUTER_TERRAIN_STEP), z,
        height: 8 + random() * 6,
        yaw: random() * Math.PI * 2,
        variant: Math.floor(random() * 3), shade: random(),
      });
    }
  }
  return trees;
}

export const forestTrees = generateForest();

const { x, z } = tuning.lighthouse;
const foundationRadius = tuning.lighthouse.baseRadius * 1.4;
const foundationHeights = Array.from({ length: 8 }, (_, i) => {
  const angle = i * Math.PI / 4 + Math.PI / 8;
  return surfaceHeight(x + Math.cos(angle) * foundationRadius, z + Math.sin(angle) * foundationRadius, TERRAIN_STEP);
});
const foundationTop = Math.max(...foundationHeights) + 0.12;
export const lighthouseSite = {
  x, y: foundationTop, z,
  foundationRadius,
  foundationDepth: foundationTop - Math.min(...foundationHeights) + 0.25,
};
