import {
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
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
import { smoothstep } from "./bloom";
import { decor, decorClearOf, type Decor, type DecorKind } from "./nature";

const tuning = config.nature.decor;
const UP = new Vector3(0, 1, 0);

/** The decoration as the player sees it (REQ-013 AC-4, REQ-021): one instanced mesh per kind, each piece its own colour. */
export interface DecorView {
  group: Group;
  /** 0 is the murky bay, 1 the clear water after the Bloom: every piece goes from dull to its own colour (AC-5). */
  setBloom(clarity: number): void;
  /** AC-6: hides the pieces that would cover one of these spots (this dive's trash). */
  setTrash(spots: readonly { x: number; z: number }[]): void;
  /** The pieces shown now. */
  shown(): readonly Decor[];
  /** For the tests: how many pieces are shown, and the colour each one has now. */
  look(): { shown: number; colours: number[] };
}

/** The colour a piece takes after the Bloom (AC-5): one of its kind's colours, picked by its seed. */
export function decorColour(item: Decor): number {
  const colours = tuning.colours[item.kind];
  return colours[item.seed % colours.length];
}

/** A geometry with only positions, moved into place, so the parts of one shape merge into one geometry. */
function placed(geometry: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(flat.attributes)) if (name !== "position") flat.deleteAttribute(name);
  return flat.applyMatrix4(matrix);
}

/** Moves `geometry` to (x, y, z), turned by `turn` first. */
function moved(geometry: BufferGeometry, x: number, y: number, z: number, turn = new Quaternion()): BufferGeometry {
  return placed(geometry, new Matrix4().compose(new Vector3(x, y, z), turn, new Vector3(1, 1, 1)));
}

/** The parts of one shape, merged into a single geometry. */
function merged(parts: BufferGeometry[]): BufferGeometry {
  const geometry = mergeGeometries(parts)!;
  geometry.computeVertexNormals();
  return geometry;
}

// The shapes below stand on their root at y = 0 at size 1; each piece is scaled to its own size.

/** Halimeda: small upright, overlapping paddle segments, with each shoot bending out from its root. */
function halimedaShape(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let stem = 0; stem < 3; stem++) {
    const angle = stem * 2.1;
    for (let k = 0; k < 4; k++) {
      const turn = new Quaternion().setFromEuler(new Euler(Math.PI / 2 + 0.16 * Math.sin(k + angle), angle + 0.22 * k, 0.12 * Math.cos(angle), "YXZ"));
      const spread = 0.018 + 0.025 * k;
      const paddle = new CylinderGeometry(0.055 - 0.004 * k, 0.059 - 0.004 * k, 0.012, 7);
      parts.push(moved(paddle, Math.cos(angle) * spread, 0.04 + 0.075 * k, Math.sin(angle) * spread, turn));
    }
  }
  const geometry = merged(parts);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(0, -box.min.y, 0);
  geometry.scale(1, 0.325 / (box.max.y - box.min.y), 1);
  return geometry;
}

/** Padina (REQ-021 AC-1): a whitish fan standing on its flat edge, its bands rippled across it, about 0.25 m wide. */
function padinaShape(): BufferGeometry {
  const fan = new CircleGeometry(0.13, 14, 0, Math.PI);
  const position = fan.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    position.setZ(i, 0.012 * Math.sin(Math.hypot(position.getX(i), position.getY(i)) * 110));
  }
  return placed(fan, new Matrix4());
}

