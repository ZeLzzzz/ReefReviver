import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { constrainToBay, floorHeight, posts, rocks } from "../../src/game/bay";
import { aimDirection, followCamera } from "../../src/game/follow-camera";
import { inStationZone } from "../../src/game/station";
import { createRovState, forwardVector, steer, stepRov, type MoveInput, type RovState } from "../../src/game/rov";

const { bay, rov } = config;
const idle: MoveInput = { forward: 0, strafe: 0, rise: 0 };

function fly(state: RovState, input: Partial<MoveInput>, seconds: number, onStep?: (s: RovState) => void): RovState {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepRov(state, { ...idle, ...input }, dt);
    onStep?.(state);
  }
  return state;
}

function rovAt(x: number, y: number, z: number, yaw = 0): RovState {
  return { position: new Vector3(x, y, z), velocity: new Vector3(), yaw, pitch: 0 };
}

describe("ROV controls (REQ-001 AC-3)", () => {
  it("starts off the west shore by the dock, facing east (+X) into the bay, inside the water and above the floor (D-071)", () => {
    const state = createRovState();
    expect(forwardVector(state.yaw).x).toBeCloseTo(1);
    expect(Math.hypot(state.position.x - config.bay.dock.seaX, state.position.z - config.bay.dock.z)).toBeLessThan(25);
    const before = state.position.clone();
    constrainToBay(state.position, state.velocity);
    expect(state.position.distanceTo(before)).toBe(0);
  });

  it("W moves forward along the heading and S moves back", () => {
    const forward = fly(createRovState(), { forward: 1 }, 1);
    expect(forward.position.x).toBeGreaterThan(rov.start.x + 2);
    expect(forward.position.z).toBeCloseTo(rov.start.z, 5);

    const back = fly(createRovState(), { forward: -1 }, 1);
    expect(back.position.x).toBeLessThan(rov.start.x - 2);
  });

  it("D strafes right and A strafes left", () => {
    // Facing east, right is south (+Z).
    expect(fly(createRovState(), { strafe: 1 }, 1).position.z).toBeGreaterThan(rov.start.z + 2);
    expect(fly(createRovState(), { strafe: -1 }, 1).position.z).toBeLessThan(rov.start.z - 2);
  });

  it("Space rises and Shift dives", () => {
    expect(fly(createRovState(), { rise: 1 }, 1).position.y).toBeGreaterThan(rov.start.y + 1);
    expect(fly(createRovState(), { rise: -1 }, 1).position.y).toBeLessThan(rov.start.y - 1);
  });

  it("never goes faster than the top speed, even diagonally", () => {
    let fastest = 0;
    fly(createRovState(), { forward: 1, strafe: 1 }, 3, (s) => {
      fastest = Math.max(fastest, Math.hypot(s.velocity.x, s.velocity.z));
    });
    expect(fastest).toBeLessThanOrEqual(rov.maxSpeed + 1e-9);
  });

  it("glides to a stop when no key is held", () => {
    const state = fly(createRovState(), { forward: 1 }, 1);
    fly(state, {}, 3);
    expect(state.velocity.length()).toBeLessThan(0.01);
  });

  it("the mouse turns the ROV: right turns right, up looks up", () => {
    const state = createRovState();
    steer(state, Math.PI / 2 / rov.mouseSensitivity, 0);
    // Facing east, a right turn faces south.
    expect(forwardVector(state.yaw).z).toBeCloseTo(1);
    steer(state, 0, -100);
    expect(state.pitch).toBeGreaterThan(0);
  });

  it("limits how far the aim can tilt up or down", () => {
    const state = createRovState();
    steer(state, 0, -100000);
    expect(state.pitch).toBe(rov.maxPitch);
    steer(state, 0, 100000);
    expect(state.pitch).toBe(rov.minPitch);
  });
});

