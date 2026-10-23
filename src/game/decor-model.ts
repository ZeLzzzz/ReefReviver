import {
  BoxGeometry,
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
  TorusGeometry,
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

/** Halimeda (REQ-021 AC-1): three clumps of flat segments, each segment a coin on the one below, about 0.33 m tall. */
function halimedaShape(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let stem = 0; stem < 3; stem++) {
    const angle = stem * 2.1;
    for (let k = 0; k < 4; k++) {
      const turn = new Quaternion().setFromEuler(new Euler(0.3 * Math.cos(angle), angle, 0.3 * Math.sin(angle)));
      const spread = 0.03 + 0.03 * k;
      const coin = new CylinderGeometry(0.075 - 0.005 * k, 0.082 - 0.005 * k, 0.022, 7);
      parts.push(moved(coin, Math.cos(angle) * spread, 0.04 + 0.09 * k, Math.sin(angle) * spread, turn));
    }
  }
  return merged(parts);
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

/**
 * A barrel sponge (REQ-021 AC-3): a hollow barrel open at both ends, with ridges up its wall and a jagged rim, 1 m tall at
 * size 1. The material is double-sided, so its inside shows.
 */
function spongeShape(): BufferGeometry {
  const sides = 24;
  const rows = 8;
  const positions: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const barrel = 0.27 + 0.13 * Math.sin(Math.PI * (0.2 + 0.7 * t));
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2;
      const ridge = 1 + 0.1 * Math.cos(8 * angle);
      const tooth = j === rows ? (i % 2 ? 0.8 : 1.05) : 1;
      const r = barrel * ridge * tooth;
      positions.push(Math.cos(angle) * r, t, Math.sin(angle) * r);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * sides + i;
      const b = j * sides + ((i + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * A sea fan (REQ-021 AC-4): an upright fan standing on its base, 0.9 m high at size 1, with a lattice of radial ribs and rings
 * over a thin membrane. The membrane keeps it reading as a fan, not as a net.
 */
function fanShape(): BufferGeometry {
  const radius = 0.9;
  const parts: BufferGeometry[] = [placed(new CircleGeometry(radius, 20, 0, Math.PI), new Matrix4().makeTranslation(0, 0, -0.01))];
  const plane = new Vector3(0, 0, 1);
  for (let k = 0; k <= 8; k++) {
    // A rib from the base, fanned out `angle` round from the x axis.
    const angle = (k / 8) * Math.PI;
    const rib = new BoxGeometry(0.02, radius, 0.02).translate(0, radius / 2, 0);
    parts.push(moved(rib, 0, 0, 0, new Quaternion().setFromAxisAngle(plane, angle - Math.PI / 2)));
  }
  for (let k = 1; k <= 4; k++) parts.push(placed(new TorusGeometry((radius * k) / 5, 0.012, 3, 24, Math.PI), new Matrix4()));
  return merged(parts);
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
  return shapes[kind]();
}

/** REQ-013 AC-4, REQ-021: the algae, barrel sponges and sea fans, one instanced mesh per kind, so a handful of draw calls. */
export function createDecorView(): DecorView {
  const group = new Group();
  group.name = "decor";
  // Flat-shaded and double-sided, like the rest of the low-poly reef. The material is white: each piece's colour comes from its instance.
  const material = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, side: DoubleSide });
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
