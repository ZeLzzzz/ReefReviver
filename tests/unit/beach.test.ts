import { Box3, InstancedMesh, Matrix4, Mesh, Raycaster, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { beachItems, beachItemsClearOf, generateBeachItems, type BeachItem } from "../../src/game/beach";
import { beachGeometry, createBeachView } from "../../src/game/beach-model";
import { buildPalmMesh } from "../../src/game/palm-model";
import { createWalker, insideShed, onDock, standable, stepWalker } from "../../src/game/land";
import { counterPosition } from "../../src/game/station";
import { floorHeight, headland, inland } from "../../src/game/terrain";
import { generateTrash } from "../../src/game/trash";
import { buildTerrainChunks, buildWorld } from "../../src/game/world";

const { land, station, bay } = config;
const tuning = land.beachDecor;
const isCoconut = (kind: string) => kind.includes("coconut");

describe("the sandy beach", () => {
  it("places repeatable shell patches near the water and fallen fruit around the palms", () => {
    expect(generateBeachItems()).toEqual(beachItems);
    const shells = beachItems.filter((item) => !isCoconut(item.kind));
    const coconuts = beachItems.filter((item) => isCoconut(item.kind));
    expect(shells.length).toBeGreaterThan(400);
    expect(coconuts).toHaveLength(land.palms.length * tuning.coconutsPerPalm);
    expect(new Set(shells.map((item) => item.kind)).size).toBe(4);
    for (const shell of shells) {
      expect(inland(shell.x, shell.z)).toBeGreaterThanOrEqual(tuning.minInland);
      expect(inland(shell.x, shell.z)).toBeLessThanOrEqual(tuning.maxInland);
    }
    for (const coconut of coconuts) {
      expect(land.palms.some((palm) => Math.hypot(coconut.x - palm.x, coconut.z - palm.z) < tuning.coconutSpread + 2.5)).toBe(true);
    }
    expect(shells.some((s) => s.z > 70)).toBe(true);
    expect(shells.some((s) => s.z < -70)).toBe(true);
  });

  it("keeps the water, rocks, buildings, counter and dock approach clear", () => {
    for (const item of beachItems) {
      expect(standable(item.x, item.z)).toBe(true);
      expect(floorHeight(item.x, item.z)).toBeGreaterThan(bay.surfaceY);
      expect(headland(item.x, item.z)).toBe(0);
      expect(insideShed(item.x, item.z, tuning.structureClear)).toBe(false);
      expect(onDock(item.x, item.z)).toBe(false);
      expect(Math.hypot(item.x - counterPosition.x, item.z - counterPosition.z)).toBeGreaterThan(station.zoneRadius + 0.6);
      if (item.x > station.x + station.halfX) expect(Math.abs(item.z - bay.dock.z)).toBeGreaterThan(bay.dock.halfWidth + 1);
    }
  });

  it("rests small props on the actual rendered sand triangles", () => {
    const terrain = buildTerrainChunks();
    terrain.forEach((mesh) => mesh.updateMatrixWorld(true));
    for (const item of beachItems.filter((_, i) => i % 19 === 0)) {
      const ray = new Raycaster(new Vector3(item.x, item.y + 10, item.z), new Vector3(0, -1, 0));
      const hit = ray.intersectObjects(terrain)[0];
      expect(hit).toBeDefined();
      expect(item.y - hit.point.y).toBeCloseTo(0.006, 5);
      expect(new Vector3(...item.normal).dot(hit.face!.normal)).toBeCloseTo(1, 5);
    }
  });

  it("leaves collectible beach trash visible across different dives", () => {
    const view = createBeachView();
    for (let seed = 1; seed <= 12; seed++) {
      const trash = generateTrash(seed).filter((item) => item.onBeach).map((item) => item.home);
      view.setTrash(trash);
      const expected = beachItemsClearOf(trash);
      expect(new Set(view.shown())).toEqual(new Set(expected));
      for (const item of view.shown()) for (const p of trash) {
        expect(Math.hypot(item.x - p.x, item.z - p.z)).toBeGreaterThanOrEqual(tuning.trashClear + item.size * 0.53);
      }
    }
    view.setTrash([]);
    expect(view.shown()).toHaveLength(beachItems.length);
  });

  it("does not add collision obstacles to the decorative shells", () => {
    const shell = beachItems.find((item) => !isCoconut(item.kind) && inland(item.x, item.z) > 4.5 && item.z < -20)!;
    const walker = createWalker(shell.x - 1, shell.z, Math.PI / 2);
    for (let frame = 0; frame < 30; frame++) stepWalker(walker, { forward: 1, strafe: 0, rise: 0 }, 1 / 60);
    expect(walker.position.x).toBeCloseTo(shell.x - 1 + land.walkSpeed * 0.5, 6);
  });

  it("keeps every visible instance inside the batch's culling bounds", () => {
    const view = createBeachView();
    const matrix = new Matrix4();
    for (const object of view.group.children) {
      const mesh = object as InstancedMesh;
      mesh.geometry.computeBoundingBox();
      const centre = mesh.geometry.boundingBox!.getCenter(new Vector3());
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        expect(mesh.boundingSphere!.containsPoint(centre.clone().applyMatrix4(matrix))).toBe(true);
      }
    }
    for (const kind of ["scallop", "clam", "spiral", "fragment", "coconut", "green-coconut"] as const) {
      const geometry = beachGeometry(kind);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-1e-7);
      expect(geometry.boundingBox!.max.y).toBeLessThan(1.2);
    }
  });

  it("keeps the shells and coconuts low-poly like the rest of the bay (D-125)", () => {
    const triangles = (kind: BeachItem["kind"]) => {
      const geometry = beachGeometry(kind);
      return (geometry.index?.count ?? geometry.getAttribute("position").count) / 3;
    };
    for (const kind of ["scallop", "clam", "spiral", "fragment", "coconut", "green-coconut"] as const) {
      expect(triangles(kind), kind).toBeLessThanOrEqual(150);
    }
    // Codex's smooth shells came to 169,310 for the whole beach.
    expect(beachItems.reduce((sum, item) => sum + triangles(item.kind), 0)).toBeLessThan(40_000);
  });

  it("removes the grass and keeps coastal props through the Bloom and world updates", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    expect(scene.getObjectByName("grass")).toBeUndefined();
    expect(scene.children.filter((child) => child.name === "palm")).toHaveLength(land.palms.length);
    const before = world.beach.shown();
    const roots = scene.children.filter((child) => child.name === "palm").map((palm) => palm.position.clone());
    const crown = scene.getObjectByName("palm-crown")!;
    const beforeTurn = crown.rotation.clone();
    world.setClarity(1);
    world.setAbove(true);
    world.update(2, new Vector3(-130, 3, 0));
    expect(world.beach.shown()).toEqual(before);
    expect(crown.rotation.equals(beforeTurn)).toBe(false);
    expect(scene.children.filter((child) => child.name === "palm").map((palm) => palm.position)).toEqual(roots);
  });
});

describe("the redesigned coconut palms", () => {
  it("keeps the lower trunk inside its existing obstacle and the crown above walking height", () => {
    for (const spec of land.palms) {
      const palm = buildPalmMesh(spec.height, spec.lean, 1.2);
      const trunk = palm.children.find((child) => child instanceof Mesh) as Mesh;
      const vertices = trunk.geometry.getAttribute("position");
      for (let i = 0; i < vertices.count; i++) {
        if (vertices.getY(i) <= land.eyeHeight) expect(Math.hypot(vertices.getX(i), vertices.getZ(i))).toBeLessThanOrEqual(0.3);
      }
      const crown = palm.getObjectByName("palm-crown")!;
      expect(new Box3().setFromObject(crown).min.y).toBeGreaterThan(land.eyeHeight + 1);
      let meshes = 0, triangles = 0;
      palm.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        meshes++;
        triangles += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3;
      });
      expect(meshes).toBeLessThanOrEqual(3);
      // D-125: low-poly like the rest of the bay (Codex's feathered palm had 4,596).
      expect(triangles).toBeLessThan(2000);
    }
  });
});
