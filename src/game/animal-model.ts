import { ConeGeometry, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry, type Material } from "three";
import type { Animal } from "./animals";

/**
 * Stand-in animals built from primitives until the artist's GLB arrives (D-022): a green turtle with a domed
 * shell and four flippers, and a blacktip reef shark with a grey body and black fin tips (D-027). Both face +Z
 * like a glTF model, and are lit a little from inside so they read through the murk (DESIGN).
 */
const materials = {
  shell: new MeshStandardMaterial({ color: 0x4f9a4a, emissive: 0x1c4a20, flatShading: true, roughness: 0.8 }),
  shellRim: new MeshStandardMaterial({ color: 0xc9c27a, emissive: 0x4a4620, flatShading: true }),
  skin: new MeshStandardMaterial({ color: 0x8dbb6a, emissive: 0x2a4a1a, flatShading: true }),
  eye: new MeshStandardMaterial({ color: 0x101010, flatShading: true }),
  shark: new MeshStandardMaterial({ color: 0x9aa7ad, emissive: 0x2a3438, flatShading: true, roughness: 0.6 }),
  belly: new MeshStandardMaterial({ color: 0xe8eeee, emissive: 0x4a5050, flatShading: true }),
  tip: new MeshStandardMaterial({ color: 0x101010, flatShading: true }),
};

function part(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

interface Rig {
  group: Group;
  /** Parts that swing while the animal moves: the flippers or the tail. */
  swing: Group[];
}

function createTurtle(): Rig {
  const group = new Group();
  group.add(
    part(new IcosahedronGeometry(0.7, 1).scale(0.9, 0.42, 1.1), materials.shell, 0, 0.04, -0.05),
    part(new IcosahedronGeometry(0.7, 1).scale(0.95, 0.12, 1.15), materials.shellRim, 0, -0.14, -0.05),
    part(new SphereGeometry(0.2, 8, 6), materials.skin, 0, 0.0, 0.8),
    part(new SphereGeometry(0.04, 4, 3), materials.eye, 0.1, 0.06, 0.93),
    part(new SphereGeometry(0.04, 4, 3), materials.eye, -0.1, 0.06, 0.93),
    part(new ConeGeometry(0.12, 0.35, 5).rotateX(-Math.PI / 2), materials.skin, 0, -0.05, -0.85),
  );
  const swing: Group[] = [];
  // Front flippers are long and wide, rear ones short; each swings around its shoulder.
  for (const [x, z, length] of [
    [0.6, 0.45, 0.75],
    [0.6, -0.5, 0.45],
  ] as const) {
    for (const side of [-1, 1]) {
      const flipper = new Group();
      flipper.position.set(side * x, -0.05, z);
      flipper.add(part(new SphereGeometry(0.2, 6, 4).scale(length, 0.07, 0.5), materials.skin, side * length * 0.5 * 0.9, 0, 0));
      flipper.userData.side = side;
      group.add(flipper);
      swing.push(flipper);
    }
  }
  return { group, swing };
}

function createShark(): Rig {
  const group = new Group();
  // Body, belly and snout.
  group.add(
    part(new SphereGeometry(0.4, 10, 8).scale(1, 0.95, 3.1), materials.shark, 0, 0.02, 0.05),
    part(new SphereGeometry(0.4, 8, 6).scale(0.85, 0.5, 2.8), materials.belly, 0, -0.17, 0.05),
    part(new ConeGeometry(0.34, 0.6, 8).rotateX(Math.PI / 2), materials.shark, 0, 0, 1.4),
    part(new SphereGeometry(0.05, 4, 3), materials.eye, 0.2, 0.08, 1.1),
    part(new SphereGeometry(0.05, 4, 3), materials.eye, -0.2, 0.08, 1.1),
  );
  // Dorsal fin with a black tip.
  group.add(part(new ConeGeometry(0.2, 0.62, 4).scale(0.35, 1, 1.6), materials.shark, 0, 0.62, 0.1), part(new ConeGeometry(0.08, 0.2, 4).scale(0.35, 1, 1.6), materials.tip, 0, 0.9, 0.04));
  // Pectoral fins, tips black.
  for (const side of [-1, 1]) {
    const fin = part(new ConeGeometry(0.16, 0.7, 4).scale(1, 1, 0.3), materials.shark, side * 0.42, -0.2, 0.5);
    fin.rotation.set(0, 0, side * 1.15);
    const tip = part(new ConeGeometry(0.06, 0.2, 4).scale(1, 1, 0.3), materials.tip, side * 0.66, -0.45, 0.5);
    tip.rotation.set(0, 0, side * 1.15);
    group.add(fin, tip);
  }
  // Tail: a swinging group with the upper and lower lobes, black at the ends.
  const tail = new Group();
  tail.position.set(0, 0, -1.2);
  const upper = part(new ConeGeometry(0.2, 0.9, 4).scale(0.3, 1, 1), materials.shark, 0, 0.4, -0.25);
  upper.rotation.x = -0.5;
  const upperTip = part(new ConeGeometry(0.08, 0.22, 4).scale(0.3, 1, 1), materials.tip, 0, 0.79, -0.5);
  upperTip.rotation.x = -0.5;
  const lower = part(new ConeGeometry(0.14, 0.6, 4).scale(0.3, 1, 1), materials.shark, 0, -0.28, -0.12);
  lower.rotation.x = Math.PI + 0.5;
  const lowerTip = part(new ConeGeometry(0.06, 0.16, 4).scale(0.3, 1, 1), materials.tip, 0, -0.53, -0.25);
  lowerTip.rotation.x = Math.PI + 0.5;
  tail.add(upper, upperTip, lower, lowerTip, part(new ConeGeometry(0.2, 0.5, 6).rotateX(-Math.PI / 2), materials.shark, 0, 0, -0.1));
  group.add(tail);
  return { group, swing: [tail] };
}

export interface AnimalView {
  group: Group;
  /** Places each animal and swings its flippers or tail; trapped animals thrash, free ones glide. */
  sync(animals: readonly Animal[], dt: number): void;
}

export function createAnimalView(animals: readonly Animal[]): AnimalView {
  const group = new Group();
  const rigs = animals.map((animal) => {
    const rig = animal.species === "turtle" ? createTurtle() : createShark();
    group.add(rig.group);
    return rig;
  });
  let time = 0;

  return {
    group,
    sync(current, dt) {
      time += dt;
      for (const animal of current) {
        const rig = rigs[animal.id];
        const thrash = animal.state === "trapped" ? 1 : 0.25;
        const t = time + animal.phase;
        rig.group.position.copy(animal.position);
        rig.group.rotation.set(-animal.velocity.y * 0.25, animal.yaw, Math.sin(t * 8.3) * 0.35 * thrash, "YXZ");
        for (const part of rig.swing) {
          if (animal.species === "turtle") part.rotation.z = (part.userData.side as number) * -Math.sin(t * (animal.state === "trapped" ? 11 : 2.2)) * (animal.state === "trapped" ? 0.7 : 0.45);
          else part.rotation.y = Math.sin(t * (animal.state === "trapped" ? 12 : 3.5)) * (animal.state === "trapped" ? 0.7 : 0.35);
        }
      }
    },
  };
}
