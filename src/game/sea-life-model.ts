import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { assets } from "../assets";
import { config } from "../config";
import { compactGroup, hasMesh } from "./model-utils";
import type { SeaCreature, SeaLife, SeaSpecies } from "./sea-life";

const { seaLife } = config;

/**
 * Low-poly Phase 3 sea life models (D-022, D-027, D-038): clownfish (Amphiprion ocellaris) and sea anemone,
 * yellowtail fusilier school drawn as one instanced mesh (REQ-009), reef manta rays (Mobula alfredi), and
 * spinner dolphins (Stenella longirostris). Every model faces +Z like a glTF asset.
 */
const materials = {
  anemoneRock: new MeshStandardMaterial({ color: 0x6f695b, flatShading: true, roughness: 0.95 }),
  anemoneBase: new MeshStandardMaterial({ color: 0x8a4fa3, emissive: 0x241030, flatShading: true, roughness: 0.85 }),
  anemoneTentacle: new MeshStandardMaterial({ color: 0xe86fae, emissive: 0x4a1a30, flatShading: true, roughness: 0.7 }),
  anemoneTip: new MeshStandardMaterial({ color: 0xffa8d8, emissive: 0x662448, flatShading: true, roughness: 0.5 }),
  clown: new MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x4a2000, flatShading: true, roughness: 0.55 }),
  clownStripe: new MeshStandardMaterial({ color: 0xffffff, emissive: 0x404040, flatShading: true, roughness: 0.6 }),
  clownEdge: new MeshStandardMaterial({ color: 0x1a1a1a, flatShading: true, roughness: 0.7 }),
  yellowtail: new MeshStandardMaterial({ vertexColors: true, emissive: 0x1a2a3a, flatShading: true, roughness: 0.5 }),
  mantaTop: new MeshStandardMaterial({ color: 0x2b3c54, emissive: 0x101820, flatShading: true, side: DoubleSide, roughness: 0.6 }),
  mantaChevron: new MeshStandardMaterial({ color: 0xb8cde0, emissive: 0x2a3440, flatShading: true, roughness: 0.65 }),
  mantaBelly: new MeshStandardMaterial({ color: 0xe9eef2, emissive: 0x3a3f44, flatShading: true, side: DoubleSide, roughness: 0.65 }),
  dolphinCape: new MeshStandardMaterial({ color: 0x526273, emissive: 0x141c24, flatShading: true, roughness: 0.55 }),
  dolphin: new MeshStandardMaterial({ color: 0x7d8da0, emissive: 0x1c2630, flatShading: true, roughness: 0.55 }),
  dolphinBelly: new MeshStandardMaterial({ color: 0xdfe6ec, emissive: 0x3a4044, flatShading: true, roughness: 0.6 }),
  eye: new MeshStandardMaterial({ color: 0x101010, flatShading: true, roughness: 0.3 }),
};

