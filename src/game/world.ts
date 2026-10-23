import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  type Scene,
  TorusGeometry,
  type Vector3,
} from "three";
import { assets } from "../assets";
import { config } from "../config";
import { arches, boulders, floorHeight, floorSlope, rocks, type Arch, type Boulder } from "./bay";
import { wallness } from "./terrain";
import { waterAt } from "./bloom";
import { compactGroup, hasMesh } from "./model-utils";

const { bay, water } = config;

/** Builds a low-poly multi-boulder rock outcrop in a unit radius so (rock.size, rock.height, rock.size) matches collision. */
export function buildRockMesh(variant: number): Group {
  const primary = new MeshStandardMaterial({ color: 0x7a7466, flatShading: true, roughness: 0.95 });
  const dark = new MeshStandardMaterial({ color: 0x635d50, flatShading: true, roughness: 1 });
  const ledge = new MeshStandardMaterial({ color: 0x8c8574, flatShading: true, roughness: 0.9 });

  const group = new Group();
  group.name = `rock-${variant % 3}`;

  const core = new Mesh(new DodecahedronGeometry(0.92, 0), primary);
  core.rotation.set(variant * 0.7, variant * 1.1, variant * 0.4);
  group.add(core);

  if (variant % 3 === 0) {
    const shoulder = new Mesh(new IcosahedronGeometry(0.62, 0), ledge);
    shoulder.position.set(0.32, -0.18, 0.24);
    shoulder.scale.set(1.1, 0.75, 0.95);
    const spire = new Mesh(new DodecahedronGeometry(0.5, 0), dark);
    spire.position.set(-0.28, 0.25, -0.18);
    spire.scale.set(0.8, 1.15, 0.8);
    group.add(shoulder, spire);
  } else if (variant % 3 === 1) {
    const slab = new Mesh(new DodecahedronGeometry(0.68, 0), dark);
    slab.position.set(-0.3, -0.15, 0.25);
    slab.scale.set(1.15, 0.65, 1.0);
    const crest = new Mesh(new IcosahedronGeometry(0.54, 0), ledge);
    crest.position.set(0.22, 0.28, -0.2);
    group.add(slab, crest);
  } else {
    const terraceA = new Mesh(new DodecahedronGeometry(0.64, 0), ledge);
    terraceA.position.set(0.26, -0.22, -0.28);
    terraceA.scale.set(1.1, 0.6, 1.1);
    const terraceB = new Mesh(new IcosahedronGeometry(0.56, 0), dark);
    terraceB.position.set(-0.26, 0.12, 0.26);
    group.add(terraceA, terraceB);
  }
  return compactGroup(group);
}

const TERRAIN_STEP = 2.5;
const TERRAIN_CHUNKS = 4;

const sandLight = new Color(0xc2b48e);
const sandDeep = new Color(0x8f8464);
const algae = new Color(0x6f7d48);
const rockLight = new Color(0x8a826f);
const rockDark = new Color(0x5b5548);
const beach = new Color(0xd8c690);
const land = new Color(0x9c8e60);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The ground's colour at a point: sand on the flats (darker deeper down), algae turf on gentle hill tops, rock on
 * steep slopes and the walls, and beach and land above the water (REQ-011).
 */
function groundColour(x: number, y: number, z: number, out: Color): Color {
  const slope = floorSlope(x, z);
  const ripple = 0.5 + 0.5 * Math.sin(x * 0.35 + z * 0.25) * Math.cos(z * 0.4 - x * 0.15);
  const strata = 0.5 + 0.5 * Math.sin(y * 1.4 + Math.sin(x * 0.11 + z * 0.07) * 2);
  if (y > 0.2 && wallness(x, z) < 0.3) return out.copy(beach).lerp(land, smoothstep(1, 3, y));
  out.copy(sandDeep).lerp(sandLight, smoothstep(-24, -10, y)).lerp(sandLight, ripple * 0.25);
  out.lerp(algae, smoothstep(-12.5, -9.5, y) * (1 - smoothstep(0.2, 0.45, slope)) * 0.85);
  const rocky = Math.max(smoothstep(0.55, 1.1, slope), wallness(x, z));
  return out.lerp(tmpRock.copy(rockDark).lerp(rockLight, strata), rocky);
}
const tmpRock = new Color();

