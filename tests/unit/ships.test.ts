import { Box3, Mesh, MeshStandardMaterial, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { buildShipMesh } from "../../src/game/ship-model";
import { SHIP_KINDS, ShipTraffic, laneReach, shipPlace, shipPosition, type Ship } from "../../src/game/ships";
import { buildWorld } from "../../src/game/world";

const { ships: tuning } = config;
const inSight = (ship: Ship) => shipPlace(ship).distance < tuning.horn.sight;
/** Degrees from north toward east, as seen from the camera. */
const bearingOf = (ship: Ship) => {
  const { x, z } = shipPlace(ship);
  return (Math.atan2(x, -z) * 180) / Math.PI;
};

/** An hour of traffic in half-second steps: what was in sight at each step, and the horns. */
function anHour(seed: number, above = true) {
  const traffic = new ShipTraffic();
  traffic.reset(seed);
  const steps: Ship[][] = [];
  const horns: number[] = [];
  // The seconds with a ship in sight, counted up to each step: the horn's clock runs only then.
  const sightClock: number[] = [];
  let sight = 0;
  const seen = new Map<number, { kind: Ship["kind"]; seconds: number }>();
  for (let t = 0; t < 3600; t += 0.5) {
    const horn = traffic.update(0.5, above);
    if (traffic.ships.some(inSight)) sight += 0.5;
    sightClock.push(sight);
    if (horn) horns.push(sightClock.length - 1);
    steps.push(traffic.ships.map((ship) => ({ ...ship })));
    for (const ship of traffic.ships.filter(inSight)) {
      const entry = seen.get(ship.id) ?? { kind: ship.kind, seconds: 0 };
      entry.seconds += 0.5;
      seen.set(ship.id, entry);
    }
  }
  return { traffic, steps, horns, seen, sightClock };
}

describe("ships passing far out at sea (REQ-035)", () => {
  it("starts a dive with one ship out at sea near the middle of its lane, in sight (AC-4)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const traffic = new ShipTraffic();
      traffic.reset(seed);
      expect(traffic.ships).toHaveLength(1);
      const [ship] = traffic.ships;
      expect(Math.abs(ship.along)).toBeLessThanOrEqual(tuning.startAlong * laneReach(ship.lane) + 1e-9);
      expect(inSight(ship)).toBe(true);
    }
  });

  it("keeps one or two ships about, never more than two, with all four kinds and both directions (AC-2, AC-4)", () => {
    for (const seed of [3, 11, 42]) {
      const { steps, seen } = anHour(seed);
      expect(Math.max(...steps.map((ships) => ships.length))).toBeLessThanOrEqual(tuning.maxShips);
      // Most of the time at least one ship is in sight, and ships keep coming: about one a minute or more.
      const withShip = steps.filter((ships) => ships.some(inSight)).length / steps.length;
      expect(withShip).toBeGreaterThan(0.7);
      expect(seen.size).toBeGreaterThan(25);
      expect(new Set([...seen.values()].map((entry) => entry.kind))).toEqual(new Set(SHIP_KINDS));
      const directions = new Set(steps.flat().map((ship) => ship.direction));
      expect(directions).toEqual(new Set([1, -1]));
    }
  });

  it("takes a big ship about two to three minutes to cross, a fishing boat less (AC-4)", () => {
    const { seen } = anHour(7);
    const crossings = [...seen.entries()].filter(([id]) => id !== 1).map(([, entry]) => entry);
    const big = crossings.filter((entry) => entry.kind !== "fishing").map((entry) => entry.seconds);
    const small = crossings.filter((entry) => entry.kind === "fishing").map((entry) => entry.seconds);
    expect(big.length).toBeGreaterThan(5);
    expect(small.length).toBeGreaterThan(2);
    for (const seconds of big) {
      expect(seconds).toBeGreaterThan(110);
      expect(seconds).toBeLessThan(200);
    }
    expect(Math.max(...small)).toBeLessThan(Math.min(...big));
  });

  it("keeps every ship in sight over the open sea, between north-east and south-east (AC-1)", () => {
    for (const seed of [1, 5, 9]) {
      for (const ships of anHour(seed).steps) {
        for (const ship of ships.filter(inSight)) {
          const bearing = bearingOf(ship);
          expect(bearing, `seed ${seed}`).toBeGreaterThan(5);
          expect(bearing, `seed ${seed}`).toBeLessThan(175);
        }
      }
    }
  });

  it("sails ships along their lanes, bow first, out of the haze and back into it (AC-3)", () => {
    const traffic = new ShipTraffic();
    traffic.reset(2);
    const [ship] = traffic.ships;
    const before = shipPlace(ship);
    traffic.update(1, true);
    const after = shipPlace(ship);
    const moved = Math.atan2(after.x - before.x, after.z - before.z);
    expect(Math.cos(moved - before.yaw)).toBeCloseTo(1, 5);
    // The ends of the lane are past the haze, so ships come and go out of sight, never popping in or out.
    for (const lane of [1300, 2400]) expect(Math.hypot(lane, laneReach(lane))).toBeCloseTo(tuning.end, 6);
    expect(tuning.end * tuning.scale).toBeGreaterThan(config.land.hazeFar);
    expect(tuning.end * tuning.scale).toBeLessThan(config.camera.far);
  });

  it("draws a ship on its real line of sight, a tenth as far and as big, so it shifts as a real one would when the player moves (D-133)", () => {
    const traffic = new ShipTraffic();
    traffic.reset(6);
    const [ship] = traffic.ships;
    const real = shipPosition(ship);
    for (const camera of [{ x: 0, z: 0 }, { x: -140, z: 30 }, { x: 140, z: -120 }]) {
      const place = shipPlace(ship, camera);
      expect(place.x).toBeCloseTo((real.x - camera.x) * tuning.scale, 6);
      expect(place.z).toBeCloseTo((real.z - camera.z) * tuning.scale, 6);
      expect(place.distance).toBeCloseTo(Math.hypot(real.x - camera.x, real.z - camera.z), 6);
    }
    // Sailing 140 m toward it from the beach brings it about 140 m nearer: it looks a few percent bigger, as a real one would.
    const beach = shipPlace(ship, { x: -140, z: 0 });
    const out = shipPlace(ship, { x: 0, z: 0 });
    expect(beach.distance - out.distance).toBeGreaterThan(100);
    expect(beach.distance / out.distance).toBeLessThan(1.15);
  });

  it("sounds a horn every 40 to 90 seconds of a ship in sight above the water, and never below it (AC-5)", () => {
    const { horns, sightClock } = anHour(4);
    expect(horns.length).toBeGreaterThan(30);
    for (let i = 1; i < horns.length; i++) {
      const seconds = sightClock[horns[i]] - sightClock[horns[i - 1]];
      expect(seconds).toBeGreaterThanOrEqual(tuning.horn.interval[0] - 0.5);
      expect(seconds).toBeLessThanOrEqual(tuning.horn.interval[1] + 0.5);
    }
    expect(anHour(4, false).horns).toEqual([]);
  });

  it("is the same traffic for the same seed and different for another (AC-4)", () => {
    const kinds = (seed: number) => [...anHour(seed).seen.values()].map((entry) => entry.kind).join();
    expect(kinds(8)).toBe(kinds(8));
    expect(kinds(8)).not.toBe(kinds(9));
  });
});

