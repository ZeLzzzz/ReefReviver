import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { allSpots } from "../../src/game/layout";
import { arches, boulders, constrainToBay, corals, floorHeight, insideRockAt, rocks, terrainSolidAt } from "../../src/game/bay";
import { followCamera, keepCameraInWater } from "../../src/game/follow-camera";
import { createRovState, forwardVector, stepRov, type MoveInput, type RovState } from "../../src/game/rov";
import { stationPosition } from "../../src/game/station";
import { inland, squareRadius } from "../../src/game/terrain";
import { generateTrash } from "../../src/game/trash";

const { bay, rov, camera, trash } = config;
const idle: MoveInput = { forward: 0, strafe: 0, rise: 0 };

function fly(state: RovState, input: Partial<MoveInput>, seconds: number, onStep?: (s: RovState) => void): RovState {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepRov(state, { ...idle, ...input }, dt);
    onStep?.(state);
  }
  return state;
}

function rovAt(x: number, y: number, z: number, yaw = 0, pitch = 0): RovState {
  return { position: new Vector3(x, y, z), velocity: new Vector3(), yaw, pitch };
}

/** Whether the ROV's centre is legally placed: in the water and out of the floor. */
function expectInWater(s: RovState): void {
  expect(s.position.y).toBeGreaterThanOrEqual(floorHeight(s.position.x, s.position.z) + rov.radius - 1e-6);
  expect(s.position.y).toBeLessThanOrEqual(bay.surfaceY - rov.radius + 1e-9);
}

/** Every point of the open bay on a grid: away from the rock wall and the shore's shelf. */
function openBay(step = 3): { x: number; z: number; y: number }[] {
  const points = [];
  const reach = bay.wall.radius - bay.wall.width - 5;
  for (let x = -reach; x <= reach; x += step) {
    for (let z = -reach; z <= reach; z += step) {
      if (squareRadius(x, z) > reach || inland(x, z) > -bay.shore.shelfWidth - bay.shore.blendWidth - 5) continue;
      points.push({ x, z, y: floorHeight(x, z) });
    }
  }
  return points;
}

/** Water width along a line through the centre: from where the floor leaves the surface to where it meets it again. */
function waterWidth(along: (t: number) => [number, number]): number {
  let first = Infinity;
  let last = -Infinity;
  for (let t = -bay.halfSize; t <= bay.halfSize; t += 0.5) {
    const [x, z] = along(t);
    if (floorHeight(x, z) < bay.surfaceY) {
      first = Math.min(first, t);
      last = Math.max(last, t);
    }
  }
  return last - first;
}

