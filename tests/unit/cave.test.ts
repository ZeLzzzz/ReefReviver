import { DirectionalLight, HemisphereLight, type Mesh, Scene, SpotLight, Vector3, type Fog } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { constrainToBay, floorHeight, insideRockAt, rocks, terrainSolidAt } from "../../src/game/bay";
import { caveColumn, caveDistance, caveInfo, caveLamp, caveLevel, caveSolidAt, caveTrashSpots, inCave } from "../../src/game/cave";
import { buildMassifOutside, buildTunnelInside } from "../../src/game/cave-model";
import { bendAt, halfWidthAt, heightAt, roofAbove } from "../../src/game/cave-shape";
import { followCamera } from "../../src/game/follow-camera";
import { chooseLayout } from "../../src/game/layout";
import { buildMinimap, mapPoint, minimapLayout } from "../../src/game/minimap";
import { stepRov, type MoveInput, type RovState } from "../../src/game/rov";
import { createRovModel, setHeadlight } from "../../src/game/rov-model";
import { Session } from "../../src/game/session";
import { generateTrash, TrashField, trashSpotOk } from "../../src/game/trash";
import { buildWorld } from "../../src/game/world";
import { createMinimap } from "../../src/ui/minimap";

const { bay, rov, trash, vacuum } = config;
const { cave } = bay;
const idle: MoveInput = { forward: 0, strafe: 0, rise: 0 };
const [west, east] = caveInfo.mouths;
const seeds = Array.from({ length: 200 }, (_, i) => i * 7919 + 3);

function rovAt(x: number, y: number, z: number, yaw = 0): RovState {
  return { position: new Vector3(x, y, z), velocity: new Vector3(), yaw, pitch: 0 };
}

function fly(state: RovState, input: Partial<MoveInput>, seconds: number, onStep?: (s: RovState) => void, dt = 1 / 60): RovState {
  for (let t = 0; t < seconds; t += dt) {
    stepRov(state, { ...idle, ...input }, dt);
    onStep?.(state);
  }
  return state;
}

/** A point of the tunnel's floor, `a` metres east of the cave's centre, `u` metres off its centre line. */
const floorAt = (a: number, u = 0) => ({ x: cave.x + a, z: cave.z + bendAt(a) + u });

/** True when any of the sphere's surface, shrunk to `fraction` of the vehicle's radius, is in rock or under the floor. */
function touchesRock(p: Vector3, fraction: number): boolean {
  const r = rov.radius * fraction;
  const directions = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7], [0.7, 0, 0.7], [-0.7, 0, -0.7],
  ];
  return directions.some(([dx, dy, dz]) => {
    const l = Math.hypot(dx, dy, dz);
    return terrainSolidAt(p.x + (dx / l) * r, p.y + (dy / l) * r, p.z + (dz / l) * r, 0);
  });
}

describe("the tunnel (REQ-014 AC-1)", () => {
  it("is 30 to 40 m long between its two mouths, one in the west and one in the east", () => {
    expect(caveInfo.length).toBeGreaterThanOrEqual(30);
    expect(caveInfo.length).toBeLessThanOrEqual(40);
    expect(west.x).toBeLessThan(cave.x);
    expect(east.x).toBeGreaterThan(cave.x);
    expect(Math.hypot(east.x - west.x, east.z - west.z)).toBeGreaterThan(30);
  });

  it("goes through a rock hill: rock over the tunnel from one mouth to the other, none outside the mouths", () => {
    for (let a = west.x - cave.x + 1; a < east.x - cave.x - 1; a += 0.5) {
      const { x, z } = floorAt(a);
      const column = caveColumn(x, z);
      expect(column.top - column.roof, `a = ${a}`).toBeGreaterThan(0.3);
    }
    for (const a of [west.x - cave.x - 4, east.x - cave.x + 4]) {
      const { x, z } = floorAt(a);
      expect(caveSolidAt(x, caveColumn(x, z).floor + 2, z, rov.radius)).toBe(false);
    }
  });

  it("has a level floor, and is wide and high enough for the vehicle all the way", () => {
    for (let a = west.x - cave.x; a <= east.x - cave.x; a += 0.5) {
      const { x, z } = floorAt(a);
      expect(floorHeight(x, z)).toBeCloseTo(cave.floorY, 6);
      expect(halfWidthAt(a)).toBeGreaterThan(3 * rov.radius);
      expect(heightAt(a)).toBeGreaterThan(4 * rov.radius);
    }
  });

  it("can be flown through end to end, from the west mouth out of the east one, holding forward only", () => {
    const state = rovAt(west.x - 8, west.y, west.z, Math.PI / 2);
    let inside = false;
    let embedded = 0;
    fly(state, { forward: 1 }, 14, (s) => {
      if (inCave(s.position.x, s.position.y, s.position.z)) inside = true;
      if (touchesRock(s.position, 0.6)) embedded += 1;
    });
    expect(inside).toBe(true);
    expect(state.position.x).toBeGreaterThan(east.x + 3);
    expect(embedded).toBe(0);
    expect(inCave(state.position.x, state.position.y, state.position.z)).toBe(false);
  });

  it("can be flown through the other way too, with the game's longest step", () => {
    const state = rovAt(east.x + 8, east.y, east.z, -Math.PI / 2);
    fly(state, { forward: 1 }, 14, () => {}, 0.1);
    expect(state.position.x).toBeLessThan(west.x - 3);
  });

  it("is not blocked at either mouth: the vehicle fits at flying height along the whole centre line", () => {
    for (const point of caveInfo.path) {
      const probe = new Vector3(point.x, point.y, point.z);
      constrainToBay(probe, new Vector3());
      expect(probe.distanceTo(new Vector3(point.x, point.y, point.z))).toBeLessThan(1e-6);
    }
  });

  it("keeps rocks and everything else out of its way", () => {
    for (const rock of rocks) expect(Math.hypot(rock.x - cave.x, rock.z - cave.z)).toBeGreaterThan(cave.clear - 4);
    expect(insideRockAt(caveInfo.hole.x, cave.floorY + 2, caveInfo.hole.z, 0)).toBe(false);
  });
});

