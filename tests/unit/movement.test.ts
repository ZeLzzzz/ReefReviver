import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { constrainToBay, floorHeight, rocks } from "../../src/game/bay";
import { aimDirection, followCamera } from "../../src/game/follow-camera";
import { inStationZone, stationPosition } from "../../src/game/station";
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
  it("starts near the station facing east (+X), into the bay, inside the water and above the floor (D-071)", () => {
    const state = createRovState();
    expect(forwardVector(state.yaw).x).toBeCloseTo(1);
    expect(Math.hypot(state.position.x - stationPosition.x, state.position.z - stationPosition.z)).toBeLessThan(20);
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

  it("stays under the surface when looking down near it", () => {
    const state = rovAt(0, bay.surfaceY - rov.radius, 0);
    state.pitch = rov.minPitch;
    const position = new Vector3();
    followCamera(state, position, new Vector3());
    expect(position.y).toBeLessThan(bay.surfaceY);
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

  it("stops at the water surface", () => {
    const state = fly(createRovState(), { rise: 1 }, 20);
    expect(state.position.y).toBe(bay.surfaceY - rov.radius);
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

  describe("the recycling station is solid (REQ-002 AC-8, D-041)", () => {
    const { body } = config.station;
    const top = stationPosition.y + body.height;
    const horizontal = (s: RovState) => Math.hypot(s.position.x - stationPosition.x, s.position.z - stationPosition.z);

    it("stops the ROV at the station's side", () => {
      // Facing -X (yaw -PI/2), level with the container, starting east of the station.
      const state = rovAt(stationPosition.x + 5, stationPosition.y + 1.5, stationPosition.z, -Math.PI / 2);
      fly(state, { forward: 1 }, 4, (s) => {
        if (s.position.y < top) expect(horizontal(s)).toBeGreaterThanOrEqual(body.radius + rov.radius - 1e-9);
      });
      expect(horizontal(state)).toBeLessThan(body.radius + rov.radius + 0.5);
    });

    it("lets the ROV settle on top instead of sinking into it", () => {
      const state = rovAt(stationPosition.x - 0.3, top + 3, stationPosition.z + 0.2, 0);
      fly(state, { rise: -1 }, 4);
      expect(state.position.y).toBeCloseTo(top + rov.radius, 5);
    });

    it("stops the ROV at the beacon mast", () => {
      const { mast } = config.station;
      const mx = stationPosition.x + mast.dx;
      const mz = stationPosition.z + mast.dz;
      const state = rovAt(mx, stationPosition.y + 5, mz + 4, Math.PI);
      fly(state, { forward: 1 }, 3, (s) => {
        expect(Math.hypot(s.position.x - mx, s.position.z - mz)).toBeGreaterThanOrEqual(mast.radius + rov.radius - 1e-9);
      });
    });

    it("still lets the ROV into the deposit zone", () => {
      const state = rovAt(stationPosition.x + 8, stationPosition.y + 1.5, stationPosition.z, -Math.PI / 2);
      let entered = false;
      fly(state, { forward: 1 }, 4, (s) => {
        entered ||= inStationZone(s.position);
      });
      expect(entered).toBe(true);
    });
  });

  it("slides along a limit instead of sticking to it", () => {
    // Diving forward over a reef site's level pad: the floor stops the descent but not the forward motion.
    const site = config.reef.frameSites[0];
    const state = rovAt(site.x, floorHeight(site.x, site.z + 2) + rov.radius, site.z + 2, Math.PI);
    fly(state, { forward: 1, rise: -1 }, 1);
    expect(state.position.z).toBeLessThan(site.z);
  });
});
