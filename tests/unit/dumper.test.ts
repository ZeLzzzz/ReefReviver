import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { aimedHull } from "../../src/game/cutter";
import { Dumper } from "../../src/game/dumper";
import { buildMinimap } from "../../src/game/minimap";
import { Session } from "../../src/game/session";
import { inland } from "../../src/game/terrain";
import { TrashField, surfaceSpotOk } from "../../src/game/trash";
import type { HudState } from "../../src/game/hud-state";
import { createHud } from "../../src/ui/hud";

const { dumper: tuning, bay } = config;
const player = new Vector3(0, -6, 0);

/** Runs `dumper` for `seconds` in steps of `dt`, collecting what it does. */
function run(dumper: Dumper, seconds: number, bloom = false, dt = 0.1) {
  const drops: { x: number; z: number; floating: boolean }[] = [];
  let arrivals = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const { arrived, drop } = dumper.update(dt, bloom, player);
    if (arrived) arrivals += 1;
    if (drop) drops.push(drop);
  }
  return { drops, arrivals };
}

/** A boat stopped and dumping at its spot. */
function dumping(seed = 3) {
  const dumper = new Dumper();
  dumper.reset(seed);
  run(dumper, tuning.firstAfter + 0.05);
  // Until it has just stopped.
  for (let i = 0; i < 1000 && dumper.phase !== "dumping"; i++) dumper.update(0.1, false, player);
  expect(dumper.phase).toBe("dumping");
  return dumper;
}

describe("the dumping boat (REQ-036)", () => {
  it("comes a while into the dive, from out at sea, says so, and stops at a good spot on the water away from the player (AC-1)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const dumper = new Dumper();
      dumper.reset(seed);
      const before = run(dumper, tuning.firstAfter - 1);
      expect(before.arrivals).toBe(0);
      expect(dumper.seen).toBe(false);
      const coming = run(dumper, 1.05);
      expect(coming.arrivals).toBe(1);
      expect(dumper.phase).toBe("arriving");
      // It comes in from the east, the open sea.
      const start = dumper.position.clone();
      run(dumper, tuning.arriveFrom / tuning.speed + 0.5);
      expect(dumper.phase).toBe("dumping");
      expect(start.x - dumper.position.x).toBeCloseTo(tuning.arriveFrom, 0);
      expect(surfaceSpotOk(dumper.position.x, dumper.position.z)).toBe(true);
      expect(Math.hypot(dumper.position.x - player.x, dumper.position.z - player.z)).toBeGreaterThanOrEqual(tuning.clearOfPlayer);
      expect(dumper.position.y).toBe(bay.surfaceY);
      expect(dumper.crew).toHaveLength(tuning.crew.count);
      expect(dumper.crew.every((person) => person.phase === "aboard")).toBe(true);
    }
  });

  it("drops a piece of trash every 15 seconds next to it, every other one sinking, and stops at 20 (AC-2)", () => {
    const dumper = dumping();
    const first = run(dumper, tuning.firstDrop + 0.05);
    expect(first.drops).toHaveLength(1);
    const next = run(dumper, tuning.dumpEvery - 0.2);
    expect(next.drops).toHaveLength(0);
    const all = [...first.drops, ...run(dumper, tuning.dumpEvery * 30).drops];
    expect(all).toHaveLength(tuning.maxDrops);
    expect(dumper.dumped).toBe(tuning.maxDrops);
    for (const drop of all) {
      const distance = Math.hypot(drop.x - dumper.position.x, drop.z - dumper.position.z);
      expect(distance).toBeGreaterThanOrEqual(tuning.dropRadius[0] - 1e-9);
      expect(distance).toBeLessThanOrEqual(tuning.dropRadius[1] + 1e-9);
    }
    expect(all.filter((drop) => drop.floating).length).toBeGreaterThanOrEqual(tuning.maxDrops / 2);
    expect(all.some((drop) => !drop.floating)).toBe(true);
  });

  it("adds what it drops to the bay's trash: floating at the waterline or sinking to the floor, and gone at the next dive (AC-2)", () => {
    const field = new TrashField(7);
    const laid = field.total;
    const floating = field.drop(40, 20, true);
    const sinking = field.drop(42, 20, false);
    expect(field.total).toBe(laid + 2);
    expect(floating.position.y).toBeCloseTo(bay.surfaceY - config.trash.surface.sink, 6);
    expect(sinking.position.y).toBeGreaterThan(sinking.home.y);
    const fall = sinking.position.y - sinking.home.y;
    field.update(1, new Vector3(0, -30, 0), new Vector3(0, 0, 1), false, 0);
    expect(sinking.position.y).toBeCloseTo(sinking.home.y + fall - tuning.sinkSpeed, 6);
    for (let i = 0; i < 40; i++) field.update(1, new Vector3(0, -30, 0), new Vector3(0, 0, 1), false, 0);
    expect(sinking.position.y).toBeCloseTo(sinking.home.y, 6);
    expect(floating.position.y).toBeCloseTo(floating.home.y, 6);
    field.reset(8);
    expect(field.total).toBe(laid);
  });

  it("lowers the bay's cleanliness with every piece, and pays 100 when capsized (AC-2, AC-4)", () => {
    const session = new Session(60);
    session.trashRemoved = 48;
    const before = session.cleanliness;
    session.addTrash(5);
    expect(session.cleanliness).toBeLessThan(before);
    expect(session.totalTrash).toBe(65);
    const score = session.score;
    session.capsizedBoat();
    expect(session.score).toBe(score + tuning.score);
    expect(session.currentNotice).toEqual({ key: "dumper.capsized", amount: tuning.score });
  });

  it("is turned over by the Cutter: it rolls keel up, stops dumping, sinks, and its crew swims to the beach (AC-4, AC-5)", () => {
    const dumper = dumping(4);
    run(dumper, tuning.firstDrop + 0.05);
    expect(dumper.hull).not.toBeNull();
    dumper.capsize();
    expect(dumper.phase).toBe("capsizing");
    expect(dumper.hull).toBeNull();
    expect(dumper.crew.every((person) => person.phase === "clinging")).toBe(true);
    const dropped = dumper.dumped;
    run(dumper, tuning.rollSeconds + 0.05);
    expect(dumper.roll).toBeCloseTo(Math.PI, 6);
    expect(dumper.phase).toBe("wrecked");
    run(dumper, tuning.crew.clingSeconds);
    expect(dumper.crew.every((person) => person.phase === "swimming")).toBe(true);
    const crewStart = dumper.crew.map((person) => person.position.x);
    run(dumper, 10);
    // Swimming west, to the beach.
    dumper.crew.forEach((person, i) => expect(person.position.x).toBeLessThan(crewStart[i] - 10));
    expect(dumper.position.y).toBeLessThan(bay.surfaceY);
    expect(dumper.dumped).toBe(dropped);
    run(dumper, tuning.crew.maxSwimSeconds);
    expect(dumper.crew.every((person) => person.phase === "ashore")).toBe(true);
  });

  it("brings the next boat a few minutes after the last was turned over, but none once the Bloom has begun (AC-3, AC-6)", () => {
    const dumper = dumping(5);
    dumper.capsize();
    const { arrivals } = run(dumper, tuning.rollSeconds + tuning.floatSeconds + tuning.sinkSeconds + tuning.crew.maxSwimSeconds + tuning.nextAfter[1] + 5);
    expect(arrivals).toBe(1);
    expect(dumper.active).toBe(true);

    const later = new Dumper();
    later.reset(5);
    expect(run(later, tuning.firstAfter * 3, true).arrivals).toBe(0);
    expect(later.phase).toBe("done");
  });

  it("sails away when the Bloom begins while it is still dumping, and never more than one boat is in the bay (AC-3, AC-6)", () => {
    const dumper = dumping(6);
    run(dumper, 1, true);
    expect(dumper.phase).toBe("leaving");
    expect(dumper.hull).toBeNull();
    const there = dumper.position.clone();
    run(dumper, tuning.leaveSeconds, true);
    expect(dumper.position.x).toBeGreaterThan(there.x + 50);
    expect(dumper.phase).toBe("done");
    expect(dumper.seen).toBe(false);
  });

  it("is hit by the Cutter's ray within the cutter's range, unless a nearer net takes the ray (AC-4)", () => {
    const dumper = dumping(2);
    const hull = dumper.hull!;
    const aimFrom = (distance: number) => {
      const origin = new Vector3(hull.center.x - distance, bay.surfaceY - 0.4, hull.center.z);
      const rov = origin.clone().add(new Vector3(2, -0.5, 0));
      return { origin, rov, dir: new Vector3(1, 0, 0) };
    };
    const near = aimFrom(7);
    expect(aimedHull(near.origin, near.dir, near.rov, hull)).not.toBeNull();
    const far = aimFrom(config.cutter.range + 6);
    expect(aimedHull(far.origin, far.dir, far.rov, hull)).toBeNull();
    expect(aimedHull(near.origin, near.dir, near.rov, hull, 2)).toBeNull();
    // Not at it: nothing.
    expect(aimedHull(near.origin, new Vector3(0, 0, 1), near.rov, hull)).toBeNull();
  });
});

