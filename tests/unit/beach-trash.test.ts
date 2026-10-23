import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight, floorSlope } from "../../src/game/bay";
import { aimDirection } from "../../src/game/follow-camera";
import type { HudState, LandHud } from "../../src/game/hud-state";
import { ashoreSpot, createWalker, eyePosition, insideShed, landObstacles, onDock, standable } from "../../src/game/land";
import { chooseLayout } from "../../src/game/layout";
import { buildMinimap } from "../../src/game/minimap";
import { Session } from "../../src/game/session";
import { counterPosition } from "../../src/game/station";
import { inland, wallness } from "../../src/game/terrain";
import { aimedBeachItem, generateTrash, TrashField, type TrashItem } from "../../src/game/trash";
import { createHud } from "../../src/ui/hud";

const { trash, station, land, bay } = config;
const { beach } = trash;
const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 3);
const beachItems = (items: readonly TrashItem[]) => items.filter((item) => item.onBeach);

/** A player standing `distance` m from the item, on its sea side, with the crosshair on it. */
function standNear(item: TrashItem, distance: number, yawOffset = 0) {
  const yaw = -Math.PI / 2 + yawOffset;
  const walker = createWalker(item.home.x - Math.sin(yaw) * distance, item.home.z - Math.cos(yaw) * distance, yaw);
  const eye = eyePosition(walker);
  walker.pitch = Math.atan2(item.position.y - eye.y, distance);
  return { walker, eye, aim: aimDirection(walker.yaw, walker.pitch) };
}

