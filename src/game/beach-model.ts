import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { config } from "../config";
import { beachItems, beachItemsClearOf, type BeachItem, type BeachKind } from "./beach";
import { coconutGeometry } from "./palm-model";

const UP = new Vector3(0, 1, 0);
const KINDS: BeachKind[] = ["scallop", "clam", "spiral", "fragment", "coconut", "green-coconut"];

export function beachGeometry(kind: BeachKind): BufferGeometry {
  if (kind === "coconut" || kind === "green-coconut") {
    const geometry = coconutGeometry(kind === "coconut");
    geometry.rotateZ(1.05);
    geometry.computeBoundingBox();
    geometry.translate(0, -geometry.boundingBox!.min.y, 0);
    return geometry;
  }
  const positions: number[] = [];
  const colours: number[] = [];
  const ivory = new Color(0xf3ebdb);
  const groove = new Color(0xb6a286);
  const pink = new Color(0xd2b4a4);
  const shade = new Color();
  const vertex = (p: Vector3, colour: Color) => {
    positions.push(p.x, p.y, p.z);
    colours.push(colour.r, colour.g, colour.b);
  };
  const triangle = (a: Vector3, b: Vector3, c: Vector3, colour: Color) => {
    vertex(a, colour); vertex(b, colour); vertex(c, colour);
  };
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, colour: Color) => {
    triangle(a, b, c, colour);
    triangle(c, b, d, colour);
  };

  // Few, large facets like the rest of the bay (D-125): 8 sides and 2 rings for the scallop and clam, a five-sided spiral.
  if (kind === "scallop") {
    const sides = 8;
    const rings = 2;
    const point = (ring: number, side: number) => {
      const r = ring / rings;
      const angle = -1.35 + 2.7 * side / sides;
      const rib = side % 2 ? 0 : 0.024 * Math.pow(r, 0.7);
      const rim = 1 + (side % 2 ? -0.012 : 0.012) * r;
      return new Vector3(Math.sin(angle) * r * 0.51 * rim,
        0.012 + 0.18 * Math.sin(r * Math.PI) * (0.8 + 0.2 * Math.cos(angle)) + rib,
        Math.cos(angle) * r * 0.78 * rim - 0.34);
    };
    for (let ring = 0; ring < rings; ring++) {
      for (let side = 0; side < sides; side++) {
        shade.copy(ivory).lerp(groove, (side % 2 ? 0.08 : 0.29) + (ring === rings - 1 ? 0.14 : 0));
        if (ring === 0) triangle(point(0, 0), point(1, side + 1), point(1, side), shade);
        else quad(point(ring, side), point(ring + 1, side), point(ring, side + 1), point(ring + 1, side + 1), shade);
      }
    }
    triangle(new Vector3(-0.14, 0.016, -0.35), new Vector3(-0.1, 0.018, -0.2), new Vector3(0, 0.024, -0.34), pink);
    triangle(new Vector3(0, 0.024, -0.34), new Vector3(0.1, 0.018, -0.2), new Vector3(0.14, 0.016, -0.35), ivory);
  } else if (kind === "clam") {
    const sides = 8;
    const rings = 2;
    const point = (ring: number, side: number) => {
      const r = ring / rings;
      const angle = side * Math.PI * 2 / sides;
      const ripple = 1 + 0.018 * Math.cos(side * Math.PI);
      return new Vector3(Math.sin(angle) * r * 0.5, 0.015 + 0.24 * Math.cos(r * Math.PI / 2) * ripple,
        Math.cos(angle) * r * 0.39);
    };
    for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
      shade.copy(ivory).lerp(ring % 2 ? pink : groove, ring % 2 ? 0.23 : 0.16).multiplyScalar(side % 2 ? 1 : 0.94);
      if (ring === 0) triangle(point(0, 0), point(1, side), point(1, side + 1), shade);
      else quad(point(ring, side), point(ring + 1, side), point(ring, side + 1), point(ring + 1, side + 1), shade);
    }
  } else if (kind === "spiral") {
    const steps = 12;
    const sides = 5;
    const point = (step: number, side: number, inset = 0) => {
      const t = step / steps;
      const angle = t * Math.PI * 4.5;
      const tube = (0.175 * Math.pow(1 - t, 0.8) + 0.012) * (1 - inset);
      const centre = 0.29 * (1 - t);
      const around = side * Math.PI * 2 / sides;
      return new Vector3(Math.cos(angle) * (centre + Math.cos(around) * tube),
        0.19 + t * 0.31 + Math.sin(around) * tube,
        Math.sin(angle) * (centre + Math.cos(around) * tube) + inset * 0.16);
    };
    for (let step = 0; step < steps; step++) for (let side = 0; side < sides; side++) {
      shade.copy(ivory).lerp(groove, step % 4 === 0 ? 0.55 : 0.12 + side % 3 * 0.08);
      quad(point(step, side), point(step + 1, side), point(step, side + 1), point(step + 1, side + 1), shade);
    }
    const centre = new Vector3(0.29, 0.19, 0.11);
    const dark = new Color(0x785b44);
    for (let side = 0; side < sides; side++) {
      quad(point(0, side), point(0, side, 0.3), point(0, side + 1), point(0, side + 1, 0.3), ivory);
      triangle(centre, point(0, side, 0.3), point(0, side + 1, 0.3), dark);
    }
  } else {
    const a = new Vector3(-0.46, 0.015, -0.2), b = new Vector3(0.22, 0.02, -0.36);
    const c = new Vector3(0.4, 0.012, 0.13), d = new Vector3(-0.14, 0.045, 0.34);
    const centre = new Vector3(0, 0.11, 0);
    triangle(a, b, centre, ivory);
    triangle(b, c, centre, pink);
    triangle(c, d, centre, ivory);
    triangle(d, a, centre, shade.copy(ivory).lerp(groove, 0.32));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export interface BeachView {
  group: Group;
  setTrash(spots: readonly { x: number; z: number }[]): void;
  shown(): BeachItem[];
  look(): { shells: number; coconuts: number; batches: number };
}

/** Six short stretches can be culled separately; each shape and material is shared by all its instances. */
export function createBeachView(): BeachView {
  const group = new Group();
  group.name = "beach-decor";
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, side: DoubleSide });
  const shells = [0xffffff, 0xf1dfc5, 0xe4c4ba, 0xd6c2a0, 0xf0ede2].map((c) => new Color(c));
  const meshes: InstancedMesh[] = [];
  const slots: { item: BeachItem; mesh: InstancedMesh; index: number; matrix: Matrix4; shown: boolean }[] = [];
  const tilt = new Quaternion();
  const turn = new Quaternion();
  const normal = new Vector3();
  const position = new Vector3();
  const scale = new Vector3();
  const half = config.land.beachDecor.halfLength;
  for (const kind of KINDS) {
    const geometry = beachGeometry(kind);
    for (let stretch = 0; stretch < 6; stretch++) {
      const items = beachItems.filter((item) => item.kind === kind && Math.min(5, Math.floor((item.z + half) / (half * 2) * 6)) === stretch);
      if (!items.length) continue;
      const mesh = new InstancedMesh(geometry, material, items.length);
      mesh.name = `beach-${kind}-${stretch}`;
      items.forEach((item, index) => {
        tilt.setFromUnitVectors(UP, normal.fromArray(item.normal));
        turn.setFromAxisAngle(UP, item.yaw);
        tilt.multiply(turn);
        const matrix = new Matrix4().compose(position.set(item.x, item.y, item.z), tilt, scale.setScalar(item.size));
        mesh.setMatrixAt(index, matrix);
        const coconut = kind === "coconut" || kind === "green-coconut";
        mesh.setColorAt(index, coconut ? new Color(0xffffff) : shells[Math.floor(item.shade * shells.length)]);
        slots.push({ item, mesh, index, matrix, shown: true });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      meshes.push(mesh);
    }
  }
  const hidden = new Vector3(0, 0, 0);
  const matrix = new Matrix4();
  return {
    group,
    setTrash(spots) {
      const clear = new Set(beachItemsClearOf(spots));
      for (const slot of slots) {
        slot.shown = clear.has(slot.item);
        matrix.copy(slot.matrix);
        if (!slot.shown) matrix.scale(hidden);
        slot.mesh.setMatrixAt(slot.index, matrix);
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    },
    shown: () => slots.filter((slot) => slot.shown).map((slot) => slot.item),
    look() {
      let shells = 0, coconuts = 0;
      for (const slot of slots) {
        if (!slot.shown) continue;
        if (slot.item.kind === "coconut" || slot.item.kind === "green-coconut") coconuts++;
        else shells++;
      }
      return { shells, coconuts, batches: meshes.length };
    },
  };
}
