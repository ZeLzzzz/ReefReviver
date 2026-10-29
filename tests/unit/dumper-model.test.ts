import { Box3, Mesh, Vector3, type MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { Dumper } from "../../src/game/dumper";
import { createDumperView } from "../../src/game/dumper-model";

const triangles = (root: Object3D) => {
  let count = 0;
  root.traverse((node) => {
    if (node instanceof Mesh) count += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3;
  });
  return count;
};
const meshes = (root: Object3D) => {
  const found: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh) found.push(node);
  });
  return found;
};

function stoppedBoat() {
  const dumper = new Dumper();
  dumper.reset(3);
  dumper.summon(new Vector3(0, -5, 0), { x: 40, z: 10 });
  dumper.update(14, false, new Vector3());
  return dumper;
}

describe("the dumping boat's animated view", () => {
  it("keeps the crew on its rocking deck even when the boat changes heading", () => {
    const dumper = stoppedBoat(), view = createDumperView();
    const boat = view.group.getObjectByName("dumper-boat")!;
    const crew = view.group.children.filter((child) => child.name === "dumper-crew");
    for (const yaw of [-Math.PI / 2, 0.7, Math.PI]) {
      dumper.yaw = yaw;
      dumper.update(0, false, new Vector3());
      view.sync(dumper, 1.9);
      view.group.updateMatrixWorld(true);
      crew.forEach((person, i) => {
        const feet = boat.worldToLocal(person.getWorldPosition(new Vector3()));
        expect(feet.y).toBeCloseTo(0.45, 6);
        expect(feet.x).toBeCloseTo(i === 0 ? -0.45 : 0.5, 6);
        expect(feet.z).toBeCloseTo(i === 0 ? -0.9 : 0.6, 6);
        const up = new Vector3(0, 1, 0).applyQuaternion(person.quaternion);
        expect(up.distanceTo(new Vector3(0, 1, 0).applyQuaternion(boat.quaternion))).toBeLessThan(1e-6);
      });
    }
  });

  it("swims face up with alternating arm strokes and leg kicks, using the gameplay clock", () => {
    const dumper = stoppedBoat(), view = createDumperView();
    dumper.capsize();
    dumper.update(config.dumper.crew.clingSeconds + 0.1, false, new Vector3());
    const person = view.group.children.find((child) => child.name === "dumper-crew")!;
    const elbow = person.getObjectByName("elbow-left")!;
    const right = person.getObjectByName("elbow-right")!;
    const knee = person.getObjectByName("knee-left")!;
    const hands: Vector3[] = [], feet: Vector3[] = [];
    let separation = 0;
    for (let i = 0; i < 20; i++) {
      dumper.crew.forEach((member) => { member.seconds = 0.7 + i * 0.08; });
      view.sync(dumper, i);
      view.group.updateMatrixWorld(true);
      const hand = elbow.localToWorld(new Vector3(0, -0.295, 0.01));
      hands.push(hand);
      feet.push(knee.localToWorld(new Vector3(0, -0.38, 0.055)));
      separation = Math.max(separation, Math.abs(hand.y - right.localToWorld(new Vector3(0, -0.295, 0.01)).y));
      expect(new Box3().setFromObject(person.getObjectByName("crew-head")!).max.y).toBeGreaterThan(config.bay.surfaceY + 0.25);
    }
    expect(Math.max(...hands.map((p) => p.y))).toBeGreaterThan(config.bay.surfaceY + 0.2);
    expect(Math.min(...hands.map((p) => p.y))).toBeLessThan(config.bay.surfaceY - 0.2);
    expect(separation).toBeGreaterThan(0.4);
    expect(Math.max(...feet.map((p) => p.y)) - Math.min(...feet.map((p) => p.y))).toBeGreaterThan(0.12);
    const pose = elbow.parent!.quaternion.clone();
    view.sync(dumper, 1000);
    expect(elbow.parent!.quaternion.angleTo(pose)).toBeLessThan(1e-6);
    const forward = new Vector3(Math.sin(dumper.crew[0].yaw), 0, Math.cos(dumper.crew[0].yaw));
    const body = person.getObjectByName("crew-body")!;
    expect(new Vector3(0, 1, 0).transformDirection(body.matrixWorld).dot(forward)).toBeGreaterThan(0.9);
  });

  it("removes the cargo as trash is dumped and hides the crew when the boat leaves or the dive resets", () => {
    const dumper = stoppedBoat(), view = createDumperView();
    const boat = view.group.getObjectByName("dumper-boat")!;
    const bags = boat.children.filter((child) => child.name.startsWith("trash-bag-"));
    const crew = view.group.children.filter((child) => child.name === "dumper-crew");
    view.sync(dumper, 0);
    expect(bags.filter((bag) => bag.visible)).toHaveLength(6);
    dumper.dumped = config.dumper.maxDrops / 2;
    view.sync(dumper, 1);
    expect(bags.filter((bag) => bag.visible)).toHaveLength(3);
    dumper.dumped = config.dumper.maxDrops;
    view.sync(dumper, 2);
    expect(bags.every((bag) => !bag.visible)).toBe(true);
    dumper.update(config.dumper.leaveSeconds, true, new Vector3());
    dumper.update(config.dumper.leaveSeconds, true, new Vector3());
    view.sync(dumper, 3);
    expect(boat.visible).toBe(false);
    expect(crew.every((person) => !person.visible)).toBe(true);
    dumper.reset(4);
    view.sync(dumper, 4);
    expect(crew.every((person) => !person.visible)).toBe(true);
  });

  it("stays low-poly and matte like the rest of the bay, in a few draw calls (D-136)", () => {
    const view = createDumperView();
    const boat = view.group.getObjectByName("dumper-boat")!;
    const crew = view.group.children.filter((child) => child.name === "dumper-crew");
    expect(crew).toHaveLength(config.dumper.crew.count);
    expect(triangles(boat)).toBeLessThanOrEqual(1500);
    for (const person of crew) expect(triangles(person)).toBeLessThanOrEqual(1000);
    // One mesh for the hull, one per bag (they go one by one), one for the propeller, one per joint of each person.
    expect(meshes(view.group).length).toBeLessThanOrEqual(30);
    for (const mesh of meshes(view.group)) {
      const material = mesh.material as MeshStandardMaterial;
      expect(material.flatShading).toBe(true);
      expect(material.roughness).toBeGreaterThanOrEqual(0.8);
      expect(material.transparent).toBe(false);
    }
  });
});
