import { readFileSync } from "node:fs";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterEach, describe, expect, it } from "vitest";
import { assets } from "../../src/assets";
import { buildRovMesh, createRovModel, updateRovPropellers } from "../../src/game/rov-model";

afterEach(() => assets.clear());

async function loadShippedModel(): Promise<void> {
  const bytes = readFileSync("public/assets/models/rov.glb");
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  assets.add("rov", gltf.scene);
}

const propeller = (model: Object3D, side: "left" | "right") => model.getObjectByName(`propeller-${side}`)!;

describe("the submarine's model (REQ-032)", () => {
  it("loads its closed hull and articulated propellers without a cockpit or pilot from the shipped GLB, within the old footprint (AC-1, AC-5, AC-6)", async () => {
    await loadShippedModel();
    const model = createRovModel();
    const hatch = model.getObjectByName("deck-hatch") as Mesh;
    expect(hatch).toBeInstanceOf(Mesh);
    expect(model.getObjectByName("cockpit-dome")).toBeUndefined();
    expect((hatch.material as MeshStandardMaterial).transparent).toBe(false);
    expect(model.getObjectByName("pilot")).toBeUndefined();
    expect(model.getObjectByName("pilot-suit")).toBeUndefined();
    expect(propeller(model, "left")).toBeDefined();
    expect(propeller(model, "right")).toBeDefined();
    const bounds = new Box3().setFromObject(model);
    expect(bounds.min.x).toBeGreaterThan(-0.9);
    expect(bounds.max.x).toBeLessThan(0.9);
    expect(bounds.min.z).toBeGreaterThan(-0.9);
    expect(bounds.max.z).toBeLessThan(0.95);
    expect(bounds.min.y).toBeGreaterThan(-0.45);
    expect(bounds.max.y).toBeLessThan(0.55);
  });

  it("is low-poly and matte like the world around it: a few thousand triangles, and every unlit material rough (AC-2)", () => {
    const model = buildRovMesh();
    let triangles = 0;
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const geometry = child.geometry;
      triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      const material = child.material as MeshStandardMaterial;
      // The lamps, the display and the cutter's tip glow; everything else is matte.
      if (material.emissive.getHex() === 0) expect(material.roughness, child.name || material.uuid).toBeGreaterThanOrEqual(0.6);
    });
    // The 24-sided version had 11,720.
    expect(triangles).toBeLessThan(3000);
  });

  it("spins the propellers in opposite directions, faster at a higher speed, and holds them still when the submarine stops (AC-3)", async () => {
    await loadShippedModel();
    const model = createRovModel(), other = createRovModel(), fast = createRovModel();
    updateRovPropellers(model, 0.1, 1);
    updateRovPropellers(fast, 0.1, 6);
    expect(propeller(model, "left").rotation.z).toBeGreaterThan(0);
    expect(propeller(model, "right").rotation.z).toBeLessThan(0);
    expect(propeller(fast, "left").rotation.z).toBeGreaterThan(propeller(model, "left").rotation.z);
    expect(propeller(other, "left").rotation.z).toBeCloseTo(0);
    const angle = propeller(model, "left").rotation.z;
    updateRovPropellers(model, 0, 6);
    updateRovPropellers(model, 1, 0);
    updateRovPropellers(model, 1, 0.04);
    expect(propeller(model, "left").rotation.z).toBe(angle);
  });

  it("still uses an artist's model without named propellers, which then simply do not spin (AC-6)", () => {
    const artist = new Group();
    artist.add(new Mesh(new BoxGeometry(1.6, 0.8, 1.8), new MeshStandardMaterial()));
    assets.add("rov", artist);
    const model = createRovModel();
    // `assets.model` hands out a clone, so the artist's 1.6 m box is recognised by its size.
    const size = new Box3().setFromObject(model.children[0]).getSize(new Vector3());
    expect(size.x).toBeCloseTo(1.6);
    expect(model.getObjectByName("deck-hatch")).toBeUndefined();
    expect(() => updateRovPropellers(model, 0.1, 6)).not.toThrow();
    expect(model.getObjectByName("propeller-left")).toBeUndefined();
  });
});