describe("the ship models (REQ-035 AC-2)", () => {
  it("builds four low-poly ships of at most 1,000 triangles, each standing on the waterline with its bow forward", () => {
    for (const kind of SHIP_KINDS) {
      const model = buildShipMesh(kind);
      let triangles = 0;
      const materials = new Set<unknown>();
      model.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        triangles += (child.geometry.index?.count ?? child.geometry.getAttribute("position").count) / 3;
        materials.add(child.material);
      });
      expect(triangles, kind).toBeLessThanOrEqual(1000);
      expect(materials.size, kind).toBeGreaterThanOrEqual(3);
      const bounds = new Box3().setFromObject(model);
      expect(bounds.min.y, kind).toBeCloseTo(0, 5);
      // One unit long from stern to bow, the wake trailing behind the stern.
      expect(bounds.max.z, kind).toBeCloseTo(0.5, 5);
    }
  });

  it("tells the kinds apart: coloured containers, a tall funnel aft on the tanker, decks in tiers on the cruise ship, a mast on the boat", () => {
    const colours = (kind: Parameters<typeof buildShipMesh>[0]) => {
      const set = new Set<number>();
      buildShipMesh(kind).traverse((child) => {
        if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) set.add(child.material.color.getHex());
      });
      return set;
    };
    expect(colours("container").size).toBeGreaterThanOrEqual(8);
    const height = (kind: Parameters<typeof buildShipMesh>[0]) => new Box3().setFromObject(buildShipMesh(kind)).max.y;
    // The boat is short and tall for its length; the cruise ship stands higher than the cargo ships.
    expect(height("fishing")).toBeGreaterThan(0.5);
    expect(height("cruise")).toBeGreaterThan(height("container"));
    expect(height("tanker")).toBeGreaterThan(0.18);
  });

  it("keeps the ships when the Bloom clears the water (AC-6)", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    world.ships.reset(5);
    world.setAbove(true);
    world.update(1, new Vector3(0, 2, 0));
    const before = world.ships.shown();
    world.setClarity(1);
    expect(world.ships.shown()).toEqual(before);
    expect(world.ships.group.visible).toBe(true);
    world.setAbove(false);
    expect(world.ships.group.visible).toBe(false);
  });
});