describe("a bay about 300 m wide with hills and valleys (REQ-011 AC-1)", () => {
  it("is about 300 m across from west to east and from north to south, walls and shore included", () => {
    for (const width of [waterWidth((t) => [t, 0]), waterWidth((t) => [0, t])]) {
      expect(width).toBeGreaterThan(250);
      expect(width).toBeLessThan(300);
    }
  });

  it("goes down to about 25 m in the valleys and up to about 8 m below the surface on the hill tops", () => {
    const heights = openBay().map((p) => p.y);
    expect(Math.min(...heights)).toBeLessThan(-23);
    expect(Math.min(...heights)).toBeGreaterThan(-27);
    expect(Math.max(...heights)).toBeGreaterThan(-9.5);
    expect(Math.max(...heights)).toBeLessThanOrEqual(bay.hillCap);
  });

  it("rises over each hill and sinks into each valley", () => {
    for (const hill of bay.hills) expect(floorHeight(hill.x, hill.z)).toBeGreaterThan(floorHeight(hill.x + hill.radius, hill.z) + 2);
    for (const valley of bay.valleys) expect(floorHeight(valley.x, valley.z)).toBeLessThan(floorHeight(valley.x + valley.radius, valley.z) - 2);
  });

  it("has flat-topped boulders in two tiers standing on the floor, the upper one narrower", () => {
    expect(boulders.length).toBe(bay.boulders.length);
    for (const boulder of boulders) {
      const [lower, upper] = boulder.tiers;
      expect(upper.radius).toBeLessThan(lower.radius);
      expect(upper.baseY).toBeCloseTo(lower.baseY + lower.height, 0);
      // The lower tier is buried all around: no gap under it.
      for (let angle = 0; angle < Math.PI * 2; angle += 0.3) {
        expect(lower.baseY).toBeLessThan(floorHeight(boulder.x + Math.cos(angle) * lower.radius, boulder.z + Math.sin(angle) * lower.radius));
      }
      expect(upper.baseY + upper.height).toBeLessThan(bay.surfaceY - 4);
    }
  });

  it("has rock arches whose feet are buried and whose opening is tall enough for the ROV", () => {
    expect(arches.length).toBe(bay.arches.length);
    for (const arch of arches) {
      for (const side of [1, -1]) {
        const footX = arch.x + Math.cos(arch.yaw) * arch.radius * side;
        const footZ = arch.z - Math.sin(arch.yaw) * arch.radius * side;
        expect(arch.y).toBeLessThan(floorHeight(footX, footZ));
      }
      const opening = arch.y + arch.radius - arch.tube - floorHeight(arch.x, arch.z);
      expect(opening).toBeGreaterThan(2 * rov.radius + 1);
    }
  });

  it("starts the ROV near the west shore, a short swim from the dock (D-071, REQ-016)", () => {
    expect(rov.start.x).toBeLessThan(-80);
    expect(Math.hypot(rov.start.x - bay.dock.seaX, rov.start.z - bay.dock.z)).toBeLessThan(25);
    const fromShore = inland(rov.start.x, rov.start.z);
    expect(fromShore).toBeLessThan(-10);
    expect(fromShore).toBeGreaterThan(-bay.shore.shelfWidth - bay.shore.blendWidth);
    // The recycling shed stands on the land behind the beach.
    expect(inland(stationPosition.x, stationPosition.z)).toBeGreaterThan(10);
  });
});

describe("the west shore (REQ-011 AC-2)", () => {
  it("rises from the bay to the surface and goes on as land above it", () => {
    for (let z = -90; z <= 90; z += 10) {
      let previous = floorHeight(-80, z);
      let waterline: number | null = null;
      for (let x = -80; x >= -bay.halfSize; x -= 1) {
        const h = floorHeight(x, z);
        // Under water the floor only rises toward the shore.
        if (x < -95 && h < bay.surfaceY) expect(h).toBeGreaterThanOrEqual(previous - 0.05);
        if (waterline === null && h > bay.surfaceY) waterline = x;
        previous = h;
      }
      expect(waterline).not.toBeNull();
      expect(waterline!).toBeLessThan(-120);
      expect(waterline!).toBeGreaterThan(-145);
      expect(floorHeight(-155, z)).toBeGreaterThan(bay.surfaceY + 2);
    }
  });

  it("leaves the dock's spot empty in shallow water next to the station (D-069)", () => {
    const { dock } = bay;
    const depth = bay.surfaceY - floorHeight(dock.x, dock.z);
    expect(depth).toBeGreaterThan(0.5);
    expect(depth).toBeLessThan(5);
    expect(Math.hypot(dock.x - stationPosition.x, dock.z - stationPosition.z)).toBeLessThan(30);
    for (const rock of rocks) expect(Math.hypot(rock.x - dock.x, rock.z - dock.z)).toBeGreaterThan(dock.clear);
    for (const item of generateTrash()) expect(Math.hypot(item.home.x - dock.x, item.home.z - dock.z)).toBeGreaterThan(dock.clear);
    for (const thing of [...boulders, ...arches]) expect(Math.hypot(thing.x - dock.x, thing.z - dock.z)).toBeGreaterThan(dock.clear + 10);
  });
});

