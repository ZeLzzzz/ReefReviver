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
  /** REQ-003: how far the cutter has cut the net it aims at, 0 (not cutting) to 1. */
  cutProgress: number;
  /** REQ-004: the Phase 2 list and the frame prompt. Optional so a state without a reef still renders. */
  reef?: ReefHud;
}

export interface ReefHud {
  /** The Phase 2 objectives; empty until the first deposit. */
  phase2: Objective[];
  /** The ROV is near an empty reef site (and not in the station zone), so E installs a frame. */
  canInstall: boolean;
}
