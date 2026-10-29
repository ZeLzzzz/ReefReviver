import { Box3, Vector3, type Mesh } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { constrainToBay, floorHeight, rocks, terrainSolidAt } from "../../src/game/bay";
import { caveColumn, caveInfo } from "../../src/game/cave";
import { followCamera, keepCameraInWater, viewAbove } from "../../src/game/follow-camera";
import { constrainRov, FLOAT_Y, stepRov, surfaceBob, type MoveInput, type RovState } from "../../src/game/rov";
import { buildRovMesh } from "../../src/game/rov-model";

const { bay, rov, camera } = config;
const idle: MoveInput = { forward: 0, strafe: 0, rise: 0 };

function rovAt(x: number, y: number, z: number, yaw = 0, pitch = 0): RovState {
  return { position: new Vector3(x, y, z), velocity: new Vector3(), yaw, pitch };
}

function fly(state: RovState, input: Partial<MoveInput>, seconds: number, onStep?: (s: RovState) => void): RovState {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepRov(state, { ...idle, ...input }, dt);
    onStep?.(state);
  }
  return state;
}

/** Open deep water well away from everything, where only the surface limits the vehicle. */
const open = (): RovState => {
  for (let x = -60; x < 100; x += 4) for (let z = -60; z < 100; z += 4) {
    if (floorHeight(x, z) < -9 && rocks.every((r) => Math.hypot(r.x - x, r.z - z) > r.size + 12)) return rovAt(x, -6, z);
  }
  throw new Error("no open water");
};

describe("floating at the surface (REQ-024 AC-1, AC-2)", () => {
  it("rises while Space is held and floats with its centre floatDepth under the surface", () => {
    const state = fly(open(), { rise: 1 }, 6);
    expect(state.position.y).toBe(bay.surfaceY - rov.floatDepth);
    expect(state.position.y).toBe(FLOAT_Y);
  });

  it("floats with the deck hatch above the water, through the whole bobbing (REQ-032 AC-4)", () => {
    const model = buildRovMesh();
    const hatch = model.getObjectByName("deck-hatch") as Mesh;
    for (let t = 0; t < 20; t += 0.05) {
      const bob = surfaceBob(FLOAT_Y, t);
      model.position.set(0, FLOAT_Y + bob.lift, 0);
      model.rotation.set(bob.pitch, 0, bob.roll, "YXZ");
      model.updateMatrixWorld(true);
      const box = new Box3().setFromObject(hatch);
      expect(box.min.y, `t ${t}`).toBeGreaterThan(bay.surfaceY);
    }
  });

  it("goes no higher and never above the water while Space stays held, and Shift dives again (AC-2)", () => {
    const state = fly(open(), { rise: 1 }, 6);
    fly(state, { rise: 1 }, 10, (s) => {
      expect(s.position.y).toBeLessThanOrEqual(FLOAT_Y);
      expect(s.velocity.y).toBeLessThanOrEqual(1e-9);
    });
    expect(state.position.y).toBe(FLOAT_Y);
    fly(state, { rise: -1 }, 2);
    expect(state.position.y).toBeLessThan(FLOAT_Y - 3);
  });

  it("keeps the collision position still: the bobbing is the model's only", () => {
    const state = fly(open(), { rise: 1 }, 6);
    const rest = state.position.clone();
    fly(state, {}, 5);
    expect(state.position.distanceTo(rest)).toBeLessThan(1e-9);
  });

  it("bobs gently at the surface and not at all when diving", () => {
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0; t < 20; t += 0.05) {
      const { lift, roll, pitch } = surfaceBob(FLOAT_Y, t);
      low = Math.min(low, lift);
      high = Math.max(high, lift);
      expect(Math.abs(roll)).toBeLessThanOrEqual(rov.bob.roll + 1e-12);
      expect(Math.abs(pitch)).toBeLessThanOrEqual(rov.bob.pitch + 1e-12);
    }
    expect(high).toBeGreaterThan(rov.bob.amplitude * 0.9);
    expect(low).toBeLessThan(-rov.bob.amplitude * 0.9);
    expect(high - low).toBeLessThan(0.2);
    for (let t = 0; t < 20; t += 0.5) {
      const deep = surfaceBob(FLOAT_Y - rov.bob.reach - 1, t);
      expect(Math.abs(deep.lift) + Math.abs(deep.roll) + Math.abs(deep.pitch)).toBe(0);
    }
  });

  it("still stops other bodies (animals) a full radius short of the surface", () => {
    for (const radius of [0.6, 0.9, 1.5]) {
      const p = new Vector3(0, 5, 0);
      const v = new Vector3(0, 1, 0);
      constrainToBay(p, v, radius);
      expect(p.y).toBeCloseTo(bay.surfaceY - radius, 9);
    }
  });

  it("does not move a vehicle that already floats", () => {
    const at = new Vector3(open().position.x, FLOAT_Y, open().position.z);
    const p = at.clone();
    constrainRov(p, new Vector3());
    expect(p.distanceTo(at)).toBe(0);
  });
});

