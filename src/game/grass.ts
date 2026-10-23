import { config } from "../config";
import { floorHeight, floorSlope } from "./bay";
import { insideShed, landObstacles } from "./land";
import { mulberry32 } from "./nature";
import { counterPosition } from "./station";
import { inland, wallness } from "./terrain";

const { bay, land, station } = config;
const { dock } = bay;
const { grass } = land;

/** A blade of grass on the land (REQ-018): where its root stands, how it turns and leans, how tall and wide it is. */
export interface Blade {
  x: number;
  y: number;
  z: number;
  yaw: number;
  lean: number;
  height: number;
  width: number;
  /** 0 is the darker of `grass.shades`, 1 the lighter. */
  shade: number;
}

/** The dock and the ground at its landward end, with the structure clearance around them. */
function nearDock(x: number, z: number): boolean {
  const clear = grass.structureClear;
  return x >= dock.landX - clear && x <= dock.seaX + clear && Math.abs(z - dock.z) <= dock.halfWidth + clear;
}

/**
 * Whether grass may grow at (x, z) (REQ-018 AC-1, AC-3): dry ground at least `fromInland` metres inland, not the rock
 * wall, not ground steeper than `maxSlope` (the foot of the cliff), and clear of the shed, the dock, the counter's zone
 * (AC-2), the palms and the rocks.
 */
export function growsGrassAt(x: number, z: number): boolean {
  if (inland(x, z) < grass.fromInland || wallness(x, z) > 0) return false;
  if (floorHeight(x, z) <= bay.surfaceY || floorSlope(x, z) > grass.maxSlope) return false;
  if (insideShed(x, z, grass.structureClear) || nearDock(x, z)) return false;
  if (Math.hypot(x - counterPosition.x, z - counterPosition.z) < station.zoneRadius + grass.counterClear) return false;
  return !landObstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.radius + grass.obstacleClear);
}

/**
 * Lays out every blade once from the seed, so the land is the same on every run and every dive. The random draws
 * do not depend on the rules, so changing one rule moves no other blade.
 */
function generateGrass(): Blade[] {
  const random = mulberry32(grass.seed);
  const blades: Blade[] = [];
  const columns = Math.ceil((bay.shore.waterlineX - land.cliffX) / grass.spacing);
  const rows = Math.ceil((2 * bay.shore.openHalf) / grass.spacing);
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const cx = land.cliffX + (i + random()) * grass.spacing;
      const cz = -bay.shore.openHalf + (j + random()) * grass.spacing;
      if (random() >= grass.tuftChance) continue;
      for (let b = 0; b < grass.bladesPerTuft; b++) {
        const angle = random() * Math.PI * 2;
        const distance = Math.sqrt(random()) * grass.tuftRadius;
        const x = cx + Math.cos(angle) * distance;
        const z = cz + Math.sin(angle) * distance;
        const yaw = random() * Math.PI * 2;
        const lean = (random() - 0.5) * 2 * grass.lean;
        const height = grass.minHeight + random() * (grass.maxHeight - grass.minHeight);
        const width = grass.width * (0.8 + 0.4 * random());
        const shade = random();
        if (growsGrassAt(x, z)) blades.push({ x, y: floorHeight(x, z) - 0.05, z, yaw, lean, height, width, shade });
      }
    }
  }
  return blades;
}

/** Every blade of grass on the land (REQ-018). */
export const grassBlades: readonly Blade[] = generateGrass();

const windLength = Math.hypot(grass.sway.wind.x, grass.sway.wind.z);

/** The way the wind blows, on the ground: a unit vector (x, z) that the tips are pushed toward (REQ-018 AC-4). */
export const windDirection = { x: grass.sway.wind.x / windLength, z: grass.sway.wind.z / windLength };

/**
 * How far the wind pushes a blade's tip along `windDirection` at time `t` (REQ-018 AC-4): nothing at the root (`tip` 0),
 * most at the tip (`tip` 1), and a gust rolling across the field. Never negative, never more than `amplitude`, and it
 * changes smoothly, so the grass sways without flicker. The vertex shader in grass-model.ts makes the same bend.
 */
export function windBend(x: number, z: number, tip: number, t: number): number {
  const { amplitude, period, waveLength } = grass.sway;
  const phase = (2 * Math.PI * t) / period - ((x * windDirection.x + z * windDirection.z) * 2 * Math.PI) / waveLength;
  return amplitude * tip * tip * (0.5 + 0.5 * Math.sin(phase));
}
