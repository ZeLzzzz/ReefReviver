import { Group, InstancedMesh, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight, rocks } from "../../src/game/bay";
import { loopPose, SeaLife, type LoopSpec, type Pose, type SeaSpecies } from "../../src/game/sea-life";
import { createSeaLifeView, createYellowtailGeometry } from "../../src/game/sea-life-model";
import { stationPosition } from "../../src/game/station";
import { LOGBOOK_ENTRIES } from "../../src/logbook/entries";

const { bay, reef, seaLife } = config;

const count = (life: SeaLife, species: SeaSpecies) => life.creatures.filter((c) => c.species === species).length;

/** Runs `seconds` of game time in 0.5 s steps and calls `check` after every step (and once at the start). */
function swim(life: SeaLife, seconds: number, check: () => void) {
  life.start();
  check();
  for (let t = 0; t < seconds; t += 0.5) {
    life.update(0.5);
    check();
  }
}

describe("who returns (REQ-005 AC-3, D-038)", () => {
  const life = new SeaLife();

  it("has two clownfish at an anemone beside each of the three frames", () => {
    expect(life.anemones).toHaveLength(reef.frameSites.length);
    expect(count(life, "clownfish")).toBe(reef.frameSites.length * seaLife.clownfish.perAnemone);
  });

  it("has one yellowtail school, manta rays and dolphins", () => {
    expect(count(life, "yellowtail")).toBeGreaterThanOrEqual(20);
    expect(count(life, "yellowtail")).toBeLessThanOrEqual(30);
    expect(count(life, "mantaRay")).toBeGreaterThanOrEqual(1);
    expect(count(life, "mantaRay")).toBeLessThanOrEqual(2);
    expect(count(life, "dolphin")).toBeGreaterThanOrEqual(2);
    expect(count(life, "dolphin")).toBeLessThanOrEqual(3);
  });

  it("makes the yellowtail decoration only: not scannable (D-038); the others can be scanned later", () => {
    for (const creature of life.creatures) {
      if (creature.species === "yellowtail") {
        expect(creature.scannable).toBe(false);
        expect(creature.logbookId).toBeNull();
      } else {
        expect(creature.scannable).toBe(true);
        expect(LOGBOOK_ENTRIES.map((e) => e.id)).toContain(creature.logbookId);
      }
    }
    expect(life.creatures.filter((c) => c.scannable).map((c) => c.logbookId)).not.toContain("turtle");
  });

  it("gives every creature its own id, for REQ-006", () => {
    expect(new Set(life.creatures.map((c) => c.id)).size).toBe(life.creatures.length);
  });
});

describe("before and after the transition", () => {
  it("nothing is in the bay until it starts, and nothing moves", () => {
    const life = new SeaLife();
    const before = life.creatures.map((c) => c.position.toArray());
    life.update(5);
    expect(life.active).toBe(false);
    expect(life.scale).toBe(0);
    expect(life.creatures.map((c) => c.position.toArray())).toEqual(before);
  });

  it("grows in gently to full size, one way only (no pop, AC-7)", () => {
    const life = new SeaLife();
    life.start();
    let last = life.scale;
    expect(last).toBe(0);
    for (let t = 0; t < seaLife.appearSeconds + 1; t += 0.016) {
      life.update(0.016);
      expect(life.scale).toBeGreaterThanOrEqual(last);
      expect(life.scale - last).toBeLessThan(0.02);
      last = life.scale;
    }
    expect(life.scale).toBe(1);
  });

  it("empties the bay again for a new dive", () => {
    const life = new SeaLife();
    const start = life.creatures.map((c) => c.position.toArray());
    swim(life, 20, () => {});
    life.reset();
    expect([life.active, life.scale, life.elapsed]).toEqual([false, 0, 0]);
    expect(life.creatures.map((c) => c.position.toArray())).toEqual(start);
  });
});