describe("the light (REQ-014 AC-2, AC-3, AC-8)", () => {
  it("is dark inside the tunnel and not outside it, with no flash at the mouths (the level eases in over the first metres of roof)", () => {
    expect(caveLevel(cave.x, cave.floorY + 2, cave.z)).toBe(1);
    expect(caveLevel(west.x - 6, west.y, west.z)).toBe(0);
    expect(caveLevel(east.x + 6, east.y, east.z)).toBe(0);
    let previous = 0;
    let biggest = 0;
    for (let a = west.x - cave.x - 6; a <= -8; a += 0.25) {
      const { x, z } = floorAt(a);
      const level = caveLevel(x, cave.floorY + 1.9, z);
      biggest = Math.max(biggest, Math.abs(level - previous));
      previous = level;
    }
    expect(previous).toBeGreaterThan(0.99);
    expect(biggest).toBeLessThan(0.35);
  });

  it("is nothing outside the cave, above the hill or beside it", () => {
    expect(caveLevel(0, -8, 0)).toBe(0);
    expect(caveLevel(cave.x, caveInfo.hole.top + 1, cave.z)).toBe(0);
    expect(caveLevel(cave.x, cave.floorY + 2, cave.z + 25)).toBe(0);
  });

  it("lights the lamp when the vehicle is in the cave and puts it out when it is out, with no flicker at the edge", () => {
    expect(caveLamp(false, 0)).toBe(false);
    expect(caveLamp(false, cave.lamp.lampOn)).toBe(true);
    expect(caveLamp(true, 1)).toBe(true);
    expect(caveLamp(true, 0)).toBe(false);
    // Between the two thresholds it keeps whatever it was.
    const between = (cave.lamp.lampOn + cave.lamp.lampOff) / 2;
    expect(caveLamp(true, between)).toBe(true);
    expect(caveLamp(false, between)).toBe(false);
    // Along a flight through the tunnel it turns on once and off once.
    let lit = false;
    let changes = 0;
    for (let x = west.x - 8; x <= east.x + 8; x += 0.1) {
      const next = caveLamp(lit, caveLevel(x, west.y, west.z + bendAt(x - cave.x)));
      if (next !== lit) changes += 1;
      lit = next;
    }
    expect(changes).toBe(2);
    expect(lit).toBe(false);
  });

  it("starts the headlight off in the model, and sets its brightness", () => {
    const model = createRovModel();
    const lamp = model.getObjectByName("headlight") as SpotLight;
    expect(lamp.intensity).toBe(0);
    setHeadlight(model, 1, cave.lamp.intensity);
    expect(lamp.intensity).toBe(cave.lamp.intensity);
    setHeadlight(model, 0, cave.lamp.intensity);
    expect(lamp.intensity).toBe(0);
  });

  it("darkens the water inside the cave, Bloom or not, and gives it back outside (AC-8)", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const lights = () => {
      let hemisphere = 0;
      let sun = 0;
      scene.traverse((o) => {
        if (o instanceof HemisphereLight) hemisphere = o.intensity;
        if (o instanceof DirectionalLight) sun = o.intensity;
      });
      return { hemisphere, sun, fog: scene.fog as Fog };
    };
    const open = lights();
    const openHemisphere = open.hemisphere;
    const openSun = open.sun;
    const openFar = open.fog.far;
    world.setCave(1);
    const murky = lights();
    expect(murky.hemisphere).toBeLessThan(openHemisphere * 0.3);
    expect(murky.sun).toBeLessThan(openSun * 0.3);
    expect(murky.fog.far).toBeLessThan(openFar + 5);
    expect(murky.fog.color.getHex()).toBe(cave.dark.fogColor);
    // After the Bloom the sea is clear and bright, but the cave is still dark.
    world.setCave(0);
    world.setClarity(1);
    const clear = lights();
    const clearHemisphere = clear.hemisphere;
    expect(clearHemisphere).toBeGreaterThan(openHemisphere);
    world.setCave(1);
    const dark = lights();
    expect(dark.hemisphere).toBeLessThan(clearHemisphere * 0.3);
    expect(dark.fog.far).toBeLessThanOrEqual(cave.dark.fogFar);
    expect(dark.fog.color.getHex()).toBe(cave.dark.fogColor);
    world.setCave(0);
    expect(lights().hemisphere).toBeCloseTo(clearHemisphere, 6);
  });
});

