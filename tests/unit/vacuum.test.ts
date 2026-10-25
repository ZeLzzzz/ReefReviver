import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight, rocks } from "../../src/game/bay";
import { aimDirection } from "../../src/game/follow-camera";
import { Session } from "../../src/game/session";
import { inStationZone, stationPosition } from "../../src/game/station";
import { TrashField, generateTrash } from "../../src/game/trash";
import { inVacuumCone, pickNearestInCone } from "../../src/game/vacuum";

const { vacuum, trash, tank } = config;

/** Faces `target` from `distance` metres away (horizontally) and at the same height; returns nozzle and aim. */
function lookAt(target: Vector3, distance: number, fromYaw = 0) {
  const nozzle = new Vector3(target.x - Math.sin(fromYaw) * distance, target.y, target.z - Math.cos(fromYaw) * distance);
  return { nozzle, aim: aimDirection(fromYaw, 0) };
}

/** Moves every item but the first `keep` far away, so only those can be in the cone (the trash lies in groups, D-066). */
function isolate(field: TrashField, keep = 1) {
  for (const item of field.items.slice(keep)) {
    item.home.set(item.home.x, -500, item.home.z);
    item.position.copy(item.home);
  }
}

/** Runs the field like the game does: sucking, collecting arrivals into the session. */
function run(field: TrashField, session: Session, nozzle: Vector3, aim: Vector3, seconds: number, sucking = true) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const room = session.tankSpace - field.pulling;
    for (const _ of field.update(dt, nozzle, aim, sucking, room)) session.collect();
  }
}

describe("trash layout (D-012)", () => {
  const items = generateTrash();

  it("lays 60 items of three kinds, the same every time (D-066)", () => {
    expect(items).toHaveLength(trash.count);
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(["bottle", "bag", "can"]));
    expect(generateTrash().map((i) => i.home.toArray())).toEqual(items.map((i) => i.home.toArray()));
  });

  it("lies on the floor under water, apart from each other (the beach's 8 and the 8 floating aside: REQ-017, REQ-025)", () => {
    for (const item of items.filter((i) => !i.onBeach && !i.floating)) {
      expect(floorHeight(item.home.x, item.home.z)).toBeLessThan(config.bay.surfaceY - trash.minDepth);
      expect(item.home.y).toBeCloseTo(floorHeight(item.home.x, item.home.z) + trash.restHeight);
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        expect(Math.hypot(items[i].home.x - items[j].home.x, items[i].home.z - items[j].home.z)).toBeGreaterThanOrEqual(trash.spacing);
      }
  });

  it("never lies inside a rock or in the station's deposit zone, and never at the start", () => {
    for (const item of items) {
      for (const rock of rocks) expect(Math.hypot(item.home.x - rock.x, item.home.z - rock.z)).toBeGreaterThan(rock.size);
      expect(inStationZone(item.home)).toBe(false);
      expect(Math.hypot(item.home.x - config.rov.start.x, item.home.z - config.rov.start.z)).toBeGreaterThanOrEqual(trash.clearOfStart);
    }
  });
});

describe("the station stands clear of the rocks (D-011)", () => {
  it("has no rock in its deposit zone", () => {
    for (const rock of rocks) {
      expect(Math.hypot(rock.x - stationPosition.x, rock.z - stationPosition.z)).toBeGreaterThan(config.station.zoneRadius + rock.size);
    }
  });
});

describe("vacuum cone", () => {
  const origin = new Vector3(0, -5, 0);
  const aim = aimDirection(0, 0); // +Z

  it("accepts a point ahead within range and rejects one too far", () => {
    expect(inVacuumCone(origin, aim, { x: 0, y: -5, z: vacuum.range - 0.1 })).toBe(true);
    expect(inVacuumCone(origin, aim, { x: 0, y: -5, z: vacuum.range + 0.1 })).toBe(false);
  });

  it("rejects points outside the cone angle, behind and to the side", () => {
    const edge = 4;
    const inside = Math.tan(vacuum.coneHalfAngle * 0.9) * edge;
    const outside = Math.tan(vacuum.coneHalfAngle * 1.2) * edge;
    expect(inVacuumCone(origin, aim, { x: inside, y: -5, z: edge })).toBe(true);
    expect(inVacuumCone(origin, aim, { x: outside, y: -5, z: edge })).toBe(false);
    expect(inVacuumCone(origin, aim, { x: 0, y: -5, z: -3 })).toBe(false);
    expect(inVacuumCone(origin, aim, { x: 3, y: -5, z: 0.1 })).toBe(false);
  });

  it("picks the nearest of several candidates, or none", () => {
    const far = { x: 0, y: -5, z: 6 };
    const near = { x: 0.3, y: -5, z: 3 };
    expect(pickNearestInCone(origin, aim, [far, near])).toBe(1);
    expect(pickNearestInCone(origin, aim, [{ x: 0, y: -5, z: -4 }])).toBe(-1);
    expect(pickNearestInCone(origin, aim, [])).toBe(-1);
  });
});

