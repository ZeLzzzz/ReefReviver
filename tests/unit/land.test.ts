import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight, floorSlope } from "../../src/game/bay";
import { ashoreSpot, canBoard, createWalker, eyePosition, landObstacles, lookWalker, standable, stepWalker, type Walker } from "../../src/game/land";
import { inland } from "../../src/game/terrain";

const { land, bay, rov } = config;
const idle = { forward: 0, strafe: 0, rise: 0 };

function walk(walker: Walker, input: Partial<typeof idle>, seconds: number, onStep?: (w: Walker) => void): Walker {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepWalker(walker, { ...idle, ...input }, dt);
    onStep?.(walker);
  }
  return walker;
}

/** The waterline's x at z: where inland() is 0. */
const waterlineX = (z: number) => {
  let x = -110;
  while (inland(x, z) < 0) x -= 0.1;
  return x;
};

describe("going ashore (REQ-015 AC-1)", () => {
  it("is offered within 10 m of the waterline of the open west shore", () => {
    for (let z = -70; z <= 70; z += 10) {
      const shore = waterlineX(z);
      expect(ashoreSpot(shore + 5, z)).not.toBeNull();
      expect(ashoreSpot(shore + land.ashoreRange - 0.5, z)).not.toBeNull();
      expect(ashoreSpot(shore + land.ashoreRange + 2, z)).toBeNull();
    }
  });

  it("is not offered out in the bay, by the rock walls, or on the east side", () => {
    expect(ashoreSpot(0, 0)).toBeNull();
    expect(ashoreSpot(config.station.x, config.station.z)).toBeNull();
    expect(ashoreSpot(rov.start.x, rov.start.z)).toBeNull();
    expect(ashoreSpot(waterlineX(0) + 3, bay.shore.openHalf + 10)).toBeNull();
    expect(ashoreSpot(130, 0)).toBeNull();
  });

  it("lands the player on dry, walkable beach facing inland, and leaves the submarine floating alongside", () => {
    for (let z = -70; z <= 70; z += 5) {
      const spot = ashoreSpot(waterlineX(z) + 6, z)!;
      expect(spot).not.toBeNull();
      expect(floorHeight(spot.landing.x, spot.landing.z)).toBeGreaterThan(bay.surfaceY);
      expect(standable(spot.landing.x, spot.landing.z)).toBe(true);
      // Facing inland (west, -X).
      expect(Math.sin(spot.landing.yaw)).toBeCloseTo(-1);
      // Deep enough to float, and close enough to the beach that a player at the water's edge can board.
      expect(floorHeight(spot.park.x, spot.park.z)).toBeLessThanOrEqual(bay.surfaceY - land.parkDepth);
      let edge = spot.landing.x;
      while (standable(edge + 0.1, z)) edge += 0.1;
      expect(Math.hypot(edge - spot.park.x, z - spot.park.z)).toBeLessThan(land.boardRange);
    }
  });
});

describe("walking on the land (REQ-015 AC-2)", () => {
  const start = () => {
    const spot = ashoreSpot(waterlineX(0) + 6, 0)!;
    return createWalker(spot.landing.x, spot.landing.z, spot.landing.yaw);
  };

  it("walks at about 4 m/s with WASD, feet on the ground, eyes 1.6 m above them", () => {
    const walker = start();
    const from = walker.position.clone();
    walk(walker, { forward: 1 }, 1);
    expect(Math.hypot(walker.position.x - from.x, walker.position.z - from.z)).toBeCloseTo(land.walkSpeed, 0);
    expect(walker.position.y).toBeCloseTo(floorHeight(walker.position.x, walker.position.z), 6);
    expect(eyePosition(walker).y - walker.position.y).toBeCloseTo(land.eyeHeight);
    // Facing west, D steps to the right: north (-Z).
    const strafed = walk(start(), { strafe: 1 }, 0.5);
    expect(strafed.position.z).toBeLessThan(-1);
  });

  it("has no rising, running or jumping: Space and Shift do nothing on land", () => {
    const walker = start();
    const from = walker.position.clone();
    walk(walker, { rise: 1 }, 1);
    expect(walker.position.distanceTo(from)).toBe(0);
    walk(walker, { rise: -1 }, 1);
    expect(walker.position.distanceTo(from)).toBe(0);
  });

  it("looks around with the mouse, within limits", () => {
    const walker = start();
    lookWalker(walker, Math.PI / 2 / rov.mouseSensitivity, 0);
    expect(Math.cos(walker.yaw)).toBeCloseTo(-1); // from west, a right turn faces north (-Z)
    lookWalker(walker, 0, -100000);
    expect(walker.pitch).toBe(land.maxPitch);
    lookWalker(walker, 0, 100000);
    expect(walker.pitch).toBe(land.minPitch);
  });
});

