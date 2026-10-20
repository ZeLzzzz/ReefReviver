import { config } from "../config";
import type { StringKey } from "../i18n/i18n";
import { LOGBOOK_ENTRIES } from "../logbook/entries";
import { bloomReady } from "./bloom";
import type { AnimalSpecies } from "./nets";
import { START_TOOL, type ToolId } from "./tools";

const { tank, rewards, phase1, hud, nets, reef } = config;

export type ObjectiveId = "clean" | "free" | "deposit" | "frames" | "coral" | "seagrass" | "scan";

export interface Objective {
  id: ObjectiveId;
  /** Progress and goal for the counted objectives (clean %, animals freed); null for the yes/no one. */
  current: number | null;
  target: number | null;
  done: boolean;
}

/** A short message in the HUD; `amount` is added after the text. */
export interface Notice {
  key: StringKey;
  amount?: number;
}

export type DepositResult = { deposited: number } | "empty";

/**
 * The rules of one dive: tank, score, materials, cleanliness and the Phase 1 objectives.
 * Pure state, no rendering; the HUD only reads it.
 */
export class Session {
  tool: ToolId = START_TOOL;
  tank = 0;
  score = 0;
  materials = 0;
  /** Trash taken up by the vacuum (counts for cleanliness at once, not at deposit; AC-5). */
  trashRemoved = 0;
  /** Total trash deposited so far, for the "Setor sampah ke stasiun" objective. */
  trashDeposited = 0;
  /** Nets cut and animals freed by the cutter (REQ-003). */
  netsCut = 0;
  animalsFreed = 0;
  // REQ-004 progress: frames installed, frames planted with coral (3 fragments), seagrass patches planted (3 seeds).
  framesInstalled = 0;
  framesPlanted = 0;
  patchesPlanted = 0;
  // REQ-005: the Bloom has finished, which opens the Scanner and the Phase 3 list; entries scanned (REQ-006 counts them).
  bloomDone = false;
  entriesScanned = 0;
  private notice: Notice | null = null;
  private noticeLeft = 0;

  constructor(readonly totalTrash: number) {}

  get capacity(): number {
    return tank.capacity;
  }

  get tankFull(): boolean {
    return this.tank >= tank.capacity;
  }

  get tankSpace(): number {
    return tank.capacity - this.tank;
  }

  /** (trash removed + nets cut) / (total trash + total nets) x 100, rounded down (AC-5). */
  get cleanliness(): number {
    const total = this.totalTrash + phase1.nets;
    return Math.floor((100 * (this.trashRemoved + this.netsCut)) / total);
  }

  /** One trash item reached the ROV. Returns false when the tank had no room. */
  collect(): boolean {
    if (this.tankFull) return false;
    this.tank += 1;
    this.trashRemoved += 1;
    this.score += rewards.scorePerTrash;
    return true;
  }

  /** E at the station: empties the tank into materials (AC-3), or says the tank is empty (AC-4). */
  deposit(): DepositResult {
    if (this.tank === 0) {
      this.say({ key: "hud.tankEmpty" });
      return "empty";
    }
    const deposited = this.tank;
    this.tank = 0;
    this.trashDeposited += deposited;
    this.materials += deposited * rewards.materialPerTrash;
    this.say({ key: "hud.deposited", amount: deposited * rewards.materialPerTrash });
    return { deposited };
  }

  /** REQ-003: a net was cut and its animal is free. +100 score, counts for cleanliness and the "free" goal (AC-2). */
  freeAnimal(species: AnimalSpecies): void {
    this.netsCut += 1;
    this.animalsFreed += 1;
    this.score += nets.scorePerAnimal;
    this.say({ key: `animals.${species}.freed`, amount: nets.scorePerAnimal });
  }

  /** E at an empty reef site: pays for a frame (AC-2), or says how much is missing (AC-3). */
  buyFrame(): boolean {
    if (this.materials < reef.frameCost) {
      this.say({ key: "reef.needMaterials" });
      return false;
    }
    this.materials -= reef.frameCost;
    this.framesInstalled += 1;
    this.say({ key: "reef.frameInstalled" });
    return true;
  }

  /** A coral fragment attached to a frame; the frame's last fragment plants it (AC-4, D-030). */
  coralAttached(planted: boolean): void {
    if (!planted) return this.say({ key: "seed.coralAttached" });
    this.framesPlanted += 1;
    this.score += reef.scorePerPlanted;
    this.say({ key: "reef.framePlanted", amount: reef.scorePerPlanted });
  }

  /** A seagrass seed was planted; the patch's last seed plants it (AC-5, D-030). */
  seedPlanted(planted: boolean): void {
    if (!planted) return this.say({ key: "seed.seedPlanted" });
    this.patchesPlanted += 1;
    this.score += reef.scorePerPlanted;
    this.say({ key: "seagrass.patchPlanted", amount: reef.scorePerPlanted });
  }

  /** The tool a key selected; null leaves the current tool alone. */
  select(tool: ToolId | null): void {
    if (tool) this.tool = tool;
  }

  say(notice: Notice): void {
    this.notice = notice;
    this.noticeLeft = hud.noticeSeconds;
  }

  /** Lets a message fade; call once per simulated frame. */
  tick(dt: number): void {
    if (!this.notice) return;
    this.noticeLeft -= dt;
    if (this.noticeLeft <= 0) this.notice = null;
  }

  get currentNotice(): Notice | null {
    return this.notice;
  }

  /** The Phase 1 list (AC-6); an objective is done once it is met and stays done. */
  get objectives(): Objective[] {
    return [
      { id: "clean", current: this.cleanliness, target: phase1.cleanTarget, done: this.cleanliness >= phase1.cleanTarget },
      { id: "free", current: this.animalsFreed, target: phase1.animals, done: this.animalsFreed >= phase1.animals },
      { id: "deposit", current: null, target: null, done: this.trashDeposited > 0 },
    ];
  }

  /** The Phase 2 list (AC-7): empty until the first deposit, then shown below the Phase 1 list. */
  get phase2Objectives(): Objective[] {
    if (this.trashDeposited === 0) return [];
    const row = (id: ObjectiveId, current: number, target: number): Objective => ({ id, current, target, done: current >= target });
    return [
      row("frames", this.framesInstalled, reef.frameSites.length),
      row("coral", this.framesPlanted, reef.frameSites.length),
      row("seagrass", this.patchesPlanted, reef.seagrassPatches.length),
    ];
  }

  /** REQ-005 AC-1: cleanliness 80 % or more, three frames and two seagrass patches planted. */
  get bloomReady(): boolean {
    return bloomReady({ cleanliness: this.cleanliness, framesPlanted: this.framesPlanted, patchesPlanted: this.patchesPlanted });
  }

  /** REQ-005 AC-5: the Bloom is over; the Scanner is open (a notice) and the Phase 3 list replaces the others. */
  openScanner(): void {
    this.bloomDone = true;
    this.say({ key: "bloom.scannerOpen" });
  }

  /** The Phase 3 list (D-049): empty until the Bloom is over; "Pindai 0/7", one point for each Logbook entry. */
  get phase3Objectives(): Objective[] {
    if (!this.bloomDone) return [];
    const target = LOGBOOK_ENTRIES.length;
    return [{ id: "scan", current: this.entriesScanned, target, done: this.entriesScanned >= target }];
  }
}
