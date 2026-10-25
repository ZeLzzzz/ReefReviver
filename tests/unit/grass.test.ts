import { Frustum, Matrix4, MeshStandardMaterial, PerspectiveCamera, Scene, ShaderLib, Vector3, type WebGLProgramParametersWithUniforms } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight, floorSlope } from "../../src/game/bay";
import { grassBlades, growsGrassAt, windBend, windDirection } from "../../src/game/grass";
import { createGrassView } from "../../src/game/grass-model";
import { createWalker, insideShed, landObstacles, onDock, stepWalker } from "../../src/game/land";
import { counterPosition } from "../../src/game/station";
import { generateTrash } from "../../src/game/trash";
import { inland, headland } from "../../src/game/terrain";
import { buildWorld } from "../../src/game/world";

const { land, bay, station } = config;
const { grass } = land;

describe("grass on the land (REQ-018 AC-1)", () => {
  it("grows on the dry beach from 8 m inland to the foot of the cliff, along the whole open beach", () => {
    expect(grassBlades.length).toBeGreaterThan(10000);
    for (const b of grassBlades) {
      expect(inland(b.x, b.z)).toBeGreaterThanOrEqual(grass.fromInland);
      // A blade stands up to `tuftRadius` from its tuft, so it may lie a little past the cliff's foot; the slope rule
      // keeps it off the cliff itself (see below).
      expect(b.x).toBeGreaterThanOrEqual(land.cliffX - grass.tuftRadius);
      expect(Math.abs(b.z)).toBeLessThan(bay.shore.openHalf);
    }
    // It reaches the level top of the beach, which ends at the cliff's foot, and both ends of the open beach.
    const furthest = grassBlades.reduce((most, b) => Math.max(most, inland(b.x, b.z)), 0);
    expect(furthest).toBeGreaterThan(15);
    expect(grassBlades.some((b) => b.z > bay.shore.openHalf - 15)).toBe(true);
    expect(grassBlades.some((b) => b.z < -(bay.shore.openHalf - 15))).toBe(true);
  });

  it("every blade stands where the placement rules allow", () => {
    for (const b of grassBlades) expect(growsGrassAt(b.x, b.z)).toBe(true);
  });
});

describe("where grass must not grow (REQ-018 AC-3)", () => {
  it("never on the headlands at either end of the beach, in the water, or on the steep foot of the cliff", () => {
    for (const b of grassBlades) {
      expect(headland(b.x, b.z)).toBe(0);
      expect(floorHeight(b.x, b.z)).toBeGreaterThan(bay.surfaceY);
      expect(floorSlope(b.x, b.z)).toBeLessThanOrEqual(grass.maxSlope + 1e-9);
    }
  });

  it("never inside the recycling shed, on the dock, or on a palm or a rock", () => {
    for (const b of grassBlades) {
      expect(insideShed(b.x, b.z)).toBe(false);
      expect(insideShed(b.x, b.z, grass.structureClear)).toBe(false);
      expect(onDock(b.x, b.z)).toBe(false);
      for (const o of landObstacles) expect(Math.hypot(b.x - o.x, b.z - o.z)).toBeGreaterThan(o.radius);
    }
  });

  it("keeps the counter's zone ring clear, so the ring and the counter stay in view (REQ-018 AC-2)", () => {
    for (const b of grassBlades) {
      expect(Math.hypot(b.x - counterPosition.x, b.z - counterPosition.z)).toBeGreaterThan(station.zoneRadius + grass.counterClear);
    }
  });
});

describe("the grass does not stop the player (REQ-018 AC-2)", () => {
  it("is at most 0.5 m tall", () => {
    expect(grass.maxHeight).toBeLessThanOrEqual(0.5);
    for (const b of grassBlades) {
      expect(b.height).toBeGreaterThanOrEqual(grass.minHeight);
      expect(b.height).toBeLessThanOrEqual(grass.maxHeight);
    }
  });

  it("is not an obstacle: a walker crosses a patch at full walking speed", () => {
    // Facing east, from a blade about 12 m inland, away from the shed, the palms and the rocks.
    const start = grassBlades.find((b) => Math.abs(inland(b.x, b.z) - 12) < 0.5 && Math.abs(b.z + 30) < 6)!;
    expect(start).toBeDefined();
    const walker = createWalker(start.x, start.z, Math.PI / 2);
    const dt = 1 / 60;
    for (let frame = 0; frame < 120; frame++) stepWalker(walker, { forward: 1, strafe: 0, rise: 0 }, dt);
    expect(Math.hypot(walker.position.x - start.x, walker.position.z - start.z)).toBeCloseTo(land.walkSpeed * 2, 6);
    // And it did walk through blades: some of the grass lies on the path.
    const onPath = grassBlades.filter((b) => b.z > start.z - 0.2 && b.z < start.z + 0.2 && b.x > start.x && b.x < walker.position.x);
    expect(onPath.length).toBeGreaterThan(0);
  });
});

