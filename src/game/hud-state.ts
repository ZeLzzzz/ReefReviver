import type { MarkerPlacement } from "./marker";
import type { Notice, Objective } from "./session";
import type { ToolId } from "./tools";

/** Everything the HUD shows, produced by the game once per frame. The HUD only reads it. */
export interface HudState {
  tool: ToolId;
  tank: number;
  capacity: number;
  tankFull: boolean;
  score: number;
  materials: number;
  cleanliness: number;
  objectives: Objective[];
  notice: Notice | null;
  /** The ROV is inside the station's deposit zone, so E deposits. */
  inStationZone: boolean;
  /** Metres to the station on the ground plane, rounded. */
  stationDistance: number;
  marker: MarkerPlacement;
  /** The vacuum is pulling right now (button held, tank has room). */
  sucking: boolean;
}
