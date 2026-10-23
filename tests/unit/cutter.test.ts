import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight, rocks } from "../../src/game/bay";
import { wallness } from "../../src/game/terrain";
import { Cutter, aimedNet } from "../../src/game/cutter";
import { aimDirection } from "../../src/game/follow-camera";
import { generateNets, NetField } from "../../src/game/nets";
import { AnimalField } from "../../src/game/animals";
import { Rescue } from "../../src/game/rescue";
import { createRovState, type RovState } from "../../src/game/rov";
import { Session } from "../../src/game/session";
import { TrashField } from "../../src/game/trash";
import { stationPosition } from "../../src/game/station";

const { cutter, camera, nets: netConfig, phase1 } = config;

/** Yaw and pitch that make the screen-centre ray (camera 6 m behind and 2 m above the ROV) pass through `target`. */
function aimThrough(from: Vector3, target: Vector3): { yaw: number; pitch: number } {
  const aim = new Vector3();
  const cam = new Vector3();
  let yaw = 0;
  let pitch = 0;
  for (let i = 0; i < 40; i++) {
    aimDirection(yaw, pitch, aim);
    cam.copy(from).addScaledVector(aim, -camera.distance);
    cam.y += camera.height;
    const d = target.clone().sub(cam).normalize();
    yaw = Math.atan2(d.x, d.z);
    pitch = Math.asin(d.y);
  }
  return { yaw, pitch };
}

/** A ROV `distance` metres from the net's centre, on the side facing the bay's centre, aimed at `target`. */
function rovAiming(target: Vector3, awayFrom: Vector3, distance = 5): RovState {
  const rov = createRovState();
  const side = new Vector3(-awayFrom.x, 0, -awayFrom.z).normalize();
  rov.position.set(target.x + side.x * distance, floorHeight(target.x + side.x * distance, target.z + side.z * distance) + 1.6, target.z + side.z * distance);
  Object.assign(rov, aimThrough(rov.position, target));
  return rov;
}

function rayOf(rov: RovState): { origin: Vector3; dir: Vector3 } {
  const dir = aimDirection(rov.yaw, rov.pitch);
  const origin = rov.position.clone().addScaledVector(dir, -camera.distance);
  origin.y += camera.height;
  return { origin, dir };
}

const domeTop = (net: { center: Vector3; height: number }) => net.center.clone().add(new Vector3(0, net.height * 0.85, 0));

describe("Cutter progress (REQ-003 AC-1, AC-4)", () => {
  it("fills over 2 seconds of holding on one net, then the net is cut", () => {
    const c = new Cutter();
    expect(cutter.seconds).toBe(2);
    for (let i = 0; i < 59; i++) expect(c.update(1 / 30, true, 0)).toBeNull();
    expect(c.progress).toBeGreaterThan(0.95);
    expect(c.progress).toBeLessThan(1);
    expect(c.update(1 / 30, true, 0)).toBe(0);
    expect(c.progress).toBe(0);
  });

  it("shows half after one second", () => {
    const c = new Cutter();
    for (let i = 0; i < 10; i++) c.update(0.1, true, 1);
    expect(c.progress).toBeCloseTo(0.5, 5);
  });

  it("goes back to zero the moment the button is released, and the net is not cut", () => {
    const c = new Cutter();
    for (let i = 0; i < 15; i++) expect(c.update(0.1, true, 0)).toBeNull();
    expect(c.progress).toBeGreaterThan(0);
    expect(c.update(0.1, false, 0)).toBeNull();
    expect(c.progress).toBe(0);
    // Starting again needs the whole 2 seconds again.
    for (let i = 0; i < 15; i++) expect(c.update(0.1, true, 0)).toBeNull();
  });

  it("goes back to zero when the aim leaves the net", () => {
    const c = new Cutter();
    for (let i = 0; i < 15; i++) c.update(0.1, true, 0);
    expect(c.update(0.1, true, null)).toBeNull();
    expect(c.progress).toBe(0);
  });

  it("starts over when the aim moves from one net to another", () => {
    const c = new Cutter();
    for (let i = 0; i < 15; i++) c.update(0.1, true, 0);
    expect(c.update(0.1, true, 1)).toBeNull();
    expect(c.progress).toBeCloseTo(0.05, 5);
  });
});

