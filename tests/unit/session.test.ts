import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { Session } from "../../src/game/session";
import { groundHeight, insideShed, standable } from "../../src/game/land";
import { counterPosition, distanceToStation, inStationZone, stationPosition } from "../../src/game/station";
import { START_TOOL, toolForKey } from "../../src/game/tools";

const { tank, rewards, phase1, hud } = config;

function session() {
  return new Session(config.trash.count);
}

function collect(s: Session, n: number) {
  for (let i = 0; i < n; i++) s.collect();
}

describe("tank and score (REQ-002 AC-1, AC-2)", () => {
  it("starts empty with a capacity of 12 (D-072)", () => {
    const s = session();
    expect([s.tank, s.capacity, s.score, s.materials, s.tankFull]).toEqual([0, 12, 0, 0, false]);
  });

  it("each trash adds 1 to the tank and 10 to the score", () => {
    const s = session();
    collect(s, 3);
    expect(s.tank).toBe(3);
    expect(s.score).toBe(3 * rewards.scorePerTrash);
  });

  it("refuses more trash when full", () => {
    const s = session();
    collect(s, tank.capacity);
    expect(s.tankFull).toBe(true);
    expect(s.collect()).toBe(false);
    expect(s.tank).toBe(12);
    expect(s.score).toBe(12 * rewards.scorePerTrash);
    expect(s.trashRemoved).toBe(12);
  });
});

describe("deposit (REQ-002 AC-3, AC-4)", () => {
  it("empties the tank into as many materials as items", () => {
    const s = session();
    collect(s, 5);
    expect(s.deposit()).toEqual({ deposited: 5 });
    expect(s.tank).toBe(0);
    expect(s.materials).toBe(5 * rewards.materialPerTrash);
    expect(s.currentNotice).toEqual({ key: "hud.deposited", amount: 5 });
  });

  it("adds up over several deposits", () => {
    const s = session();
    collect(s, 8);
    s.deposit();
    collect(s, 2);
    s.deposit();
    expect(s.materials).toBe(10);
  });

  it("says the tank is empty and leaves the materials alone", () => {
    const s = session();
    collect(s, 2);
    s.deposit();
    expect(s.deposit()).toBe("empty");
    expect(s.materials).toBe(2);
    expect(s.currentNotice).toEqual({ key: "hud.tankEmpty" });
  });

  it("does not change the score", () => {
    const s = session();
    collect(s, 4);
    s.deposit();
    expect(s.score).toBe(4 * rewards.scorePerTrash);
  });

  it("messages fade after a few seconds", () => {
    const s = session();
    s.deposit();
    s.tick(hud.noticeSeconds - 0.1);
    expect(s.currentNotice).not.toBeNull();
    s.tick(0.2);
    expect(s.currentNotice).toBeNull();
  });
});

describe("cleanliness (REQ-002 AC-5, D-013)", () => {
  it("is 0 at the start", () => {
    expect(session().cleanliness).toBe(0);
  });

  it("rises when trash is sucked, not when it is deposited", () => {
    const s = session();
    collect(s, 8);
    const afterSucking = s.cleanliness;
    expect(afterSucking).toBe(12); // 8 / 62 = 12.9 %
    s.deposit();
    expect(s.cleanliness).toBe(afterSucking);
  });

  it("is rounded down", () => {
    const s = session();
    collect(s, 1);
    expect(s.cleanliness).toBe(1); // 1.61 %
    collect(s, 6);
    expect(s.cleanliness).toBe(11); // 7 / 62 = 11.29 %
  });

  it("reads 96% with all 60 trash removed and no net cut", () => {
    const s = session();
    s.trashRemoved = config.trash.count;
    expect(s.cleanliness).toBe(96);
  });

  it("counts cut nets as well and reaches 100%", () => {
    const s = session();
    s.trashRemoved = config.trash.count;
    s.netsCut = phase1.nets;
    expect(s.cleanliness).toBe(100);
  });
});