describe("the anemones", () => {
  const life = new SeaLife();

  it("stand on the floor beside their frame, in the bay, clear of rocks", () => {
    life.anemones.forEach((anemone, i) => {
      const site = reef.frameSites[i];
      const distance = Math.hypot(anemone.x - site.x, anemone.z - site.z);
      // Outside the frame's solid column, within the interaction distance.
      expect(distance).toBeGreaterThan(reef.frame.radius + 0.5);
      expect(distance).toBeLessThan(reef.interactRadius);
      expect(anemone.y).toBe(floorHeight(anemone.x, anemone.z));
      expect(Math.hypot(anemone.x, anemone.z)).toBeLessThan(bay.boundaryRadius - seaLife.edgeMargin);
      for (const rock of rocks) expect(Math.hypot(anemone.x - rock.x, anemone.z - rock.z)).toBeGreaterThan(rock.size + 1);
      // Not on a seagrass patch.
      for (const patch of reef.seagrassPatches) expect(Math.hypot(anemone.x - patch.x, anemone.z - patch.z)).toBeGreaterThan(reef.patchRadius + 1);
    });
  });

  it("each hold their two clownfish within about a metre, above the anemone", () => {
    const fish = life.creatures.filter((c) => c.species === "clownfish");
    swim(life, 60, () => {
      fish.forEach((creature, i) => {
        const anemone = life.anemones[Math.floor(i / seaLife.clownfish.perAnemone)];
        expect(Math.hypot(creature.position.x - anemone.x, creature.position.z - anemone.z)).toBeLessThan(1.1);
        expect(creature.position.y).toBeGreaterThan(anemone.y + 0.4);
        expect(creature.position.y).toBeLessThan(anemone.y + 1.2);
      });
    });
  });
});

describe("the school, rays and dolphins stay in the bay (AC-3)", () => {
  const free = (species: SeaSpecies) => (c: { species: SeaSpecies }) => c.species === species;

  it("never get close to the cliffs, nor below the floor or above the surface", () => {
    const life = new SeaLife();
    swim(life, 600, () => {
      for (const c of life.creatures) {
        expect(Math.hypot(c.position.x, c.position.z)).toBeLessThanOrEqual(bay.boundaryRadius - seaLife.edgeMargin);
        expect(c.position.y).toBeGreaterThan(floorHeight(c.position.x, c.position.z) + 0.3);
        expect(c.position.y).toBeLessThan(bay.surfaceY - 1);
      }
    });
  });

  it("swim well above every rock and keep away from the station", () => {
    const life = new SeaLife();
    swim(life, 600, () => {
      for (const c of life.creatures.filter((x) => x.species !== "clownfish")) {
        for (const rock of rocks) {
          const over = Math.hypot(c.position.x - rock.x, c.position.z - rock.z) < rock.size + 1;
          if (over) expect(c.position.y).toBeGreaterThan(rock.y + rock.height + 1);
        }
        expect(Math.hypot(c.position.x - stationPosition.x, c.position.z - stationPosition.z)).toBeGreaterThan(8);
      }
    });
  });

  it("dolphins stay near the surface and manta rays mid-water", () => {
    const life = new SeaLife();
    const dolphins = life.creatures.filter(free("dolphin"));
    const mantas = life.creatures.filter(free("mantaRay"));
    swim(life, 300, () => {
      for (const d of dolphins) expect(d.position.y).toBeGreaterThan(-4);
      for (const m of mantas) {
        expect(m.position.y).toBeLessThan(-5);
        expect(m.position.y).toBeGreaterThan(floorHeight(m.position.x, m.position.z) + 1.5);
      }
    });
  });

  it("keep the school together: every fish stays within a few metres of the school's middle ring", () => {
    const life = new SeaLife();
    const school = life.creatures.filter(free("yellowtail"));
    swim(life, 120, () => {
      const cx = school.reduce((sum, f) => sum + f.position.x, 0) / school.length;
      const cz = school.reduce((sum, f) => sum + f.position.z, 0) / school.length;
      for (const fish of school) expect(Math.hypot(fish.position.x - cx, fish.position.z - cz)).toBeLessThan(8);
    });
  });
});