describe("the beach's share of the trash (REQ-017 AC-1)", () => {
  it("is 8 of the 60 items, so the sea keeps 52 (the cave's included), for every seed", () => {
    for (const seed of seeds) {
      const items = generateTrash(chooseLayout(seed).trashSeed);
      expect(items).toHaveLength(trash.count);
      expect(beachItems(items)).toHaveLength(8);
      expect(items.filter((item) => !item.onBeach)).toHaveLength(52);
      expect(items.filter((item) => item.onBeach).every((item) => item.id >= 52)).toBe(true);
    }
  });

  it("lies in 3 or 4 small groups along the open beach, at most 85 m north or south of the middle", () => {
    const counts = new Set<number>();
    for (const seed of seeds) {
      const items = beachItems(generateTrash(chooseLayout(seed).trashSeed));
      // Items within a few metres of each other make one group; groups are far apart (groupSpacing).
      const groups: TrashItem[][] = [];
      for (const item of items) {
        const group = groups.find((g) => g.some((other) => Math.hypot(other.home.x - item.home.x, other.home.z - item.home.z) < 2 * beach.groupRadius + 1));
        if (group) group.push(item);
        else groups.push([item]);
      }
      counts.add(groups.length);
      expect(groups.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(groups.length, `seed ${seed}`).toBeLessThanOrEqual(4);
      for (const group of groups) expect(group.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      for (const item of items) expect(Math.abs(item.home.z)).toBeLessThanOrEqual(beach.halfLength);
    }
    expect(counts).toEqual(new Set([3, 4]));
  });

  it("lies on dry sand between the water's edge and 7 m inland, resting on the ground", () => {
    for (const seed of seeds) {
      for (const item of beachItems(generateTrash(chooseLayout(seed).trashSeed))) {
        const { x, z } = item.home;
        expect(inland(x, z)).toBeGreaterThan(0);
        expect(inland(x, z)).toBeLessThanOrEqual(7);
        expect(floorHeight(x, z)).toBeGreaterThan(bay.surfaceY);
        expect(item.home.y).toBeCloseTo(floorHeight(x, z) + trash.restHeight, 6);
        expect(item.position.toArray()).toEqual(item.home.toArray());
      }
    }
  });

  it("is laid somewhere else each dive, the same for the same seed (REQ-012)", () => {
    const key = (seed: number) => beachItems(generateTrash(chooseLayout(seed).trashSeed)).map((i) => `${i.home.x.toFixed(2)},${i.home.z.toFixed(2)}`).join(";");
    expect(key(42)).toBe(key(42));
    expect(new Set(seeds.slice(0, 50).map(key)).size).toBeGreaterThan(40);
  });

  it("is laid the same way after a reset with a seed, as when generated with it", () => {
    const field = new TrashField(chooseLayout(5).trashSeed);
    field.reset(chooseLayout(9).trashSeed);
    const fresh = generateTrash(chooseLayout(9).trashSeed);
    expect(field.items.map((i) => i.home.toArray())).toEqual(fresh.map((i) => i.home.toArray()));
    expect(field.items.map((i) => i.onBeach)).toEqual(fresh.map((i) => i.onBeach));
  });
});

describe("where beach trash never lies (REQ-017 AC-8)", () => {
  it("keeps clear of the shed, its counter, the dock, the trees, the rocks, the bins, the cliffs and the slopes", () => {
    for (const seed of seeds) {
      for (const item of beachItems(generateTrash(chooseLayout(seed).trashSeed))) {
        const { x, z } = item.home;
        const where = `seed ${seed} at ${x.toFixed(1)}, ${z.toFixed(1)}`;
        expect(standable(x, z), where).toBe(true);
        expect(insideShed(x, z, 1), where).toBe(false);
        expect(Math.hypot(x - counterPosition.x, z - counterPosition.z), where).toBeGreaterThan(station.zoneRadius);
        expect(onDock(x, z), where).toBe(false);
        expect(x >= bay.dock.landX - 1 && Math.abs(z - bay.dock.z) <= bay.dock.halfWidth + 1, where).toBe(false);
        for (const o of landObstacles) expect(Math.hypot(x - o.x, z - o.z), where).toBeGreaterThan(o.radius + 0.5);
        expect(wallness(x, z), where).toBe(0);
        expect(x, where).toBeGreaterThan(land.cliffX);
        expect(floorSlope(x, z), where).toBeLessThanOrEqual(trash.maxSlope);
      }
    }
  });

  it("can be walked to and aimed at from somewhere the player can stand", () => {
    // Flood the standable ground from where the player lands, on a 0.5 m grid.
    const step = 0.5;
    const spot = ashoreSpot(-120, 8)!;
    const xs = (value: number) => Math.round(value / step);
    const reached = new Set<string>();
    const queue: [number, number][] = [[xs(spot.landing.x), xs(spot.landing.z)]];
    reached.add(queue[0].join());
    while (queue.length) {
      const [i, j] = queue.pop()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${i + di},${j + dj}`;
        if (reached.has(key) || !standable((i + di) * step, (j + dj) * step)) continue;
        reached.add(key);
        queue.push([i + di, j + dj]);
      }
    }
    for (const seed of seeds.slice(0, 60)) {
      for (const item of beachItems(generateTrash(chooseLayout(seed).trashSeed))) {
        // A standing place within 2 m that was reached by walking, with the crosshair able to hit the item from it.
        let found = false;
        for (let k = 0; k < 24 && !found; k++) {
          const angle = (k / 24) * Math.PI * 2;
          const x = item.home.x + Math.cos(angle) * 1.5;
          const z = item.home.z + Math.sin(angle) * 1.5;
          if (!standable(x, z) || !reached.has(`${xs(x)},${xs(z)}`)) continue;
          const walker = createWalker(x, z, 0);
          const eye = eyePosition(walker);
          const toItem = item.position.clone().sub(eye);
          const length = toItem.length();
          toItem.normalize();
          const hidden = Array.from({ length: 20 }, (_, n) => eye.clone().addScaledVector(toItem, (n / 20) * (length - 0.2))).some((p) => floorHeight(p.x, p.z) > p.y);
          if (hidden) continue;
          walker.yaw = Math.atan2(toItem.x, toItem.z);
          walker.pitch = Math.asin(toItem.y);
          found = aimedBeachItem(walker.position, eye, aimDirection(walker.yaw, walker.pitch), [item]) === item;
        }
        expect(found, `seed ${seed} at ${item.home.x.toFixed(1)}, ${item.home.z.toFixed(1)}`).toBe(true);
      }
    }
  });
});

describe("aiming at beach trash (REQ-017 AC-2, AC-5)", () => {
  const item = () => generateTrash(chooseLayout(1).trashSeed).find((i) => i.onBeach)!;

  it("finds the item under the crosshair from 3 m away", () => {
    const target = item();
    const { walker, eye, aim } = standNear(target, 2.9);
    expect(aimedBeachItem(walker.position, eye, aim, [target])).toBe(target);
  });

  it("finds nothing from further than 3 m, nor when looking elsewhere or behind", () => {
    const target = item();
    const far = standNear(target, 3.4);
    expect(aimedBeachItem(far.walker.position, far.eye, far.aim, [target])).toBeNull();
    const near = standNear(target, 2);
    for (const turn of [0.5, -0.5, Math.PI]) {
      const aim = aimDirection(near.walker.yaw + turn, near.walker.pitch);
      expect(aimedBeachItem(near.walker.position, near.eye, aim, [target]), `turned ${turn}`).toBeNull();
    }
    const up = aimDirection(near.walker.yaw, 0.8);
    expect(aimedBeachItem(near.walker.position, near.eye, up, [target])).toBeNull();
  });

  it("ignores items already picked up, lifting, or lying in the sea", () => {
    const target = item();
    const { walker, eye, aim } = standNear(target, 2);
    for (const state of ["lifting", "collected", "pulling"] as const) {
      target.state = state;
      expect(aimedBeachItem(walker.position, eye, aim, [target])).toBeNull();
    }
    target.state = "free";
    target.onBeach = false;
    expect(aimedBeachItem(walker.position, eye, aim, [target])).toBeNull();
  });

  it("takes the item the crosshair is closest to when two are in reach", () => {
    const a = item();
    const b = { ...a, id: 99, home: a.home.clone(), position: a.position.clone() };
    b.position.z += 0.6;
    const { walker, eye, aim } = standNear(a, 2);
    expect(aimedBeachItem(walker.position, eye, aim, [b, a])).toBe(a);
  });
});

describe("picking up and the vacuum (REQ-017 AC-2, AC-6)", () => {
  it("lifts the item off the sand and makes it disappear within about 0.3 s", () => {
    const field = new TrashField(chooseLayout(1).trashSeed);
    const target = field.items.find((i) => i.onBeach)!;
    field.lift(target);
    expect(target.state).toBe("lifting");
    const nozzle = new Vector3(0, -5, 0);
    field.update(0.1, nozzle, new Vector3(0, 0, 1), false, 12);
    expect(target.state).toBe("lifting");
    expect(target.position.y).toBeGreaterThan(target.home.y);
    for (let t = 0.1; t < 0.35; t += 1 / 60) field.update(1 / 60, nozzle, new Vector3(0, 0, 1), false, 12);
    expect(target.state).toBe("collected");
  });

  it("only lifts a free beach item", () => {
    const field = new TrashField(chooseLayout(1).trashSeed);
    const sea = field.items.find((i) => !i.onBeach)!;
    field.lift(sea);
    expect(sea.state).toBe("free");
    const target = field.items.find((i) => i.onBeach)!;
    target.state = "collected";
    field.lift(target);
    expect(target.state).toBe("collected");
  });

  it("does not let the vacuum pull a beach item, even right in its cone from the shallows", () => {
    const field = new TrashField(chooseLayout(1).trashSeed);
    const target = field.items.find((i) => i.onBeach)!;
    // The submarine just off the beach, 2 m from the item, aiming straight at it.
    const nozzle = new Vector3(target.position.x + 2, bay.surfaceY - 0.5, target.position.z);
    const aim = target.position.clone().sub(nozzle).normalize();
    for (const other of field.items) if (other !== target) other.state = "collected";
    const session = new Session(field.total);
    for (let t = 0; t < 3; t += 1 / 60) for (const _ of field.update(1 / 60, nozzle, aim, true, session.tankSpace)) session.collect();
    expect(target.state).toBe("free");
    expect(session.tank).toBe(0);
    expect(field.pulling).toBe(0);
  });
});

describe("beach trash counts like any other (REQ-017 AC-2, AC-7)", () => {
  it("raises the tank, the score and the cleanliness once, like sucked trash", () => {
    const session = new Session(trash.count);
    expect(session.collect()).toBe(true);
    expect(session.tank).toBe(1);
    expect(session.score).toBe(config.rewards.scorePerTrash);
    expect(session.cleanliness).toBe(Math.floor(100 / (trash.count + config.phase1.nets)));
  });

  it("is refused with a full tank, leaving tank and score as they were (AC-4)", () => {
    const session = new Session(trash.count);
    while (!session.tankFull) session.collect();
    const before = { tank: session.tank, score: session.score, cleanliness: session.cleanliness };
    expect(session.collect()).toBe(false);
    expect({ tank: session.tank, score: session.score, cleanliness: session.cleanliness }).toEqual(before);
  });

  it("shows on the minimap from 70% as a trash dot, and leaves it once picked up", () => {
    const field = new TrashField(chooseLayout(1).trashSeed);
    const input = (cleanliness: number) => ({ rov: { x: -136, z: 0, yaw: 0 }, frames: [], patches: [], nets: [], trash: field.items, cleanliness });
    const target = field.items.find((i) => i.onBeach)!;
    expect(buildMinimap(input(69)).trash).toEqual([]);
    expect(buildMinimap(input(70)).trash.map((m) => m.id)).toContain(target.id);
    expect(buildMinimap(input(70)).trash).toHaveLength(field.total);
    field.lift(target);
    expect(buildMinimap(input(70)).trash.map((m) => m.id)).not.toContain(target.id);
  });
});

describe("the prompt to pick up (REQ-017 AC-2, AC-5)", () => {
  const onFoot: LandHud = { onLand: true, canGoAshore: false, canBoard: false, fade: 0 };

  function state(land: LandHud, overrides: Partial<HudState> = {}): HudState {
    const session = new Session(trash.count);
    return {
      tool: session.tool,
      tank: 0,
      capacity: session.capacity,
      tankFull: false,
      score: 0,
      materials: 0,
      cleanliness: 0,
      objectives: session.objectives,
      notice: null,
      inStationZone: false,
      stationDistance: 20,
      marker: { left: 100, top: 200, onScreen: false, angle: 1 },
      sucking: false,
      cutProgress: 0,
      land,
      ...overrides,
    };
  }
  const prompt = (hud: ReturnType<typeof createHud>) => hud.element.querySelector<HTMLElement>(".message-prompt")!;

  it("asks to pick up the trash in both languages", () => {
    for (const [lang, text] of [["id", "Tekan E untuk memungut sampah"], ["en", "Press E to pick up the trash"]] as const) {
      const hud = createHud(lang);
      hud.update(state({ ...onFoot, canPickUp: true }));
      expect(prompt(hud).hidden).toBe(false);
      expect(prompt(hud).textContent).toBe(text);
    }
  });

  it("is not shown when no trash is aimed at in reach", () => {
    const hud = createHud("id");
    hud.update(state({ ...onFoot, canPickUp: false }));
    expect(prompt(hud).hidden).toBe(true);
    hud.update(state(onFoot));
    expect(prompt(hud).hidden).toBe(true);
  });

  it("wins over depositing and boarding the submarine", () => {
    const hud = createHud("id");
    hud.update(state({ ...onFoot, canPickUp: true, canBoard: true }, { inStationZone: true }));
    expect(prompt(hud).textContent).toBe("Tekan E untuk memungut sampah");
    hud.update(state({ ...onFoot, canPickUp: false, canBoard: true }, { inStationZone: true }));
    expect(prompt(hud).textContent).toBe("Tekan E untuk masuk kapal selam mini");
  });

  it("keeps the full-tank message on screen while aiming at trash with a full tank (AC-4)", () => {
    const hud = createHud("id");
    hud.update(state({ ...onFoot, canPickUp: true }, { tankFull: true, tank: 12 }));
    const message = hud.element.querySelector<HTMLElement>(".message-full")!;
    expect(message.hidden).toBe(false);
    expect(message.textContent).toBe("Tangki penuh, setor di gudang daur ulang di darat");
  });
});
