import { Mesh, MeshBasicMaterial, Raycaster, Scene, ShaderLib, Vector3, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { headland } from "../../src/game/terrain";
import { createSeaUniforms } from "../../src/game/sea-surface";
import { createShoreSurf } from "../../src/game/shore-surf";
import { createSkyUniforms } from "../../src/game/sky";
import { buildTerrainChunks, buildWorld } from "../../src/game/world";

describe("small breaking waves on the beach", () => {
  it("uses the rendered beach height for its wet edge and stays away from the rocky headlands", () => {
    const mesh = createShoreSurf(createSkyUniforms(), createSeaUniforms(config.bay.surfaceY));
    const terrain = buildTerrainChunks();
    terrain.forEach((part) => part.updateMatrixWorld(true));
    const positions = mesh.geometry.attributes.position;
    const ground = mesh.geometry.attributes.surfGround;
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    for (let i = 0; i < positions.count; i += 137) {
      const x = positions.getX(i), z = positions.getZ(i);
      ray.ray.origin.set(x, 20, z);
      const hit = ray.intersectObjects(terrain)[0];
      expect(hit).toBeDefined();
      expect(ground.getX(i)).toBeCloseTo(hit.point.y, 4);
      expect(headland(x, z)).toBe(0);
      expect(mesh.geometry.boundingBox!.containsPoint(new Vector3(x, config.bay.surfaceY + config.sea.surf.height, z))).toBe(true);
    }
    expect(mesh.geometry.index!.count / 3).toBeLessThan(25_000);
    expect(mesh.material.depthWrite).toBe(false);
  });

  it("shares the pausable sea clock, follows Bloom's water colour, and disappears below water", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const surf = scene.getObjectByName("shore-surf") as Mesh;
    const material = surf.material as MeshBasicMaterial;
    const shader = { uniforms: {}, vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader } as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(surf.visible).toBe(false);
    for (const clarity of [0, 1]) {
      world.setClarity(clarity);
      world.setAbove(true);
      expect(surf.visible).toBe(true);
      expect(material.color.equals(world.sea.material.color)).toBe(true);
      world.update(0.5, new Vector3(-130, 2, 0));
      expect(shader.uniforms.uTime.value).toBe(world.sea.look().time);
      const paused = shader.uniforms.uTime.value;
      world.setAbove(false);
      expect(shader.uniforms.uTime.value).toBe(paused);
      expect(surf.visible).toBe(false);
    }
  });
});
