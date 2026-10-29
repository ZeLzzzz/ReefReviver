import type { LogbookId } from "../logbook/entries";
import type { CinematicHud } from "./cinematic";
import type { MarkerPlacement } from "./marker";
import type { MinimapState } from "./minimap";
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
  /** REQ-005: the Phase 3 list ("Pindai 0/7"), present once the Bloom is over; it replaces the Phase 1 and 2 lists (D-049). */
  phase3?: Objective[];
  /**
   * REQ-036: a dumping boat is in the bay (its goal shows), and whether the cutter is working on its hull (`cutProgress`).
   * REQ-037: where the marker to it goes (null while there is none to point at) and how far it is, in metres.
   */
  dumper?: { active: boolean; atBoat: boolean; marker?: MarkerPlacement | null; distance?: number };
  /** REQ-006: how far the scanner has scanned what the crosshair aims at, 0 (not scanning) to 1. */
  scanProgress?: number;
  /** REQ-006: the Logbook entries scanned so far, in the order of the Logbook; the Logbook screen reads them. */
  unlocked?: readonly LogbookId[];
  /** REQ-010: what the minimap draws. Optional so a state without a map still renders. */
  minimap?: MinimapState;
  /** REQ-015: on foot or aboard, and the prompts to get out or back in. Optional so an older state still renders. */
  land?: LandHud;
  /** REQ-027, REQ-028: the cinematic that is playing, or null: the HUD hides itself, and the bars and the narration show. */
  cinematic?: CinematicHud | null;
}

export interface LandHud {
  /** The player is on foot on the land: no tools, and E boards the submarine. */
  onLand: boolean;
  /** Aboard, close enough to the west shore that E goes ashore. */
  canGoAshore: boolean;
  /** On foot, close enough to the submarine that E gets back in. */
  canBoard: boolean;
  /** REQ-017: on foot with the crosshair on trash within reach, so E picks it up (before depositing or boarding). */
  canPickUp?: boolean;
  /** 0 (clear) to 1 (dark): the short fade while getting out or in, going dark after a skip, and coming up from black as the opening begins. */
  fade: number;
}

export interface ReefHud {
  /** The Phase 2 objectives; empty until the first deposit. */
  phase2: Objective[];
  /** The ROV is near an empty reef site (and not in the station zone), so E installs a frame. */
  canInstall: boolean;
}
