import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { AnimalField } from "../../src/game/animals";
import { arches, boulders, floorHeight, rocks } from "../../src/game/bay";
import { inCave } from "../../src/game/cave";
import { allSpots, chooseLayout, quarterOf, type Layout } from "../../src/game/layout";
import { buildMinimap, mapPoint } from "../../src/game/minimap";
import { NetField } from "../../src/game/nets";
import { ReefField } from "../../src/game/reef-sites";
import { SeaLife } from "../../src/game/sea-life";
import { inland, wallness } from "../../src/game/terrain";
import { generateTrash, TrashField, trashSpotOk } from "../../src/game/trash";

const { reef, nets, trash, bay, rov, seaLife } = config;
const seeds = Array.from({ length: 300 }, (_, i) => i * 7919 + 3);
const key = (s: { x: number; z: number }) => `${s.x},${s.z}`;
const all = (layout: Layout) => [...layout.frames, ...layout.patches, ...layout.nets];

describe("the candidate spots (REQ-012 AC-1, AC-3)", () => {
  it("are 8 for reef sites, 5 for seagrass patches and 5 for nets (D-074)", () => {
    expect(reef.frameSpots).toHaveLength(8);
    expect(reef.patchSpots).toHaveLength(5);
    expect(nets.spots).toHaveLength(5);
  });

  it("are all good places: deep enough, level, out in the bay, clear of the rocks, the cave, the start and each other", () => {
    for (const spot of allSpots) {
      const h = floorHeight(spot.x, spot.z);
      expect(h).toBeLessThan(bay.surfaceY - 6);
      expect(wallness(spot.x, spot.z)).toBe(0);
      expect(inland(spot.x, spot.z)).toBeLessThan(-50);
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) expect(Math.abs(floorHeight(spot.x + dx, spot.z + dz) - h)).toBeLessThan(0.05);
      for (const rock of rocks) expect(Math.hypot(spot.x - rock.x, spot.z - rock.z)).toBeGreaterThan(rock.size + 4);
      for (const boulder of boulders) expect(Math.hypot(spot.x - boulder.x, spot.z - boulder.z)).toBeGreaterThan(boulder.tiers[0].radius + 4);
      for (const arch of arches) expect(Math.hypot(spot.x - arch.x, spot.z - arch.z)).toBeGreaterThan(arch.radius + arch.tube + 4);
      expect(Math.hypot(spot.x - bay.cave.x, spot.z - bay.cave.z)).toBeGreaterThan(bay.cave.clear);
      expect(Math.hypot(spot.x - rov.start.x, spot.z - rov.start.z)).toBeGreaterThan(20);
      for (const other of allSpots) if (other !== spot) expect(Math.hypot(spot.x - other.x, spot.z - other.z)).toBeGreaterThanOrEqual(15);
    }
  });
});

describe("one dive's layout (REQ-012 AC-1, AC-5)", () => {
  it("picks 2 of the 5 net spots, 3 of the 8 reef spots and 2 of the 5 seagrass spots, never the same spot twice", () => {
    for (const seed of seeds) {
      const layout = chooseLayout(seed);
      expect(layout.nets).toHaveLength(2);
      expect(layout.frames).toHaveLength(3);
      expect(layout.patches).toHaveLength(2);
      const frameKeys = new Set(reef.frameSpots.map(key));
      const patchKeys = new Set(reef.patchSpots.map(key));
      const netKeys = new Set(nets.spots.map(key));
      for (const s of layout.frames) expect(frameKeys.has(key(s))).toBe(true);
      for (const s of layout.patches) expect(patchKeys.has(key(s))).toBe(true);
      for (const s of layout.nets) expect(netKeys.has(key(s))).toBe(true);
      expect(new Set(all(layout).map(key)).size).toBe(7);
    }
  });

  it("is the same for the same seed, and differs between dives", () => {
    expect(chooseLayout(42)).toEqual(chooseLayout(42));
    const distinct = new Set(seeds.slice(0, 50).map((seed) => JSON.stringify(all(chooseLayout(seed)).map(key))));
    expect(distinct.size).toBeGreaterThan(40);
  });

  it("never puts everything in one part of the bay: the picked spots cover at least 3 of its 4 quarters (AC-5)", () => {
    for (const seed of seeds) expect(new Set(all(chooseLayout(seed)).map(quarterOf)).size).toBeGreaterThanOrEqual(reef.spreadQuarters);
  });

  it("lays all 60 pieces of trash, in groups, on good spots, for every seed (AC-1, AC-3)", () => {
    for (const seed of seeds.slice(0, 60)) {
      const items = generateTrash(chooseLayout(seed).trashSeed);
      expect(items).toHaveLength(trash.count);
      for (const item of items) {
        // REQ-014: the pieces on the cave's floor are placed by the cave's own rules (cave.test.ts); the rest by these.
        if (inCave(item.home.x, item.home.y + 1, item.home.z)) continue;
        expect(trashSpotOk(item.home.x, item.home.z)).toBe(true);
        for (const spot of allSpots) expect(Math.hypot(item.home.x - spot.x, item.home.z - spot.z)).toBeGreaterThanOrEqual(trash.clearOfNets);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) expect(items[i].home.distanceTo(items[j].home)).toBeGreaterThanOrEqual(trash.spacing - 1e-6);
      }
    }
  });

  it("lays the trash differently in different dives", () => {
    const a = generateTrash(chooseLayout(1).trashSeed).map((i) => i.home.x.toFixed(2));
    const b = generateTrash(chooseLayout(2).trashSeed).map((i) => i.home.x.toFixed(2));
    expect(a).not.toEqual(b);
  });
});