function part(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

interface Rig {
  group: Group;
  /** Parts that move while the animal swims: a tail, or wings (with the side they belong to). */
  swing: Object3D[];
}

export function buildClownfishMesh(): Group {
  const group = new Group();
  group.name = "clownfish";

  // Plump orange body with three white vertical bands edged in black.
  group.add(part(new SphereGeometry(0.1, 8, 6).scale(0.56, 0.78, 1.52), materials.clown));
  for (const [z, sx, sy] of [
    [0.075, 0.55, 0.88],
    [-0.01, 0.6, 0.96],
    [-0.095, 0.42, 0.68],
  ] as const) {
    group.add(
      part(new CylinderGeometry(0.1, 0.1, 0.036, 8).scale(sx * 0.98, 1, sy * 0.78).rotateX(Math.PI / 2), materials.clownEdge, 0, 0, z),
      part(new CylinderGeometry(0.1, 0.1, 0.026, 8).scale(sx, 1, sy * 0.8).rotateX(Math.PI / 2), materials.clownStripe, 0, 0, z),
    );
  }

  // Two-lobed dorsal fin, pectoral fins with black rims, and eyes.
  group.add(
    part(new ConeGeometry(0.048, 0.09, 5).rotateX(Math.PI / 2).scale(0.5, 0.5, 1), materials.clown, 0, 0.082, 0.03),
    part(new ConeGeometry(0.052, 0.1, 5).rotateX(Math.PI / 2).scale(0.5, 0.45, 1), materials.clownEdge, 0, 0.088, -0.04),
    part(new SphereGeometry(0.016, 4, 3), materials.eye, 0.045, 0.028, 0.12),
    part(new SphereGeometry(0.016, 4, 3), materials.eye, -0.045, 0.028, 0.12),
  );
  for (const side of [-1, 1]) {
    group.add(
      part(new ConeGeometry(0.04, 0.075, 5).scale(0.35, 1, 0.8), materials.clown, side * 0.056, -0.018, 0.04, 0, 0, side * 1.15),
      part(new ConeGeometry(0.022, 0.03, 5).scale(0.36, 1, 0.8), materials.clownEdge, side * 0.082, -0.032, 0.04, 0, 0, side * 1.15),
    );
  }

  // Articulated rounded caudal fin with black fringe.
  const tail = new Group();
  tail.name = "tail";
  tail.position.set(0, 0, -0.14);
  tail.add(
    part(new ConeGeometry(0.072, 0.13, 5).rotateX(Math.PI / 2).scale(0.32, 1, 1), materials.clown, 0, 0, -0.065),
    part(new ConeGeometry(0.076, 0.035, 5).rotateX(Math.PI / 2).scale(0.34, 1, 1), materials.clownEdge, 0, 0, -0.12),
  );
  group.add(tail);
  return compactGroup(group);
}

function createClownfish(): Rig {
  const loaded = assets.model("clownfish");
  const group = hasMesh(loaded) ? loaded : buildClownfishMesh();
  const tail = group.getObjectByName("tail");
  if (!tail) {
    const fallback = buildClownfishMesh();
    return { group: fallback, swing: [fallback.getObjectByName("tail")!] };
  }
  return { group, swing: [tail] };
}

export function buildAnemoneMesh(): Group {
  const group = new Group();
  group.name = "anemone";

  // Reef-rock base, fleshy purple pedal column, and oral disc.
  group.add(
    part(new DodecahedronGeometry(0.38, 0).scale(1.12, 0.34, 1.08), materials.anemoneRock, 0, 0.06, 0),
    part(new CylinderGeometry(0.28, 0.34, 0.22, 8), materials.anemoneBase, 0, 0.16, 0),
    part(new CylinderGeometry(0.32, 0.26, 0.07, 10), materials.anemoneBase, 0, 0.27, 0),
  );

  // Concentric rings of bubble-tip tentacles with glowing rose tips.
  const tentacle = new ConeGeometry(0.044, 0.34, 5);
  const bulb = new SphereGeometry(0.032, 5, 4);
  for (const [count, radius, tilt, height] of [
    [11, 0.23, 0.38, 0.36],
    [7, 0.13, 0.2, 0.4],
    [4, 0.05, 0.08, 0.42],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + radius * 2.5;
      const rx = Math.sin(angle) * tilt;
      const rz = -Math.cos(angle) * tilt;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      group.add(
        part(tentacle, materials.anemoneTentacle, x, height, z, rx, 0, rz),
        part(bulb, materials.anemoneTip, x * 1.18, height + 0.15, z * 1.18),
      );
    }
  }
  return compactGroup(group);
}

function createAnemone(): Group {
  const loaded = assets.model("anemone");
  return hasMesh(loaded) ? loaded : buildAnemoneMesh();
}

/** One yellowtail: a blue-silver body with a yellow tail and a yellow stripe, with vertex colours so the whole school is one draw call. */
export function createYellowtailGeometry(): BufferGeometry {
  const loaded = assets.model("yellowtail");
  let found: BufferGeometry | null = null;
  loaded?.traverse((child) => {
    if (child instanceof Mesh && child.geometry?.attributes.color) found = child.geometry;
  });
  if (found) return found;
  const coloured = (geometry: BufferGeometry, color: number): BufferGeometry => {
    geometry.deleteAttribute("uv");
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
  const body = coloured(new SphereGeometry(0.5, 7, 5).scale(0.2, 0.27, 0.82).translate(0, 0, 0.06), 0x7fc0f0);
  const belly = coloured(new SphereGeometry(0.45, 6, 4).scale(0.18, 0.16, 0.72).translate(0, -0.05, 0.06), 0xc4e4ff);
  const stripe = coloured(new SphereGeometry(0.5, 7, 4).scale(0.218, 0.075, 0.64).translate(0, 0.02, -0.01), 0xffd23f);
  const dorsal = coloured(new ConeGeometry(0.08, 0.24, 4).rotateX(-Math.PI / 2).scale(0.3, 0.8, 1).translate(0, 0.13, -0.02), 0xffd23f);
  const tailUpper = coloured(new ConeGeometry(0.12, 0.26, 4).rotateX(0.95).scale(0.26, 1, 1).translate(0, 0.07, -0.46), 0xffd23f);
  const tailLower = coloured(new ConeGeometry(0.11, 0.24, 4).rotateX(Math.PI - 0.95).scale(0.26, 1, 1).translate(0, -0.07, -0.45), 0xffd23f);
  const merged = mergeGeometries([body, belly, stripe, dorsal, tailUpper, tailLower], false);
  if (!merged) throw new Error("Could not merge the yellowtail geometry");
  return merged;
}

export function buildYellowtailMesh(): Group {
  const group = new Group();
  group.name = "yellowtail";
  group.add(new Mesh(createYellowtailGeometry(), materials.yellowtail));
  return group;
}

export function buildMantaMesh(): Group {
  const group = new Group();
  group.name = "manta-ray";

  // Central diamond disc, pale dorsal chevron markings, and white ventral belly.
  group.add(
    part(new SphereGeometry(1, 8, 6).scale(0.46, 0.13, 0.92), materials.mantaTop),
    part(new SphereGeometry(1, 8, 6).scale(0.41, 0.1, 0.86), materials.mantaBelly, 0, -0.025, 0),
    part(new ConeGeometry(0.12, 0.22, 4).scale(0.4, 1, 1.4), materials.mantaTop, 0, 0.14, -0.78, -0.25, 0, 0),
  );
  for (const side of [-1, 1]) {
    // Dorsal shoulder chevron patch and forward cephalic horn fin.
    group.add(
      part(new BoxGeometry(0.26, 0.03, 0.34), materials.mantaChevron, side * 0.22, 0.1, 0.28, 0, side * 0.35, side * -0.12),
      part(new ConeGeometry(0.075, 0.44, 5).rotateX(Math.PI / 2).scale(0.75, 1, 1), materials.mantaTop, side * 0.22, -0.01, 1.0, 0.08, side * -0.12, 0),
      part(new SphereGeometry(0.038, 5, 4), materials.eye, side * 0.34, 0.02, 0.78),
    );
  }
  // Long whip-like tail.
  group.add(part(new ConeGeometry(0.055, 1.45, 5).rotateX(-Math.PI / 2), materials.mantaTop, 0, 0, -1.56));

  // Articulated pectoral wings (built with positive scale so exported normals stay outward).
  for (const side of [1, -1] as const) {
    const wing = new BufferGeometry();
    wing.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0.02, 0.62,
          side * 0.88, 0.01, 0.32,
          side * 1.74, 0, -0.28,
          side * 0.72, 0.01, -0.44,
          0, 0.015, -0.54,
        ]),
        3,
      ),
    );
    wing.setIndex(side === 1 ? [0, 1, 2, 0, 2, 3, 0, 3, 4] : [0, 2, 1, 0, 3, 2, 0, 4, 3]);
    wing.computeVertexNormals();

    const pivot = new Group();
    pivot.name = side === 1 ? "wing-R" : "wing-L";
    pivot.userData.side = side;
    pivot.add(new Mesh(wing, materials.mantaTop), part(wing, materials.mantaBelly, 0, -0.018, 0));
    group.add(pivot);
  }
  return compactGroup(group);
}