describe("the wind (REQ-018 AC-4)", () => {
  it("bends the tips and never the roots, never more than the amplitude, and changes smoothly", () => {
    const { amplitude } = grass.sway;
    expect(Math.hypot(windDirection.x, windDirection.z)).toBeCloseTo(1, 12);
    expect(windBend(-140, 0, 0, 1.3)).toBe(0);
    let most = 0;
    let last = windBend(-140, 0, 1, 0);
    const dt = 1 / 60;
    for (let t = dt; t < grass.sway.period * 2; t += dt) {
      const bend = windBend(-140, 0, 1, t);
      expect(bend).toBeGreaterThanOrEqual(0);
      expect(bend).toBeLessThanOrEqual(amplitude + 1e-12);
      // The tip moves most: halfway up, a blade bends less than half as far as its tip.
      if (bend > 0) expect(windBend(-140, 0, 0.5, t)).toBeLessThan(bend / 2);
      // No jump from one frame to the next: a flicker would show here.
      expect(Math.abs(bend - last)).toBeLessThan(0.002);
      last = bend;
      most = Math.max(most, bend);
    }
    // A gust does come round: the tips reach the full amplitude within the period.
    expect(most).toBeGreaterThan(amplitude * 0.99);
  });

  it("is gentle: a tip moves about 7 degrees at most on the tallest blade", () => {
    const angle = Math.atan(grass.sway.amplitude / grass.maxHeight);
    expect(angle * (180 / Math.PI)).toBeLessThan(8);
  });

  it("is written into the standard vertex shader, which bends the tips and keeps the clock running", () => {
    const { mesh } = createGrassView();
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: "" } as unknown as WebGLProgramParametersWithUniforms;
    (mesh.material as MeshStandardMaterial).onBeforeCompile(shader, null as never);
    expect(shader.vertexShader).toContain("uniform vec3 uSway;");
    expect(shader.vertexShader).toContain("grassGust");
    expect(shader.vertexShader).not.toContain("#include <project_vertex>");
    expect(Object.keys(shader.uniforms).sort()).toEqual(["uSway", "uTime", "uWind"]);
  });
});

describe("the grass colour (REQ-018 AC-4)", () => {
  it("is green, and does not change with the Bloom, the water or the cave", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const mesh = world.grass.mesh;
    const colours = () => Array.from(mesh.instanceColor!.array);
    const before = colours();
    for (let i = 0; i < mesh.count; i++) {
      const [r, g, b] = [before[i * 3], before[i * 3 + 1], before[i * 3 + 2]];
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
    }
    world.setClarity(1);
    world.setAbove(true);
    world.setClarity(0.4);
    world.setAbove(false);
    world.setCave(1);
    expect(colours()).toEqual(before);
    world.setCave(0);
    world.update(1, new Vector3(0, -3, 0));
    expect(colours()).toEqual(before);
  });
});

describe("the grass is culled only when it is out of view (REQ-018 AC-5)", () => {
  it("has a bounding sphere that holds every blade, root and tip", () => {
    const { mesh } = createGrassView();
    const sphere = mesh.boundingSphere!;
    for (const b of grassBlades) {
      expect(sphere.containsPoint(new Vector3(b.x, b.y, b.z))).toBe(true);
      expect(sphere.containsPoint(new Vector3(b.x, b.y + b.height, b.z))).toBe(true);
    }
  });

  it("is in view from the bay looking at the beach, and out of view looking away from it", () => {
    const { mesh } = createGrassView();
    const frustum = new Frustum();
    const camera = new PerspectiveCamera(config.camera.fov, 16 / 9, 0.1, config.camera.far);
    const seen = (target: [number, number, number]) => {
      camera.position.set(60, -0.3, 0);
      camera.lookAt(...target);
      camera.updateMatrixWorld();
      frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      return frustum.intersectsObject(mesh);
    };
    expect(seen([-140, 0, 0])).toBe(true);
    expect(seen([200, -0.3, 0])).toBe(false);
  });
});

describe("grass and the beach's trash (REQ-018 AC-1, REQ-017 AC-1)", () => {
  it("leaves the sand by the water bare, so no blade grows on or right beside a piece of beach trash", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const item of generateTrash(seed).filter((i) => i.onBeach)) {
        expect(grassBlades.some((b) => Math.hypot(b.x - item.home.x, b.z - item.home.z) < 0.5)).toBe(false);
      }
    }
  });
});
