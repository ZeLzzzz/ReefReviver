import { config } from "../config";
import { arches, boulders, floorHeight, rocks } from "./bay";
import type { Net } from "./nets";
import { frameStatus, patchStatus, type FrameSite, type PatchSite, type SiteStatus } from "./reef-sites";
import { wallness } from "./terrain";
import type { TrashItem } from "./trash";

const { minimap, bay, station, reef } = config;

/** A point on the map, in map units (0..size, x to the right, y down). */
export interface MapPoint {
  x: number;
  y: number;
}

/** The map shows `extent` metres each way from the bay's centre (REQ-011: the whole bay, walls and shore included). */
const SCALE = minimap.size / (2 * minimap.extent);

/** World (x, z) to the map: north (-Z) is up, east (+X) is right, the bay is centred. */
export function mapPoint(x: number, z: number): MapPoint {
  return { x: (x + minimap.extent) * SCALE, y: (z + minimap.extent) * SCALE };
}

/**
 * The angle, in degrees clockwise from "up" on the map, an arrow must be turned to point where the ROV faces.
 * The ROV faces (sin yaw, cos yaw) in (x, z): yaw 0 is south, and yaw PI is north.
 */
export function headingDegrees(yaw: number): number {
  return (((180 - (yaw * 180) / Math.PI) % 360) + 360) % 360;
}

/**
 * How the map shades a spot (REQ-011 AC-6): land above the water on the shore, the rock wall, or one of the depth
 * bands of the floor, "depth-0" the shallowest (hill tops) to the deepest valleys.
 */
export type Shade = "land" | "wall" | `depth-${number}`;

export function shadeAt(x: number, z: number): Shade {
  const h = floorHeight(x, z);
  if (h > bay.surfaceY) return wallness(x, z) > 0.3 ? "wall" : "land";
  let band = 0;
  while (band < minimap.depthBands.length && h < minimap.depthBands[band]) band++;
  return `depth-${band}`;
}

/** One shade of the terrain: squares of `minimap.cells` per side, merged along each row into one SVG path. */
export interface TerrainShade {
  shade: Shade;
  path: string;
}

function terrainShades(): TerrainShade[] {
  const n = minimap.cells;
  const cell = minimap.size / n;
  const metres = (2 * minimap.extent) / n;
  const paths = new Map<Shade, string[]>();
  const add = (shade: Shade, from: number, to: number, row: number) => {
    if (!paths.has(shade)) paths.set(shade, []);
    paths.get(shade)!.push(`M${(from * cell).toFixed(1)} ${(row * cell).toFixed(1)}h${((to - from) * cell).toFixed(1)}v${cell.toFixed(1)}h${(-(to - from) * cell).toFixed(1)}z`);
  };
  for (let row = 0; row < n; row++) {
    const z = -minimap.extent + (row + 0.5) * metres;
    let runStart = 0;
    let runShade = shadeAt(-minimap.extent + 0.5 * metres, z);
    for (let column = 1; column <= n; column++) {
      const shade = column < n ? shadeAt(-minimap.extent + (column + 0.5) * metres, z) : null;
      if (shade === runShade) continue;
      add(runShade, runStart, column, row);
      if (shade) {
        runStart = column;
        runShade = shade;
      }
    }
  }
  return [...paths].map(([shade, parts]) => ({ shade, path: parts.join("") }));
}

/** What never changes in a dive: the shape of the bay and where the landmarks are. */
export interface MinimapLayout {
  size: number;
  /** The terrain, shaded by depth, with the land and the rock wall (REQ-011 AC-6). */
  terrain: TerrainShade[];
  /** Rocks, boulders and the feet of the arches, in map units. */
  rocks: { x: number; y: number; radius: number }[];
  station: MapPoint;
  /** REQ-016 AC-6: the dock, a line from the beach out over the water. */
  dock: { from: MapPoint; to: MapPoint };
  frames: MapPoint[];
  patches: MapPoint[];
}

const archFeet = arches.flatMap((arch) =>
  [1, -1].map((side) => ({
    ...mapPoint(arch.x + Math.cos(arch.yaw) * arch.radius * side, arch.z - Math.sin(arch.yaw) * arch.radius * side),
    radius: arch.tube * SCALE,
  })),
);

export const minimapLayout: MinimapLayout = {
  size: minimap.size,
  terrain: terrainShades(),
  rocks: [
    ...rocks.map((rock) => ({ ...mapPoint(rock.x, rock.z), radius: rock.size * SCALE })),
    ...boulders.map((boulder) => ({ ...mapPoint(boulder.x, boulder.z), radius: boulder.tiers[0].radius * SCALE })),
    ...archFeet,
  ],
  station: mapPoint(station.x, station.z),
  dock: { from: mapPoint(bay.dock.landX, bay.dock.z), to: mapPoint(bay.dock.seaX, bay.dock.z) },
  frames: reef.frameSites.map((site) => mapPoint(site.x, site.z)),
  patches: reef.seagrassPatches.map((site) => mapPoint(site.x, site.z)),
};

/** A net still trapping an animal, or a trash item on the floor, with where to draw it. */
export interface MapMark extends MapPoint {
  id: number;
}

/** What changes: the ROV, how far each site is, which nets still trap an animal and which trash is shown. */
export interface MinimapState {
  rov: MapPoint & { heading: number };
  /** REQ-015: the submarine floating where it was left, while the player is on the land; null aboard. */
  sub: (MapPoint & { heading: number }) | null;
  frames: SiteStatus[];
  patches: SiteStatus[];
  /** Only the nets that have not been cut (AC-3). */
  nets: MapMark[];
  /** Empty while cleanliness is below the threshold (AC-4); otherwise every item still on the floor. */
  trash: MapMark[];
}

export interface MinimapInput {
  /** The submarine, or the player on foot while on the land. */
  rov: { x: number; z: number; yaw: number };
  /** REQ-015: the parked submarine while the player is on the land. */
  sub?: { x: number; z: number; yaw: number } | null;
  frames: readonly FrameSite[];
  patches: readonly PatchSite[];
  nets: readonly Net[];
  trash: readonly TrashItem[];
  /** Cleanliness in percent, as the HUD shows it. */
  cleanliness: number;
}

/** Trash is on the map only once the bay is clean enough (D-031). */
export function trashVisible(cleanliness: number): boolean {
  return cleanliness >= minimap.trashFromCleanliness;
}

export function buildMinimap({ rov, sub = null, frames, patches, nets, trash, cleanliness }: MinimapInput): MinimapState {
  const marks: MapMark[] = [];
  if (trashVisible(cleanliness)) {
    // Only items lying on the floor: one being pulled in is already gone from the map.
    for (const item of trash) if (item.state === "free") marks.push({ id: item.id, ...mapPoint(item.position.x, item.position.z) });
  }
  return {
    rov: { ...mapPoint(rov.x, rov.z), heading: headingDegrees(rov.yaw) },
    sub: sub ? { ...mapPoint(sub.x, sub.z), heading: headingDegrees(sub.yaw) } : null,
    frames: frames.map(frameStatus),
    patches: patches.map(patchStatus),
    nets: nets.filter((net) => !net.cut).map((net) => ({ id: net.id, ...mapPoint(net.center.x, net.center.z) })),
    trash: marks,
  };
}