describe("sucking trash (REQ-002 AC-1)", () => {
  it("pulls an item in front of the drone to it, then it is gone and the tank, cleanliness and score rise", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    const target = field.items[0];
    isolate(field);
    const { nozzle, aim } = lookAt(target.home, 3);

    run(field, session, nozzle, aim, vacuum.interval + 0.05);
    expect(target.state).toBe("pulling");
    // Half way through the pull it is on its way: between the floor and the drone, and not counted yet.
    expect(session.tank).toBe(0);
    expect(target.position.distanceTo(target.home)).toBeGreaterThan(0);

    run(field, session, nozzle, aim, vacuum.pullDuration + 0.1, false);
    expect(target.state).toBe("collected");
    expect(session.tank).toBe(1);
    expect(session.score).toBe(config.rewards.scorePerTrash);
    expect(session.trashRemoved).toBe(1);
    expect(session.cleanliness).toBe(1); // 1 / 62 = 1.6 %
  });

  it("ends the pull at the drone's position", () => {
    const field = new TrashField();
    const target = field.items[0];
    const { nozzle, aim } = lookAt(target.home, 3);
    field.update(0.01, nozzle, aim, true, 8);
    let last = target.position.clone();
    for (let t = 0; t < 0.5 && target.state === "pulling"; t += 1 / 60) {
      field.update(1 / 60, nozzle, aim, false, 8);
      last = target.position.clone();
    }
    expect(last.distanceTo(nozzle)).toBeLessThan(0.2);
  });

  it("does nothing while the button is not held", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    const { nozzle, aim } = lookAt(field.items[0].home, 3);
    run(field, session, nozzle, aim, 2, false);
    expect(session.tank).toBe(0);
    expect(field.items.every((i) => i.state === "free")).toBe(true);
  });

  it("does not suck trash out of range or off to the side", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    const far = lookAt(field.items[0].home, vacuum.range + 3);
    run(field, session, far.nozzle, far.aim, 1.5);
    expect(session.tank).toBe(0);

    // Clear the neighbours, so only the first item could possibly be sucked.
    for (const item of field.items.slice(1)) item.position.set(0, -50, 0);
    const side = lookAt(field.items[0].home, 3);
    run(field, session, side.nozzle, aimDirection(Math.PI / 2, 0), 1.5);
    expect(session.tank).toBe(0);
  });

  it("takes items one after another while the button stays held", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    const first = field.items[0];
    isolate(field, 3);
    // Put two more items right beside the first so all sit in the cone.
    field.items[1].home.set(first.home.x + 0.6, first.home.y, first.home.z + 0.4);
    field.items[1].position.copy(field.items[1].home);
    field.items[2].home.set(first.home.x - 0.6, first.home.y, first.home.z + 0.8);
    field.items[2].position.copy(field.items[2].home);
    const { nozzle, aim } = lookAt(first.home, 3);
    run(field, session, nozzle, aim, 3);
    expect(session.tank).toBe(3);
    expect(session.trashRemoved).toBe(3);
  });
});

describe("full tank (REQ-002 AC-2)", () => {
  it("stops sucking at 12/12, and the tank never overfills even with trash still in the cone", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    const first = field.items[0];
    isolate(field, 16);
    // A cluster of 16 items in front of the drone.
    for (let i = 0; i < 16; i++) {
      field.items[i].home.set(first.home.x + (i % 4) * 0.5, first.home.y, first.home.z + Math.floor(i / 4) * 0.5);
      field.items[i].position.copy(field.items[i].home);
    }
    const { nozzle, aim } = lookAt(first.home, 3);
    run(field, session, nozzle, aim, 10);
    expect(session.tank).toBe(tank.capacity);
    expect(session.tankFull).toBe(true);
    expect(field.items.filter((i) => i.state === "collected")).toHaveLength(tank.capacity);
    expect(field.items.filter((i) => i.state === "free").length).toBeGreaterThanOrEqual(4);
    expect(field.pulling).toBe(0);
  });

  it("sucks again after a deposit made room", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    session.tank = tank.capacity;
    const { nozzle, aim } = lookAt(field.items[0].home, 3);
    run(field, session, nozzle, aim, 1.5);
    expect(field.items[0].state).toBe("free");
    session.deposit();
    run(field, session, nozzle, aim, 1.5);
    expect(field.items[0].state).toBe("collected");
  });
});

describe("only trash is sucked (REQ-002 AC-7)", () => {
  it("sucks nothing when the vacuum points at a rock, with no trash in the cone", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    let tested = 0;
    for (const rock of rocks) {
      const target = new Vector3(rock.x, rock.y, rock.z);
      // Only consider trash-free views: skip a rock if some trash happens to lie in the cone.
      const { nozzle, aim } = lookAt(target, 3);
      if (field.items.some((i) => inVacuumCone(nozzle, aim, i.position))) continue;
      run(field, session, nozzle, aim, 1.5);
      tested++;
      expect(session.tank).toBe(0);
      expect(session.score).toBe(0);
    }
    expect(tested).toBeGreaterThan(6);
    expect(field.items.every((i) => i.state === "free")).toBe(true);
  });

  it("only ever has trash to pick: the field holds nothing but trash items at their own spots", () => {
    const field = new TrashField();
    for (const item of field.items) {
      expect(["bottle", "bag", "can"]).toContain(item.kind);
      for (const rock of rocks) expect(Math.hypot(item.home.x - rock.x, item.home.z - rock.z)).toBeGreaterThan(rock.size);
    }
  });
});

describe("new dive", () => {
  it("reset puts every item back on the floor", () => {
    const field = new TrashField();
    const session = new Session(field.total);
    const { nozzle, aim } = lookAt(field.items[0].home, 3);
    run(field, session, nozzle, aim, 1.5);
    expect(field.items[0].state).toBe("collected");
    field.reset();
    expect(field.items.every((i) => i.state === "free" && i.position.equals(i.home))).toBe(true);
  });
});
