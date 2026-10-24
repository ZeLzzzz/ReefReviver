import {
  AdditiveBlending,
  DataTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { config } from "../config";
import { smoothstep } from "./bloom";
import { createCoralView } from "./coral-model";
import { createDecorView } from "./decor-model";
import { meadows, type Decor } from "./nature";
import { createSeagrassView } from "./seagrass-model";

const { nature } = config;

/** What the natural reef shows (REQ-013): pale coral, sparse brown seagrass and no light rays until the Bloom. */
export interface NatureView {
  group: Group;
  /** 0 is the murky bay, 1 the clear water after the Bloom (AC-2, AC-3, AC-8). */
  setBloom(clarity: number): void;
  /** Moves the light rays along with the camera; `hidden` (above the water, in the cave) hides them. */
  update(dt: number, camera: Vector3, hidden: boolean): void;
  /** REQ-021 AC-6: this dive's trash, so no decoration is put over it. */
  setTrash(spots: readonly Vector3[]): void;
  /** The decoration shown now. */
  decorItems(): readonly Decor[];
  /** For the tests: the colours of the coral and the seagrass, how many blades show and exist, the sand tint under the meadows, how bright the rays are, and the decoration. */
  look(): { coral: number[]; seagrass: number; bladesShown: number; blades: number; sand: number; sandOpacity: number; rays: number; decor: { shown: number; colours: number[] } };
}

function hash(n: number): number {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** A broad, soft ribbon of scattered light, with no visible cylindrical walls or hard lower edge. */
function rayGeometry(): PlaneGeometry {
  const geometry = new PlaneGeometry(5.6, 24, 1, 4);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const height = (position.getY(i) + 12) / 24;
    position.setX(i, position.getX(i) * (1 - 0.65 * height));
  }
  geometry.translate(0, -12, 0);
  return geometry;
}

/** A small procedural opacity mask shared by all rays; its sides and both ends fade completely. */
function rayTexture(): DataTexture {
  const width = 32;
  const height = 64;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    const vertical = smoothstep(v / 0.3) * smoothstep((1 - v) / 0.12) * (0.25 + 0.75 * v);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const softEdge = Math.pow(Math.sin(Math.PI * u), 2.5);
      const streak = 0.7 + 0.3 * Math.sin(u * 19 + v * 3);
      const offset = (y * width + x) * 4;
      pixels.set([225, 244, 255, Math.round(255 * softEdge * vertical * streak)], offset);
    }
  }
  const texture = new DataTexture(pixels, width, height);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** REQ-013: the natural coral, the seagrass meadows, the sponges, sea fans and algae, and the light rays. */
export function createNatureView(): NatureView {
  const group = new Group();
  group.name = "nature";

  // Coral (REQ-020): colonies as instanced meshes, in their own module.
  const coralView = createCoralView();
  group.add(coralView.group);

  // Decoration (REQ-021): tropical algae, barrel sponges and sea fans, each where it grows.
  const decorView = createDecorView();
  group.add(decorView.group);

  // Seagrass meadows (REQ-019): the leaves and the sand tint under them, in their own module.
  const seagrass = createSeagrassView(meadows);
  group.add(seagrass.group);

  // Light rays from the surface after the Bloom, kept around the camera. Each has its own material, so a ray close to
  // the camera can fade out instead of filling the screen.
  const geometry = rayGeometry();
  const texture = rayTexture();
  const rays = Array.from({ length: nature.rays.count }, (_, i) => {
    const material = new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
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
    coralView.setBloom(value);
    decorView.setBloom(value);
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
        // Turn only around the vertical axis; the shaft keeps its slope and stays broad from every viewing direction.
        ray.rotation.y = Math.atan2(camera.x - ray.position.x, camera.z - ray.position.z);
        // Faded out within a few metres of the camera, so a ray never covers the view.
        const near = smoothstep((Math.hypot(ray.position.x - camera.x, ray.position.z - camera.z) - 5) / 10);
        (ray.material as MeshBasicMaterial).opacity = strength * near;
      }
      rayStrength = shown ? strength : 0;
    },
    setTrash(spots) {
      decorView.setTrash(spots);
    },
    decorItems: () => decorView.shown(),
    look() {
      const { seagrass: leaf, bladesShown, blades, sand, sandOpacity } = seagrass.look();
      return { coral: coralView.materials.map((m) => m.color.getHex()), seagrass: leaf, bladesShown, blades, sand, sandOpacity, rays: rayStrength, decor: decorView.look() };
    },
  };
}
