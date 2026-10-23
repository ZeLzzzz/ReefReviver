import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import { assets } from "../assets";
import type { Animal } from "./animals";
import { compactGroup, hasMesh } from "./model-utils";

/**
 * Low-poly green turtle (Chelonia mydas) and blacktip reef shark (Carcharhinus melanopterus) models (D-022, D-027).
 * Both face +Z like glTF models and include subtle self-illumination so they remain readable in murky water.
 */
const materials = {
  shell: new MeshStandardMaterial({ color: 0x4f9a4a, emissive: 0x1c4a20, flatShading: true, roughness: 0.75 }),
  shellRidge: new MeshStandardMaterial({ color: 0x3b7a37, emissive: 0x143618, flatShading: true, roughness: 0.8 }),
  shellRim: new MeshStandardMaterial({ color: 0xc9c27a, emissive: 0x4a4620, flatShading: true, roughness: 0.8 }),
  plastron: new MeshStandardMaterial({ color: 0xddd694, emissive: 0x4a4624, flatShading: true, roughness: 0.85 }),
  skin: new MeshStandardMaterial({ color: 0x8dbb6a, emissive: 0x2a4a1a, flatShading: true, roughness: 0.8 }),
  eye: new MeshStandardMaterial({ color: 0x101010, flatShading: true, roughness: 0.3 }),
  shark: new MeshStandardMaterial({ color: 0x8f9ea6, emissive: 0x2a3438, flatShading: true, roughness: 0.55 }),
  sharkFlank: new MeshStandardMaterial({ color: 0xb8c4ca, emissive: 0x323c40, flatShading: true, roughness: 0.6 }),
  belly: new MeshStandardMaterial({ color: 0xe8eeee, emissive: 0x4a5050, flatShading: true, roughness: 0.65 }),
  tip: new MeshStandardMaterial({ color: 0x101010, flatShading: true, roughness: 0.7 }),
};

