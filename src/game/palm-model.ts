import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { compactGroup } from "./model-utils";

function geometry(positions: number[], colours: number[]): BufferGeometry {
  const result = new BufferGeometry();
  result.setAttribute("position", new Float32BufferAttribute(positions, 3));
  result.setAttribute("color", new Float32BufferAttribute(colours, 3));
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}

function triangle(positions: number[], colours: number[], a: Vector3, b: Vector3, c: Vector3, shade: Color): void {
  for (const p of [a, b, c]) {
    positions.push(p.x, p.y, p.z);
    colours.push(shade.r, shade.g, shade.b);
  }
}

/**
 * A tapered, ridged husk shared by the hanging fruit and fallen coconuts, in six large facets around, each one colour.
 * Centred at the origin.
 */
export function coconutGeometry(dry: boolean): BufferGeometry {
  const body = new SphereGeometry(0.5, 6, 4).toNonIndexed();
  const vertices = body.getAttribute("position");
  const positions: number[] = [];
  const colours: number[] = [];
  const base = new Color(dry ? 0x88603c : 0x839345);
  const light = new Color(dry ? 0xb18a5b : 0xb5ad57);
  const colour = new Color();
  for (let i = 0; i < vertices.count; i += 3) {
    let centreY = 0, centreAround = 0;
    for (let corner = i; corner < i + 3; corner++) {
      const x = vertices.getX(corner);
      const y = vertices.getY(corner);
      const z = vertices.getZ(corner);
      const around = Math.atan2(z, x);
      const ridge = 1 + 0.055 * Math.cos(around * 3) * (1 - Math.abs(y));
      const taper = 1 - Math.max(0, y) * 0.34;
      positions.push(x * 0.9 * ridge * taper, y * 1.15, z * 0.83 * ridge * taper);
      centreY += y / 3;
      centreAround += around / 3;
    }
    const fibre = 0.5 + 0.5 * Math.sin(centreAround * 5 + centreY * 9);
    colour.copy(base).lerp(light, 0.15 + 0.4 * fibre + 0.15 * (centreY + 0.5));
    for (let corner = 0; corner < 3; corner++) colours.push(colour.r, colour.g, colour.b);
  }
  body.dispose();
  return geometry(positions, colours);
}