describe("the camera at the surface (REQ-024 AC-3)", () => {
  it("follows from behind and above, out of the water, with no clamp at the surface", () => {
    const state = rovAt(0, FLOAT_Y, 0, 0.7, 0);
    const position = new Vector3();
    const target = new Vector3();
    const start = open();
    state.position.x = start.position.x;
    state.position.z = start.position.z;
    followCamera(state, position, target);
    expect(position.y).toBeCloseTo(FLOAT_Y + camera.height, 6);
    expect(position.y).toBeGreaterThan(bay.surfaceY);
    expect(position.distanceTo(state.position)).toBeGreaterThan(camera.distance * 0.9);
    // Behind the vehicle.
    const offset = position.clone().sub(state.position);
    expect(offset.x * Math.sin(state.yaw) + offset.z * Math.cos(state.yaw)).toBeLessThan(0);
  });

  it("rises with the vehicle all the way: the nearer the surface, the higher the camera, never held at the waterline", () => {
    const start = open();
    let previous = -Infinity;
    for (let y = -4; y <= FLOAT_Y + 1e-9; y += 0.1) {
      const position = new Vector3();
      followCamera(rovAt(start.position.x, y, start.position.z), position, new Vector3());
      expect(position.y).toBeGreaterThan(previous);
      previous = position.y;
    }
    expect(previous).toBeGreaterThan(bay.surfaceY + 1);
  });

  it("is not held under the surface even for a point far above it", () => {
    const p = new Vector3(0, 5, 0);
    keepCameraInWater(p, new Vector3(0, 4, 0));
    expect(p.y).toBeGreaterThan(bay.surfaceY);
  });
});

describe("the view above or under the water (REQ-024 AC-4)", () => {
  it("changes only a band past the waterline", () => {
    const band = camera.surfaceBand;
    expect(band).toBeGreaterThan(0);
    expect(viewAbove(false, bay.surfaceY + band / 2)).toBe(false);
    expect(viewAbove(false, bay.surfaceY + band + 0.01)).toBe(true);
    expect(viewAbove(true, bay.surfaceY - band / 2)).toBe(true);
    expect(viewAbove(true, bay.surfaceY - band - 0.01)).toBe(false);
    expect(viewAbove(false, -20)).toBe(false);
    expect(viewAbove(true, 20)).toBe(true);
  });

  it("does not flip when the camera moves back and forth across the waterline within the band", () => {
    let above = false;
    let flips = 0;
    for (let i = 0; i < 2000; i++) {
      const y = bay.surfaceY + Math.sin(i * 0.37) * camera.surfaceBand * 0.9;
      const next = viewAbove(above, y);
      if (next !== above) flips++;
      above = next;
    }
    expect(flips).toBe(0);
  });

  it("flips once per crossing when the camera really goes through the surface", () => {
    let above = false;
    let flips = 0;
    // Up from 2 m under to 2 m over, jittering by half the band the whole way, then down again.
    const path = [...Array.from({ length: 400 }, (_, i) => -2 + i * 0.01), ...Array.from({ length: 400 }, (_, i) => 2 - i * 0.01)];
    path.forEach((y, i) => {
      const next = viewAbove(above, y + Math.sin(i * 2.1) * camera.surfaceBand * 0.5);
      if (next !== above) flips++;
      above = next;
    });
    expect(flips).toBe(2);
  });

  it("is under the water when the vehicle is deep and above when the camera is clear of the surface", () => {
    const deep = new Vector3();
    followCamera(rovAt(0, -10, 0), deep, new Vector3());
    expect(viewAbove(false, deep.y)).toBe(false);
    const floating = new Vector3();
    const start = open();
    followCamera(rovAt(start.position.x, FLOAT_Y, start.position.z), floating, new Vector3());
    expect(viewAbove(false, floating.y)).toBe(true);
  });
});

describe("the other limits of the camera stay (REQ-024 AC-6)", () => {
  it("is never inside the floor or the rocks, near the surface, over the shallows and the shore", () => {
    const position = new Vector3();
    let checked = 0;
    for (let x = -130; x <= 130; x += 6.5) {
      for (let z = -130; z <= 130; z += 6.5) {
        const floor = floorHeight(x, z);
        if (floor > bay.surfaceY - 2) continue;
        for (const pitch of [-1.1, -0.4, 0, 0.7]) {
          const state = rovAt(x, FLOAT_Y, z, (x + z) % 6.28, pitch);
          constrainRov(state.position, state.velocity);
          followCamera(state, position, new Vector3());
          expect(terrainSolidAt(position.x, position.y, position.z), `${x},${z} pitch ${pitch}`).toBe(false);
          expect(position.y).toBeGreaterThan(floorHeight(position.x, position.z));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("is stopped by the cave's roof when the vehicle is inside the cave", () => {
    let inside = 0;
    for (const point of caveInfo.path.slice(7, -7)) {
      for (let k = 0; k < 12; k++) {
        const state = rovAt(point.x, point.y, point.z, (k / 12) * Math.PI * 2, 0.5);
        constrainRov(state.position, state.velocity);
        const position = new Vector3();
        followCamera(state, position, new Vector3());
        expect(position.y, `${point.x} yaw ${k}`).toBeLessThan(caveColumn(position.x, position.z).roof);
        expect(terrainSolidAt(position.x, position.y, position.z)).toBe(false);
        inside++;
      }
    }
    expect(inside).toBeGreaterThan(100);
  });
});
