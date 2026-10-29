import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from "three";
import { config } from "../config";
import type { CrewMember, Dumper } from "./dumper";
import { buildCrewMember, poseCrew, type CrewRig } from "./dumper-crew-model";
import { colored, compactGroup } from "./model-utils";

// One matte material coloured per vertex, so the hull becomes a single draw call (D-136).
const MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
const PAINT = {
  hull: 0xc27558, stripe: 0x426d70, bottom: 0x384c4d,
  cream: 0xe5d9b5, deck: 0xa78658, plank: 0x80613f,
  motor: 0x343e40, steel: 0x8d9890, rope: 0xc6b180,
  bag: 0x394845, bagGrey: 0x777b68, orange: 0xc46537, glass: 0x9fc4c4,
};
const BAGS = 6;
const DECK_Y = 0.45;

/** Station widths give the skiff flared sides, a shallow keel and a raised bow; low-poly like the rest of the bay (D-136). */
function buildBoat(): { boat: Group; bags: Group[]; propeller: Group } {
  const boat = new Group();
  boat.name = "dumper-boat";
  const add = (geometry: BufferGeometry, color: number, x: number, y: number, z: number, parent: Group = boat) => {
    const mesh = new Mesh(colored(geometry, color), MATERIAL);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, l: number, color: number, x: number, y: number, z: number) => add(new BoxGeometry(w, h, l), color, x, y, z);
  const oval = (rx: number, ry: number, rz: number, color: number, x: number, y: number, z: number, parent: Group = boat, small = false) => {
    const mesh = add(small ? new SphereGeometry(1, 5, 3) : new SphereGeometry(1, 6, 4), color, x, y, z, parent);
    mesh.scale.set(rx, ry, rz);
    return mesh;
  };
  const tube = (a: Vector3, b: Vector3, radius: number, color: number) => {
    const direction = b.clone().sub(a);
    const mesh = add(new CylinderGeometry(radius, radius, direction.length(), 4, 1, true), color, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
    return mesh;
  };
  const stations = [[-2.72, 0.76], [-2.35, 0.99], [-1.5, 1.13], [-0.25, 1.18], [0.8, 1.1], [1.55, 0.9], [2.2, 0.61], [2.7, 0.28], [3.02, 0.02]];
  const outline = [...stations.map(([z, x]) => [x, z]), ...[...stations].reverse().map(([z, x]) => [-x, z])];
  const sheer = (z: number) => Math.pow(Math.max(0, (z + 0.3) / 3.32), 2) * 0.27 + Math.max(0, -z - 1.8) * 0.045;
  const ringAt = (width: number, length: number, y: number, rise = 1) => outline.map(([x, z]) => new Vector3(x * width, y + sheer(z) * rise, z * length));
  const triangles = (vertices: number[], color: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    add(geometry, color, 0, 0, 0);
  };
  const surface = (a: Vector3[], b: Vector3[], color: number) => {
    const vertices: number[] = [];
    const tri = (p: Vector3, q: Vector3, r: Vector3) => vertices.push(...p.toArray(), ...q.toArray(), ...r.toArray());
    for (let i = 0; i < a.length; i++) {
      const next = (i + 1) % a.length;
      tri(a[i], b[i], b[next]);
      tri(a[i], b[next], a[next]);
    }
    triangles(vertices, color);
  };
  const floor = (ring: Vector3[], color: number, down = false) => {
    const vertices: number[] = [];
    const center = new Vector3(0, ring[0].y, 0);
    for (let i = 0; i < ring.length; i++) {
      const next = (i + 1) % ring.length;
      vertices.push(...center.toArray(), ...ring[down ? i : next].toArray(), ...ring[down ? next : i].toArray());
    }
    triangles(vertices, color);
  };
  const keel = ringAt(0.48, 0.91, -0.48, 0.8);
  const chine = ringAt(0.85, 0.98, -0.12, 0.3);
  const waterline = ringAt(0.93, 1, 0.13, 0.5);
  const shoulder = ringAt(0.99, 1, 0.59);
  const rim = ringAt(1, 1, 0.72);
  const inner = ringAt(0.9, 0.97, 0.72);
  const deck = ringAt(0.83, 0.95, DECK_Y, 0);
  surface(keel, chine, PAINT.bottom);
  surface(chine, waterline, PAINT.stripe);
  surface(waterline, shoulder, PAINT.hull);
  surface(shoulder, rim, PAINT.cream);
  surface(rim, inner, PAINT.plank);
  surface(inner, deck, PAINT.cream);
  floor(keel, PAINT.bottom, true);
  floor(deck, PAINT.deck);
  for (let i = 0; i < rim.length; i++) tube(rim[i], rim[(i + 1) % rim.length], 0.035, PAINT.stripe);
  for (const side of [-1, 1]) {
    for (const z of [-1.55, 0.55]) {
      tube(new Vector3(side * 0.98, DECK_Y, z), new Vector3(side * 1.12, 0.72, z), 0.038, PAINT.plank);
      const fender = add(new TorusGeometry(0.19, 0.075, 3, 6), PAINT.motor, side * 1.16, 0.36, z);
      fender.rotation.y = Math.PI / 2;
      fender.rotation.x = side * 0.2;
    }
    for (const z of [-2.3, 1.45]) {
      tube(new Vector3(side * 0.87, 0.75, z), new Vector3(side * 0.87, 0.87, z), 0.025, PAINT.steel);
      tube(new Vector3(side * 0.78, 0.87, z), new Vector3(side * 0.96, 0.87, z), 0.025, PAINT.steel);
    }
    for (const z of [-1.05, 0.05]) box(0.02, 0.055, 0.23, PAINT.cream, side * 1.155, 0.43, z).rotation.x = 0.08;
  }
  box(1.3, 0.09, 0.38, PAINT.plank, 0, 0.69, -2.2);
  box(1.01, 0.09, 0.52, PAINT.deck, 0, 0.77, 1.95);
  const coil = add(new TorusGeometry(0.18, 0.035, 3, 8), PAINT.rope, 0, 0.84, 1.96);
  coil.rotation.x = Math.PI / 2;
  coil.scale.x = 1.4;
  const console = box(0.65, 0.64, 0.44, PAINT.stripe, 0.49, 0.78, 1.1);
  console.rotation.x = -0.12;
  box(0.73, 0.055, 0.54, PAINT.cream, 0.49, 1.115, 1.06).rotation.x = -0.12;
  add(new TorusGeometry(0.18, 0.025, 3, 8), PAINT.plank, 0.49, 1.3, 0.94).rotation.x = -0.45;
  // The windscreen is matte like everything else; its pale teal reads as glass.
  box(0.69, 0.29, 0.03, PAINT.glass, 0.49, 1.32, 1.25).rotation.x = -0.2;
  for (const x of [0.13, 0.85]) tube(new Vector3(x, 1.15, 1.28), new Vector3(x, 1.48, 1.21), 0.025, PAINT.steel);
  tube(new Vector3(0.13, 1.48, 1.21), new Vector3(0.85, 1.48, 1.21), 0.025, PAINT.steel);
  add(new TorusGeometry(0.235, 0.068, 4, 8), PAINT.orange, -0.86, 0.83, 0.95).rotation.y = Math.PI / 2;
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const band = add(new TorusGeometry(0.235, 0.072, 4, 1, 0.27), PAINT.cream, -0.86, 0.83, 0.95);
    band.rotation.set(angle, Math.PI / 2, 0);
  }
  box(0.5, 0.11, 0.37, PAINT.steel, 0, 0.62, -2.73);
  oval(0.32, 0.36, 0.34, PAINT.motor, 0, 0.62, -2.97);
  box(0.46, 0.1, 0.045, PAINT.cream, 0, 0.68, -3.287);
  box(0.12, 0.64, 0.16, PAINT.motor, 0, -0.03, -2.98);
  oval(0.11, 0.1, 0.25, PAINT.motor, 0, -0.37, -3.02);
  const propeller = new Group();
  propeller.name = "dumper-propeller";
  propeller.position.set(0, -0.37, -3.25);
  boat.add(propeller);
  oval(0.055, 0.055, 0.08, PAINT.steel, 0, 0, 0, propeller, true);
  for (let i = 0; i < 3; i++) {
    const blade = oval(0.065, 0.17, 0.026, PAINT.steel, Math.sin(i * Math.PI * 2 / 3) * 0.11, Math.cos(i * Math.PI * 2 / 3) * 0.11, 0, propeller, true);
    blade.rotation.set(0.25, 0, -i * Math.PI * 2 / 3);
  }
  const bags: Group[] = [];
  for (let i = 0; i < BAGS; i++) {
    const bag = new Group();
    bag.name = `trash-bag-${i}`;
    bag.position.set(i % 2 ? 0.43 : -0.38, 0.73 + (i >= 4 ? 0.37 : 0), -1.75 + (i % 4 < 2 ? 0 : 0.5) + (i >= 4 ? 0.2 : 0));
    bag.rotation.y = i * 1.7;
    const color = i % 3 === 2 ? PAINT.bagGrey : PAINT.bag;
    oval(0.33, 0.3, 0.37, color, 0, 0, 0, bag);
    // The tied neck, in the rope's colour.
    add(new CylinderGeometry(0.06, 0.09, 0.1, 5), PAINT.rope, 0.04, 0.3, 0, bag);
    boat.add(bag);
    bags.push(bag);
  }
  return { boat: compactGroup(boat), bags, propeller };
}

