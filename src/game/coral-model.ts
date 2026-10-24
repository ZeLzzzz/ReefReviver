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
import { FOOTPRINT, TOP } from "./coral-reef";
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

/** A thin, cupped plate with an uneven growing edge and a closed underside. */
function plate(radius: number, seed: number): BufferGeometry {
  const segments = 16;
  const rings = 2;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let side = 0; side < 2; side++) {
    positions.push(0, side ? -0.025 : 0, 0);
    for (let ring = 1; ring <= rings; ring++) {
      const r = ring / rings;
      for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2;
        const edge = 1 + 0.1 * Math.sin(a * 3 + seed) + 0.05 * Math.sin(a * 7 + seed * 2);
        positions.push(Math.cos(a) * radius * r * edge, 0.075 * r * r + 0.022 * Math.sin(a * 4 + seed) * r - side * 0.025, Math.sin(a) * radius * r * edge * 0.86);
      }
    }
  }
  const half = 1 + segments * rings;
  const face = (a: number, b: number, c: number) => {
    indices.push(a, c, b, a + half, b + half, c + half);
  };
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    face(0, 1 + i, 1 + next);
    face(1 + i, 1 + segments + i, 1 + segments + next);
    face(1 + i, 1 + segments + next, 1 + next);
    const a = 1 + segments + i;
    const b = 1 + segments + next;
    indices.push(a, b, a + half, b, b + half, a + half);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Two reusable silhouettes of each kind, normalized to the colony's collision footprint and height. */
function shapes(variant: number): BufferGeometry[] {
  const seed = variant * 43;
  const at = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const finish = (parts: BufferGeometry[], kind: number) => {
    const merged = mergeGeometries(parts)!;
    merged.computeBoundingBox();
    const bounds = merged.boundingBox!;
    const centre = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    merged.translate(-centre.x, -bounds.min.y, -centre.z);
    merged.scale(FOOTPRINT[kind] / Math.max(size.x, size.z), TOP[kind] / size.y, FOOTPRINT[kind] / Math.max(size.x, size.z));
    merged.computeVertexNormals();
    const p = merged.attributes.position;
    const n = merged.attributes.normal;
    const colours = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const height = p.getY(i) / TOP[kind];
      const shade = (0.48 + 0.52 * Math.sqrt(height)) * (0.8 + 0.2 * Math.max(0, n.getY(i)));
      colours.set([shade, shade, shade], i * 3);
    }
    merged.setAttribute("color", new Float32BufferAttribute(colours, 3));
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  };

  // A low woody root with unequal forks spreading into a broad crown.
  const branching: BufferGeometry[] = [branch(0.055, 0.095, 0.22, at(0, 0, 0), 0.12, seed)];
  for (let b = 0; b < 6; b++) {
    const heading = b * 2.4 + hash(seed + b) * 0.8;
    const lean = 0.38 + 0.55 * hash(seed + b + 10);
    const length = 0.32 + 0.34 * hash(seed + b + 18);
    const root = 0.1 + 0.1 * hash(seed + b + 25);
    branching.push(branch(0.025, 0.06, length, at(0, root, 0), lean, heading));
    for (let twig = 0; twig < 3; twig++) {
      const along = length * (0.42 + twig * 0.22);
      const tip = at(Math.sin(heading) * Math.sin(lean) * along, root + Math.cos(lean) * along, Math.cos(heading) * Math.sin(lean) * along);
      branching.push(branch(0.008, 0.03, 0.17 + 0.18 * hash(seed + b * 5 + twig), tip, 0.2 + hash(seed + b + twig) * 0.65, heading + (twig - 1) * 0.85));
    }
  }

  // Overlapping growing plates with offset centres and thin, rippled lips.
  const table = [
    branch(0.06, 0.11, 0.21, at(0, 0, 0), 0.16, seed),
    placed(plate(0.42, seed + 1), at(-0.12, 0.13, 0.04), euler.set(0.08, seed, -0.06)),
    placed(plate(0.36, seed + 4), at(0.13, 0.27, -0.08), euler.set(-0.07, seed + 1, 0.12)),
  ];

  const brain = [dome(2, 0.18, seed + 3, 0.6)];

  // 3, finger: seven upright tubes of different lengths.
  const finger: BufferGeometry[] = [];
  for (let b = 0; b < 7; b++) {
    const angle = b * 2.4 + seed;
    const near = b === 0 ? 0 : 0.12 + 0.1 * hash(seed + b + 20);
    const length = 0.45 + 0.5 * hash(seed + b + 30);
    finger.push(branch(0.035, 0.08, length, at(Math.cos(angle) * near, 0, Math.sin(angle) * near), 0.1 + 0.24 * hash(seed + b + 40), angle));
    if (b % 2 === 0) finger.push(branch(0.018, 0.045, length * 0.42, at(Math.cos(angle) * near, length * 0.35, Math.sin(angle) * near), 0.48, angle + 0.5));
  }

  // 4, Porites: a big smooth dome, 0.425 high for 1 across.
  const porites = [dome(3, 0.1, seed + 9, 0.425)];

  return [branching, table, brain, finger, porites].map(finish);
}

/** REQ-020: the colonies, one instanced mesh for each shape and colour, so the reef costs a few dozen draw calls. */
export function createCoralView(): CoralView {
  const group = new Group();
  group.name = "coral";
  const pale = new Color(nature.pale);
  const materials = bloom.coral.pastel.map(() => new MeshStandardMaterial({ color: nature.pale, vertexColors: true, flatShading: true, roughness: 0.85 }));
  const variants = [shapes(0), shapes(1)];
  const instance = new Matrix4();
  const shade = new Color();
  let meshes = 0;

  for (let variant = 0; variant < variants.length; variant++) {
    const geometries = variants[variant];
    for (let kind = 0; kind < geometries.length; kind++) {
      for (let colour = 0; colour < materials.length; colour++) {
        const these = colonies.filter((c) => c.kind === kind && c.colour === colour && Math.floor(hash(c.x * 3 + c.z * 7) * 2) === variant);
        if (these.length === 0) continue;
        const mesh = new InstancedMesh(geometries[kind], materials[colour], these.length);
        mesh.name = `coral-${kind}-${colour}-${variant}`;
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