/** The terrain in TERRAIN_CHUNKS x TERRAIN_CHUNKS meshes, so the ones out of view are skipped when drawing. */
export function buildTerrainChunks(): Mesh[] {
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const span = (bay.halfSize * 2) / TERRAIN_CHUNKS;
  const segments = Math.round(span / TERRAIN_STEP);
  const colour = new Color();
  const meshes: Mesh[] = [];
  for (let i = 0; i < TERRAIN_CHUNKS; i++) {
    for (let j = 0; j < TERRAIN_CHUNKS; j++) {
      const cx = -bay.halfSize + span * (i + 0.5);
      const cz = -bay.halfSize + span * (j + 0.5);
      const geometry = new PlaneGeometry(span, span, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(cx, 0, cz);
      const position = geometry.attributes.position;
      const colors = new Float32Array(position.count * 3);
      for (let k = 0; k < position.count; k++) {
        const x = position.getX(k);
        const z = position.getZ(k);
        const y = floorHeight(x, z);
        position.setY(k, y);
        groundColour(x, y, z, colour);
        colors[k * 3] = colour.r;
        colors[k * 3 + 1] = colour.g;
        colors[k * 3 + 2] = colour.b;
      }
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.name = `terrain-${i}-${j}`;
      meshes.push(mesh);
    }
  }
  return meshes;
}

/** A repeatable pseudo-random number in -1..1 for a point, so vertices shared by two faces move together. */
function hash(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

/** One tier of a boulder: a rough upright cylinder of unit radius and height, flat on top, never wider than 1. */
function buildTierGeometry(seed: number): CylinderGeometry {
  const geometry = new CylinderGeometry(0.97, 1, 1, 9, 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const radial = Math.hypot(x, z);
    if (radial < 1e-6) continue;
    const k = 0.93 + 0.07 * (0.5 + 0.5 * hash(x + seed, y, z));
    position.setXYZ(i, x * k, y < 0.49 ? y + 0.06 * hash(z, x + seed, y) : y, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A flat-topped boulder in tiers, matching its collision cylinders (REQ-011 AC-1, AC-3). */
export function buildBoulderMesh(boulder: Boulder, seed: number): Group {
  const group = new Group();
  group.name = "boulder";
  boulder.tiers.forEach((tier, index) => {
    const material = new MeshStandardMaterial({ color: index === 0 ? 0x766f60 : 0x8a8372, flatShading: true, roughness: 0.95 });
    const mesh = new Mesh(buildTierGeometry(seed * 3 + index), material);
    mesh.scale.set(tier.radius, tier.height, tier.radius);
    mesh.position.set(boulder.x, tier.baseY + tier.height / 2, boulder.z);
    mesh.rotation.y = seed * 1.3 + index;
    group.add(mesh);
  });
  return group;
}

/** A rock arch: half a rough ring standing on the floor, turned so its opening faces along its yaw (REQ-011 AC-3). */
export function buildArchMesh(arch: Arch, seed: number): Mesh {
  const geometry = new TorusGeometry(arch.radius, arch.tube, 7, 18, Math.PI);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const k = arch.tube * 0.12;
    position.setXYZ(i, x + k * hash(x + seed, y, z), y + k * hash(y, z + seed, x), z + k * hash(z, x, y + seed));
  }
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0x7c7563, flatShading: true, roughness: 0.95 }));
  mesh.name = "arch";
  mesh.position.set(arch.x, arch.y, arch.z);
  mesh.rotation.y = arch.yaw;
  return mesh;
}

function addTerrain(scene: Scene): void {
  for (const mesh of buildTerrainChunks()) scene.add(mesh);
  boulders.forEach((boulder, index) => scene.add(buildBoulderMesh(boulder, index)));
  arches.forEach((arch, index) => scene.add(buildArchMesh(arch, index)));
}

function addRocks(scene: Scene): void {
  rocks.forEach((rock, index) => {
    const id = `rock-${index % 3}`;
    const loaded = assets.model(id);
    const model = loaded && hasMesh(loaded) ? loaded : buildRockMesh(index % 3);
    model.position.set(rock.x, rock.y, rock.z);
    model.scale.set(rock.size, rock.height, rock.size);
    model.rotation.y = rock.rotation;
    scene.add(model);
  });
}
function addSurface(scene: Scene): MeshBasicMaterial {
  const geometry = new PlaneGeometry(bay.halfSize * 2 + 40, bay.halfSize * 2 + 40);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, bay.surfaceY, 0);
  const material = new MeshBasicMaterial({ color: water.murky.surfaceColor, transparent: true, opacity: 0.5, side: DoubleSide });
  scene.add(new Mesh(geometry, material));
  return material;
}

/** Drifting particles ("marine snow") around the camera, so the murky water reads as water. */
function addMarineSnow(scene: Scene): { update: (dt: number, around: Vector3) => void; material: PointsMaterial } {
  const half = 15;
  const positions = new Float32Array(water.snowCount * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() * 2 - 1) * half;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new PointsMaterial({ color: 0xdfe6d8, size: 0.06, transparent: true, opacity: water.murky.snowOpacity });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  const wrap = (value: number, centre: number) => centre - half + ((((value - centre + half) % (half * 2)) + half * 2) % (half * 2));
  const update = (dt: number, around: Vector3) => {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] -= 0.15 * dt;
      positions[i] = wrap(positions[i], around.x);
      positions[i + 1] = wrap(positions[i + 1], around.y);
      positions[i + 2] = wrap(positions[i + 2], around.z);
    }
    geometry.attributes.position.needsUpdate = true;
  };
  return { update, material };
}

export interface World {
  /** Advances ambient motion; `around` is the camera position. */
  update(dt: number, around: Vector3): void;
  /** REQ-005: 0 is the murky bay, 1 is the clear water after the Bloom; water, fog, light and snow blend by it. */
  setClarity(clarity: number): void;
}

/** The bay before the Bloom: murky green-grey water with short visibility (REQ-001 AC-3). */
export function buildWorld(scene: Scene): World {
  const murk = new Color(water.murky.color);
  scene.background = murk;
  scene.fog = new Fog(murk, water.murky.fogNear, water.murky.fogFar);

  const hemisphere = new HemisphereLight(water.murky.hemiSky, 0x4a4636, water.murky.hemiIntensity);
  scene.add(hemisphere);
  const sun = new DirectionalLight(0xffffff, water.murky.sunIntensity);
  sun.position.set(10, 30, 5);
  scene.add(sun);

  addTerrain(scene);
  addRocks(scene);
  const surface = addSurface(scene);
  const snow = addMarineSnow(scene);
  const fog = scene.fog as Fog;

  return {
    update: snow.update,
    setClarity(clarity) {
      const look = waterAt(clarity);
      murk.setHex(look.color);
      fog.color.setHex(look.color);
      fog.near = look.fogNear;
      fog.far = look.fogFar;
      hemisphere.color.setHex(look.hemiSky);
      hemisphere.intensity = look.hemiIntensity;
      sun.intensity = look.sunIntensity;
      snow.material.opacity = look.snowOpacity;
      surface.color.setHex(look.surfaceColor);
    },
  };
}
