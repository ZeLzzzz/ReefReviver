import { Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { boulders } from "../../src/game/bay";
import { boulderSurfaceHeight, insideBoulder, pushOutOfBoulder } from "../../src/game/boulder-shape";
import { buildBoulderMesh } from "../../src/game/world";

describe("the visible rock surface and its collision", () => {
  it("has no collapsed faces or vertices outside the reserved layout footprint", () => {
    for (const boulder of boulders) {
      for (const face of boulder.faces) expect(face.triangle.getArea()).toBeGreaterThan(0.001);
      for (const p of boulder.vertices) expect(Math.hypot(p.x - boulder.x, p.z - boulder.z)).toBeLessThanOrEqual(boulder.radius);
    }
  });

  it("grounds biota at the same height that a ray hits the rendered rock", () => {
    for (const boulder of boulders) {
      const mesh = buildBoulderMesh(boulder, 0);
      mesh.updateMatrixWorld(true);
      for (let angle = 0; angle < Math.PI * 2; angle += 0.6) {
        const x = boulder.x + Math.cos(angle) * boulder.radius * 0.55;
        const z = boulder.z + Math.sin(angle) * boulder.radius * 0.55;
        const ray = new Raycaster(new Vector3(x, boulder.topY + 3, z), new Vector3(0, -1, 0));
        const hit = ray.intersectObject(mesh, true)[0];
        expect(hit).toBeDefined();
        const y = hit.point.y;
        expect(boulderSurfaceHeight(boulder, x, z)).toBeCloseTo(y, 4);
        expect(insideBoulder(boulder, x, y - 0.02, z)).toBe(true);
        expect(insideBoulder(boulder, x, y + 0.02, z)).toBe(false);
      }
    }
  });

  it("pushes a vehicle out of the crown and flanks, with clearance for its whole body", () => {
    for (const boulder of boulders) {
      for (let angle = 0; angle < Math.PI * 2; angle += 0.7) {
        const x = boulder.x + Math.cos(angle) * boulder.radius * 0.65;
        const z = boulder.z + Math.sin(angle) * boulder.radius * 0.65;
        const y = boulderSurfaceHeight(boulder, x, z)!;
        for (const offset of [-0.05, 0.05]) {
          const position = new Vector3(x, y + offset, z);
          pushOutOfBoulder(position, new Vector3(0, -1, 0), boulder, 0.9);
          expect(insideBoulder(boulder, position.x, position.y, position.z, 0.89)).toBe(false);
        }
      }
    }
  });
});
