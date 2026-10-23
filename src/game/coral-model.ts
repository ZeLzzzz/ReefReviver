import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { config } from "../config";
import { colonies } from "./bay";
import { smoothstep } from "./bloom";

const { nature, bloom } = config;

/** The natural coral's colonies as a few instanced meshes (REQ-020 AC-3, AC-8). */
export interface CoralView {
  group: Group;
  /** One material for each of the six pastel colours (REQ-013, D-091). */
  materials: MeshStandardMaterial[];
  /** Blends every colony from pale (0) to its pastel colour (1), all together and without a flash (AC-4). */
  setBloom(clarity: number): void;
  /** For the tests: how many colonies there are and how many meshes (draw calls) show them. */
  stats(): { colonies: number; meshes: number };
}

function hash(n: number): number {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const unit = new Vector3(1, 1, 1);

/** A geometry with only positions, moved by `matrix`, so that pieces of any shape can be merged into one. */
function placed(geometry: BufferGeometry, position: Vector3, rotation: Euler, scale = unit): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(flat.attributes)) if (name !== "position") flat.deleteAttribute(name);
  return flat.applyMatrix4(matrix.compose(position, quaternion.setFromEuler(rotation), scale));
}

/** A tapered branch growing up from the origin, leaning `lean` radians toward `heading`. */
function branch(radiusTop: number, radiusBottom: number, length: number, at: Vector3, lean: number, heading: number): BufferGeometry {
  const tube = new CylinderGeometry(radiusTop, radiusBottom, length, 4, 1, true).translate(0, length / 2, 0);
  return placed(tube, at, euler.set(lean, heading, 0, "YXZ"));
}

/** The part of a rounded shape above the ground, bumpy like a brain or a Porites head. */
function dome(detail: number, bump: number, seed: number, height: number): BufferGeometry {
  const sphere = new IcosahedronGeometry(0.5, detail);
  const position = sphere.attributes.position;
  const keep: number[] = [];
  const vertex = new Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const lump = 1 + bump * (hash(Math.round(vertex.x * 40) * 3 + Math.round(vertex.y * 40) * 7 + Math.round(vertex.z * 40) * 11 + seed) - 0.5) * 2;
    position.setXYZ(i, vertex.x * lump, vertex.y * lump * (height / 0.5), vertex.z * lump);
  }
  // Only the upper half shows; the rest is buried in the floor.
  for (let i = 0; i < position.count; i += 3) {
    if ((position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3 >= -0.01) keep.push(i, i + 1, i + 2);
  }
  const out = new Float32Array(keep.length * 3);
  keep.forEach((v, i) => out.set([position.getX(v), position.getY(v), position.getZ(v)], i * 3));
  const half = new BufferGeometry();
  half.setAttribute("position", new Float32BufferAttribute(out, 3));
  return half;
}

/** The unit shape of each kind of colony: 1 m across or tall, standing on y = 0. */
function shapes(): BufferGeometry[] {
  const at = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const finish = (parts: BufferGeometry[]) => {
    const merged = mergeGeometries(parts)!;
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    return merged;
  };

  // 0, branching (Acropora): a short trunk, six leaning branches and a twig on each.
  const branching: BufferGeometry[] = [branch(0.06, 0.09, 0.3, at(0, -0.05, 0), 0, 0)];
  for (let b = 0; b < 6; b++) {
    const heading = (b / 6) * Math.PI * 2 + hash(b) * 0.5;
    const lean = 0.5 + 0.3 * hash(b + 10);
    branching.push(branch(0.03, 0.055, 0.62, at(0, 0.22, 0), lean, heading));
    const tip = at(Math.sin(heading) * Math.sin(lean) * 0.34, 0.22 + Math.cos(lean) * 0.34, Math.cos(heading) * Math.sin(lean) * 0.34);
    branching.push(branch(0.02, 0.035, 0.3, tip, lean + 0.6, heading + 0.5));
  }

  // 1, table: a flat plate, a metre across, on a short stalk.
  const table = [
    placed(new CylinderGeometry(0.07, 0.11, 0.3, 5).translate(0, 0.15, 0), at(0, -0.02, 0), euler.set(0, 0, 0)),
    placed(new CylinderGeometry(0.5, 0.36, 0.12, 9).translate(0, 0.34, 0), at(0, 0, 0), euler.set(0, 0, 0)),
  ];

  // 2, brain: a low, lumpy dome.
  const brain = [dome(1, 0.07, 3, 0.6)];

  // 3, finger: seven upright tubes of different lengths.
  const finger: BufferGeometry[] = [];
  for (let b = 0; b < 7; b++) {
    const angle = b * 2.4;
    const near = b === 0 ? 0 : 0.14 + 0.08 * hash(b + 20);
    finger.push(branch(0.045, 0.075, 0.55 + 0.45 * hash(b + 30), at(Math.cos(angle) * near, -0.04, Math.sin(angle) * near), 0.12 * hash(b + 40), angle));
  }

  // 4, Porites: a big smooth dome, 0.425 high for 1 across.
  const porites = [dome(3, 0.04, 9, 0.425)];

  return [branching, table, brain, finger, porites].map(finish);
}

/** REQ-020: the colonies, one instanced mesh for each shape and colour, so the reef costs a few dozen draw calls. */
export function createCoralView(): CoralView {
  const group = new Group();
  group.name = "coral";
  const pale = new Color(nature.pale);
  const materials = bloom.coral.pastel.map(() => new MeshStandardMaterial({ color: nature.pale, flatShading: true, roughness: 0.85 }));
  const geometries = shapes();
  const instance = new Matrix4();
  const shade = new Color();
  let meshes = 0;

  for (let kind = 0; kind < geometries.length; kind++) {
    for (let colour = 0; colour < materials.length; colour++) {
      const these = colonies.filter((c) => c.kind === kind && c.colour === colour);
      if (these.length === 0) continue;
      const mesh = new InstancedMesh(geometries[kind], materials[colour], these.length);
      mesh.name = `coral-${kind}-${colour}`;
      these.forEach((c, i) => {
        quaternion.setFromAxisAngle(new Vector3(0, 1, 0), c.yaw);
        instance.compose(new Vector3(c.x, c.y, c.z), quaternion, new Vector3(c.size, c.size * c.stretch, c.size));
        mesh.setMatrixAt(i, instance);
        mesh.setColorAt(i, shade.setScalar(c.shade));
      });
      mesh.instanceMatrix.needsUpdate = true;
      // The colonies spread over the whole shelf and bay; the mesh's own bounding sphere would cull them wrongly.
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes++;
    }
  }

  const setBloom = (clarity: number) => {
    const c = smoothstep(clarity);
    materials.forEach((material, i) => {
      const pastel = new Color(bloom.coral.pastel[i]);
      material.color.copy(pale).lerp(pastel, c);
      material.emissive.copy(pastel).multiplyScalar(bloom.coral.glow * c);
    });
  };
  setBloom(0);

  return { group, materials, setBloom, stats: () => ({ colonies: colonies.length, meshes }) };
}
