import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  BackSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { config } from "../config";
import type { SeaCreature, SeaLife, SeaSpecies } from "./sea-life";

const { seaLife } = config;

/**
 * Stand-ins built from primitives until the artist's GLBs arrive (D-022): clownfish and an anemone, a yellowtail
 * school drawn as one instanced mesh (one draw call for the whole school, REQ-009), manta rays and dolphins.
 * Every model faces +Z like a glTF model. They are lit a little from inside so they read in the shade.
 */
const materials = {
  anemoneBase: new MeshStandardMaterial({ color: 0x8a4fa3, flatShading: true, roughness: 0.9 }),
  anemoneTentacle: new MeshStandardMaterial({ color: 0xe86fae, emissive: 0x4a1a30, flatShading: true }),
  clown: new MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x4a2000, flatShading: true }),
  clownStripe: new MeshStandardMaterial({ color: 0xffffff, emissive: 0x404040, flatShading: true }),
  clownEdge: new MeshStandardMaterial({ color: 0x1a1a1a, flatShading: true }),
  yellowtail: new MeshStandardMaterial({ vertexColors: true, emissive: 0x1a2a3a, flatShading: true }),
  mantaTop: new MeshStandardMaterial({ color: 0x2f4058, emissive: 0x101820, flatShading: true, side: DoubleSide }),
  mantaBelly: new MeshStandardMaterial({ color: 0xe9eef2, emissive: 0x3a3f44, flatShading: true, side: BackSide }),
  dolphin: new MeshStandardMaterial({ color: 0x7d8da0, emissive: 0x1c2630, flatShading: true, roughness: 0.6 }),
  dolphinBelly: new MeshStandardMaterial({ color: 0xdfe6ec, emissive: 0x3a4044, flatShading: true }),
  eye: new MeshStandardMaterial({ color: 0x101010, flatShading: true }),
};

function part(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

interface Rig {
  group: Group;
  /** Parts that move while the animal swims: a tail, or wings (with the side they belong to). */
  swing: Group[];
}

function createClownfish(): Rig {
  const group = new Group();
  group.add(part(new SphereGeometry(0.1, 8, 6).scale(0.55, 0.75, 1.5), materials.clown));
  for (const z of [0.07, -0.05]) group.add(part(new CylinderGeometry(0.1, 0.1, 0.03, 8).scale(0.6, 1, 0.8).rotateX(Math.PI / 2), materials.clownStripe, 0, 0, z));
  group.add(part(new ConeGeometry(0.05, 0.1, 5).rotateX(Math.PI / 2).scale(1, 0.4, 1), materials.clownEdge, 0, 0.09, -0.02));
  group.add(part(new SphereGeometry(0.015, 4, 3), materials.eye, 0.045, 0.03, 0.12), part(new SphereGeometry(0.015, 4, 3), materials.eye, -0.045, 0.03, 0.12));
  const tail = new Group();
  tail.position.set(0, 0, -0.14);
  tail.add(part(new ConeGeometry(0.07, 0.14, 4).rotateX(Math.PI / 2).scale(0.3, 1, 1), materials.clown, 0, 0, -0.07));
  group.add(tail);
  return { group, swing: [tail] };
}

function createAnemone(): Group {
  const group = new Group();
  group.add(part(new CylinderGeometry(0.28, 0.34, 0.2, 8), materials.anemoneBase, 0, 0.1, 0));
  const tentacle = new ConeGeometry(0.045, 0.34, 4);
  for (const [count, radius, tilt, height] of [
    [10, 0.22, 0.35, 0.34],
    [6, 0.1, 0.12, 0.38],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + radius;
      const mesh = part(tentacle, materials.anemoneTentacle, Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      mesh.rotation.set(Math.sin(angle) * tilt, 0, -Math.cos(angle) * tilt);
      group.add(mesh);
    }
  }
  return group;
}

/** One yellowtail: a blue-silver body with a yellow tail and a yellow stripe, with vertex colours so the whole school is one draw call. */
export function createYellowtailGeometry(): BufferGeometry {
  const coloured = (geometry: BufferGeometry, color: number): BufferGeometry => {
    const count = geometry.attributes.position.count;
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      values[i * 3] = ((color >> 16) & 0xff) / 255;
      values[i * 3 + 1] = ((color >> 8) & 0xff) / 255;
      values[i * 3 + 2] = (color & 0xff) / 255;
    }
    geometry.setAttribute("color", new Float32BufferAttribute(values, 3));
    return geometry;
  };
  const body = coloured(new SphereGeometry(0.5, 7, 5).scale(0.2, 0.26, 0.8).translate(0, 0, 0.05), 0x7fc0f0);
  const stripe = coloured(new SphereGeometry(0.5, 7, 5).scale(0.215, 0.07, 0.6).translate(0, 0.0, -0.02), 0xffd23f);
  const tail = coloured(new ConeGeometry(0.17, 0.3, 4).rotateX(Math.PI / 2).scale(0.25, 1, 1).translate(0, 0, -0.5), 0xffd23f);
  const merged = mergeGeometries([body, stripe, tail], false);
  if (!merged) throw new Error("Could not merge the yellowtail geometry");
  return merged;
}

function createManta(): Rig {
  const group = new Group();
  group.add(part(new SphereGeometry(1, 8, 6).scale(0.45, 0.13, 0.9), materials.mantaTop), part(new SphereGeometry(1, 8, 6).scale(0.4, 0.1, 0.85), materials.mantaBelly, 0, -0.02, 0));
  // Head fins and a long thin tail.
  for (const side of [-1, 1]) group.add(part(new ConeGeometry(0.07, 0.4, 4).rotateX(Math.PI / 2), materials.mantaTop, side * 0.2, 0, 1.0));
  group.add(part(new ConeGeometry(0.06, 1.4, 4).rotateX(-Math.PI / 2), materials.mantaTop, 0, 0, -1.55));
  // A wing is a swept quad, dark on top and pale underneath; the left one is the right one mirrored.
  const wing = new BufferGeometry();
  wing.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0.6, 0.9, 0, 0.3, 1.7, 0, -0.3, 0, 0, -0.5]), 3));
  wing.setIndex([0, 1, 2, 0, 2, 3]);
  wing.computeVertexNormals();
  const swing: Group[] = [];
  for (const side of [1, -1]) {
    const pivot = new Group();
    pivot.scale.x = side;
    pivot.add(new Mesh(wing, materials.mantaTop), part(wing, materials.mantaBelly, 0, -0.015, 0));
    group.add(pivot);
    swing.push(pivot);
  }
  return { group, swing };
}

