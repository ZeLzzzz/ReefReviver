import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { atDiveEdge, floorHeight, isSolidAt, terrainSolidAt } from "../../src/game/bay";
import { aimDirection } from "../../src/game/follow-camera";
import { ashoreSpot } from "../../src/game/land";
import { chooseLayout } from "../../src/game/layout";
import { buildMinimap } from "../../src/game/minimap";
import { FLOAT_Y } from "../../src/game/rov";
import { findAimPoint } from "../../src/game/seed-launcher";
import { Session } from "../../src/game/session";
import { headland, inDiveArea, inland, squareRadius } from "../../src/game/terrain";
import { TrashField, generateTrash, type TrashItem } from "../../src/game/trash";
import { createTrashView } from "../../src/game/trash-model";

const { trash, vacuum, bay, rov } = config;
const { surface } = trash;
const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 3);
const layoutOf = (seed: number) => generateTrash(chooseLayout(seed).trashSeed);
const floating = (items: readonly TrashItem[]) => items.filter((item) => item.floating);

/** Items within a few metres of each other make one group; groups are far apart (groupSpacing). */
function groupsOf(items: readonly TrashItem[]): TrashItem[][] {
  const groups: TrashItem[][] = [];
  for (const item of items) {
    const group = groups.find((g) => g.some((other) => Math.hypot(other.home.x - item.home.x, other.home.z - item.home.z) < 2 * surface.groupRadius + 1));
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

/** A field with only the floating item `index` kept near; the rest are sent far away so only it can be in the cone. */
function isolate(field: TrashField, keep: TrashItem): void {
  for (const item of field.items) {
    if (item === keep) continue;
    item.home.set(item.home.x, -500, item.home.z);
    item.position.copy(item.home);
  }
}

/** The submarine `distance` m (horizontally) from the item, `below` m under its floating height, aimed at it. */
function aimFrom(item: TrashItem, distance: number, below = 0, yaw = 0) {
  const nozzle = new Vector3(item.position.x - Math.sin(yaw) * distance, FLOAT_Y - below, item.position.z - Math.cos(yaw) * distance);
  const pitch = Math.atan2(item.position.y - nozzle.y, distance);
  return { nozzle, aim: aimDirection(yaw, pitch) };
}

function suck(field: TrashField, session: Session, nozzle: Vector3, aim: Vector3, seconds: number): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    for (const _ of field.update(dt, nozzle, aim, true, session.tankSpace - field.pulling)) session.collect();
  }
}