function createManta(): Rig {
  const loaded = assets.model("manta-ray");
  const group = hasMesh(loaded) ? loaded : buildMantaMesh();
  const right = group.getObjectByName("wing-R");
  const left = group.getObjectByName("wing-L");
  if (!right || !left) {
    const fallback = buildMantaMesh();
    return {
      group: fallback,
      swing: [fallback.getObjectByName("wing-R")!, fallback.getObjectByName("wing-L")!],
    };
  }
  right.userData.side = 1;
  left.userData.side = -1;
  return { group, swing: [right, left] };
}

export function buildDolphinMesh(): Group {
  const group = new Group();
  group.name = "spinner-dolphin";

  // Tri-colour spinner dolphin body: dark dorsal cape, silver-grey flank, white belly, melon and long beak.
  group.add(
    part(new SphereGeometry(0.5, 10, 8).scale(0.45, 0.45, 1.92), materials.dolphin),
    part(new SphereGeometry(0.48, 8, 6).scale(0.41, 0.28, 1.75), materials.dolphinCape, 0, 0.11, 0.04),
    part(new SphereGeometry(0.5, 8, 6).scale(0.4, 0.3, 1.72), materials.dolphinBelly, 0, -0.14, 0.05),
    part(new SphereGeometry(0.22, 8, 6).scale(0.82, 0.78, 1.15), materials.dolphinCape, 0, 0.06, 0.84),
    part(new ConeGeometry(0.095, 0.48, 6).rotateX(Math.PI / 2).scale(0.85, 0.65, 1), materials.dolphinCape, 0, -0.04, 1.16),
    part(new ConeGeometry(0.08, 0.42, 6).rotateX(Math.PI / 2).scale(0.8, 0.45, 1), materials.dolphinBelly, 0, -0.07, 1.12),
    part(new SphereGeometry(0.04, 5, 4), materials.eye, 0.19, 0.07, 0.78),
    part(new SphereGeometry(0.04, 5, 4), materials.eye, -0.19, 0.07, 0.78),
    part(new ConeGeometry(0.17, 0.52, 4).scale(0.3, 1, 1.55), materials.dolphinCape, 0, 0.49, -0.1, -0.2, 0, 0),
  );
  for (const side of [-1, 1]) {
    group.add(
      part(new ConeGeometry(0.12, 0.52, 4).scale(1, 1, 0.26), materials.dolphinCape, side * 0.3, -0.2, 0.4, 0, -side * 0.15, side * 1.2),
    );
  }

  // Articulated caudal peduncle and horizontal tail flukes.
  const tail = new Group();
  tail.name = "tail";
  tail.position.set(0, 0, -0.85);
  tail.add(part(new ConeGeometry(0.2, 0.72, 6).rotateX(-Math.PI / 2), materials.dolphin, 0, 0, -0.3));
  for (const side of [-1, 1]) {
    tail.add(
      part(
        new ConeGeometry(0.16, 0.52, 4).rotateZ(side * -Math.PI / 2).scale(1, 0.2, 1),
        materials.dolphinCape,
        side * 0.25,
        0,
        -0.78,
        0,
        side * -0.22,
        0,
      ),
    );
  }
  group.add(tail);
  return compactGroup(group);
}

function createDolphin(): Rig {
  const loaded = assets.model("spinner-dolphin");
  const group = hasMesh(loaded) ? loaded : buildDolphinMesh();
  const tail = group.getObjectByName("tail");
  if (!tail) {
    const fallback = buildDolphinMesh();
    return { group: fallback, swing: [fallback.getObjectByName("tail")!] };
  }
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
      anemones.forEach((anemone, i) => {
        // REQ-012: a new dive can put the anemones beside other frames.
        const spot = current.anemones[i];
        anemone.position.set(spot.x, spot.y, spot.z);
        anemone.scale.setScalar(grown);
      });

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
        else rig.swing.forEach((wing) => (wing.rotation.z = Math.sin(time * 1.4 + phase) * 0.28 * ((wing.userData.side as number) ?? 1)));
      }
    },
  };
}