export interface DumperView {
  group: Group;
  sync(dumper: Dumper, seconds: number): void;
}

export function createDumperView(): DumperView {
  const group = new Group();
  group.name = "dumper";
  const { boat, bags, propeller } = buildBoat();
  boat.visible = false;
  group.add(boat);
  const crew = Array.from({ length: config.dumper.crew.count }, (_, i) => buildCrewMember(i));
  for (const rig of crew) {
    rig.model.visible = false;
    group.add(rig.model);
  }
  const placePerson = (rig: CrewRig, member: CrewMember | undefined, index: number, dumper: Dumper) => {
    const { model } = rig;
    model.visible = dumper.seen && member !== undefined && member.phase !== "ashore";
    if (!member || !model.visible) return;
    poseCrew(rig, member.phase, member.seconds, index);
    if (member.phase === "aboard") {
      const dx = member.position.x - dumper.position.x, dz = member.position.z - dumper.position.z;
      const cos = Math.cos(dumper.yaw), sin = Math.sin(dumper.yaw);
      model.position.set(cos * dx - sin * dz, DECK_Y, sin * dx + cos * dz).applyQuaternion(boat.quaternion).add(boat.position);
      model.rotation.set(0, member.yaw - dumper.yaw, 0);
      model.quaternion.premultiply(boat.quaternion);
    } else {
      const blend = member.phase === "swimming" ? Math.min(1, member.seconds / 0.65) : 0;
      model.position.set(member.position.x, config.bay.surfaceY - 1.48 + blend * 0.38 + 0.035 * Math.sin(member.seconds * 4.6 + index * 1.9), member.position.z);
      model.rotation.set(0, member.yaw, 0);
    }
  };
  return {
    group,
    sync(dumper, seconds) {
      boat.visible = dumper.seen && dumper.position.y > config.bay.surfaceY - config.dumper.sinkDepth + 0.05;
      const upright = dumper.roll === 0;
      const bob = upright ? 0.05 * Math.sin(seconds * 1.6) : 0;
      boat.position.set(dumper.position.x, dumper.position.y + bob, dumper.position.z);
      boat.rotation.set(upright ? 0.02 * Math.sin(seconds * 1.1) : 0, dumper.yaw, dumper.roll + (upright ? 0.03 * Math.sin(seconds * 1.3) : 0), "YXZ");
      if (dumper.phase === "arriving" || dumper.phase === "leaving") propeller.rotation.z = seconds * 22;
      bags.forEach((bag, i) => { bag.visible = i < Math.ceil(BAGS * (1 - dumper.dumped / config.dumper.maxDrops)); });
      crew.forEach((rig, i) => placePerson(rig, dumper.crew[i], i, dumper));
    },
  };
}