function part(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

export interface Rig {
  group: Group;
  /** Parts that swing while the animal moves: the flippers or the tail. */
  swing: Object3D[];
}

export function buildTurtleMesh(): Group {
  const group = new Group();
  group.name = "turtle";

  // Domed carapace, marginal rim and ventral plastron.
  group.add(
    part(new IcosahedronGeometry(0.7, 1).scale(0.9, 0.42, 1.12), materials.shell, 0, 0.05, -0.05),
    part(new IcosahedronGeometry(0.7, 1).scale(0.96, 0.12, 1.16), materials.shellRim, 0, -0.13, -0.05),
    part(new SphereGeometry(0.62, 8, 6).scale(0.84, 0.14, 1.04), materials.plastron, 0, -0.19, -0.05),
  );

  // Raised vertebral and costal scute plates across the shell.
  for (const [z, s] of [
    [0.36, 0.22],
    [0.1, 0.26],
    [-0.18, 0.25],
    [-0.44, 0.2],
  ] as const) {
    group.add(part(new CylinderGeometry(s * 0.85, s, 0.08, 6), materials.shellRidge, 0, 0.31, z));
  }
  for (const side of [-1, 1]) {
    for (const z of [0.22, -0.08, -0.36]) {
      group.add(
        part(new CylinderGeometry(0.16, 0.19, 0.06, 6), materials.shellRidge, side * 0.34, 0.23, z, 0, 0, side * -0.38),
      );
    }
  }

  // Neck, sculpted head with beak and crown scutes, eyes, and short tail.
  group.add(
    part(new CylinderGeometry(0.13, 0.16, 0.26, 7).rotateX(Math.PI / 2), materials.skin, 0, -0.02, 0.64),
    part(new SphereGeometry(0.2, 8, 6).scale(0.92, 0.88, 1.15), materials.skin, 0, 0.01, 0.82),
    part(new ConeGeometry(0.13, 0.18, 6).rotateX(Math.PI / 2), materials.skin, 0, -0.02, 0.99),
    part(new BoxGeometry(0.18, 0.04, 0.2), materials.shellRidge, 0, 0.16, 0.82),
    part(new SphereGeometry(0.042, 5, 4), materials.eye, 0.11, 0.06, 0.92),
    part(new SphereGeometry(0.042, 5, 4), materials.eye, -0.11, 0.06, 0.92),
    part(new ConeGeometry(0.11, 0.34, 5).rotateX(-Math.PI / 2), materials.skin, 0, -0.06, -0.86),
  );

  // Four articulated flippers (front pair long and wing-like, rear pair shorter paddles).
  const specs = [
    { tag: "fl", side: -1, x: 0.58, z: 0.44, length: 0.78, sweep: -0.18 },
    { tag: "fr", side: 1, x: 0.58, z: 0.44, length: 0.78, sweep: -0.18 },
    { tag: "rl", side: -1, x: 0.56, z: -0.52, length: 0.46, sweep: -0.42 },
    { tag: "rr", side: 1, x: 0.56, z: -0.52, length: 0.46, sweep: -0.42 },
  ] as const;

  for (const { tag, side, x, z, length, sweep } of specs) {
    const flipper = new Group();
    flipper.name = `flipper-${tag}`;
    flipper.position.set(side * x, -0.06, z);
    flipper.userData.side = side;
    const blade = part(
      new SphereGeometry(0.2, 7, 5).scale(length, 0.075, 0.52),
      materials.skin,
      side * length * 0.46,
      0,
      0,
      0,
      side * sweep,
      0,
    );
    const edge = part(
      new BoxGeometry(length * 0.75, 0.035, 0.07),
      materials.shellRidge,
      side * length * 0.44,
      0.015,
      0.06,
      0,
      side * sweep,
      0,
    );
    flipper.add(blade, edge);
    group.add(flipper);
  }
  return compactGroup(group);
}

function createTurtle(): Rig {
  const loaded = assets.model("turtle");
  const group = hasMesh(loaded) ? loaded : buildTurtleMesh();
  const swing = ["flipper-fl", "flipper-fr", "flipper-rl", "flipper-rr"]
    .map((name) => group.getObjectByName(name))
    .filter((obj): obj is Object3D => Boolean(obj));
  if (swing.length < 4) {
    const fallback = buildTurtleMesh();
    return {
      group: fallback,
      swing: ["flipper-fl", "flipper-fr", "flipper-rl", "flipper-rr"].map((name) => fallback.getObjectByName(name)!),
    };
  }
  for (const part of swing) {
    part.userData.side = part.name.endsWith("l") ? -1 : 1;
  }
  return { group, swing };
}

export function buildSharkMesh(): Group {
  const group = new Group();
  group.name = "reef-shark";

  // Torpedo body, pale flank band, countershaded white belly, and wedge snout.
  group.add(
    part(new SphereGeometry(0.4, 10, 8).scale(1, 0.94, 3.12), materials.shark, 0, 0.03, 0.05),
    part(new SphereGeometry(0.4, 8, 6).scale(1.03, 0.34, 2.75), materials.sharkFlank, 0, -0.04, 0.06),
    part(new SphereGeometry(0.4, 8, 6).scale(0.86, 0.5, 2.82), materials.belly, 0, -0.17, 0.06),
    part(new ConeGeometry(0.34, 0.64, 8).rotateX(Math.PI / 2).scale(1, 0.72, 1), materials.shark, 0, 0.0, 1.4),
    part(new ConeGeometry(0.28, 0.52, 8).rotateX(Math.PI / 2).scale(0.9, 0.45, 1), materials.belly, 0, -0.08, 1.34),
    part(new SphereGeometry(0.05, 5, 4), materials.eye, 0.21, 0.07, 1.12),
    part(new SphereGeometry(0.05, 5, 4), materials.eye, -0.21, 0.07, 1.12),
  );

  // Five gill slits on each side behind the head.
  for (const side of [-1, 1]) {
    for (let g = 0; g < 5; g++) {
      group.add(part(new BoxGeometry(0.02, 0.16, 0.022), materials.tip, side * 0.37, -0.02, 0.68 + g * 0.06));
    }
  }

  // First dorsal fin with white sub-terminal highlight and iconic black tip.
  group.add(
    part(new ConeGeometry(0.2, 0.56, 4).scale(0.34, 1, 1.65), materials.shark, 0, 0.58, 0.1, -0.15, 0, 0),
    part(new ConeGeometry(0.11, 0.16, 4).scale(0.35, 1, 1.65), materials.belly, 0, 0.8, 0.05, -0.15, 0, 0),
    part(new ConeGeometry(0.08, 0.22, 4).scale(0.35, 1, 1.65), materials.tip, 0, 0.92, 0.02, -0.15, 0, 0),
  );

  // Second dorsal fin with black tip.
  group.add(
    part(new ConeGeometry(0.11, 0.28, 4).scale(0.32, 1, 1.4), materials.shark, 0, 0.34, -0.76, -0.2, 0, 0),
    part(new ConeGeometry(0.05, 0.11, 4).scale(0.33, 1, 1.4), materials.tip, 0, 0.46, -0.79, -0.2, 0, 0),
  );

  // Swept pectoral and pelvic fins with black tips.
  for (const side of [-1, 1]) {
    group.add(
      part(new ConeGeometry(0.17, 0.72, 4).scale(1, 1, 0.32), materials.shark, side * 0.42, -0.2, 0.48, 0, -side * 0.18, side * 1.16),
      part(new ConeGeometry(0.065, 0.22, 4).scale(1, 1, 0.32), materials.tip, side * 0.67, -0.45, 0.44, 0, -side * 0.18, side * 1.16),
      part(new ConeGeometry(0.09, 0.28, 4).scale(1, 1, 0.3), materials.shark, side * 0.24, -0.24, -0.45, 0, 0, side * 0.95),
      part(new ConeGeometry(0.04, 0.1, 4).scale(1, 1, 0.3), materials.tip, side * 0.34, -0.32, -0.45, 0, 0, side * 0.95),
    );
  }

  // Articulated caudal tail group with upper and lower lobes tipped in black.
  const tail = new Group();
  tail.name = "tail";
  tail.position.set(0, 0, -1.2);
  tail.add(
    part(new ConeGeometry(0.2, 0.52, 6).rotateX(-Math.PI / 2), materials.shark, 0, 0, -0.1),
    part(new ConeGeometry(0.2, 0.92, 4).scale(0.3, 1, 1), materials.shark, 0, 0.4, -0.25, -0.5, 0, 0),
    part(new ConeGeometry(0.085, 0.24, 4).scale(0.3, 1, 1), materials.tip, 0, 0.79, -0.5, -0.5, 0, 0),
    part(new ConeGeometry(0.14, 0.62, 4).scale(0.3, 1, 1), materials.shark, 0, -0.28, -0.12, Math.PI + 0.5, 0, 0),
    part(new ConeGeometry(0.065, 0.17, 4).scale(0.3, 1, 1), materials.tip, 0, -0.53, -0.25, Math.PI + 0.5, 0, 0),
  );
  group.add(tail);
  return compactGroup(group);
}

function createShark(): Rig {
  const loaded = assets.model("reef-shark");
  const group = hasMesh(loaded) ? loaded : buildSharkMesh();
  const tail = group.getObjectByName("tail");
  if (!tail) {
    const fallback = buildSharkMesh();
    return { group: fallback, swing: [fallback.getObjectByName("tail")!] };
  }
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
