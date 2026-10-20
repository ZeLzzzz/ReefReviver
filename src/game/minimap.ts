import { config } from "../config";
import { rocks } from "./bay";
import type { Net } from "./nets";
import { frameStatus, patchStatus, type FrameSite, type PatchSite, type SiteStatus } from "./reef-sites";
import type { TrashItem } from "./trash";

const { minimap, bay, station, reef } = config;

/** A point on the map, in map units (0..size, x to the right, y down). */
export interface MapPoint {
  x: number;
  y: number;
}

/** Half the width of the area the map shows, in metres: the cliff circle and a margin. */
const HALF_EXTENT = bay.cliffRadius + minimap.margin;
const SCALE = minimap.size / (2 * HALF_EXTENT);

/** World (x, z) to the map: north (-Z) is up, east (+X) is right, the bay is centred. */
export function mapPoint(x: number, z: number): MapPoint {
  return { x: (x + HALF_EXTENT) * SCALE, y: (z + HALF_EXTENT) * SCALE };
}

/**
 * The angle, in degrees clockwise from "up" on the map, an arrow must be turned to point where the ROV faces.
 * The ROV faces (sin yaw, cos yaw) in (x, z): yaw 0 is south, and yaw PI (the start) is north.
 */
export function headingDegrees(yaw: number): number {
  return (((180 - (yaw * 180) / Math.PI) % 360) + 360) % 360;
}

/** What never changes in a dive: the shape of the bay and where the landmarks are. */
export interface MinimapLayout {
  size: number;
  /** The cliff circle, in map units. */
  bay: { x: number; y: number; radius: number };
  rocks: { x: number; y: number; radius: number }[];
  station: MapPoint;
  frames: MapPoint[];
  patches: MapPoint[];
}

export const minimapLayout: MinimapLayout = {
  size: minimap.size,
  bay: { x: minimap.size / 2, y: minimap.size / 2, radius: bay.cliffRadius * SCALE },
  rocks: rocks.map((rock) => ({ ...mapPoint(rock.x, rock.z), radius: rock.size * SCALE })),
  station: mapPoint(station.x, station.z),
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
  frames: SiteStatus[];
  patches: SiteStatus[];
  /** Only the nets that have not been cut (AC-3). */
  nets: MapMark[];
  /** Empty while cleanliness is below the threshold (AC-4); otherwise every item still on the floor. */
  trash: MapMark[];
}

export interface MinimapInput {
  rov: { x: number; z: number; yaw: number };
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

export function buildMinimap({ rov, frames, patches, nets, trash, cleanliness }: MinimapInput): MinimapState {
  const marks: MapMark[] = [];
  if (trashVisible(cleanliness)) {
    // Only items lying on the floor: one being pulled in is already gone from the map.
    for (const item of trash) if (item.state === "free") marks.push({ id: item.id, ...mapPoint(item.position.x, item.position.z) });
  }
  return {
    rov: { ...mapPoint(rov.x, rov.z), heading: headingDegrees(rov.yaw) },
    frames: frames.map(frameStatus),
    patches: patches.map(patchStatus),
    nets: nets.filter((net) => !net.cut).map((net) => ({ id: net.id, ...mapPoint(net.center.x, net.center.z) })),
    trash: marks,
  };
}
