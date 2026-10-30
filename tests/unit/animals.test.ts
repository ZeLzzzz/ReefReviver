import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { AnimalField } from "../../src/game/animals";
import { floorHeight, insideRockAt, posts, rocks } from "../../src/game/bay";
import { generateTrash } from "../../src/game/trash";
import { Session } from "../../src/game/session";

const { nets, bay } = config;

describe("trapped animals (REQ-003 AC-6)", () => {
  it("start trapped, one turtle and one reef shark", () => {
    const field = new AnimalField();
    expect(field.animals.map((a) => [a.species, a.state])).toEqual([
      ["turtle", "trapped"],
      ["reefShark", "trapped"],
    ]);
  });

  it("move and turn all the time, but stay inside the net", () => {
    const field = new AnimalField();
    for (const animal of field.animals) {
      const start = animal.position.clone();
      let farthest = 0;
      let turned = 0;
      let lastYaw = animal.yaw;
      for (let i = 0; i < 600; i++) {
        field.update(1 / 30);
        farthest = Math.max(farthest, animal.position.distanceTo(animal.home));
        turned += Math.abs(animal.yaw - lastYaw);
        lastYaw = animal.yaw;
        expect(animal.state).toBe("trapped");
      }
      const s = nets.species[animal.species].struggle;
      expect(farthest).toBeGreaterThan(s * 0.5);
      expect(farthest).toBeLessThanOrEqual(s * 1.6);
      expect(turned).toBeGreaterThan(5);
      expect(animal.position.distanceTo(start)).toBeLessThanOrEqual(s * 1.6);
    }
  });

  it("lie inside their own dome (the body does not stick out through the net)", () => {
    const field = new AnimalField();
    for (let i = 0; i < 300; i++) field.update(1 / 30);
    for (const net of [0, 1]) {
      const animal = field.animals[net];
      const species = nets.species[animal.species];
      const centre = animal.home.y - (floorHeight(animal.home.x, animal.home.z) - 0.1);
      const shell = species.body.reduce((a, b) => (b.radius > a.radius ? b : a));
      expect(centre + species.struggle * 0.4 + shell.radius).toBeLessThan(species.netHeight);
    }
  });
});

