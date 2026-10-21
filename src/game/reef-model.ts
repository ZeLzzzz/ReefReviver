import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from "three";
import { config } from "../config";
import { floorHeight } from "./bay";
import { lerp, lerpHex } from "./bloom";
import { frameStatus, patchStatus, type ReefField, type SiteStatus } from "./reef-sites";
import type { Shot } from "./seed-launcher";

const { reef, bay, bloom } = config;

/** The pale colour coral fragments have before the Bloom. */
const PALE_CORAL = 0xd9d3c3;
const YOUNG_SEAGRASS = 0xa6c48a;

/**
 * Stand-ins built from primitives until the artist's GLBs arrive (D-022): a steel and concrete frame, coral
 * fragments in three shapes, seagrass sprouts, and the markers that show every site through the murk (AC-1).
 *
 * Before the Bloom the fragments are small and pale and the seagrass is a sprout. The Bloom (REQ-005) blends the
 * coral to several pastel colours and makes it bigger, and grows each sprout into a tall tuft: see `setBloom`.
 */
export interface ReefView {
  group: Group;
  /** One material for each coral fragment (3 frames x 3 shapes), all pale before the Bloom (REQ-005 colours each one). */
  coralMaterials: MeshStandardMaterial[];
  /** The seagrass material: light green for the sprout, richer green for the adult plant. */
  seagrassMaterial: MeshStandardMaterial;
  /**
   * REQ-005: blends the reef from before the Bloom (0) to after it (1): coral grows and turns pastel, seagrass
   * grows tall. Cheap and idempotent; the game calls it while the Bloom runs.
   */
  setBloom(clarity: number): void;
  /** How big the first coral fragment and the first seagrass sprout are now (relative to their pre-Bloom size 1.4 and 1), for tests. */
  look(): { coralScale: number; seagrassHeight: number };
  /** How opaque each site marker is now, frames first, 0 when hidden (D-052), for tests. */
  markerOpacity(): number[];
  /** Shows the field's current state: frames, fragments, sprouts and markers. Call after something changed. */
  sync(field: ReefField): void;
}

const MARKER = {
  frame: 0xff8a5c,
  patch: 0x7dff9b,
  planted: 0xfff1a8,
};

/** A ring lying on the floor around (0, 0), following the floor's shape; positions are relative to the site. */
function groundRing(centreX: number, centreZ: number, floorY: number, inner: number, outer: number, lift: number): BufferGeometry {
  const geometry = new RingGeometry(inner, outer, 40, 3);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, floorHeight(centreX + position.getX(i), centreZ + position.getZ(i)) - floorY + lift);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function mesh(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const result = new Mesh(geometry, material);
  result.position.set(x, y, z);
  return result;
}

interface Marker {
  group: Group;
  setStatus(status: SiteStatus): void;
  /** D-052: 1 is fully shown, 0 hides the marker. */
  setOpacity(opacity: number): void;
  opacity(): number;
}

/**
 * A beam from the floor up to just under the surface with a shape on top. It ignores the fog, so it shows
 * from across the bay. The shape tells reef sites (a diamond) from seagrass patches (a ball); the state is
 * told by the shape too: an outline when empty, solid once work has started, solid with a halo when planted.
 * The Bloom fades it out (D-052): every site is planted by then, and the clear water makes the beam too loud.
 */
function createMarker(kind: "frame" | "patch", site: { x: number; y: number; z: number }, ringRadius: number): Marker {
  const colour = kind === "frame" ? MARKER.frame : MARKER.patch;
  const basic = new MeshBasicMaterial({ color: colour, fog: false, side: DoubleSide, transparent: true });
  const outline = new MeshBasicMaterial({ color: colour, fog: false, wireframe: true, transparent: true });
  const done = new MeshBasicMaterial({ color: MARKER.planted, fog: false, side: DoubleSide, transparent: true });
  const materials = [basic, outline, done];

  const topY = bay.surfaceY - reef.markerTopDepth - site.y;
  const group = new Group();
  group.add(mesh(groundRing(site.x, site.z, site.y, ringRadius - 0.35, ringRadius, 0.1), basic));
  const beam = mesh(new CylinderGeometry(0.13, 0.13, topY, 6), basic, 0, topY / 2, 0);
  group.add(beam);

  const shape = (): BufferGeometry => (kind === "frame" ? new OctahedronGeometry(1.1, 0) : new SphereGeometry(0.85, 10, 7));
  const solid = mesh(shape(), basic, 0, topY, 0);
  const wire = mesh(shape(), outline, 0, topY, 0);
  const halo = mesh(new TorusGeometry(1.5, 0.12, 6, 20), done, 0, topY, 0);
  halo.rotation.x = Math.PI / 2;
  group.add(solid, wire, halo);

  return {
    group,
    setStatus(status) {
      wire.visible = status === "empty";
      solid.visible = status !== "empty";
      halo.visible = status === "planted";
      solid.material = status === "planted" ? done : basic;
      beam.material = status === "planted" ? done : basic;
    },
    setOpacity(opacity) {
      for (const material of materials) material.opacity = opacity;
      group.visible = opacity > 0;
    },
    opacity: () => (group.visible ? basic.opacity : 0),
  };
}