/** The lower trunk stays inside the existing 0.3 m collision radius; most of the bend is above the player. */
export function buildPalmMesh(height: number, lean: number, seed: number): Group {
  const palm = new Group();
  palm.name = "palm";
  const solid = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.94 });
  const leaves = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.87, side: DoubleSide });
  const positions: number[] = [];
  const colours: number[] = [];
  const bark = new Color(0x9c825e);
  const scar = new Color(0x7c6a50);
  const shade = new Color();
  // A six-sided trunk in rings of ±0.7 m, each with a darker scar at its foot.
  const bands = Math.round(height * 1.5);
  const sides = 6;
  const centre = (t: number) => new Vector3(
    Math.tan(lean) * height * 0.72 * t * t,
    height * t,
    Math.sin(t * Math.PI) * Math.sin(seed) * 0.1,
  );
  const vertex = (t: number, angle: number) => {
    const radius = (0.205 - t * 0.08 + 0.075 * Math.exp(-t * 22)) * (1 + 0.035 * Math.cos(t * bands * Math.PI * 2));
    return centre(t).add(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  };
  for (let band = 0; band < bands; band++) {
    for (let edge = 0; edge < 2; edge++) {
      const low = (band + (edge ? 0.16 : 0)) / bands;
      const high = (band + (edge ? 1 : 0.16)) / bands;
      for (let side = 0; side < sides; side++) {
        const a = side * Math.PI * 2 / sides;
        const b = (side + 1) * Math.PI * 2 / sides;
        shade.copy(edge ? bark : scar).multiplyScalar(0.88 + 0.12 * Math.cos(a - seed) + 0.04 * Math.sin(band * 1.7));
        const p = vertex(low, a), q = vertex(low, b), r = vertex(high, a), s = vertex(high, b);
        triangle(positions, colours, p, r, q, shade);
        triangle(positions, colours, q, r, s, shade);
      }
    }
  }
  palm.add(new Mesh(geometry(positions, colours), solid));

  const crown = new Group();
  crown.name = "palm-crown";
  crown.position.copy(centre(1));
  palm.add(crown);
  const leafPositions: number[] = [];
  const leafColours: number[] = [];
  const greens = [0x477139, 0x5c8039, 0x688f43, 0x7c994b].map((hex) => new Color(hex));
  const tip = new Color(0xa2a05b);
  const rib = new Color(0x8d9b54);
  const addFrond = (angle: number, length: number, lift: number, droop: number, index: number, pairs: number) => {
    const forward = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const across = new Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const point = (t: number) => forward.clone().multiplyScalar(0.12 + length * t)
      .add(new Vector3(0, lift * Math.sin(t * Math.PI * 0.86) - droop * t * t, 0));
    for (let segment = 0; segment < 4; segment++) {
      const a = point(segment / 4), b = point((segment + 1) / 4);
      const width = 0.028 * (1 - segment / 5);
      const offset = across.clone().multiplyScalar(width);
      triangle(leafPositions, leafColours, a.clone().add(offset), b.clone().add(offset), a.clone().sub(offset), rib);
      triangle(leafPositions, leafColours, a.clone().sub(offset), b.clone().add(offset), b.clone().sub(offset), rib);
    }
    // Each leaflet is one folded triangle whose base runs along the rib past the next leaflet's, so a frond reads as
    // one serrated blade made of a few large facets.
    for (let pair = 0; pair < pairs; pair++) {
      for (const side of [-1, 1]) {
        const t = 0.1 + 0.83 * pair / pairs;
        const reach = length * 0.24 * Math.pow(Math.sin(t * Math.PI), 0.7) * (0.91 + 0.09 * Math.sin(pair * 2.4 + seed));
        const root = point(t), next = point(Math.min(1, t + 1.7 * 0.83 / pairs));
        const end = root.clone().addScaledVector(across, side * reach).addScaledVector(forward, 0.2 + t * 0.28);
        end.y -= reach * (0.25 + t * 0.25);
        const crease = root.clone().lerp(next, 0.5).lerp(end, 0.4).add(new Vector3(0, 0.035, 0));
        shade.copy(greens[(index + pair % 3) % greens.length]).lerp(tip, index >= 8 ? 0.2 * t : 0.06 * t);
        triangle(leafPositions, leafColours, root, crease, end, shade);
        shade.multiplyScalar(0.81);
        triangle(leafPositions, leafColours, crease, next, end, shade);
      }
    }
  };
  for (let frond = 0; frond < 12; frond++) {
    const lower = frond >= 8;
    const angle = seed + (lower ? (frond - 8) * Math.PI / 2 + 0.4 : frond * Math.PI / 4) + 0.11 * Math.sin(frond * 3.1 + seed);
    const length = height * (lower ? 0.43 : 0.51) * (0.94 + 0.08 * Math.sin(seed + frond * 1.9));
    addFrond(angle, length, lower ? 0.38 : 1.05 + 0.18 * Math.sin(frond), lower ? 1.65 : 0.95, frond, 7);
  }
  for (let spear = 0; spear < 3; spear++) {
    addFrond(seed + spear * 2.15, height * 0.23, 1.8, -0.15, spear, 5);
  }
  crown.add(new Mesh(geometry(leafPositions, leafColours), leaves));
  const fruit = coconutGeometry(false);
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.4 + seed;
    const coconut = new Mesh(fruit, solid);
    coconut.position.set(Math.cos(angle) * 0.3, -0.18 - (i % 3) * 0.13, Math.sin(angle) * 0.3);
    coconut.scale.setScalar(0.37 + 0.05 * Math.sin(i * 2.3));
    coconut.rotation.set(0.2 * Math.sin(angle), angle, 0.28 * Math.cos(angle));
    crown.add(coconut);
  }
  return compactGroup(palm);
}
