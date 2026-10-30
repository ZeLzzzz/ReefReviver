import { Box3, DoubleSide, Mesh, Vector3, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { aimDirection } from "../../src/game/follow-camera";
import { chooseLayout } from "../../src/game/layout";
import { buildMinimap } from "../../src/game/minimap";
import { FLOAT_Y } from "../../src/game/rov";
import { Session } from "../../src/game/session";
import { inland } from "../../src/game/terrain";
import { TrashField, floatingTrash, generateTrash, surfaceSpotOk, type TrashItem } from "../../src/game/trash";
import { buildTrashMesh, createTrashView } from "../../src/game/trash-model";

// REQ-038: oil slicks at the sea surface, a kind of trash of their own that is cleaned up like the floating trash.

const { trash, bay } = config;
const { oil, surface } = trash;
const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 3);
const layoutOf = (seed: number) => generateTrash(chooseLayout(seed).trashSeed);
const slicks = (items: readonly TrashItem[]) => items.filter((item) => item.kind === "oil");
const apart = (a: TrashItem, b: TrashItem) => Math.hypot(a.home.x - b.home.x, a.home.z - b.home.z);

/** Slicks within a group's reach of each other make one group. */
function groupsOf(items: readonly TrashItem[]): TrashItem[][] {
  const groups: TrashItem[][] = [];
  for (const item of items) {
    const group = groups.find((g) => g.some((other) => apart(other, item) < 2 * oil.groupRadius + 1));
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups;
}

describe("where the oil slicks lie (REQ-038 AC-1, AC-5)", () => {
  it("are 4 of the 60 items, floating at the waterline, in 2 groups of 2, one of them in front of the west beach", () => {
    for (const seed of seeds) {
      const items = layoutOf(seed);
      expect(items).toHaveLength(trash.count);
      const oils = slicks(items);
      expect(oils, `seed ${seed}`).toHaveLength(oil.count);
      for (const slick of oils) {
        expect(slick.floating).toBe(true);
        expect(slick.onBeach).toBe(false);
        expect(slick.home.y).toBeCloseTo(bay.surfaceY - surface.sink, 6);
        expect(surfaceSpotOk(slick.home.x, slick.home.z)).toBe(true);
      }
      const groups = groupsOf(oils);
      expect(groups.map((g) => g.length).sort(), `seed ${seed}`).toEqual([2, 2]);
      expect(groups.some((g) => g.every((s) => -inland(s.home.x, s.home.z) <= oil.nearShore && Math.abs(s.home.z) <= surface.beachHalfLength)), `seed ${seed}`).toBe(true);
    }
  });

  it("keep apart from each other and from the floating bottles and bags", () => {
    for (const seed of seeds) {
      const items = layoutOf(seed);
      const oils = slicks(items);
      for (const slick of oils) {
        for (const other of oils) if (other !== slick) expect(apart(slick, other)).toBeGreaterThanOrEqual(oil.spacing - 1e-9);
        for (const other of items.filter(floatingTrash)) expect(apart(slick, other)).toBeGreaterThanOrEqual(oil.clearOfTrash - 1e-9);
      }
    }
  });

  it("are laid the same for the same seed and somewhere else for another, and whole again after a reset", () => {
    const where = (seed: number) => slicks(layoutOf(seed)).map((s) => s.home.toArray());
    expect(where(41)).toEqual(where(41));
    expect(where(41)).not.toEqual(where(42));
    const field = new TrashField(chooseLayout(5).trashSeed);
    for (const slick of slicks(field.items)) slick.state = "collected";
    field.reset(chooseLayout(6).trashSeed);
    expect(slicks(field.items).every((s) => s.state === "free")).toBe(true);
    expect(slicks(field.items).map((s) => s.home.toArray())).toEqual(where(6));
  });
});

describe("an oil slick's look (REQ-038 AC-2)", () => {
  it("is a thin, glossy, low-poly slab about 2 m across, dark with a sheen on top, in three shapes", () => {
    const outlines = new Set<string>();
    for (const variant of [0, 1, 2]) {
      const model = buildTrashMesh("oil", variant);
      const size = new Box3().setFromObject(model).getSize(new Vector3());
      expect(Math.max(size.x, size.z)).toBeGreaterThan(oil.size * 0.8);
      expect(Math.max(size.x, size.z)).toBeLessThan(oil.size * 1.4);
      expect(size.y).toBeCloseTo(oil.thickness, 6);
      const meshes: Mesh[] = [];
      model.traverse((node) => {
        if (node instanceof Mesh) meshes.push(node);
      });
      expect(meshes).toHaveLength(1);
      const [mesh] = meshes;
      expect(mesh.geometry.attributes.position.count / 3).toBeLessThanOrEqual(60);
      const material = mesh.material as MeshStandardMaterial;
      expect(material.vertexColors).toBe(true);
      expect(material.flatShading).toBe(true);
      expect(material.side).toBe(DoubleSide);
      // Dark in the middle, with colour in the sheen.
      const colors = mesh.geometry.attributes.color;
      const brightness = Array.from({ length: colors.count }, (_, i) => colors.getX(i) + colors.getY(i) + colors.getZ(i));
      expect(Math.min(...brightness)).toBeLessThan(0.05);
      expect(Math.max(...brightness)).toBeGreaterThan(0.1);
      outlines.add(JSON.stringify(Array.from(mesh.geometry.attributes.position.array).map((v) => v.toFixed(3))));
    }
    expect(outlines.size).toBe(3);
  });

  it("lies flat on the water with its top always above the surface and its underside always below, at its real size; it shrinks as it is sucked in", () => {
    const field = new TrashField(chooseLayout(9).trashSeed);
    const view = createTrashView(field.items);
    const slick = slicks(field.items)[0];
    const model = view.group.children[slick.id];
    const heights: number[] = [];
    for (let t = 0; t < 4; t += 0.25) {
      view.sync(field.items, t);
      heights.push(model.position.y);
      expect(model.rotation.x).toBe(0);
      expect(model.rotation.z).toBe(0);
      expect(model.scale.x).toBe(1);
      // The sea surface is a flat plane at surfaceY (its waves are only shading).
      expect(model.position.y).toBeGreaterThan(bay.surfaceY + 0.005);
      expect(model.position.y - oil.thickness).toBeLessThan(bay.surfaceY - 0.005);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(surface.bob.amplitude * oil.bob);
    slick.state = "pulling";
    slick.pull = 0.5;
    view.sync(field.items, 1);
    expect(model.scale.x).toBeCloseTo(1 - 0.7 * 0.5, 6);
  });
});

describe("cleaning up an oil slick (REQ-038 AC-3, AC-4)", () => {
  /** A field where only `keep` is near: the rest are sent far down so only it can be in the cone. */
  const isolate = (field: TrashField, keep: TrashItem) => {
    for (const item of field.items) {
      if (item === keep) continue;
      item.home.set(item.home.x, -500, item.home.z);
      item.position.copy(item.home);
    }
  };
  const aimAt = (item: TrashItem, distance: number) => {
    const nozzle = new Vector3(item.position.x, FLOAT_Y, item.position.z - distance);
    return { nozzle, aim: aimDirection(0, Math.atan2(item.position.y - nozzle.y, distance)) };
  };
  const suck = (field: TrashField, session: Session, nozzle: Vector3, aim: Vector3, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      for (const _ of field.update(1 / 60, nozzle, aim, true, session.tankSpace - field.pulling)) session.collect();
    }
  };

  it("is sucked up by the vacuum from the floating submarine into one place in the tank, and counts in the cleanliness", () => {
    const field = new TrashField(chooseLayout(3).trashSeed);
    const session = new Session(field.total);
    const slick = slicks(field.items)[0];
    isolate(field, slick);
    const { nozzle, aim } = aimAt(slick, 3);
    const before = session.cleanliness;
    suck(field, session, nozzle, aim, 3);
    expect(slick.state).toBe("collected");
    expect(session.tank).toBe(1);
    expect(session.trashRemoved).toBe(1);
    expect(session.cleanliness).toBeGreaterThan(before);
  });

  it("stays on the water when the tank is full", () => {
    const field = new TrashField(chooseLayout(3).trashSeed);
    const session = new Session(field.total);
    while (session.tankSpace > 0) session.collect();
    const slick = slicks(field.items)[0];
    isolate(field, slick);
    const { nozzle, aim } = aimAt(slick, 3);
    suck(field, session, nozzle, aim, 3);
    expect(slick.state).toBe("free");
    expect(slick.position.toArray()).toEqual(slick.home.toArray());
  });

  it("shows on the minimap as a trash dot from 70% cleanliness on, and not once collected", () => {
    const field = new TrashField(chooseLayout(3).trashSeed);
    const slick = slicks(field.items)[0];
    const map = (cleanliness: number) =>
      buildMinimap({ rov: { x: 0, z: 0, yaw: 0 }, frames: [], patches: [], nets: [], trash: field.items, cleanliness }).trash.length;
    expect(map(60)).toBe(0);
    const all = map(75);
    expect(all).toBe(field.items.filter((i) => i.state === "free").length);
    slick.state = "collected";
    expect(map(75)).toBe(all - 1);
  });
});