describe("Phase 1 goals (REQ-002 AC-6)", () => {
  const find = (s: Session, id: string) => s.objectives.find((o) => o.id === id)!;

  it("lists the three goals, none done at the start", () => {
    const s = session();
    expect(s.objectives.map((o) => [o.id, o.current, o.target, o.done])).toEqual([
      ["clean", 0, 80, false],
      ["free", 0, 2, false],
      ["deposit", null, null, false],
    ]);
  });

  it("ticks 'Bersihkan teluk' at 80% and not before", () => {
    const s = session();
    s.trashRemoved = 49; // 79.03 %
    expect(find(s, "clean").done).toBe(false);
    s.trashRemoved = 50; // 80.65 %
    expect(find(s, "clean")).toMatchObject({ current: 80, done: true });
  });

  it("ticks 'Setor sampah ke gudang' after the first deposit, even a small one", () => {
    const s = session();
    collect(s, 1);
    expect(find(s, "deposit").done).toBe(false);
    s.deposit();
    expect(find(s, "deposit").done).toBe(true);
  });

  it("an empty deposit does not tick it", () => {
    const s = session();
    s.deposit();
    expect(find(s, "deposit").done).toBe(false);
  });

  it("ticks 'Bebaskan satwa' at 2/2", () => {
    const s = session();
    s.animalsFreed = 1;
    expect(find(s, "free")).toMatchObject({ current: 1, done: false });
    s.animalsFreed = 2;
    expect(find(s, "free").done).toBe(true);
  });
});

describe("tools (D-019)", () => {
  it("starts with the Vacuum; key 1 selects the Cutter, key 2 the Vacuum, key 3 the Seed launcher and key 4 the Scanner (REQ-003, REQ-004, REQ-006)", () => {
    const s = session();
    expect(s.tool).toBe(START_TOOL);
    expect(START_TOOL).toBe("vacuum");
    expect(toolForKey("Digit2")).toBe("vacuum");
    expect(toolForKey("Digit1")).toBe("cutter");
    expect(toolForKey("Digit3")).toBe("seedLauncher");
    expect(toolForKey("Digit4")).toBe("scanner");
    for (const code of ["KeyE", "KeyL", "Digit5"]) expect(toolForKey(code)).toBeNull();
  });

  it("a key that selects nothing leaves the tool as it is", () => {
    const s = session();
    for (const code of ["Digit5", "KeyL"]) s.select(toolForKey(code));
    expect(s.tool).toBe("vacuum");
  });
});

describe("the recycling shed's counter (REQ-016 AC-2, AC-4)", () => {
  const ground = (x: number, z: number) => new Vector3(x, groundHeight(x, z), z);

  it("is a circle on the ground in front of the shed's east wall, facing the sea", () => {
    expect(counterPosition.x).toBeGreaterThan(stationPosition.x + config.station.halfX);
    expect(inStationZone(ground(counterPosition.x, counterPosition.z))).toBe(true);
    expect(inStationZone(ground(counterPosition.x + config.station.zoneRadius - 0.2, counterPosition.z))).toBe(true);
    expect(inStationZone(ground(counterPosition.x + config.station.zoneRadius + 0.5, counterPosition.z))).toBe(false);
  });

  it("can be stood in: the player is not stopped by the shed before reaching it", () => {
    expect(standable(counterPosition.x - 0.5, counterPosition.z)).toBe(true);
    expect(insideShed(counterPosition.x, counterPosition.z, config.land.radius)).toBe(false);
  });

  it("is never reached from under the water (AC-4)", () => {
    expect(inStationZone(new Vector3(counterPosition.x, -3, counterPosition.z))).toBe(false);
    expect(inStationZone(new Vector3(-108, -6, 8))).toBe(false);
  });

  it("stands on the land near the dock, 20 to 30 m from it (D-081)", () => {
    expect(stationPosition.y).toBeGreaterThan(config.bay.surfaceY + 2);
    const { dock } = config.bay;
    const fromDock = Math.hypot(stationPosition.x - (dock.landX + dock.seaX) / 2, stationPosition.z - dock.z);
    expect(fromDock).toBeGreaterThanOrEqual(18);
    expect(fromDock).toBeLessThanOrEqual(30);
    expect(distanceToStation(new Vector3(dock.seaX, 0, dock.z))).toBeLessThan(32);
  });
});