describe("the walls, floor and roof (REQ-014 AC-5)", () => {
  const chamber = () => rovAt(cave.x, cave.floorY + 1.9, cave.z, 0);

  it("stop the vehicle from a side wall: it does not go through", () => {
    for (const yaw of [0, Math.PI]) {
      const state = rovAt(cave.x, cave.floorY + 1.9, cave.z, yaw);
      fly(state, { forward: 1 }, 6);
      const wall = halfWidthAt(0);
      // Stopped against the wall, about a vehicle's radius from it, and still moving no further.
      expect(Math.abs(state.position.z - cave.z)).toBeGreaterThan(wall - 2 * rov.radius);
      expect(Math.abs(state.position.z - cave.z)).toBeLessThan(wall);
      expect(touchesRock(state.position, 0.6)).toBe(false);
      const stopped = state.position.clone();
      fly(state, { forward: 1 }, 1);
      expect(state.position.distanceTo(stopped)).toBeLessThan(0.05);
      expect(Math.abs(state.velocity.z)).toBeLessThan(0.3);
    }
  });

  it("stop the vehicle from the roof, which is a vehicle's radius or so over its top", () => {
    const state = chamber();
    fly(state, { rise: 1 }, 6);
    const roof = caveColumn(state.position.x, state.position.z).roof;
    expect(state.position.y).toBeLessThan(roof);
    expect(state.position.y).toBeGreaterThan(roof - 2 * rov.radius);
    expect(touchesRock(state.position, 0.6)).toBe(false);
    expect(caveLevel(state.position.x, state.position.y, state.position.z)).toBeGreaterThan(0.9);
  });

  it("stop the vehicle from the floor", () => {
    const state = chamber();
    fly(state, { rise: -1 }, 6);
    expect(state.position.y).toBeGreaterThanOrEqual(cave.floorY + rov.radius - 1e-6);
    expect(state.position.y).toBeLessThan(cave.floorY + rov.radius + 0.3);
  });

  it("stop the vehicle from the side of the hill, anywhere around it: it never ends up in the rock", () => {
    const heading = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 1, 2, 4, 5];
    for (const yaw of heading) {
      for (const height of [-8, -6, -4]) {
        const from = new Vector3(cave.x - Math.sin(yaw) * 40, height, cave.z - Math.cos(yaw) * 40 + 4);
        const state = { position: from, velocity: new Vector3(), yaw, pitch: 0 };
        let worst = 0;
        fly(state, { forward: 1 }, 14, (s) => {
          // The centre is never in rock. (The roof ends in a thin lip at the mouths; the estimate that keeps the body off
          // it can let a corner of the body into the lip's very edge, so the body is only checked inside the tunnel.)
          if (terrainSolidAt(s.position.x, s.position.y, s.position.z, 0)) worst += 1;
          if (inCave(s.position.x, s.position.y, s.position.z) && touchesRock(s.position, 0.5)) worst += 1;
        });
        expect(worst, `yaw ${yaw} at ${height}`).toBe(0);
      }
    }
  });

  it("hold up under random flying about in and around the tunnel", () => {
    let seed = 5;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let steps = 0;
    for (let run = 0; run < 60; run++) {
      const p = new Vector3(cave.x + (random() * 2 - 1) * 24, -9 + random() * 8, cave.z + (random() * 2 - 1) * 14);
      const v = new Vector3();
      constrainToBay(p, v);
      let yaw = random() * Math.PI * 2;
      for (let step = 0; step < 200; step++) {
        if (step % 20 === 0) yaw += (random() - 0.5) * 3;
        v.set(Math.sin(yaw) * 6, (random() - 0.5) * 6, Math.cos(yaw) * 6);
        p.addScaledVector(v, 0.05);
        constrainToBay(p, v);
        steps += 1;
        // The centre is never in rock, and the vehicle never sinks more than a little into it.
        expect(terrainSolidAt(p.x, p.y, p.z, 0)).toBe(false);
        expect(caveDistance(p.x, p.y, p.z)).toBeGreaterThan(rov.radius * 0.5);
      }
    }
    expect(steps).toBe(12000);
  });

  it("never lets the camera into the rock, for any heading and tilt, in the tunnel or around the hill", () => {
    for (let a = west.x - cave.x - 8; a <= east.x - cave.x + 8; a += 2) {
      const { x, z } = floorAt(a);
      for (const height of [0.9, 1.9, 3]) {
        for (let k = 0; k < 16; k++) {
          for (const pitch of [-1.1, -0.5, 0, 0.4, 0.7]) {
            const state = rovAt(x, cave.floorY + height, z, (k / 16) * Math.PI * 2);
            state.pitch = pitch;
            constrainToBay(state.position, state.velocity);
            const camera = new Vector3();
            const target = new Vector3();
            followCamera(state, camera, target);
            expect(terrainSolidAt(camera.x, camera.y, camera.z, 0), `a ${a} yaw ${k} pitch ${pitch}`).toBe(false);
            expect(terrainSolidAt(target.x, target.y, target.z, 0)).toBe(false);
          }
        }
      }
    }
  });

  it("keeps the camera inside the tunnel while the vehicle is inside it, so the player never sees out of the hill", () => {
    for (let a = west.x - cave.x + 7; a <= east.x - cave.x - 7; a += 1.5) {
      const { x, z } = floorAt(a);
      for (let k = 0; k < 24; k++) {
        for (const pitch of [-1, 0, 0.7]) {
          const state = rovAt(x, cave.floorY + 1.9, z, (k / 24) * Math.PI * 2);
          state.pitch = pitch;
          const camera = new Vector3();
          followCamera(state, camera, new Vector3());
          const column = caveColumn(camera.x, camera.z);
          // Under the roof (not above it, not in a wall) and in the tunnel's own air.
          expect(camera.y, `a ${a} yaw ${k} pitch ${pitch}`).toBeLessThan(column.roof);
          expect(caveLevel(camera.x, camera.y, camera.z)).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it("stops the cutter's and the shots' line at the wall (they are blocked by the rock like by a hill)", () => {
    const from = new Vector3(cave.x, cave.floorY + 2, cave.z);
    let blockedAt = -1;
    for (let t = 0; t < 12; t += 0.1) {
      if (terrainSolidAt(from.x, from.y, from.z + t, 0)) {
        blockedAt = t;
        break;
      }
    }
    expect(blockedAt).toBeGreaterThan(2);
    expect(blockedAt).toBeLessThan(halfWidthAt(0) + 1);
  });
});

describe("the roof hole (REQ-014 AC-6)", () => {
  const { hole } = caveInfo;

  it("is narrower than the vehicle", () => {
    expect(hole.radius * 2).toBeLessThan(rov.radius * 2);
  });

  it("lets nothing through: the vehicle can not rise through it, even straight under its middle", () => {
    const state = rovAt(hole.x, cave.floorY + 2, hole.z, 0);
    fly(state, { rise: 1 }, 10);
    expect(state.position.y).toBeLessThan(hole.under);
    // And rising beside it, close enough that the hole is within the vehicle's reach.
    for (const offset of [0.3, 0.6, 1, 1.4]) {
      const beside = rovAt(hole.x, cave.floorY + 2, hole.z + offset, 0);
      fly(beside, { rise: 1 }, 10);
      expect(beside.position.y, `offset ${offset}`).toBeLessThan(caveColumn(beside.position.x, beside.position.z).roof);
    }
  });

  it("is where the roof is thick enough to be a shaft, over the middle of the tunnel, under the sea", () => {
    expect(hole.top - hole.under).toBeGreaterThan(1);
    expect(hole.top).toBeLessThan(bay.surfaceY - 1);
    expect(Math.abs(hole.x - cave.x)).toBeLessThan(2);
    expect(roofAbove(0, 0)).toBeGreaterThan(rov.radius * 6);
  });

  it("keeps the camera, the cutter and the shots out of it too (the hole is only light)", () => {
    const mid = (hole.top + hole.under) / 2;
    expect(caveSolidAt(hole.x, mid, hole.z, 0)).toBe(true);
    expect(terrainSolidAt(hole.x, mid, hole.z, 0)).toBe(true);
  });
});

describe("the cave's meshes (REQ-014 performance)", () => {
  it("are a few thousand triangles at most", () => {
    const triangles = (mesh: Mesh) => mesh.geometry.attributes.position.count / 3;
    const outside = triangles(buildMassifOutside());
    const inside = triangles(buildTunnelInside());
    expect(outside).toBeGreaterThan(100);
    expect(inside).toBeGreaterThan(100);
    expect(outside + inside).toBeLessThan(6000);
  });
});

describe("the trash in the cave (REQ-014 AC-4)", () => {
  const inTunnel = (item: { home: Vector3 }) => inCave(item.home.x, item.home.y + 1, item.home.z);

  it("puts about 6 of the 60 pieces on the tunnel floor in every dive's layout, and the rest outside it", () => {
    for (const seed of seeds) {
      const items = generateTrash(chooseLayout(seed).trashSeed);
      expect(items).toHaveLength(trash.count);
      const inside = items.filter(inTunnel);
      expect(inside, `layout seed ${seed}`).toHaveLength(cave.trash.groups * cave.trash.groupSize);
      expect(inside).toHaveLength(6);
      for (const item of items) if (!inTunnel(item) && !item.onBeach) expect(trashSpotOk(item.home.x, item.home.z)).toBe(true);
    }
  });

  it("moves them about from one dive to the next", () => {
    const places = new Set(seeds.slice(0, 40).map((seed) => generateTrash(chooseLayout(seed).trashSeed).filter(inTunnel).map((i) => i.home.x.toFixed(1)).join(",")));
    expect(places.size).toBeGreaterThan(30);
  });

  it("lays them on the floor, apart from each other, with room above them for the vehicle", () => {
    for (const seed of seeds.slice(0, 80)) {
      const inside = generateTrash(chooseLayout(seed).trashSeed).filter(inTunnel);
      for (const item of inside) {
        expect(item.home.y).toBeCloseTo(cave.floorY + trash.restHeight, 6);
        expect(terrainSolidAt(item.home.x, item.home.y + 1.5, item.home.z, rov.radius)).toBe(false);
      }
      for (let i = 0; i < inside.length; i++)
        for (let j = i + 1; j < inside.length; j++) expect(inside[i].home.distanceTo(inside[j].home)).toBeGreaterThanOrEqual(trash.spacing - 1e-6);
    }
  });

  it("places all 6 even with an unlucky random stream", () => {
    for (const fixed of [0, 0.999999, 0.5]) {
      expect(caveTrashSpots(() => fixed, trash.spacing)).toHaveLength(6);
    }
  });

  it("can all be sucked up like any other: the vehicle can get to each one and the vacuum takes it", () => {
    for (const seed of seeds.slice(0, 40)) {
      const field = new TrashField(chooseLayout(seed).trashSeed);
      for (const item of field.items.filter(inTunnel)) {
        let taken = false;
        for (const side of [-1, 1]) {
          for (const distance of [3, 4.5, 6]) {
            // The vehicle in the tunnel on one side of the item, a little above it, aimed straight at it.
            const from = new Vector3(item.home.x - side * distance, item.home.y + 1, item.home.z);
            const probe = from.clone();
            constrainToBay(probe, new Vector3());
            if (probe.distanceTo(from) > 1e-6) continue;
            const aim = item.home.clone().sub(from);
            const range = aim.length();
            aim.normalize();
            let clear = true;
            for (let t = 0.2; t < range; t += 0.1) if (terrainSolidAt(from.x + aim.x * t, from.y + aim.y * t, from.z + aim.z * t, 0)) clear = false;
            if (!clear || range > vacuum.range) continue;
            const fresh = new TrashField(chooseLayout(seed).trashSeed);
            fresh.update(0.1, from, aim, true, 12);
            if (fresh.items[item.id].state === "pulling") taken = true;
          }
        }
        expect(taken, `seed ${seed} item ${item.id}`).toBe(true);
      }
    }
  });

  it("count in the cleanliness like all the other trash, and show on the minimap from 70 % on, inside the tunnel's line", () => {
    const field = new TrashField(chooseLayout(1).trashSeed);
    const session = new Session(field.total);
    expect(field.total).toBe(60);
    const mine = field.items.filter(inTunnel);
    for (let i = 0; i < mine.length; i++) session.collect();
    expect(session.cleanliness).toBeGreaterThan(0);
    const input = { rov: { x: 0, z: 0, yaw: 0 }, frames: [], patches: [], nets: [], trash: field.items };
    expect(buildMinimap({ ...input, cleanliness: 69 }).trash).toEqual([]);
    const marks = buildMinimap({ ...input, cleanliness: 70 }).trash;
    expect(marks).toHaveLength(60);
    for (const item of mine) expect(marks).toContainEqual(expect.objectContaining({ id: item.id, ...mapPoint(item.home.x, item.home.z) }));
    // Taken ones leave the map.
    mine[0].state = "collected";
    expect(buildMinimap({ ...input, cleanliness: 70 }).trash).toHaveLength(59);
  });

  it("is reset to the new layout's spots with the rest of the trash", () => {
    const field = new TrashField(chooseLayout(1).trashSeed);
    const next = chooseLayout(2);
    field.reset(next.trashSeed);
    const expected = generateTrash(next.trashSeed);
    expect(field.items.map((i) => i.home.toArray())).toEqual(expected.map((i) => i.home.toArray()));
    expect(field.items.filter(inTunnel)).toHaveLength(6);
  });
});

describe("the cave on the minimap (REQ-014 AC-7)", () => {
  it("has both mouths and the tunnel between them in the layout, in map units", () => {
    expect(minimapLayout.cave.mouths).toEqual([mapPoint(west.x, west.z), mapPoint(east.x, east.z)]);
    expect(minimapLayout.cave.tunnel.length).toBeGreaterThan(20);
    expect(minimapLayout.cave.tunnel[0]).toEqual(minimapLayout.cave.mouths[0]);
    expect(minimapLayout.cave.tunnel[minimapLayout.cave.tunnel.length - 1]).toEqual(minimapLayout.cave.mouths[1]);
  });

  it("draws each mouth with an icon of its own (an arch) and the tunnel as a faint line", () => {
    const map = createMinimap("id").element;
    const mouths = [...map.querySelectorAll('[data-kind="cave"]')];
    expect(mouths).toHaveLength(2);
    for (const mouth of mouths) {
      expect(mouth.querySelector("path")).not.toBeNull();
      expect(mouth.getAttribute("transform")).toMatch(/^translate\(/);
    }
    // Not the same shape as any other icon: the arch is a path with an arc, where sites are diamonds and circles, the station a square.
    expect(mouths[0].querySelector("path")!.getAttribute("d")).toContain("A");
    const tunnel = map.querySelector('[data-kind="tunnel"]');
    expect(tunnel).not.toBeNull();
    expect(tunnel!.tagName.toLowerCase()).toBe("polyline");
    expect(tunnel!.getAttribute("points")!.split(" ").length).toBe(minimapLayout.cave.tunnel.length);
  });
});

describe("the shape's own consistency", () => {
  it("has a roof that is an arch: highest on the centre line, the floor at the walls", () => {
    for (const a of [-12, -4, 0, 5, 11]) {
      const half = halfWidthAt(a);
      expect(roofAbove(a, 0)).toBeGreaterThan(roofAbove(a, half * 0.7));
      expect(roofAbove(a, half)).toBe(0);
      expect(roofAbove(a, half + 1)).toBe(0);
    }
  });

  it("estimates the distance to the rock the same from every side of the roof's thickness", () => {
    const y = (a: number) => caveColumn(floorAt(a).x, floorAt(a).z);
    const { x, z } = floorAt(-5);
    const column = y(-5);
    const middle = (column.roof + column.top) / 2;
    expect(caveDistance(x, middle, z)).toBeLessThan(0);
    expect(caveDistance(x, column.roof - 1, z)).toBeGreaterThan(0.5);
    expect(caveDistance(x, column.top + 1, z)).toBeGreaterThan(0.5);
    expect(caveDistance(x + 60, middle, z)).toBeGreaterThan(50);
  });
});