describe("third-person camera (REQ-001 AC-3, D-029)", () => {
  it("sits behind and above the ROV and looks where it aims", () => {
    const state = createRovState();
    const position = new Vector3();
    const target = new Vector3();
    followCamera(state, position, target);
    const offset = position.clone().sub(state.position);
    expect(offset.dot(forwardVector(state.yaw))).toBeLessThan(0);
    expect(offset.y).toBeGreaterThan(0);
    expect(target.clone().sub(position).distanceTo(aimDirection(state.yaw, state.pitch))).toBeLessThan(1e-9);
  });

  it("is not held under the surface when the ROV floats there (REQ-024 AC-3)", () => {
    const state = rovAt(0, bay.surfaceY - rov.floatDepth, 0);
    state.pitch = rov.minPitch;
    const position = new Vector3();
    followCamera(state, position, new Vector3());
    expect(position.y).toBeGreaterThan(bay.surfaceY);
  });

  it("stays above the floor when looking up near it", () => {
    const state = rovAt(0, floorHeight(0, 0) + rov.radius, 0);
    state.pitch = rov.maxPitch;
    const position = new Vector3();
    followCamera(state, position, new Vector3());
    expect(position.y).toBeGreaterThan(floorHeight(position.x, position.z));
  });

});

describe("bay limits (REQ-001 AC-4)", () => {
  it("stops at the sea floor", () => {
    const state = fly(createRovState(), { rise: -1 }, 20, (s) => {
      expect(s.position.y).toBeGreaterThanOrEqual(floorHeight(s.position.x, s.position.z) + rov.radius - 1e-9);
    });
    // On a slope the ROV rests against it, a hair higher than straight above the floor.
    expect(state.position.y).toBeCloseTo(floorHeight(state.position.x, state.position.z) + rov.radius, 1);
  });

  it("stops at the water surface, floating with its centre floatDepth under it (REQ-024 AC-2)", () => {
    const state = fly(createRovState(), { rise: 1 }, 20);
    expect(state.position.y).toBe(bay.surfaceY - rov.floatDepth);
  });

  it("does not pass through rocks", () => {
    // Rocks with open water level with them on the west side, where the ROV starts its run.
    const reachable = rocks.filter((r) => floorHeight(r.x - r.size - 4, r.z) < r.y - rov.radius - 0.5);
    expect(reachable.length).toBeGreaterThan(2);
    for (const rock of reachable) {
      // Yaw PI/2 faces +X, straight at the rock.
      const state = rovAt(rock.x - rock.size - 4, rock.y, rock.z, Math.PI / 2);
      fly(state, { forward: 1 }, 4, (s) => {
        const inside =
          ((s.position.x - rock.x) / rock.size) ** 2 +
          ((s.position.y - rock.y) / rock.height) ** 2 +
          ((s.position.z - rock.z) / rock.size) ** 2;
        expect(inside).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe("the dock's posts are solid for the submarine (REQ-016)", () => {
    it("stops the submarine at a post, under the deck", () => {
      for (const post of posts.filter((p) => floorHeight(p.x, p.z) < -3)) {
        const y = Math.max(floorHeight(post.x, post.z) + rov.radius + 0.5, -2.5);
        // Facing -X (yaw -PI/2), from 4 m east of the post.
        const state = rovAt(post.x + 4, y, post.z, -Math.PI / 2);
        fly(state, { forward: 1 }, 3, (s) => {
          expect(Math.hypot(s.position.x - post.x, s.position.z - post.z)).toBeGreaterThanOrEqual(post.radius + rov.radius - 1e-6);
        });
      }
    });

    it("has no station under the water any more: the old station's place is open water (D-078)", () => {
      const state = rovAt(-108, -6, 8, Math.PI / 2);
      constrainToBay(state.position, state.velocity);
      const from = state.position.clone();
      fly(state, { forward: 1 }, 2);
      expect(state.position.x).toBeGreaterThan(from.x + 5);
      expect(inStationZone(state.position)).toBe(false);
    });
  });

  it("slides along a limit instead of sticking to it", () => {
    // Diving forward over a reef site's level pad: the floor stops the descent but not the forward motion.
    const site = config.reef.frameSpots[0];
    const state = rovAt(site.x, floorHeight(site.x, site.z + 2) + rov.radius, site.z + 2, Math.PI);
    fly(state, { forward: 1, rise: -1 }, 1);
    expect(state.position.z).toBeLessThan(site.z);
  });
});