describe("everything follows the dive's layout (REQ-012 AC-2, AC-4)", () => {
  const first = chooseLayout(11);
  const next = chooseLayout(12);

  it("moves the reef sites and seagrass patches, empty again", () => {
    const field = new ReefField(first);
    field.install(0);
    field.frames[0].fragments = 2;
    field.patches[1].seeds = 1;
    field.reset(next);
    expect(field.frames.map(key)).toEqual(next.frames.map(key));
    expect(field.patches.map(key)).toEqual(next.patches.map(key));
    for (const frame of field.frames) expect(frame.y).toBeCloseTo(floorHeight(frame.x, frame.z));
    expect(field.frames.every((f) => !f.installed && f.fragments === 0)).toBe(true);
    expect(field.patches.every((p) => p.seeds === 0)).toBe(true);
  });

  it("moves the nets and puts each animal back in its net, turtle in net 0 and shark in net 1", () => {
    const field = new NetField(first);
    const animals = new AnimalField(first);
    field.cut(0);
    field.reset(next);
    animals.reset(next);
    expect(field.nets.map((n) => key(n.center))).toEqual(next.nets.map(key));
    expect(field.nets.map((n) => n.species)).toEqual(["turtle", "reefShark"]);
    expect(field.nets.every((n) => !n.cut)).toBe(true);
    animals.animals.forEach((animal, i) => {
      expect(animal.state).toBe("trapped");
      expect(Math.hypot(animal.position.x - next.nets[i].x, animal.position.z - next.nets[i].z)).toBeLessThan(0.5);
    });
  });

  it("moves the anemones and their clownfish beside the new frames", () => {
    const life = new SeaLife(first.frames);
    life.reset(next.frames);
    life.anemones.forEach((anemone, i) => {
      expect(Math.hypot(anemone.x - next.frames[i].x, anemone.z - next.frames[i].z)).toBeLessThan(reef.interactRadius);
      expect(anemone.y).toBeCloseTo(floorHeight(anemone.x, anemone.z));
    });
    const fish = life.creatures.filter((c) => c.species === "clownfish");
    expect(fish).toHaveLength(reef.frames * seaLife.clownfish.perAnemone);
    for (const f of fish) {
      const anemone = life.anemones[f.anemone!];
      expect(f.loop.x).toBe(anemone.x);
      expect(f.loop.z).toBe(anemone.z);
    }
  });

  it("lays the trash anew on the floor, all of it free again", () => {
    const field = new TrashField(first.trashSeed);
    field.items[0].state = "collected";
    field.reset(next.trashSeed);
    const fresh = generateTrash(next.trashSeed);
    expect(field.items.map((i) => i.home.toArray())).toEqual(fresh.map((i) => i.home.toArray()));
    expect(field.items.every((i) => i.state === "free" && i.position.equals(i.home))).toBe(true);
  });

  it("puts the minimap's marks where the new sites and nets are", () => {
    const sites = new ReefField(next);
    const netField = new NetField(next);
    const map = buildMinimap({ rov: { x: 0, z: 0, yaw: 0 }, frames: sites.frames, patches: sites.patches, nets: netField.nets, trash: [], cleanliness: 0 });
    expect(map.frames.map(({ x, y }) => ({ x, y }))).toEqual(next.frames.map((s) => mapPoint(s.x, s.z)));
    expect(map.patches.map(({ x, y }) => ({ x, y }))).toEqual(next.patches.map((s) => mapPoint(s.x, s.z)));
    map.nets.forEach((mark, i) => expect({ x: mark.x, y: mark.y }).toEqual(mapPoint(next.nets[i].x, next.nets[i].z)));
  });
});

describe("the minimap after a new dive (REQ-012 AC-4)", () => {
  it("moves the net marks and the trash dots to the new layout, even though their ids stay the same", async () => {
    const { createHud } = await import("../../src/ui/hud");
    const { Session } = await import("../../src/game/session");
    const hud = createHud("id");
    const show = (layout: Layout) => {
      const sites = new ReefField(layout);
      const netField = new NetField(layout);
      const field = new TrashField(layout.trashSeed);
      const session = new Session(field.total);
      hud.update({
        tool: session.tool, tank: 0, capacity: session.capacity, tankFull: false, score: 0, materials: 0, cleanliness: 80,
        objectives: session.objectives, notice: null, inStationZone: false, stationDistance: 10,
        marker: { left: 0, top: 0, onScreen: false, angle: 0 }, sucking: false, cutProgress: 0,
        minimap: buildMinimap({ rov: { x: 0, z: 0, yaw: 0 }, frames: sites.frames, patches: sites.patches, nets: netField.nets, trash: field.items, cleanliness: 80 }),
      });
      return {
        nets: [...hud.element.querySelectorAll('[data-kind="net"]')].map((n) => n.getAttribute("transform")),
        trash: [...hud.element.querySelectorAll('[data-kind="trash"]')].map((t) => `${t.getAttribute("cx")},${t.getAttribute("cy")}`),
      };
    };
    const before = show(chooseLayout(11));
    const after = show(chooseLayout(12));
    const next = chooseLayout(12);
    expect(after.nets).toEqual(next.nets.map((n) => `translate(${mapPoint(n.x, n.z).x.toFixed(1)} ${mapPoint(n.x, n.z).y.toFixed(1)})`));
    expect(after.trash).not.toEqual(before.trash);
  });
});