describe("limits (REQ-011 AC-3)", () => {
  it("rises above the surface all the way round before the edge of the terrain: no invisible wall", () => {
    for (let a = 0; a < 720; a++) {
      const angle = (a / 720) * Math.PI * 2;
      let closed = false;
      for (let r = 0; r < bay.halfSize * 1.42; r += 0.5) {
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (Math.max(Math.abs(x), Math.abs(z)) > bay.halfSize - 4) break;
        if (floorHeight(x, z) > bay.surfaceY) {
          closed = true;
          break;
        }
      }
      expect(closed).toBe(true);
    }
  });

  it.each([
    ["the rock wall to the north", Math.PI],
    ["the rock wall to the north-east", (Math.PI * 3) / 4],
    ["the rock wall to the east", Math.PI / 2],
    ["the rock wall to the south-east", Math.PI / 4],
    ["the rock wall to the south", 0],
    ["the shore to the west", -Math.PI / 2],
    ["the rock wall to the north-west", (-Math.PI * 3) / 4],
  ])("stops at %s, never inside it", (_name, yaw) => {
    const state = rovAt(0, -10, 0, yaw);
    constrainToBay(state.position, state.velocity);
    fly(state, { forward: 1 }, 60, expectInWater);
    const end = state.position.clone();
    fly(state, { forward: 1 }, 1, expectInWater);
    expect(state.position.distanceTo(end)).toBeLessThan(0.5);
    const edge = bay.halfSize - 3;
    expect(Math.abs(state.position.x)).toBeLessThan(edge);
    expect(Math.abs(state.position.z)).toBeLessThan(edge);
    // What stopped it is right ahead: floor rising above it, or water too shallow for it.
    const ahead = forwardVector(yaw).multiplyScalar(3).add(state.position);
    expect(floorHeight(ahead.x, ahead.z)).toBeGreaterThan(state.position.y - rov.radius);
  });

  it("climbs over a hill instead of going into it", () => {
    const hill = bay.hills[2];
    const state = rovAt(hill.x - hill.radius - 5, floorHeight(hill.x - hill.radius - 5, hill.z) + 1.5, hill.z, Math.PI / 2);
    fly(state, { forward: 1 }, 15, expectInWater);
    expect(state.position.x).toBeGreaterThan(hill.x);
  });

  it("stops at a boulder's side and settles on its top", () => {
    for (const boulder of boulders) {
      const [lower, upper] = boulder.tiers;
      const midY = lower.baseY + lower.height - 1;
      const state = rovAt(boulder.x - lower.radius - 4, midY, boulder.z, Math.PI / 2);
      constrainToBay(state.position, state.velocity);
      fly(state, { forward: 1 }, 3, (s) => {
        if (s.position.y < lower.baseY + lower.height) expect(Math.hypot(s.position.x - boulder.x, s.position.z - boulder.z)).toBeGreaterThanOrEqual(lower.radius + rov.radius - 1e-6);
      });
      const top = upper.baseY + upper.height;
      // REQ-020: a boulder with a reef on its top is topped by the coral, so the vehicle settles on that; a bare one, on the rock.
      const reefOnTop = corals.some((c) => Math.hypot(c.x - boulder.x, c.z - boulder.z) < lower.radius && c.y > lower.baseY + lower.height - 0.5);
      const above = rovAt(boulder.x + upper.radius - 0.3, top + 3, boulder.z);
      fly(above, { rise: -1 }, 4);
      if (reefOnTop) expect(above.position.y).toBeGreaterThan(top - 2.5);
      else expect(above.position.y).toBeCloseTo(top + rov.radius, 3);
    }
  });

  it("passes under an arch, and stops at its side", () => {
    for (const arch of arches) {
      const open = forwardVector(arch.yaw);
      const floor = floorHeight(arch.x, arch.z);
      const state = rovAt(arch.x - open.x * 10, floor + 2.2, arch.z - open.z * 10, arch.yaw);
      constrainToBay(state.position, state.velocity);
      fly(state, { forward: 1 }, 5, (s) => expect(insideRockAt(s.position.x, s.position.y, s.position.z, rov.radius - 0.05)).toBe(false));
      const through = (state.position.x - arch.x) * open.x + (state.position.z - arch.z) * open.z;
      expect(through).toBeGreaterThan(5);

      // Straight at one foot, level with the floor: it stops at the rock.
      const span = { x: Math.cos(arch.yaw), z: -Math.sin(arch.yaw) };
      const footX = arch.x + span.x * arch.radius;
      const footZ = arch.z + span.z * arch.radius;
      const side = rovAt(footX - open.x * 6, floorHeight(footX, footZ) + 1.2, footZ - open.z * 6, arch.yaw);
      constrainToBay(side.position, side.velocity);
      fly(side, { forward: 1 }, 3, (s) => expect(insideRockAt(s.position.x, s.position.y, s.position.z, rov.radius - 0.05)).toBe(false));
    }
  });
});