describe("the land's limits (REQ-015 AC-3)", () => {
  it("stops at the water: never deeper than wading depth", () => {
    const walker = createWalker(waterlineX(10) - 4, 10, Math.PI / 2); // facing the sea (east)
    walk(walker, { forward: 1 }, 10, (w) => expect(floorHeight(w.position.x, w.position.z)).toBeGreaterThanOrEqual(bay.surfaceY - land.wadeDepth));
    expect(floorHeight(walker.position.x, walker.position.z)).toBeLessThan(bay.surfaceY);
  });

  it("stops at the cliff at the west end of the land, without an invisible wall", () => {
    const walker = createWalker(waterlineX(0) - 4, 0, -Math.PI / 2);
    walk(walker, { forward: 1 }, 15);
    expect(walker.position.x).toBeGreaterThan(-bay.halfSize + 5);
    // What stops it is a slope too steep to climb, right ahead.
    expect(floorSlope(walker.position.x - 0.5, walker.position.z)).toBeGreaterThan(land.maxSlope * 0.8);
  });

  it("stops at the rock walls at both ends of the beach", () => {
    // From past the last palms, along the beach and a little inland, so the walker slides along the foot of the
    // cliff rather than into the sea.
    for (const [z, yaw] of [[78, -0.3], [-78, Math.PI + 0.3]]) {
      const walker = createWalker(waterlineX(z) - 4, z, yaw);
      expect(standable(walker.position.x, walker.position.z)).toBe(true);
      walk(walker, { forward: 1 }, 40);
      expect(Math.abs(walker.position.z)).toBeGreaterThan(bay.shore.openHalf - 30);
      expect(Math.abs(walker.position.z)).toBeLessThan(bay.halfSize - 5);
    }
  });

  it("never walks through a palm or a rock", () => {
    for (const obstacle of landObstacles) {
      const walker = createWalker(obstacle.x + obstacle.radius + 3, obstacle.z, -Math.PI / 2);
      walk(walker, { forward: 1 }, 3, (w) => expect(Math.hypot(w.position.x - obstacle.x, w.position.z - obstacle.z)).toBeGreaterThanOrEqual(obstacle.radius + land.radius - 1e-9));
    }
  });

  it("puts every palm and rock on dry land", () => {
    for (const thing of [...land.palms, ...land.rocks]) expect(floorHeight(thing.x, thing.z)).toBeGreaterThan(bay.surfaceY + 0.3);
  });
});

describe("getting back in (REQ-015 AC-4)", () => {
  it("is possible within 3.5 m of the submarine, not further", () => {
    const sub = new Vector3(-120, -0.3, 0);
    expect(canBoard(createWalker(-123, 0, 0), sub)).toBe(true);
    expect(canBoard(createWalker(-125, 0, 0), sub)).toBe(false);
  });

  it("works after walking from the landing spot to the water's edge next to the submarine", () => {
    const spot = ashoreSpot(waterlineX(20) + 6, 20)!;
    const walker = createWalker(spot.landing.x, spot.landing.z, Math.PI / 2);
    const sub = new Vector3(spot.park.x, bay.surfaceY - land.floatDepth, spot.park.z);
    expect(canBoard(walker, sub)).toBe(false);
    walk(walker, { forward: 1 }, 5);
    expect(canBoard(walker, sub)).toBe(true);
  });
});