describe("what the cutter aims at (REQ-003 AC-1, AC-5)", () => {
  const field = new NetField();
  const animals = new AnimalField();
  const bodies = () => animals.bodySpheres();

  it("hits each net when the crosshair is on it", () => {
    for (const net of field.nets) {
      const rov = rovAiming(domeTop(net), net.center);
      const { origin, dir } = rayOf(rov);
      const hit = aimedNet(origin, dir, rov.position, field.nets, bodies());
      expect(hit?.net.id).toBe(net.id);
      expect(hit!.point.distanceTo(rov.position)).toBeLessThanOrEqual(cutter.range);
    }
  });

  it("hits nothing beyond the cutter's range", () => {
    const net = field.nets[0];
    const rov = rovAiming(domeTop(net), net.center, cutter.range + 4);
    const { origin, dir } = rayOf(rov);
    expect(aimedNet(origin, dir, rov.position, field.nets, bodies())).toBeNull();
  });

  it("hits nothing when the net is already cut", () => {
    const copy = generateNets();
    copy[0].cut = true;
    const rov = rovAiming(domeTop(copy[0]), copy[0].center);
    const { origin, dir } = rayOf(rov);
    expect(aimedNet(origin, dir, rov.position, copy, bodies())).toBeNull();
  });

  it("does nothing when aimed at the animal's head or tail sticking out of the net", () => {
    for (const net of field.nets) {
      const animal = animals.animals[net.id];
      const forward = new Vector3(Math.sin(animal.yaw), 0, Math.cos(animal.yaw));
      for (const end of netConfig.species[net.species].body.filter((b) => Math.abs(b.along) > 0.8)) {
        const sign = Math.sign(end.along);
        const target = animal.position.clone().addScaledVector(forward, end.along);
        // Look straight at it along the animal's axis, from beyond its end.
        const origin = target.clone().addScaledVector(forward, sign * 4);
        const dir = forward.clone().multiplyScalar(-sign);
        expect(aimedNet(origin, dir, origin, field.nets, bodies())).toBeNull();
        // The same ray without the animal in the way would run into the net: the animal is what blocks it.
        expect(aimedNet(origin, dir, origin, field.nets, [])).not.toBeNull();
      }
    }
  });

  it("does nothing when trash is in front of the net", () => {
    const net = field.nets[0];
    const rov = rovAiming(domeTop(net), net.center);
    const { origin, dir } = rayOf(rov);
    expect(aimedNet(origin, dir, rov.position, field.nets, [])).not.toBeNull();
    const inFront = origin.clone().addScaledVector(dir, 3);
    expect(aimedNet(origin, dir, rov.position, field.nets, [{ x: inFront.x, y: inFront.y, z: inFront.z, r: 0.5 }])).toBeNull();
  });

  it("does nothing when a rock is in front of the net", () => {
    const rock = rocks[0];
    const rockCentre = new Vector3(rock.x, rock.y, rock.z);
    // A made-up net 4 m behind the rock, seen from 4 m in front of it.
    const behind = generateNets()[0];
    behind.center.set(rock.x + 4 + rock.size, rock.y, rock.z);
    behind.yaw = 0;
    const origin = rockCentre.clone().add(new Vector3(-4 - rock.size, 0, 0));
    const dir = new Vector3(1, 0, 0);
    const rov = behind.center.clone();
    expect(aimedNet(origin, dir, rov, [behind], [])).toBeNull();
    // Without the rock in the way (a ray above it) the same net is hit.
    origin.y += rock.height + 0.7;
    behind.center.y = origin.y - 0.4;
    expect(aimedNet(origin, dir, rov, [behind], [])).not.toBeNull();
  });

  it("does nothing when the floor is in front of the net", () => {
    const net = field.nets[0];
    // Aim at a point well below the floor under the net: the ray meets the floor first.
    const below = net.center.clone().add(new Vector3(0, -2, 0));
    const rov = rovAiming(below, net.center);
    const { origin, dir } = rayOf(rov);
    expect(aimedNet(origin, dir, rov.position, field.nets, bodies())).toBeNull();
  });
});