describe("the camera stays out of slopes, rocks and walls (REQ-011 AC-4)", () => {
  it("comes in closer when a boulder is behind the ROV", () => {
    const boulder = boulders[0];
    const lower = boulder.tiers[0];
    // Facing east with the boulder right behind: the camera would be inside it.
    const state = rovAt(boulder.x + lower.radius + rov.radius + 0.2, lower.baseY + lower.height - 1.5, boulder.z, Math.PI / 2);
    const position = new Vector3();
    followCamera(state, position, new Vector3());
    expect(terrainSolidAt(position.x, position.y, position.z)).toBe(false);
    expect(position.distanceTo(state.position)).toBeLessThan(camera.distance);
  });

  it("is never inside the floor, a rock, a boulder, an arch or the wall, wherever the ROV is", () => {
    const random = (() => {
      let a = 99;
      return () => ((a = (a * 16807) % 2147483647) / 2147483647);
    })();
    const position = new Vector3();
    let checked = 0;
    while (checked < 1500) {
      const x = (random() * 2 - 1) * (bay.halfSize - 10);
      const z = (random() * 2 - 1) * (bay.halfSize - 10);
      const floor = floorHeight(x, z);
      if (floor > bay.surfaceY - 2.5) continue;
      const state = rovAt(x, floor + rov.radius + random() * Math.max(0, -floor - 2 * rov.radius), z, random() * Math.PI * 2, (random() * 2 - 1) * 1);
      constrainToBay(state.position, state.velocity);
      followCamera(state, position, new Vector3());
      expect(terrainSolidAt(position.x, position.y, position.z)).toBe(false);
      expect(position.y).toBeLessThan(bay.surfaceY);
      checked++;
    }
  });

  it("keeps the title screen's orbiting camera in the water too", () => {
    const state = createRovState();
    const position = new Vector3(state.position.x - 7, state.position.y - 20, state.position.z);
    keepCameraInWater(position, state.position);
    expect(terrainSolidAt(position.x, position.y, position.z)).toBe(false);
  });
});

describe("goals on the new map (REQ-011 AC-5)", () => {
  const items = generateTrash();

  it("lays about 60 pieces of trash in small groups", () => {
    expect(items.length).toBe(trash.count);
    for (const item of items) {
      const neighbours = items.filter((other) => other !== item && Math.hypot(other.home.x - item.home.x, other.home.z - item.home.z) < 2 * trash.groupRadius);
      expect(neighbours.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("spreads the trash over the whole bay, not one corner", () => {
    const quarters = new Set(items.map((item) => `${item.home.x > 0 ? "E" : "W"}${item.home.z > 0 ? "S" : "N"}`));
    expect(quarters.size).toBe(4);
  });

  it("puts every piece where the ROV can reach it: in deep enough water, on gentle floor, out of the rocks (the beach's 8 aside: REQ-017)", () => {
    for (const item of items.filter((i) => !i.onBeach)) {
      const { x, z } = item.home;
      expect(floorHeight(x, z)).toBeLessThan(bay.surfaceY - trash.minDepth);
      expect(insideRockAt(x, item.home.y, z, 0.5)).toBe(false);
      // The ROV fits above it.
      expect(terrainSolidAt(x, item.home.y + 1.5, z, rov.radius)).toBe(false);
    }
  });

  it("stands the nets, the reef sites and the seagrass patches on level floor the ROV can reach", () => {
    const places = allSpots;
    for (const { x, z } of places) {
      const h = floorHeight(x, z);
      expect(h).toBeLessThan(bay.surfaceY - 4);
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) expect(Math.abs(floorHeight(x + dx, z + dz) - h)).toBeLessThan(0.05);
      expect(terrainSolidAt(x, h + 2.5, z, rov.radius)).toBe(false);
    }
  });

  it("spreads the reef sites and nets over the bay, away from the shore (the seagrass patches lie on the shallow sand: REQ-019)", () => {
    for (const site of allSpots) {
      if (config.reef.patchSpots.some((p) => p.x === site.x && p.z === site.z)) continue;
      expect(inland(site.x, site.z)).toBeLessThan(-50);
    }
  });
});
