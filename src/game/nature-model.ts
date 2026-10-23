import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { config } from "../config";
import { smoothstep } from "./bloom";
import { createCoralView } from "./coral-model";
import { decor, meadows, type Decor } from "./nature";
import { createSeagrassView } from "./seagrass-model";

const { nature } = config;

/** What the natural reef shows (REQ-013): pale coral, sparse brown seagrass and no light rays until the Bloom. */
export interface NatureView {
  group: Group;
  /** 0 is the murky bay, 1 the clear water after the Bloom (AC-2, AC-3, AC-8). */
  setBloom(clarity: number): void;
  /** Moves the light rays along with the camera; `hidden` (above the water, in the cave) hides them. */
  update(dt: number, camera: Vector3, hidden: boolean): void;
  /** For the tests: the colours of the coral and the seagrass, how many blades show and exist, the sand tint under the meadows, and how bright the rays are. */
  look(): { coral: number[]; seagrass: number; bladesShown: number; blades: number; sand: number; sandOpacity: number; rays: number };
}

function hash(n: number): number {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** A geometry with only positions, moved into place, so pieces of any shape can be merged into one mesh. */
function placed(geometry: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(flat.attributes)) if (name !== "position") flat.deleteAttribute(name);
  return flat.applyMatrix4(matrix);
}

const matrix = new Matrix4();
const quaternion = new Quaternion();
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();
const scale = new Vector3();

/** One decoration's pieces, each with the index of its material. */
function decorPieces(item: Decor, out: BufferGeometry[][], firstMaterial: { sponge: number; fan: number; algae: number }): void {
  const s = item.size;
  const at = (geometry: BufferGeometry, material: number, dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, tilt = 0) => {
    quaternion.setFromAxisAngle(up, item.yaw).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt));
    tmp.set(dx, dy, dz).applyAxisAngle(up, item.yaw);
    matrix.compose(new Vector3(item.x + tmp.x, item.y - 0.05 + tmp.y, item.z + tmp.z), quaternion, scale.set(sx, sy, sz));
    out[material].push(placed(geometry, matrix));
  };
  if (item.kind === "sponge") {
    // A barrel sponge, open at the top.
    at(new CylinderGeometry(0.42, 0.3, 1, 7, 1, true).translate(0, 0.5, 0), firstMaterial.sponge + (item.seed % 3), 0, 0, 0, s, s, s);
  } else if (item.kind === "fan") {
    // A sea fan: half a disc standing upright.
    at(new CircleGeometry(0.7, 8, 0, Math.PI), firstMaterial.fan + (item.seed % 2), 0, 0, 0, s, s, s);
  } else {
    // A tuft of algae.
    const blade = new ConeGeometry(0.06, 0.5, 3).translate(0, 0.25, 0);
    for (let b = 0; b < 5; b++) at(blade, firstMaterial.algae + (item.seed % 2), Math.cos(b * 1.3) * 0.12 * s, 0, Math.sin(b * 1.3) * 0.12 * s, s, s * (0.8 + 0.4 * hash(b + item.seed)), s, (b - 2) * 0.18);
  }
}

function mergedMesh(parts: BufferGeometry[], material: Material, name: string): Mesh | null {
  if (parts.length === 0) return null;
  const geometry = mergeGeometries(parts)!;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/** A shaft of light from the surface: brightest at the top, fading to nothing toward the floor (additive). */
function rayGeometry(): CylinderGeometry {
  const geometry = new CylinderGeometry(0.7, 1.8, 24, 8, 4, true);
  geometry.translate(0, -12, 0);
  const position = geometry.attributes.position;
  const colours = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const k = Math.max(0, 1 + position.getY(i) / 24);
    colours.set([k, k, k * 0.95], i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
}

/** REQ-013: the natural coral, the seagrass meadows, the sponges, sea fans and algae, and the light rays. */
export function createNatureView(): NatureView {
  const group = new Group();
  group.name = "nature";

  // Coral (REQ-020): colonies as instanced meshes, in their own module.
  const coralView = createCoralView();
  group.add(coralView.group);

  // Decoration: sponges (3 colours), sea fans (2) and algae (2).
  const decorColours = [0xb05ac8, 0xe08a3c, 0xd9c84a, 0xc8455a, 0x8e5fd6, 0x5e8a3a, 0x7a7a3a];
  const dull = new Color(0x8f8a7c);
  const decorMaterials = decorColours.map((colour, i) => new MeshStandardMaterial({ color: i >= 5 ? colour : dull.getHex(), flatShading: true, roughness: 0.9, side: DoubleSide }));
  const decorParts: BufferGeometry[][] = decorMaterials.map(() => []);
  for (const item of decor) decorPieces(item, decorParts, { sponge: 0, fan: 3, algae: 5 });
  decorParts.forEach((parts, i) => {
    const mesh = mergedMesh(parts, decorMaterials[i], `decor-${i}`);
    if (mesh) group.add(mesh);
  });

  // Seagrass meadows (REQ-019): the leaves and the sand tint under them, in their own module.
  const seagrass = createSeagrassView(meadows);
  group.add(seagrass.group);

  // Light rays from the surface after the Bloom, kept around the camera. Each has its own material, so a ray close to
  // the camera can fade out instead of filling the screen.
  const geometry = rayGeometry();
  const rays = Array.from({ length: nature.rays.count }, (_, i) => {
    const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    const ray = new Mesh(geometry, material);
    ray.name = "light-ray";
    ray.rotation.set(0.18, 0, 0.12);
    ray.userData.offset = { x: (hash(i * 3.1) * 2 - 1) * nature.rays.spread, z: (hash(i * 7.7) * 2 - 1) * nature.rays.spread };
    ray.visible = false;
    group.add(ray);
    return ray;
  });

  let clarity = 0;
  let time = 0;
  let rayStrength = 0;
  const setBloom = (value: number) => {
    clarity = value;
    const c = smoothstep(value);
    coralView.setBloom(value);
    decorMaterials.forEach((material, i) => {
      if (i < 5) material.color.copy(dull).lerp(new Color(decorColours[i]), c);
    });
    seagrass.setBloom(value);
  };
  setBloom(0);

  return {
    group,
    setBloom,
    update(dt, camera, hidden) {
      time += dt;
      seagrass.update(dt);
      const spread = nature.rays.spread;
      const shown = !hidden && clarity > 0;
      // A slow shimmer, never a flash (REQ-005 AC-7).
      const strength = nature.rays.opacity * smoothstep(clarity) * (0.85 + 0.15 * Math.sin(time * 0.6));
      for (const ray of rays) {
        ray.visible = shown;
        if (!shown) continue;
        // Wrapped around the camera like the marine snow, so there are always a few rays nearby.
        const { x, z } = ray.userData.offset as { x: number; z: number };
        const wrap = (value: number, centre: number) => centre - spread + ((((value - centre + spread) % (spread * 2)) + spread * 2) % (spread * 2));
        ray.position.set(wrap(x, camera.x), config.bay.surfaceY, wrap(z, camera.z));
        // Faded out within a few metres of the camera, so a ray never covers the view.
        const near = smoothstep((Math.hypot(ray.position.x - camera.x, ray.position.z - camera.z) - 5) / 10);
        (ray.material as MeshBasicMaterial).opacity = strength * near;
      }
      rayStrength = shown ? strength : 0;
    },
    look() {
      const { seagrass: leaf, bladesShown, blades, sand, sandOpacity } = seagrass.look();
      return { coral: coralView.materials.map((m) => m.color.getHex()), seagrass: leaf, bladesShown, blades, sand, sandOpacity, rays: rayStrength };
    },
  };
}