describe("the dumping boat on the HUD and the minimap (REQ-036 AC-1, AC-4)", () => {
  const state = (overrides: Partial<HudState> = {}): HudState => {
    const session = new Session(40);
    return {
      tool: "cutter",
      tank: 0,
      capacity: session.capacity,
      tankFull: false,
      score: 0,
      materials: 0,
      cleanliness: 0,
      objectives: session.objectives,
      notice: null,
      inStationZone: false,
      stationDistance: 30,
      marker: { left: 100, top: 200, onScreen: false, angle: 1 },
      sucking: false,
      cutProgress: 0,
      ...overrides,
    };
  };

  it("tops the goals with an urgent line while the boat is in the bay, and names the cutting on its hull", () => {
    const hud = createHud("id");
    hud.update(state());
    const alert = hud.element.querySelector<HTMLElement>(".goal-alert-list")!;
    expect(alert.hidden).toBe(true);
    hud.update(state({ dumper: { active: true, atBoat: false } }));
    expect(alert.hidden).toBe(false);
    expect(alert.textContent).toBe("!Balikkan kapal pembuang sampah");
    hud.update(state({ dumper: { active: true, atBoat: true }, cutProgress: 0.5 }));
    expect(hud.element.querySelector(".cut-label")!.textContent).toBe("Membalikkan kapal 50%");
    hud.update(state({ cutProgress: 0.5 }));
    expect(hud.element.querySelector(".cut-label")!.textContent).toBe("Memotong jaring 50%");
    expect(alert.hidden).toBe(true);
  });

  it("marks the boat on the minimap only while it is there", () => {
    const base = { rov: { x: 0, z: 0, yaw: 0 }, frames: [], patches: [], nets: [], trash: [], cleanliness: 0 };
    expect(buildMinimap(base).dumper).toBeNull();
    const marked = buildMinimap({ ...base, dumper: { x: 30, z: -20 } }).dumper!;
    expect(marked.x).toBeGreaterThan(buildMinimap({ ...base, dumper: { x: 0, z: -20 } }).dumper!.x);
  });

  it("knows where the beach is for the crew: the waterline lies west of the bay", () => {
    expect(inland(0, 0)).toBeLessThan(-100);
  });
});