/** Sargassum (REQ-021 AC-1): a brown bush, a stem with branches that lean out, each set with small leaves; about 0.8 m tall. */
function sargassumShape(): BufferGeometry {
  const parts: BufferGeometry[] = [moved(new CylinderGeometry(0.008, 0.012, 0.6, 4), 0, 0.3, 0)];
  for (let k = 0; k < 9; k++) {
    const yaw = k * 2.3;
    const lean = 0.8;
    const direction = new Vector3(Math.sin(lean) * Math.cos(yaw), Math.cos(lean), Math.sin(lean) * Math.sin(yaw));
    const length = 0.26 - 0.014 * k;
    const start = new Vector3(0, 0.18 + 0.065 * k, 0);
    const middle = start.clone().addScaledVector(direction, length / 2);
    const turn = new Quaternion().setFromUnitVectors(UP, direction);
    parts.push(placed(new CylinderGeometry(0.005, 0.007, length, 3), new Matrix4().compose(middle, turn, new Vector3(1, 1, 1))));
    // Leaves along the branch: three at its middle and three near its tip.
    for (const along of [0.5, 0.85]) {
      const point = start.clone().addScaledVector(direction, length * along);
      for (let leaf = 0; leaf < 3; leaf++) {
        const spin = leaf * 2.1 + k;
        const at = point.clone().add(new Vector3(Math.cos(spin) * 0.03, 0, Math.sin(spin) * 0.03));
        parts.push(placed(new IcosahedronGeometry(0.032, 0), new Matrix4().compose(at, new Quaternion().setFromAxisAngle(UP, spin), new Vector3(1, 0.35, 0.6))));
      }
    }
  }
  return merged(parts);
}

