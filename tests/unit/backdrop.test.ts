import { Box3, InstancedMesh, Matrix4, Mesh, Raycaster, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { forestTrees, generateForest, lighthouseSite } from "../../src/game/backdrop";
import { createLandBackdrop } from "../../src/game/backdrop-model";
import { standable } from "../../src/game/land";
import { cliffFootX } from "../../src/game/terrain";
import { buildTerrainChunks, buildWorld } from "../../src/game/world";

describe("the coast's inland backdrop", () => {
  it("anchors the forest and lighthouse to the rendered hills and headland", () => {
    expect(generateForest()).toEqual(forestTrees);
    const terrain = buildTerrainChunks();
    terrain.forEach((mesh) => mesh.updateMatrixWorld(true));
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    const heightAt = (x: number, z: number) => {
      ray.ray.origin.set(x, 300, z);
      const hit = ray.intersectObjects(terrain)[0];
      expect(hit).toBeDefined();
      return hit.point.y;
    };
    for (const tree of forestTrees) {
      expect(tree.y).toBeCloseTo(heightAt(tree.x, tree.z), 4);
      expect(tree.y).toBeGreaterThan(config.bay.surfaceY);
      expect(standable(tree.x, tree.z)).toBe(false);
      expect(tree.x + tree.height * 0.5).toBeLessThan(cliffFootX(tree.z));
    }
    expect(standable(lighthouseSite.x, lighthouseSite.z)).toBe(false);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4 + Math.PI / 8;
      const floor = heightAt(lighthouseSite.x + Math.cos(angle) * lighthouseSite.foundationRadius, lighthouseSite.z + Math.sin(angle) * lighthouseSite.foundationRadius);
      expect(lighthouseSite.y).toBeGreaterThan(floor);
      expect(lighthouseSite.y - lighthouseSite.foundationDepth).toBeLessThan(floor);
    }
  });

  it("leaves no route from the beach through the reshaped cliff", () => {
    const step = 0.5;
    const queue: [number, number][] = [[-136, 0]];
    const seen = new Set(["-136,0"]);
    const neighbours = [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [-step, step], [step, -step]];
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i];
      expect(x).toBeGreaterThan(cliffFootX(z) - config.land.cliffWidth * 0.65);
      for (const [dx, dz] of neighbours) {
        const nx = x + dx, nz = z + dz, key = `${nx},${nz}`;
        if (seen.has(key) || !standable(nx, nz)) continue;
        seen.add(key);
        queue.push([nx, nz]);
      }
    }
    expect(queue.length).toBeGreaterThan(1000);
  });

  it("keeps the detailed cliff and coarse hills joined along their western seam", () => {
    const terrain = buildTerrainChunks();
    terrain.forEach((mesh) => mesh.updateMatrixWorld(true));
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    for (let z = -159; z < 160; z += 7) {
      const heights = [-0.001, 0.001].map((offset) => {
        ray.ray.origin.set(-config.bay.halfSize + offset, 300, z);
        const hit = ray.intersectObjects(terrain)[0];
        expect(hit).toBeDefined();
        return hit.point.y;
      });
      expect(Math.abs(heights[0] - heights[1])).toBeLessThan(0.02);
    }
  });

  it("batches trees with bounds that contain every instance and a modest geometry budget", () => {
    const backdrop = createLandBackdrop();
    const matrix = new Matrix4();
    let trees = 0, meshes = 0, triangles = 0;
    backdrop.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      meshes++;
      const count = (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      triangles += count * (object instanceof InstancedMesh ? object.count : 1);
      if (!(object instanceof InstancedMesh)) return;
      trees += object.count;
      const geometryBounds = object.geometry.boundingBox!;
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        const bounds = new Box3().copy(geometryBounds).applyMatrix4(matrix);
        expect(object.boundingBox!.containsBox(bounds)).toBe(true);
      }
    });
    expect(trees).toBe(forestTrees.length);
    expect(meshes).toBeLessThanOrEqual(30);
    // D-125: six-sided crowns, so the forest reads as large facets like the cliffs (Codex's had 191,100).
    expect(triangles).toBeLessThan(120_000);
  });

  it("shows the backdrop above water and culls it again when diving, before and after Bloom", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const backdrop = scene.getObjectByName("land-backdrop")!;
    expect(backdrop.visible).toBe(false);
    for (const clarity of [0, 1]) {
      world.setClarity(clarity);
      world.setAbove(true);
      world.update(1, new Vector3(-130, 3, 0));
      expect(backdrop.visible).toBe(true);
      world.setAbove(false);
      expect(backdrop.visible).toBe(false);
    }
  });
});