function createDolphin(): Rig {
  const group = new Group();
  group.add(
    part(new SphereGeometry(0.5, 10, 8).scale(0.45, 0.45, 1.9), materials.dolphin),
    part(new SphereGeometry(0.5, 8, 6).scale(0.4, 0.3, 1.7), materials.dolphinBelly, 0, -0.14, 0.05),
    part(new ConeGeometry(0.1, 0.45, 6).rotateX(Math.PI / 2), materials.dolphin, 0, -0.04, 1.15),
    part(new SphereGeometry(0.04, 4, 3), materials.eye, 0.19, 0.08, 0.78),
    part(new SphereGeometry(0.04, 4, 3), materials.eye, -0.19, 0.08, 0.78),
    part(new ConeGeometry(0.17, 0.5, 4).scale(0.3, 1, 1.5), materials.dolphin, 0, 0.5, -0.1),
  );
  for (const side of [-1, 1]) {
    const flipper = part(new ConeGeometry(0.12, 0.5, 4).scale(1, 1, 0.25), materials.dolphin, side * 0.3, -0.2, 0.4);
    flipper.rotation.set(0, 0, side * 1.2);
    group.add(flipper);
  }
  // The tail swings up and down, with two flat flukes.
  const tail = new Group();
  tail.position.set(0, 0, -0.85);
  tail.add(part(new ConeGeometry(0.2, 0.7, 6).rotateX(-Math.PI / 2), materials.dolphin, 0, 0, -0.3));
  for (const side of [-1, 1]) {
    // Each fluke points sideways and lies flat, like a real dolphin's tail.
    tail.add(part(new ConeGeometry(0.15, 0.5, 4).rotateZ(side * -Math.PI / 2).scale(1, 0.2, 1), materials.dolphin, side * 0.25, 0, -0.78));
  }
  group.add(tail);
  return { group, swing: [tail] };
}

export interface SeaLifeView {
  group: Group;
  /** Places everything and swings the tails and wings; nothing is drawn until the sea life is active. */
  sync(life: SeaLife, dt: number): void;
}

const euler = new Euler();
const quaternion = new Quaternion();
const matrix = new Matrix4();
const position = new Vector3();
const scaleVector = new Vector3();

export function createSeaLifeView(life: SeaLife): SeaLifeView {
  const group = new Group();
  group.visible = false;

  const anemones = life.anemones.map((spot) => {
    const anemone = createAnemone();
    anemone.position.set(spot.x, spot.y, spot.z);
    group.add(anemone);
    return anemone;
  });

  const school = life.creatures.filter((c) => c.species === "yellowtail");
  const schoolMesh = new InstancedMesh(createYellowtailGeometry(), materials.yellowtail, school.length);
  // Instances move all over the bay, so the mesh's own bounding sphere would cull the school too early.
  schoolMesh.frustumCulled = false;
  group.add(schoolMesh);

  const builders: Record<Exclude<SeaSpecies, "yellowtail">, () => Rig> = { clownfish: createClownfish, mantaRay: createManta, dolphin: createDolphin };
  const rigs = new Map<SeaCreature, Rig>();
  for (const creature of life.creatures) {
    if (creature.species === "yellowtail") continue;
    const rig = builders[creature.species]();
    group.add(rig.group);
    rigs.set(creature, rig);
  }

  let time = 0;
  return {
    group,
    sync(current, dt) {
      const scale = current.scale;
      group.visible = scale > 0;
      if (scale <= 0) return;
      time += dt;
      const grown = Math.max(scale, 0.001);
      for (const anemone of anemones) anemone.scale.setScalar(grown);

      school.forEach((fish, i) => {
        // Each fish is a little different in size, and waggles as it swims.
        const size = grown * (0.85 + 0.3 * ((i * 0.618) % 1));
        euler.set(fish.pitch, fish.yaw + Math.sin(time * 9 + i * 1.7) * 0.12, 0, "YXZ");
        quaternion.setFromEuler(euler);
        matrix.compose(position.copy(fish.position), quaternion, scaleVector.setScalar(size));
        schoolMesh.setMatrixAt(i, matrix);
      });
      schoolMesh.instanceMatrix.needsUpdate = true;

      for (const [creature, rig] of rigs) {
        const phase = creature.id * 1.3;
        rig.group.position.copy(creature.position);
        rig.group.scale.setScalar(grown * (creature.species === "clownfish" ? seaLife.clownfish.size : 1));
        rig.group.rotation.set(creature.pitch, creature.yaw, 0, "YXZ");
        if (creature.species === "clownfish") rig.swing[0].rotation.y = Math.sin(time * 14 + phase) * 0.5;
        else if (creature.species === "dolphin") rig.swing[0].rotation.x = Math.sin(time * 3.2 + phase) * 0.3;
        else rig.swing.forEach((wing) => (wing.rotation.z = Math.sin(time * 1.4 + phase) * 0.28 * wing.scale.x));
      }
    },
  };
}
