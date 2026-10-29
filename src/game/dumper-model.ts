import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SphereGeometry, type Material } from "three";
import { config } from "../config";
import type { CrewMember, Dumper } from "./dumper";
import { compactGroup } from "./model-utils";

const matte = (color: number) => new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
const PAINT = {
  hull: matte(0xe8e6de),
  stripe: matte(0x2f6fa8),
  bottom: matte(0x9a3a2e),
  deck: matte(0x8b7a62),
  console: matte(0xd9d6cc),
  motor: matte(0x2b3035),
  bag: matte(0x2d3236),
  bagGrey: matte(0x7d8288),
  skin: matte(0xc58c63),
  shirtRed: matte(0xb5452f),
  shirtGreen: matte(0x4f7a46),
  trousers: matte(0x2e3a4a),
};
const BAGS = 6;

/** A low-poly open motorboat about 6 m long, bow toward +z, waterline at y = 0, with trash bags heaped on the deck. */
function buildBoat(): { boat: Group; bags: Mesh[] } {
  const boat = new Group();
  boat.name = "dumper-boat";
  const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    boat.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, l: number, material: Material, x: number, y: number, z: number) => add(new BoxGeometry(w, h, l), material, x, y + h / 2, z);
  // The hull: a pointed outline walled up from just under the water, in three bands.
  const outline: [number, number][] = [[-1.1, -3], [1.1, -3], [1.1, 1.2], [0.6, 2.4], [0, 3], [-0.6, 2.4], [-1.1, 1.2]];
  const wall = (bottom: number, top: number, material: Material, deck = false) => {
    const positions: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const [ax, az] = outline[i];
      const [bx, bz] = outline[(i + 1) % outline.length];
      positions.push(ax, bottom, az, bx, top, bz, bx, bottom, bz, ax, bottom, az, ax, top, az, bx, top, bz);
    }
    if (deck) {
      for (let i = 1; i < outline.length - 1; i++) {
        const [ax, az] = outline[0], [bx, bz] = outline[i], [cx, cz] = outline[i + 1];
        positions.push(ax, top, az, cx, top, cz, bx, top, bz);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    add(geometry, material, 0, 0, 0);
  };
  wall(-0.3, 0.05, PAINT.bottom);
  wall(0.05, 0.35, PAINT.stripe);
  wall(0.35, 0.75, PAINT.hull);
  // The floor of the cockpit, under the gunwale.
  box(2, 0.05, 5.2, PAINT.deck, 0, 0.4, -0.3);
  box(0.8, 0.9, 0.6, PAINT.console, 0, 0.45, 0.4);
  box(0.4, 0.8, 0.4, PAINT.motor, 0, 0.2, -3.2);
  const boatModel = compactGroup(boat);
  // The bags stay separate, so they can go one by one as the trash goes overboard.
  const bags: Mesh[] = [];
  for (let i = 0; i < BAGS; i++) {
    const bag = new Mesh(new SphereGeometry(0.32, 6, 4), i % 3 === 2 ? PAINT.bagGrey : PAINT.bag);
    bag.position.set(i % 2 === 0 ? -0.45 : 0.45, 0.68 + (i >= 4 ? 0.35 : 0), -1.6 + (i % 4 < 2 ? 0 : 0.6) + (i >= 4 ? 0.3 : 0));
    bag.scale.set(1, 0.8, 1.1);
    boatModel.add(bag);
    bags.push(bag);
  }
  return { boat: boatModel, bags };
}

/** A low-poly person about 1.75 m tall, feet at y = 0, facing +z. */
function buildPerson(shirt: Material): Group {
  const person = new Group();
  person.name = "dumper-crew";
  const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    person.add(mesh);
  };
  add(new BoxGeometry(0.38, 0.82, 0.24), PAINT.trousers, 0, 0.41, 0);
  add(new BoxGeometry(0.46, 0.6, 0.28), shirt, 0, 1.12, 0);
  for (const side of [-1, 1]) add(new BoxGeometry(0.12, 0.55, 0.14), shirt, side * 0.3, 1.12, 0);
  add(new SphereGeometry(0.14, 6, 5), PAINT.skin, 0, 1.6, 0);
  return compactGroup(person);
}

export interface DumperView {
  group: Group;
  /** Puts the boat, its bags and its crew where `dumper` says; `seconds` rocks the upright boat and the swimmers. */
  sync(dumper: Dumper, seconds: number): void;
}

/** REQ-036: the dumping boat and its crew. */
export function createDumperView(): DumperView {
  const group = new Group();
  group.name = "dumper";
  const { boat, bags } = buildBoat();
  boat.visible = false;
  group.add(boat);
  const crew = [buildPerson(PAINT.shirtRed), buildPerson(PAINT.shirtGreen)];
  for (const person of crew) {
    person.visible = false;
    group.add(person);
  }
  const placePerson = (model: Group, member: CrewMember | undefined, seconds: number, index: number, boatY: number) => {
    model.visible = member !== undefined && member.phase !== "ashore";
    if (!member || !model.visible) return;
    model.rotation.set(0, member.yaw, 0);
    if (member.phase === "aboard") {
      // Standing on the cockpit floor, rocking with the boat.
      model.position.set(member.position.x, boatY + 0.45, member.position.z);
    } else {
      // In the water up to the shoulders, bobbing.
      model.position.set(member.position.x, config.bay.surfaceY - 1.35 + 0.06 * Math.sin(seconds * 2.4 + index * 1.7), member.position.z);
    }
  };
  return {
    group,
    sync(dumper, seconds) {
      boat.visible = dumper.seen && dumper.position.y > config.bay.surfaceY - config.dumper.sinkDepth + 0.05;
      const upright = dumper.roll === 0;
      const bob = upright ? 0.05 * Math.sin(seconds * 1.6) : 0;
      boat.position.set(dumper.position.x, dumper.position.y + bob, dumper.position.z);
      // Rolled over about its own length; a little rocking while upright.
      boat.rotation.set(upright ? 0.02 * Math.sin(seconds * 1.1) : 0, dumper.yaw, dumper.roll + (upright ? 0.03 * Math.sin(seconds * 1.3) : 0), "YXZ");
      bags.forEach((bag, i) => {
        bag.visible = i < Math.ceil(BAGS * (1 - dumper.dumped / config.dumper.maxDrops));
      });
      crew.forEach((model, i) => placePerson(model, dumper.crew[i], seconds, i, boat.position.y));
    },
  };
}