/** The installed frame: a concrete slab, steel posts, top beams and two braces. 1.6 m tall. */
function createFrameModel(): Group {
  const concrete = new MeshStandardMaterial({ color: 0x9b9a92, flatShading: true, roughness: 1 });
  const steel = new MeshStandardMaterial({ color: 0x48535a, flatShading: true, roughness: 0.6, metalness: 0.3 });
  const group = new Group();
  group.add(mesh(new BoxGeometry(2.7, 0.5, 2.7), concrete, 0, 0, 0));
  const post = new BoxGeometry(0.18, 1.45, 0.18);
  const rail = (length: number) => new BoxGeometry(length, 0.16, 0.16);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) group.add(mesh(post, steel, sx * 1.05, 0.25 + 0.725, sz * 1.05));
  }
  for (const s of [-1, 1]) {
    group.add(mesh(rail(2.28), steel, 0, 1.55, s * 1.05));
    const side = mesh(rail(2.28), steel, s * 1.05, 1.55, 0);
    side.rotation.y = Math.PI / 2;
    group.add(side);
  }
  const brace = mesh(new BoxGeometry(2.6, 0.1, 0.1), steel, 0, 0.95, 1.05);
  brace.rotation.z = 0.62;
  const braceBack = mesh(new BoxGeometry(2.6, 0.1, 0.1), steel, 0, 0.95, -1.05);
  braceBack.rotation.z = -0.62;
  group.add(brace, braceBack);
  group.add(mesh(new BoxGeometry(0.9, 0.5, 0.9), concrete, -0.3, 0.5, 0.2));
  return group;
}

const FRAGMENT_SCALE = 1.4;

/** Where fragment 0, 1 and 2 attach (on the frame's top beams), relative to the site. */
const FRAGMENT_SPOTS: readonly [number, number, number][] = [
  [-0.7, 1.63, 1.05],
  [1.05, 1.63, -0.3],
  [-0.2, 1.63, -1.05],
];

/** Small and pale before the Bloom, in three shapes: a branching clump, a dome and a table. */
function createFragmentModel(shape: number, material: MeshStandardMaterial): Group {
  const group = new Group();
  if (shape === 0) {
    const branch = new ConeGeometry(0.07, 0.38, 5);
    for (const [x, z, tilt] of [[0, 0, 0], [0.1, 0.04, 0.4], [-0.09, -0.05, -0.45]] as const) {
      const part = mesh(branch, material, x, 0.19, z);
      part.rotation.z = tilt;
      group.add(part);
    }
  } else if (shape === 1) {
    group.add(mesh(new IcosahedronGeometry(0.2, 0).scale(1, 0.7, 1), material, 0, 0.12, 0));
  } else {
    group.add(mesh(new CylinderGeometry(0.06, 0.06, 0.2, 6), material, 0, 0.1, 0));
    group.add(mesh(new CylinderGeometry(0.26, 0.2, 0.08, 7), material, 0, 0.24, 0));
  }
  return group;
}

/** Where seed 0, 1 and 2 sprout inside a patch, relative to its centre. */
function sproutSpots(): [number, number][] {
  return [0, 1, 2].map((i) => [Math.cos(i * 2.1 + 0.4) * 1.1, Math.sin(i * 2.1 + 0.4) * 1.1]);
}

interface Sprout {
  group: Group;
  /** The blades that only exist once the plant is adult; they grow out of nothing during the Bloom. */
  extra: Mesh[];
}

/** A small sprout: three thin blades, plus a few more that appear while it grows into an adult tuft (REQ-005). */
function createSproutModel(material: MeshStandardMaterial): Sprout {
  const group = new Group();
  const blade = new ConeGeometry(0.07, 0.6, 4);
  for (const [x, z, tilt] of [[0, 0, 0], [0.08, 0.03, 0.35], [-0.07, -0.04, -0.3]] as const) {
    const part = mesh(blade, material, x, 0.3, z);
    part.rotation.z = tilt;
    group.add(part);
  }
  const extra: Mesh[] = [];
  for (let i = 0; i < bloom.seagrass.extraBlades; i++) {
    const angle = (i / bloom.seagrass.extraBlades) * Math.PI * 2 + 0.5;
    const spread = 0.1 + 0.05 * (i % 2);
    const part = mesh(blade, material, Math.cos(angle) * spread, 0.3, Math.sin(angle) * spread);
    // Lean away from the middle, so the tuft fans out.
    part.rotation.set(Math.sin(angle) * (0.25 + 0.1 * (i % 3)), 0, -Math.cos(angle) * (0.25 + 0.1 * (i % 3)));
    part.visible = false;
    group.add(part);
    extra.push(part);
  }
  return { group, extra };
}