describe("the cutter in play (REQ-003 AC-1, AC-2, AC-4, AC-5)", () => {
  const trash = () => new TrashField().items;

  function setup(netId = 0) {
    const rescue = new Rescue();
    const session = new Session(config.trash.count);
    const net = rescue.nets.nets[netId];
    const rov = rovAiming(domeTop(net), net.center);
    return { rescue, session, net, rov, aim: aimDirection(rov.yaw, rov.pitch), items: trash() };
  }

  function hold(ctx: ReturnType<typeof setup>, seconds: number, dt = 1 / 30) {
    for (let t = 0; t < seconds - 1e-9; t += dt) ctx.rescue.step(dt, ctx.rov, ctx.aim, true, ctx.items, ctx.session);
  }

  it("holding the beam on a net for 2 s cuts it, frees the animal and pays out", () => {
    const ctx = setup();
    hold(ctx, 1);
    expect(ctx.rescue.progress).toBeGreaterThan(0.4);
    expect(ctx.net.cut).toBe(false);
    hold(ctx, 1.1);
    expect(ctx.net.cut).toBe(true);
    expect(ctx.rescue.animals.animals[0].state).toBe("fleeing");
    expect(ctx.session.animalsFreed).toBe(1);
    expect(ctx.session.netsCut).toBe(1);
    expect(ctx.session.score).toBe(100);
    expect(ctx.session.currentNotice).toEqual({ key: "animals.turtle.freed", amount: 100 });
    expect(ctx.rescue.progress).toBe(0);
  });

  it("releasing the button before 2 s keeps the net whole and empties the progress", () => {
    const ctx = setup();
    hold(ctx, 1.5);
    ctx.rescue.step(1 / 30, ctx.rov, ctx.aim, false, ctx.items, ctx.session);
    expect(ctx.rescue.progress).toBe(0);
    expect(ctx.net.cut).toBe(false);
    expect(ctx.session.animalsFreed).toBe(0);
    expect(ctx.rescue.animals.animals[0].state).toBe("trapped");
  });

  it("looking away before 2 s keeps the net whole", () => {
    const ctx = setup();
    hold(ctx, 1.5);
    ctx.rov.yaw += Math.PI;
    ctx.rescue.step(1 / 30, ctx.rov, aimDirection(ctx.rov.yaw, ctx.rov.pitch), true, ctx.items, ctx.session);
    expect(ctx.rescue.progress).toBe(0);
    expect(ctx.net.cut).toBe(false);
  });

  it("aimed at the animal's head, nothing happens however long it is held", () => {
    const ctx = setup();
    const animal = ctx.rescue.animals.animals[0];
    const forward = new Vector3(Math.sin(animal.yaw), 0, Math.cos(animal.yaw));
    const head = animal.position.clone().addScaledVector(forward, netConfig.species.turtle.body[1].along);
    const rov = createRovState();
    // The ROV sits in line with the animal's axis, in front of its head, so the crosshair ray runs through the head.
    rov.position.copy(head).addScaledVector(forward, 6);
    rov.position.y = head.y - camera.height;
    rov.yaw = Math.atan2(-forward.x, -forward.z);
    rov.pitch = 0;
    hold({ ...ctx, rov, aim: aimDirection(rov.yaw, rov.pitch) }, 3);
    expect(ctx.net.cut).toBe(false);
    expect(ctx.rescue.progress).toBe(0);
    expect(ctx.session.score).toBe(0);
    expect(ctx.rescue.animals.animals[0].state).toBe("trapped");
  });

  it("trash in front of the net blocks the beam, and a bottle is not turned into a freed animal", () => {
    const ctx = setup();
    const { origin, dir } = rayOf(ctx.rov);
    const spot = origin.clone().addScaledVector(dir, 4);
    ctx.items[0].position.copy(spot);
    hold(ctx, 3);
    expect(ctx.net.cut).toBe(false);
    expect(ctx.session.score).toBe(0);
  });

  it("frees the second animal (the shark) the same way", () => {
    const ctx = setup(1);
    hold(ctx, 2.2);
    expect(ctx.session.currentNotice).toEqual({ key: "animals.reefShark.freed", amount: 100 });
    expect(ctx.rescue.animals.animals[1].state).toBe("fleeing");
  });

  it("a new dive puts the nets and animals back", () => {
    const ctx = setup();
    hold(ctx, 2.2);
    ctx.rescue.reset();
    expect(ctx.net.cut).toBe(false);
    expect(ctx.rescue.animals.animals[0].state).toBe("trapped");
    expect(ctx.rescue.progress).toBe(0);
  });
});

describe("where the nets stand (REQ-003, D-012)", () => {
  const nets = generateNets();

  it("has one net for each animal the objectives count", () => {
    expect(nets).toHaveLength(phase1.nets);
    expect(nets).toHaveLength(phase1.animals);
    expect(nets.map((n) => n.species).sort()).toEqual(["reefShark", "turtle"]);
  });

  it("puts them out in the bay, clear of the shore, the rock wall, the station, rocks and each other (REQ-011)", () => {
    for (const net of nets) {
      const { x, z } = net.center;
      expect(x).toBeGreaterThan(config.station.x + 40);
      expect(net.center.y).toBeLessThan(config.bay.surfaceY - 6);
      expect(wallness(x, z)).toBe(0);
      expect(Math.hypot(x - stationPosition.x, z - stationPosition.z)).toBeGreaterThan(config.station.padRadius + 5);
      for (const rock of rocks) expect(Math.hypot(x - rock.x, z - rock.z)).toBeGreaterThan(rock.size + Math.max(net.width, net.length) + 1);
    }
    expect(nets[0].center.distanceTo(nets[1].center)).toBeGreaterThan(10);
  });

  it("keeps the net's floor flat enough that it stands on it", () => {
    for (const net of nets) {
      for (let a = 0; a < 8; a++) {
        const x = net.center.x + Math.sin((a * Math.PI) / 4) * net.width;
        const z = net.center.z + Math.cos((a * Math.PI) / 4) * net.width;
        expect(Math.abs(floorHeight(x, z) - net.center.y)).toBeLessThan(0.8);
      }
    }
  });
});