describe("the surface's share of the trash (REQ-025 AC-1)", () => {
  it("is 8 of the 60 items, 44 on the floor (6 in the cave) and 8 on the beach, for every seed", () => {
    for (const seed of seeds) {
      const items = layoutOf(seed);
      expect(items).toHaveLength(trash.count);
      expect(floating(items)).toHaveLength(8);
      expect(items.filter((i) => i.onBeach)).toHaveLength(8);
      const floor = items.filter((i) => !i.floating && !i.onBeach);
      expect(floor).toHaveLength(44);
      expect(floor.filter((i) => i.home.y < bay.cave.floorY + 2 && Math.hypot(i.home.x - bay.cave.x, i.home.z - bay.cave.z) < bay.cave.clear)).toHaveLength(6);
      // The beach's items keep ids from 52 on; the floating ones come between the floor's and the beach's.
      expect(items.filter((i) => i.onBeach).every((i) => i.id >= 52)).toBe(true);
      expect(floating(items).map((i) => i.id)).toEqual([44, 45, 46, 47, 48, 49, 50, 51]);
      expect(items.every((item, i) => item.id === i)).toBe(true);
    }
  });

  it("gathers in 2 or 3 small groups over water at least 3 m deep", () => {
    const counts = new Set<number>();
    for (const seed of seeds) {
      const groups = groupsOf(floating(layoutOf(seed)));
      counts.add(groups.length);
      expect(groups.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(groups.length, `seed ${seed}`).toBeLessThanOrEqual(3);
      for (const group of groups) {
        expect(group.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
        expect(group.length, `seed ${seed}`).toBeLessThanOrEqual(4);
      }
      for (const item of floating(layoutOf(seed))) expect(floorHeight(item.home.x, item.home.z), `seed ${seed}`).toBeLessThanOrEqual(bay.surfaceY - surface.minDepth);
    }
    expect(counts).toEqual(new Set([2, 3]));
  });

  it("keeps at least one group within 50 m of the west beach's waterline, in front of the beach", () => {
    for (const seed of seeds) {
      const groups = groupsOf(floating(layoutOf(seed)));
      const near = groups.filter((g) => g.every((i) => -inland(i.home.x, i.home.z) <= 50 && Math.abs(i.home.z) <= bay.shore.openHalf));
      expect(near.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps the items apart from each other", () => {
    for (const seed of seeds.slice(0, 60)) {
      const items = layoutOf(seed);
      for (const a of floating(items)) for (const b of floating(items)) if (a !== b) expect(Math.hypot(a.home.x - b.home.x, a.home.z - b.home.z)).toBeGreaterThanOrEqual(surface.spacing - 1e-6);
    }
  });

  it("is laid somewhere else each dive, the same for the same seed, and the same after a reset with a seed (REQ-012)", () => {
    const key = (seed: number) => floating(layoutOf(seed)).map((i) => `${i.home.x.toFixed(2)},${i.home.z.toFixed(2)}`).join(";");
    expect(key(42)).toBe(key(42));
    expect(new Set(seeds.slice(0, 50).map(key)).size).toBeGreaterThan(45);
    const field = new TrashField(chooseLayout(5).trashSeed);
    field.reset(chooseLayout(9).trashSeed);
    const fresh = layoutOf(9);
    expect(field.items.map((i) => i.home.toArray())).toEqual(fresh.map((i) => i.home.toArray()));
    expect(field.items.map((i) => i.floating)).toEqual(fresh.map((i) => i.floating));
  });

  it("leaves the floor's and the cave's layout where it was without the floating items", () => {
    // The floating items draw from a random stream of their own: the same seed lays the same floor items whatever they do.
    const a = layoutOf(77).filter((i) => !i.floating && !i.onBeach);
    expect(a.map((i) => i.home.toArray())).toEqual(layoutOf(77).filter((i) => !i.floating && !i.onBeach).map((i) => i.home.toArray()));
  });
});

describe("a floating item (REQ-025 AC-2)", () => {
  it("floats half under water at the waterline, and is only ever a bottle or a bag", () => {
    for (const seed of seeds) {
      for (const item of floating(layoutOf(seed))) {
        expect(["bottle", "bag"]).toContain(item.kind);
        expect(item.home.y).toBeCloseTo(bay.surfaceY - surface.sink, 6);
        expect(item.position.toArray()).toEqual(item.home.toArray());
        expect(item.state).toBe("free");
      }
    }
  });

  it("includes both bottles and bags, while the cans stay on the floor", () => {
    const kinds = new Set(floating(layoutOf(1)).map((i) => i.kind));
    expect(kinds).toEqual(new Set(["bottle", "bag"]));
    expect(layoutOf(1).filter((i) => i.kind === "can").every((i) => !i.floating)).toBe(true);
  });

  it("bobs and tilts in its model only, each item on its own phase, and its position stays put", () => {
    const items = layoutOf(3);
    const view = createTrashView(items);
    const heights: number[][] = [];
    for (let seconds = 0; seconds < 8; seconds += 0.25) {
      view.sync(items, seconds);
      heights.push(view.group.children.map((model, id) => model.position.y - items[id].position.y));
      for (const item of items) expect(item.position.toArray()).toEqual(item.home.toArray());
    }
    const swing = (id: number) => Math.max(...heights.map((h) => h[id])) - Math.min(...heights.map((h) => h[id]));
    for (const item of floating(items)) {
      expect(swing(item.id), `item ${item.id}`).toBeGreaterThan(surface.bob.amplitude);
      expect(Math.max(...heights.map((h) => Math.abs(h[item.id])))).toBeLessThanOrEqual(surface.bob.amplitude + 1e-9);
    }
    for (const item of items.filter((i) => !i.floating)) expect(swing(item.id)).toBe(0);
    // Not all in step.
    const first = floating(items).map((i) => heights[0][i.id].toFixed(4));
    expect(new Set(first).size).toBeGreaterThan(4);
  });

  it("stays put in the field: nothing moves a free floating item on its own (no drift)", () => {
    const field = new TrashField(chooseLayout(4).trashSeed);
    const before = field.items.map((i) => i.position.toArray());
    for (let t = 0; t < 600; t++) field.update(1 / 60, new Vector3(0, -50, 0), new Vector3(0, 0, 1), false, 12);
    expect(field.items.map((i) => i.position.toArray())).toEqual(before);
  });
});

describe("sucking a floating item (REQ-025 AC-4)", () => {
  const field = () => new TrashField(chooseLayout(6).trashSeed);

  for (const [where, below] of [
    ["from the floating submarine", 0],
    ["from 3 m below the surface", 3],
  ] as const) {
    it(`takes it in ${where}: tank +1, score +10, cleanliness rises`, () => {
      const f = field();
      const item = floating(f.items)[0];
      isolate(f, item);
      const session = new Session(f.total);
      const { nozzle, aim } = aimFrom(item, 4, below);
      suck(f, session, nozzle, aim, 1.5);
      expect(item.state).toBe("collected");
      expect(session.tank).toBe(1);
      expect(session.score).toBe(config.rewards.scorePerTrash);
      expect(session.trashRemoved).toBe(1);
      expect(session.cleanliness).toBe(Math.floor(100 / (f.total + config.phase1.nets)));
    });
  }

  it("pulls it from where it floats to the submarine, not up from the floor", () => {
    const f = field();
    const item = floating(f.items)[0];
    isolate(f, item);
    const { nozzle, aim } = aimFrom(item, 4);
    f.update(1 / 60, nozzle, aim, true, 12);
    expect(item.state).toBe("pulling");
    f.update(0.2, nozzle, aim, true, 11);
    expect(item.position.y).toBeGreaterThan(nozzle.y - 0.01);
    expect(item.position.y).toBeLessThanOrEqual(item.home.y + 0.01);
  });
});

describe("a floating item that stays (REQ-025 AC-5)", () => {
  const f0 = () => new TrashField(chooseLayout(6).trashSeed);

  it("stays when the tank is full: nothing changes, and the full tank shows", () => {
    const f = f0();
    const item = floating(f.items)[0];
    isolate(f, item);
    const session = new Session(f.total);
    for (let i = 0; i < session.capacity; i++) session.collect();
    const { nozzle, aim } = aimFrom(item, 4);
    const score = session.score;
    suck(f, session, nozzle, aim, 1.5);
    expect(item.state).toBe("free");
    expect(session.tank).toBe(session.capacity);
    expect(session.score).toBe(score);
    expect(session.tankFull).toBe(true);
  });

  it("stays when it is beyond the vacuum's range", () => {
    const f = f0();
    const item = floating(f.items)[0];
    isolate(f, item);
    const session = new Session(f.total);
    const { nozzle, aim } = aimFrom(item, vacuum.range + 1);
    suck(f, session, nozzle, aim, 1.5);
    expect(item.state).toBe("free");
    expect(session.tank).toBe(0);
    expect(session.score).toBe(0);
  });

  it("stays when it is outside the aim cone", () => {
    const f = f0();
    const item = floating(f.items)[0];
    isolate(f, item);
    const session = new Session(f.total);
    const { nozzle } = aimFrom(item, 4);
    // Looking 60 degrees to the side of it.
    suck(f, session, nozzle, aimDirection(Math.PI / 3, 0), 1.5);
    expect(item.state).toBe("free");
    expect(session.tank).toBe(0);
  });
});

describe("a floating item counts (REQ-025 AC-6)", () => {
  it("counts in the cleanliness percentage, like the others", () => {
    const f = new TrashField(chooseLayout(6).trashSeed);
    const session = new Session(f.total);
    for (const item of floating(f.items)) {
      item.state = "collected";
      session.trashRemoved += 1;
    }
    expect(session.cleanliness).toBe(Math.floor((100 * 8) / (f.total + config.phase1.nets)));
  });

  it("shows on the minimap as a trash dot from 70% cleanliness on, not before, and no more once collected", () => {
    const f = new TrashField(chooseLayout(6).trashSeed);
    const input = (cleanliness: number) => ({ rov: { x: 0, z: 0, yaw: 0 }, frames: [], patches: [], nets: [], trash: f.items, cleanliness });
    const ids = (cleanliness: number) => buildMinimap(input(cleanliness)).trash.map((m) => m.id);
    expect(ids(69)).toEqual([]);
    for (const item of floating(f.items)) expect(ids(70)).toContain(item.id);
    const gone = floating(f.items)[0];
    gone.state = "collected";
    expect(ids(70)).not.toContain(gone.id);
  });
});

describe("where a floating item never is (REQ-025 AC-7)", () => {
  it("keeps clear of the dock, the headlands, the start, the cave's hill and the sub's parking places", () => {
    // Every place the submarine is left when the player goes ashore, one for each metre along the beach.
    const parks: { x: number; z: number }[] = [];
    for (let z = -80; z <= 80; z += 1) {
      const spot = ashoreSpot(inland(0, z) + 1, z);
      if (spot) parks.push(spot.park);
    }
    expect(parks.length).toBeGreaterThan(100);
    for (const seed of seeds) {
      for (const item of floating(layoutOf(seed))) {
        const { x, z } = item.home;
        const where = `seed ${seed} at ${x.toFixed(1)}, ${z.toFixed(1)}`;
        // The dock's deck, from the beach out to its seaward end, and its posts.
        const dock = bay.dock;
        const beyond = Math.max(dock.landX - x, 0, x - dock.seaX);
        expect(Math.hypot(beyond, Math.max(Math.abs(z - dock.z) - dock.halfWidth, 0)), where).toBeGreaterThanOrEqual(surface.clearOfDock);
        expect(headland(x, z), where).toBe(0);
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          expect(headland(x + Math.cos(a) * 3, z + Math.sin(a) * 3), where).toBe(0);
        }
        expect(Math.hypot(x - rov.start.x, z - rov.start.z), where).toBeGreaterThanOrEqual(surface.clearOfStart);
        expect(Math.hypot(x - bay.cave.x, z - bay.cave.z), where).toBeGreaterThanOrEqual(bay.cave.clear);
        for (const park of parks) expect(Math.hypot(x - park.x, z - park.z), where).toBeGreaterThanOrEqual(surface.clearOfPark);
      }
    }
  });

  it("stays inside the dive area, clear of the slow-down band and the edge", () => {
    for (const seed of seeds) {
      for (const item of floating(layoutOf(seed))) {
        const { x, z } = item.home;
        expect(inDiveArea(x, z), `seed ${seed}`).toBe(true);
        expect(squareRadius(x, z), `seed ${seed}`).toBeLessThanOrEqual(bay.area.radius - bay.area.slowBand);
        expect(atDiveEdge(x, z, bay.area.slowBand), `seed ${seed}`).toBe(false);
      }
    }
  });

  it("floats again, somewhere new, on play again", () => {
    const field = new TrashField(chooseLayout(1).trashSeed);
    const before = floating(field.items).map((i) => i.home.toArray());
    for (const item of floating(field.items)) item.state = "collected";
    field.reset(chooseLayout(2).trashSeed);
    expect(floating(field.items)).toHaveLength(8);
    expect(floating(field.items).every((i) => i.state === "free")).toBe(true);
    expect(floating(field.items).map((i) => i.home.toArray())).not.toEqual(before);
    for (const item of floating(field.items)) expect(item.position.toArray()).toEqual(item.home.toArray());
  });
});

describe("a floating item gets in nobody's way (REQ-025 AC-8)", () => {
  it("is no solid for the camera, the scanner's line of sight or the seed launcher's shots", () => {
    for (const item of floating(layoutOf(8))) {
      const { x, y, z } = item.home;
      expect(terrainSolidAt(x, y, z, rov.radius)).toBe(false);
      expect(isSolidAt(x, y - 0.1, z)).toBe(false);
    }
  });

  it("lets the seed launcher's aim from the floating submarine pass through it to what lies beyond", () => {
    const item = floating(layoutOf(8))[0];
    const camera = new Vector3(item.home.x - 8, 2.5, item.home.z);
    // Looking down at the water just beyond the item: the ray ends at the floor, not at the item.
    const target = new Vector3(item.home.x + 4, -6, item.home.z);
    const aim = target.clone().sub(camera).normalize();
    const hit = findAimPoint(camera, aim, { targetAt: () => null, land: () => ({ kind: "miss" }) });
    expect(hit.distanceTo(camera)).toBeGreaterThan(camera.distanceTo(item.home) + 1);
  });
});