export function createReefView(field: ReefField): ReefView {
  const seagrassMaterial = new MeshStandardMaterial({ color: YOUNG_SEAGRASS, flatShading: true, roughness: 0.9 });
  // Each fragment has its own material, so the Bloom can give every one its own pastel colour.
  const coralMaterials = field.frames.flatMap(() => FRAGMENT_SPOTS.map(() => new MeshStandardMaterial({ color: PALE_CORAL, flatShading: true, roughness: 0.9 })));
  const sandPatch = new MeshStandardMaterial({ color: 0x9c9772, flatShading: true, roughness: 1 });
  const group = new Group();

  const frames = field.frames.map((site, frameIndex) => {
    const siteGroup = new Group();
    siteGroup.position.set(site.x, site.y, site.z);
    const model = createFrameModel();
    // The slab sits a little below the floor, so a bumpy floor never leaves a gap under it.
    model.position.y = -0.05;
    const fragments = FRAGMENT_SPOTS.map((spot, shape) => {
      const fragment = createFragmentModel(shape, coralMaterials[frameIndex * FRAGMENT_SPOTS.length + shape]);
      fragment.position.set(...spot);
      fragment.scale.setScalar(FRAGMENT_SCALE);
      fragment.rotation.y = shape * 1.9;
      siteGroup.add(fragment);
      return fragment;
    });
    const marker = createMarker("frame", site, reef.interactRadius);
    siteGroup.add(model, marker.group);
    group.add(siteGroup);
    return { model, fragments, marker };
  });

  const patches = field.patches.map((site) => {
    const siteGroup = new Group();
    siteGroup.position.set(site.x, site.y, site.z);
    siteGroup.add(mesh(groundRing(site.x, site.z, site.y, 0, reef.patchRadius, 0.07), sandPatch));
    const sprouts = sproutSpots().map(([x, z], i) => {
      const sprout = createSproutModel(seagrassMaterial);
      sprout.group.position.set(x, floorHeight(site.x + x, site.z + z) - site.y, z);
      sprout.group.rotation.y = i * 2.3;
      siteGroup.add(sprout.group);
      return sprout;
    });
    const marker = createMarker("patch", site, reef.patchRadius + 0.6);
    siteGroup.add(marker.group);
    group.add(siteGroup);
    return { sprouts, marker };
  });

  return {
    group,
    coralMaterials,
    seagrassMaterial,
    look: () => ({ coralScale: frames[0].fragments[0].scale.y / FRAGMENT_SCALE, seagrassHeight: patches[0].sprouts[0].group.scale.y }),
    markerOpacity: () => [...frames, ...patches].map((view) => view.marker.opacity()),
    setBloom(clarity) {
      const pastel = bloom.coral.pastel;
      const grow = lerp(1, bloom.coral.scale, clarity);
      frames.forEach((view, f) => {
        view.fragments.forEach((fragment, n) => {
          fragment.scale.setScalar(FRAGMENT_SCALE * grow);
          const material = coralMaterials[f * FRAGMENT_SPOTS.length + n];
          // Neighbouring fragments get different colours, so each frame is multi-coloured.
          const colour = pastel[(f * 2 + n) % pastel.length];
          material.color.setHex(lerpHex(PALE_CORAL, colour, clarity));
          material.emissive.setHex(colour).multiplyScalar(bloom.coral.glow * clarity);
        });
      });
      seagrassMaterial.color.setHex(lerpHex(YOUNG_SEAGRASS, bloom.seagrass.color, clarity));
      const height = lerp(1, bloom.seagrass.heightScale, clarity);
      const width = lerp(1, bloom.seagrass.widthScale, clarity);
      for (const patch of patches) {
        for (const sprout of patch.sprouts) {
          sprout.group.scale.set(width, height, width);
          for (const blade of sprout.extra) {
            blade.visible = clarity > 0;
            blade.scale.setScalar(Math.max(clarity, 0.001));
          }
        }
      }
      for (const view of [...frames, ...patches]) view.marker.setOpacity(1 - clarity);
    },
    sync(current) {
      current.frames.forEach((site, i) => {
        const view = frames[i];
        view.model.visible = site.installed;
        view.fragments.forEach((fragment, n) => (fragment.visible = site.installed && n < site.fragments));
        view.marker.setStatus(frameStatus(site));
      });
      current.patches.forEach((site, i) => {
        const view = patches[i];
        view.sprouts.forEach((sprout, n) => (sprout.group.visible = n < site.seeds));
        view.marker.setStatus(patchStatus(site));
      });
    },
  };
}

export interface ShotView {
  group: Group;
  sync(shots: readonly Shot[]): void;
}

/** The seed launcher's shots: small bright seeds. */
export function createShotView(): ShotView {
  const group = new Group();
  const geometry = new IcosahedronGeometry(0.14, 0);
  const material = new MeshBasicMaterial({ color: 0xd8ffb0 });
  const meshes: Mesh[] = [];
  return {
    group,
    sync(shots) {
      while (meshes.length < shots.length) {
        const shot = new Mesh(geometry, material);
        meshes.push(shot);
        group.add(shot);
      }
      meshes.forEach((shot, i) => {
        shot.visible = i < shots.length;
        if (i < shots.length) shot.position.copy(shots[i].position);
      });
    },
  };
}