describe("freed animals (REQ-003 AC-2, AC-3)", () => {
  const rovAt = new Vector3(0, -8, -10);

  it("swim away from the ROV, then wander", () => {
    const field = new AnimalField();
    const animal = field.animals[0];
    const before = Math.hypot(animal.position.x - rovAt.x, animal.position.z - rovAt.z);
    field.free(0, rovAt);
    expect(animal.state).toBe("fleeing");
    for (let i = 0; i < 60; i++) field.update(1 / 30);
    expect(Math.hypot(animal.position.x - rovAt.x, animal.position.z - rovAt.z)).toBeGreaterThan(before + 1);
    for (let i = 0; i < nets.fleeSeconds * 30; i++) field.update(1 / 30);
    expect(animal.state).toBe("wandering");
    // The other animal is still caught.
    expect(field.animals[1].state).toBe("trapped");
  });

  it("freeing twice changes nothing the second time", () => {
    const field = new AnimalField();
    field.free(0, rovAt);
    for (let i = 0; i < 30; i++) field.update(1 / 30);
    const at = field.animals[0].position.clone();
    field.free(0, new Vector3(50, 0, 50));
    expect(field.animals[0].position.equals(at)).toBe(true);
    expect(field.animals[0].state).toBe("fleeing");
  });

  it("wander inside the bay for ten minutes: never out, through a rock, the station, the floor or the surface, and never removed", () => {
    const field = new AnimalField();
    field.free(0, rovAt);
    field.free(1, new Vector3(0, -8, 0));
    const travelled = [0, 0];
    const last = field.animals.map((a) => a.position.clone());
    for (let i = 0; i < 12000; i++) {
      field.update(0.05);
      field.animals.forEach((animal, k) => {
        const { x, y, z } = animal.position;
        const radius = nets.species[animal.species].radius;
        expect(Math.max(Math.abs(x), Math.abs(z))).toBeLessThan(bay.halfSize - 3);
        expect(y).toBeGreaterThanOrEqual(floorHeight(x, z) + radius - 1e-6);
        // REQ-011 AC-7: never inside a boulder or an arch either.
        expect(insideRockAt(x, y, z, radius - 0.05)).toBe(false);
        expect(y).toBeLessThanOrEqual(bay.surfaceY - radius + 1e-6);
        // One check for all the rocks: there are many of them in the big bay.
        const clearOfRocks = rocks.every(
          (rock) => Math.hypot((x - rock.x) / (rock.size + radius), (y - rock.y) / (rock.height + radius), (z - rock.z) / (rock.size + radius)) >= 1 - 1e-6,
        );
        expect(clearOfRocks).toBe(true);
        // REQ-016: nor through the dock's posts.
        expect(posts.every((post) => Math.hypot(x - post.x, z - post.z) >= post.radius + radius - 1e-6 || y > post.baseY + post.height + radius - 1e-6)).toBe(true);
        travelled[k] += animal.position.distanceTo(last[k]);
        last[k].copy(animal.position);
      });
    }
    expect(field.animals).toHaveLength(2);
    for (const [k, animal] of field.animals.entries()) {
      expect(animal.state).toBe("wandering");
      // They keep swimming the whole time, not just once.
      expect(travelled[k]).toBeGreaterThan(300);
    }
  });

  it("stay in mid-water, not on the floor and not at the surface", () => {
    const field = new AnimalField();
    field.free(0, rovAt);
    for (let i = 0; i < 1200; i++) field.update(0.05);
    const { x, y, z } = field.animals[0].position;
    expect(y - floorHeight(x, z)).toBeGreaterThan(1);
    expect(y).toBeLessThan(nets.wander.maxY + 1e-6);
  });

  it("a new dive puts them back into their nets", () => {
    const field = new AnimalField();
    field.free(0, rovAt);
    for (let i = 0; i < 300; i++) field.update(0.05);
    field.reset();
    expect(field.animals.map((a) => a.state)).toEqual(["trapped", "trapped"]);
    expect(field.animals[0].position.distanceTo(field.animals[0].home)).toBe(0);
  });
});

describe("animals are not trash (REQ-003 AC-5, REQ-002 AC-7)", () => {
  it("the vacuum's field holds only trash: no animal is ever a candidate to be sucked", () => {
    const field = new AnimalField();
    const trash = generateTrash();
    for (const item of trash) expect(["bottle", "bag", "can", "oil"]).toContain(item.kind);
    for (const animal of field.animals) {
      for (const item of trash) expect(item.position.distanceTo(animal.position)).toBeGreaterThan(2);
    }
  });

  it("keeps trash out from under the nets", () => {
    for (const item of generateTrash()) {
      for (const site of config.nets.spots) expect(Math.hypot(item.position.x - site.x, item.position.z - site.z)).toBeGreaterThanOrEqual(config.trash.clearOfNets);
    }
    expect(generateTrash()).toHaveLength(config.trash.count);
  });
});

describe("freeing an animal (REQ-003 AC-2)", () => {
  it("adds 100 score, counts a net cut and an animal freed, raises cleanliness and the goal, and says so", () => {
    const s = new Session(config.trash.count);
    s.freeAnimal("turtle");
    expect([s.score, s.netsCut, s.animalsFreed]).toEqual([100, 1, 1]);
    expect(s.cleanliness).toBe(Math.floor(100 / (config.trash.count + config.phase1.nets)));
    expect(s.objectives.find((o) => o.id === "free")).toMatchObject({ current: 1, target: 2, done: false });
    expect(s.currentNotice).toEqual({ key: "animals.turtle.freed", amount: 100 });
    s.freeAnimal("reefShark");
    expect(s.score).toBe(200);
    expect(s.objectives.find((o) => o.id === "free")).toMatchObject({ current: 2, done: true });
    expect(s.currentNotice).toEqual({ key: "animals.reefShark.freed", amount: 100 });
  });
});