/** A leaning barrel with an uneven thick rim and a shaded inner wall; the opening stays visibly hollow. */
function spongeShape(): BufferGeometry {
  const sides = 20;
  const rows = 6;
  const positions: number[] = [];
  const colours: number[] = [];
  const rim = Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2;
    return 0.96 + 0.025 * Math.sin(angle * 3 + 0.7) + 0.015 * Math.sin(angle * 5);
  });
  const top = Math.max(...rim);
  for (let wall = 0; wall < 2; wall++) {
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const barrel = 0.245 + 0.125 * Math.sin(Math.PI * (0.12 + 0.83 * t));
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const ridge = 1 + 0.065 * Math.cos(angle * 7 + t * 1.5) + 0.035 * Math.sin(angle * 3 + t);
        const r = barrel * ridge - wall * (0.045 + 0.015 * (1 - t));
        positions.push(Math.cos(angle) * r + 0.045 * t * t, t * rim[i] / top, Math.sin(angle) * r + 0.02 * t);
        const shade = wall ? 0.4 + 0.32 * t : 1;
        colours.push(shade, shade, shade);
      }
    }
  }
  const indices: number[] = [];
  const wallSize = (rows + 1) * sides;
  for (let wall = 0; wall < 2; wall++) {
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < sides; i++) {
        const a = wall * wallSize + j * sides + i;
        const b = wall * wallSize + j * sides + ((i + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        if (wall) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    }
  }
  for (let i = 0; i < sides; i++) {
    const a = rows * sides + i;
    const b = rows * sides + ((i + 1) % sides);
    indices.push(a, b, a + wallSize, b, b + wallSize, a + wallSize);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A broad, asymmetric branching fan with real gaps, irregular forks and a short rooted stem. */
function fanShape(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const segment = (from: Vector3, to: Vector3, width: number, tip: number) => {
    const direction = to.clone().sub(from);
    const geometry = new CylinderGeometry(tip, width, direction.length(), 5, 1, true);
    const turn = new Quaternion().setFromUnitVectors(UP, direction.normalize());
    parts.push(moved(geometry, (from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2, turn));
  };
  const random = (n: number) => {
    const value = Math.sin(n * 127.1 + 47.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const grow = (start: Vector3, heading: number, length: number, width: number, depth: number, seed: number) => {
    const points = [start];
    for (let step = 1; step <= 3; step++) {
      const t = step / 3;
      const angle = heading + 0.16 * Math.sin(t * 2.4 + seed);
      const previous = points[points.length - 1];
      const point = previous.clone().add(new Vector3(Math.sin(angle) * length / 3, Math.cos(angle) * length / 3, 0.018 * Math.sin(seed + step)));
      segment(previous, point, width * (1 - 0.45 * (t - 1 / 3)), width * (1 - 0.45 * t));
      points.push(point);
    }
    if (depth === 0) return;
    const side = seed % 2 ? 1 : -1;
    grow(points[2], heading + side * (0.4 + random(seed) * 0.22), length * (0.5 + random(seed + 3) * 0.12), width * 0.56, depth - 1, seed * 2 + 1);
    grow(points[3], heading - side * (0.18 + random(seed + 7) * 0.2), length * (0.44 + random(seed + 9) * 0.14), width * 0.48, depth - 1, seed * 2 + 2);
  };
  const root = new Vector3(0, 0, 0);
  const fork = new Vector3(-0.025, 0.14, 0.015);
  segment(root, fork, 0.032, 0.023);
  for (let arm = 0; arm < 6; arm++) {
    const heading = -1.05 + arm * 0.4 + random(arm + 17) * 0.16;
    grow(fork, heading, 0.37 + random(arm + 20) * 0.12, 0.017 + random(arm + 30) * 0.005, 2, arm + 1);
  }
  const geometry = merged(parts);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(0, -box.min.y, 0);
  geometry.scale(1.1, 0.94 / (box.max.y - box.min.y), 1);
  return geometry;
}

const shapes: Record<DecorKind, () => BufferGeometry> = {
  halimeda: halimedaShape,
  padina: padinaShape,
  sargassum: sargassumShape,
  sponge: spongeShape,
  fan: fanShape,
};

/** The shape of one kind at size 1 (AC-1, AC-3, AC-4), for the view and for the tests. */
export function decorShape(kind: DecorKind): BufferGeometry {
  const geometry = shapes[kind]();
  geometry.computeBoundingBox();
  const position = geometry.getAttribute("position");
  const previous = geometry.getAttribute("color");
  const colours = new Float32Array(position.count * 3);
  const box = geometry.boundingBox!;
  const height = Math.max(0.01, box.max.y - box.min.y);
  for (let i = 0; i < position.count; i++) {
    const up = (position.getY(i) - box.min.y) / height;
    const shade = (0.57 + 0.43 * Math.sqrt(up)) * (previous ? previous.getX(i) : 1);
    colours.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** REQ-013 AC-4, REQ-021: the algae, barrel sponges and sea fans, one instanced mesh per kind, so a handful of draw calls. */
export function createDecorView(): DecorView {
  const group = new Group();
  group.name = "decor";
  // Flat-shaded and double-sided, like the rest of the low-poly reef. The material is white: each piece's colour comes from its instance.
  const material = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, side: DoubleSide, vertexColors: true });
  const dull = new Color(tuning.dull);
  const meshes: InstancedMesh[] = [];
  const slots: { item: Decor; mesh: InstancedMesh; index: number; own: Color; colour: Color; shown: boolean }[] = [];
  for (const kind of Object.keys(shapes) as DecorKind[]) {
    const items = decor.filter((item) => item.kind === kind);
    const mesh = new InstancedMesh(decorShape(kind), material, items.length);
    mesh.name = `decor-${kind}`;
    // The pieces spread over the whole bay; the mesh's own bounding sphere would cull them wrongly.
    mesh.frustumCulled = false;
    group.add(mesh);
    meshes.push(mesh);
    items.forEach((item, index) => slots.push({ item, mesh, index, own: new Color(decorColour(item)), colour: new Color(), shown: true }));
  }

  const matrix = new Matrix4();
  const turn = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  // A hidden piece is scaled to nothing, so it draws nothing and nothing has to be rebuilt.
  const placeAll = () => {
    for (const slot of slots) {
      const { item } = slot;
      const s = slot.shown ? item.size : 0;
      turn.setFromAxisAngle(UP, item.yaw);
      matrix.compose(position.set(item.x, item.y - 0.03, item.z), turn, scale.set(s, s, s));
      slot.mesh.setMatrixAt(slot.index, matrix);
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  };

  const setBloom = (clarity: number) => {
    const c = smoothstep(clarity);
    for (const slot of slots) {
      slot.colour.copy(dull).lerp(slot.own, c);
      slot.mesh.setColorAt(slot.index, slot.colour);
    }
    for (const mesh of meshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  placeAll();
  setBloom(0);

  return {
    group,
    setBloom,
    setTrash(spots) {
      const clear = new Set(decorClearOf(spots));
      for (const slot of slots) slot.shown = clear.has(slot.item);
      placeAll();
    },
    shown: () => slots.filter((slot) => slot.shown).map((slot) => slot.item),
    look() {
      const shown = slots.filter((slot) => slot.shown);
      return { shown: shown.length, colours: shown.map((slot) => slot.colour.getHex()) };
    },
  };
}