describe("movement over time (AC-3: they swim)", () => {
  it("every creature moves, and keeps moving", () => {
    const life = new SeaLife();
    life.start();
    life.update(0.1);
    const early = life.creatures.map((c) => c.position.clone());
    life.update(10);
    life.creatures.forEach((c, i) => {
      expect(c.position.distanceTo(early[i]), `${c.species} ${c.id}`).toBeGreaterThan(c.species === "clownfish" ? 0.2 : 2);
    });
    const later = life.creatures.map((c) => c.position.clone());
    life.update(10);
    life.creatures.forEach((c, i) => expect(c.position.distanceTo(later[i])).toBeGreaterThan(0.2));
  });

  it("swims at a believable speed, with no jumps between frames", () => {
    const life = new SeaLife();
    life.start();
    const speedLimit: Record<SeaSpecies, number> = { clownfish: 1.5, yellowtail: 4, mantaRay: 3, dolphin: 5 };
    let last = life.creatures.map((c) => c.position.clone());
    for (let i = 0; i < 600; i++) {
      life.update(0.1);
      life.creatures.forEach((c, n) => {
        expect(c.position.distanceTo(last[n]) / 0.1, c.species).toBeLessThan(speedLimit[c.species]);
        last[n] = c.position.clone();
      });
    }
  });

  it("faces the way it swims", () => {
    const life = new SeaLife();
    life.start();
    life.update(3);
    const before = life.creatures.map((c) => c.position.clone());
    life.update(0.05);
    life.creatures.forEach((c, i) => {
      const dx = c.position.x - before[i].x;
      const dz = c.position.z - before[i].z;
      let difference = Math.atan2(dx, dz) - c.yaw;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      expect(Math.abs(difference), `${c.species} ${c.id}`).toBeLessThan(0.1);
    });
  });
});

describe("loopPose", () => {
  const loop: LoopSpec = { x: 5, z: -3, radiusX: 10, radiusZ: 4, y: -6, bob: 0.5, bobSpeed: 1, bobPhase: 0, speed: 0.2, phase: 0, direction: 1 };
  const pose = (t: number, l = loop): Pose => loopPose(l, t, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });

  it("is a closed loop that starts again after one lap", () => {
    const lap = (Math.PI * 2) / loop.speed;
    const a = pose(0);
    // The bob does not close over the lap in general, so compare the ground position only.
    const b = pose(lap);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
  });

  it("turns the other way round with direction -1", () => {
    const forward = pose(1);
    const backward = pose(1, { ...loop, direction: -1 });
    expect(forward.z).toBeGreaterThan(loop.z);
    expect(backward.z).toBeLessThan(loop.z);
  });

  it("pitches the nose up while rising and down while sinking", () => {
    // y = -6 + 0.5 sin(t): rising at t = 0, sinking at t = pi.
    expect(pose(0, { ...loop, speed: 0.2 }).pitch).toBeLessThan(0);
    expect(pose(Math.PI).pitch).toBeGreaterThan(0);
  });
});

describe("the models (D-022, REQ-009 cost)", () => {
  it("draw the whole school as one instanced mesh", () => {
    const life = new SeaLife();
    const view = createSeaLifeView(life);
    const instanced = view.group.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    expect(instanced).toHaveLength(1);
    expect(instanced[0].count).toBe(count(life, "yellowtail"));
    // One merged geometry for a fish, with colours per vertex.
    expect(createYellowtailGeometry().attributes.color).toBeDefined();
  });

  it("show nothing until the sea life is active, then show everything", () => {
    const life = new SeaLife();
    const view = createSeaLifeView(life);
    view.sync(life, 0.016);
    expect(view.group.visible).toBe(false);
    life.start();
    life.update(1);
    view.sync(life, 1);
    expect(view.group.visible).toBe(true);
    life.update(10);
    view.sync(life, 10);
    const rigs = view.group.children.filter((c): c is Group => c instanceof Group && !(c instanceof Mesh));
    // 3 anemones + 6 clownfish + 2 mantas + 3 dolphins.
    expect(rigs).toHaveLength(life.anemones.length + count(life, "clownfish") + count(life, "mantaRay") + count(life, "dolphin"));
    // Full size: 1, or the clownfish's own size (a stand-in that is easy to see).
    for (const rig of rigs) expect([1, seaLife.clownfish.size]).toContainEqual(expect.closeTo(rig.scale.x, 5));
    life.reset();
    view.sync(life, 0.016);
    expect(view.group.visible).toBe(false);
  });
});
