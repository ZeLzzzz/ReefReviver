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
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { config } from "../config";
import { corals, floorHeight, type Coral } from "./bay";
import { smoothstep } from "./bloom";
import { decor, meadows, type Decor } from "./nature";

const { nature, bloom } = config;

/** What the natural reef shows (REQ-013): pale coral, sparse brown seagrass and no light rays until the Bloom. */
export interface NatureView {
  group: Group;
  /** 0 is the murky bay, 1 the clear water after the Bloom (AC-2, AC-3, AC-8). */
  setBloom(clarity: number): void;
  /** Moves the light rays along with the camera; `hidden` (above the water, in the cave) hides them. */
  update(dt: number, camera: Vector3, hidden: boolean): void;
  /** For the tests: the colours of the coral and the seagrass, how many blades show, and how bright the rays are. */
  look(): { coral: number[]; seagrass: number; bladesShown: number; rays: number };
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

/** One coral cluster's pieces, each with the index of its colour: branching, brain, table and finger coral. */
function coralPieces(coral: Coral, out: BufferGeometry[][]): void {
  const pieces = 3 + Math.floor(hash(coral.seed) * 4);
  // A cluster on a boulder or an arch stands on that flat top; one on the floor follows the floor under each piece.
  const raised = coral.y - floorHeight(coral.x, coral.z) > 1;
  for (let i = 0; i < pieces; i++) {
    const r = hash(coral.seed * 13 + i);
    const angle = (i / pieces) * Math.PI * 2 + r * 2;
    const distance = i === 0 ? 0 : coral.radius * (0.35 + 0.35 * hash(coral.seed * 7 + i));
    const x = coral.x + Math.cos(angle) * distance;
    const z = coral.z + Math.sin(angle) * distance;
    const base = raised ? coral.y : floorHeight(x, z) - 0.05;
    const size = coral.radius * (0.5 + 0.4 * hash(coral.seed * 3 + i));
    const colour = (coral.seed + i) % bloom.coral.pastel.length;
    const kind = Math.floor(hash(coral.seed * 5 + i * 11) * 4);
    const yaw = hash(coral.seed + i * 17) * Math.PI * 2;
    const add = (geometry: BufferGeometry, dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, tiltX = 0, tiltZ = 0) => {
      quaternion.setFromAxisAngle(up, yaw).multiply(new Quaternion().setFromEuler(new Object3D().rotation.set(tiltX, 0, tiltZ)));
      tmp.set(dx, dy, dz).applyAxisAngle(up, yaw);
      matrix.compose(new Vector3(x + tmp.x, base + tmp.y, z + tmp.z), quaternion, scale.set(sx, sy, sz));
      out[colour].push(placed(geometry, matrix));
    };
    if (kind === 0) {
      // Branching coral: a fan of thin branches.
      const branch = new CylinderGeometry(0.05, 0.09, 1, 5).translate(0, 0.5, 0);
      for (let b = 0; b < 5; b++) add(branch, (b - 2) * 0.12 * size, 0, 0, size, size * (0.8 + 0.3 * hash(b + coral.seed)), size, 0, (b - 2) * 0.28);
    } else if (kind === 1) {
      // Brain coral: a low, rounded boulder.
      add(new IcosahedronGeometry(0.55, 0), 0, 0.15 * size, 0, size, size * 0.6, size);
    } else if (kind === 2) {
      // Table coral: a flat plate on a short stalk.
      add(new CylinderGeometry(0.1, 0.14, 0.5, 5).translate(0, 0.25, 0), 0, 0, 0, size, size, size);
      add(new CylinderGeometry(0.65, 0.3, 0.12, 7), 0, 0.55 * size, 0, size, size, size);
    } else {
      // Finger coral: a few upright tubes.
      const tube = new CylinderGeometry(0.08, 0.1, 0.8, 5).translate(0, 0.4, 0);
      for (let b = 0; b < 4; b++) add(tube, Math.cos(b * 1.6) * 0.2 * size, 0, Math.sin(b * 1.6) * 0.2 * size, size, size * (0.7 + 0.4 * hash(b * 3 + coral.seed)), size);
    }
  }
}

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
  const pale = new Color(nature.pale);

  // Coral: one merged mesh per colour, so the whole reef is a handful of draw calls.
  const coralMaterials = bloom.coral.pastel.map(() => new MeshStandardMaterial({ color: nature.pale, flatShading: true, roughness: 0.85 }));
  const coralParts: BufferGeometry[][] = coralMaterials.map(() => []);
  for (const coral of corals) coralPieces(coral, coralParts);
  coralParts.forEach((parts, i) => {
    const mesh = mergedMesh(parts, coralMaterials[i], `coral-${i}`);
    if (mesh) group.add(mesh);
  });

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

  // Seagrass meadows: every blade an instance of one mesh.
  const blades = meadows.flatMap((meadow) => meadow.blades);
  const bladeGeometry = new ConeGeometry(0.05, 1, 3).translate(0, 0.5, 0).scale(1.8, 1, 0.4);
  const seagrassMaterial = new MeshStandardMaterial({ color: nature.meadows.brown, flatShading: true, roughness: 0.9, side: DoubleSide });
  const meadowMesh = new InstancedMesh(bladeGeometry, seagrassMaterial, Math.max(1, blades.length));
  meadowMesh.name = "meadows";
  // Instances spread over the whole bay; the mesh's own bounding sphere would cull them wrongly.
  meadowMesh.frustumCulled = false;
  group.add(meadowMesh);
  let bladesShown = 0;
  const bladeQuaternion = new Quaternion();
  const bladeEuler = new Object3D();
  const placeBlades = (clarity: number) => {
    const show = nature.meadows.sparse + (1 - nature.meadows.sparse) * clarity;
    const grow = 0.45 + 0.55 * clarity;
    bladesShown = 0;
    blades.forEach((blade, i) => {
      const visible = blade.order < show;
      if (visible) bladesShown++;
      bladeEuler.rotation.set(blade.lean, blade.yaw, 0, "YXZ");
      bladeQuaternion.setFromEuler(bladeEuler.rotation);
      matrix.compose(tmp.set(blade.x, blade.y, blade.z), bladeQuaternion, scale.set(1, visible ? blade.height * grow : 0, 1));
      meadowMesh.setMatrixAt(i, matrix);
    });
    meadowMesh.instanceMatrix.needsUpdate = true;
  };

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
    coralMaterials.forEach((material, i) => {
      const pastel = new Color(bloom.coral.pastel[i]);
      material.color.copy(pale).lerp(pastel, c);
      material.emissive.copy(pastel).multiplyScalar(bloom.coral.glow * c);
    });
    decorMaterials.forEach((material, i) => {
      if (i < 5) material.color.copy(dull).lerp(new Color(decorColours[i]), c);
    });
    seagrassMaterial.color.set(nature.meadows.brown).lerp(new Color(nature.meadows.green), c);
    placeBlades(c);
  };
  setBloom(0);

  return {
    group,
    setBloom,
    update(dt, camera, hidden) {
      time += dt;
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
      return { coral: coralMaterials.map((m) => m.color.getHex()), seagrass: seagrassMaterial.color.getHex(), bladesShown, rays: rayStrength };
    },
  };
}
