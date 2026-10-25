import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
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
import { headland } from "./terrain";
import { caveLevel } from "./cave";
import { waterAt } from "./bloom";
import { createGrassView, type GrassView } from "./grass-model";
import { compactGroup, hasMesh } from "./model-utils";

const { bay, water, land } = config;
const caveFog = new Color(config.bay.cave.dark.fogColor);
const caveSky = new Color(config.bay.cave.dark.sky);

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
const dryLand = new Color(0x9c8e60);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The ground's colour at a point: sand on the flats (darker deeper down), algae turf on gentle hill tops, rock on
 * steep slopes and the headlands, and beach and land above the water (REQ-011).
 */
function groundColour(x: number, y: number, z: number, out: Color): Color {
  const slope = floorSlope(x, z);
  const ripple = 0.5 + 0.5 * Math.sin(x * 0.35 + z * 0.25) * Math.cos(z * 0.4 - x * 0.15);
  const strata = 0.5 + 0.5 * Math.sin(y * 1.4 + Math.sin(x * 0.11 + z * 0.07) * 2);
  // On the land, rock shows on the cliff that closes it at the west (REQ-015).
  if (y > 0.2 && headland(x, z) < 0.3) return out.copy(beach).lerp(dryLand, smoothstep(1, 3, y)).lerp(tmpRock.copy(rockDark).lerp(rockLight, strata), smoothstep(0.6, 1.2, slope));
  out.copy(sandDeep).lerp(sandLight, smoothstep(-24, -10, y)).lerp(sandLight, ripple * 0.25);
  out.lerp(algae, smoothstep(-12.5, -9.5, y) * (1 - smoothstep(0.2, 0.45, slope)) * 0.85);
  const rocky = Math.max(smoothstep(0.55, 1.1, slope), headland(x, z));
  return out.lerp(tmpRock.copy(rockDark).lerp(rockLight, strata), rocky);
}
const tmpRock = new Color();

/** REQ-022: the coarse terrain around the detailed one is made of squares this wide (an exact fraction of the detailed side). */
const OUTER_STEP = (bay.halfSize * 2) / 30;
const OUTER_RINGS = Math.round((bay.outerSize - bay.halfSize) / OUTER_STEP);
const OUTER_HALF = bay.halfSize + OUTER_RINGS * OUTER_STEP;

/** The detailed terrain's own outer edge follows the straight lines between the coarse terrain's corners, so no crack opens between them. */
function onCoarseEdge(x: number, z: number): number | null {
  const coarse = (t: number) => {
    const k = Math.floor((t + bay.halfSize) / OUTER_STEP);
    const t0 = -bay.halfSize + k * OUTER_STEP;
    return [t0, t0 + OUTER_STEP, (t - t0) / OUTER_STEP] as const;
  };
  const edgeX = Math.abs(Math.abs(x) - bay.halfSize) < 1e-6;
  const edgeZ = Math.abs(Math.abs(z) - bay.halfSize) < 1e-6;
  if (edgeX === edgeZ) return null;
  const [a, b, k] = coarse(edgeX ? z : x);
  const at = (t: number) => (edgeX ? floorHeight(x, t) : floorHeight(t, z));
  return at(a) + (at(b) - at(a)) * k;
}

/** Sets a flat grid's heights to the floor's, and colours it (REQ-014: the tunnel's floor is in shadow). */
function shapeTerrain(geometry: BufferGeometry, stitch: boolean): void {
  const colour = new Color();
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let k = 0; k < position.count; k++) {
    const x = position.getX(k);
    const z = position.getZ(k);
    const y = floorHeight(x, z);
    position.setY(k, stitch ? (onCoarseEdge(x, z) ?? y) : y);
    groundColour(x, y, z, colour);
    colour.multiplyScalar(1 - 0.45 * caveLevel(x, y + 0.05, z));
    colors[k * 3] = colour.r;
    colors[k * 3 + 1] = colour.g;
    colors[k * 3 + 2] = colour.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

/**
 * The terrain in TERRAIN_CHUNKS x TERRAIN_CHUNKS detailed meshes, so the ones out of view are skipped when drawing, and a
 * ring of four coarse meshes round them (REQ-022 AC-1): the floor goes on, dropping away into deep water, far enough that
 * the water's fog hides its end from anywhere in the dive area.
 */
export function buildTerrainChunks(): Mesh[] {
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const span = (bay.halfSize * 2) / TERRAIN_CHUNKS;
  const segments = Math.round(span / TERRAIN_STEP);
  const meshes: Mesh[] = [];
  const add = (name: string, width: number, depth: number, cx: number, cz: number, columns: number, rows: number, stitch: boolean) => {
    const geometry = new PlaneGeometry(width, depth, columns, rows);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(cx, 0, cz);
    shapeTerrain(geometry, stitch);
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    meshes.push(mesh);
  };
  for (let i = 0; i < TERRAIN_CHUNKS; i++) {
    for (let j = 0; j < TERRAIN_CHUNKS; j++) {
      const cx = -bay.halfSize + span * (i + 0.5);
      const cz = -bay.halfSize + span * (j + 0.5);
      add(`terrain-${i}-${j}`, span, span, cx, cz, segments, segments, true);
    }
  }
  const band = OUTER_HALF - bay.halfSize;
  const middle = (OUTER_HALF + bay.halfSize) / 2;
  const across = Math.round((OUTER_HALF * 2) / OUTER_STEP);
  const along = Math.round((bay.halfSize * 2) / OUTER_STEP);
  const rings = OUTER_RINGS;
  add("terrain-outer-north", OUTER_HALF * 2, band, 0, -middle, across, rings, false);
  add("terrain-outer-south", OUTER_HALF * 2, band, 0, middle, across, rings, false);
  add("terrain-outer-west", band, bay.halfSize * 2, -middle, 0, rings, along, false);
  add("terrain-outer-east", band, bay.halfSize * 2, middle, 0, rings, along, false);
  return meshes;
}

/** A repeatable pseudo-random number in -1..1 for a point, so vertices shared by two faces move together. */
function hash(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

/** One broken rock outcrop, drawn from the same faces the submarine and coral placement use. */
export function buildBoulderMesh(boulder: Boulder, seed: number): Group {
  const group = new Group();
  group.name = "boulder";
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(boulder.vertices.flatMap((p) => [p.x, p.y, p.z]), 3));
  geometry.setIndex([...boulder.indices]);
  const colors: number[] = [];
  const dark = new Color(0x494e49);
  const stone = new Color(0x92948a);
  const film = new Color(0x7e8b69);
  const colour = new Color();
  boulder.vertices.forEach((p) => {
    const level = (p.y - boulder.baseY) / (boulder.topY - boulder.baseY);
    colour.copy(dark).lerp(stone, 0.2 + level * 0.7);
    colour.lerp(film, Math.max(0, level - 0.45) * 0.4);
    colour.multiplyScalar(0.9 + 0.1 * hash(p.x + seed, p.y, p.z));
    colors.push(colour.r, colour.g, colour.b);
  });
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  group.add(new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })));
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
/** REQ-022 AC-2: the sea's surface reaches this far each way from the bay's centre, well past the horizon of the haze, so no edge shows. */
const SEA_HALF = 3000;

function addSurface(scene: Scene): MeshBasicMaterial {
  const geometry = new PlaneGeometry(SEA_HALF * 2, SEA_HALF * 2);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, bay.surfaceY, 0);
  const material = new MeshBasicMaterial({ color: water.murky.surfaceColor, transparent: true, opacity: 0.5, side: DoubleSide });
  scene.add(new Mesh(geometry, material));
  return material;
}

/** Drifting particles ("marine snow") around the camera, so the murky water reads as water. */
function addMarineSnow(scene: Scene): { update: (dt: number, around: Vector3) => void; material: PointsMaterial; points: Points } {
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
  return { update, material, points };
}

/** A coconut palm on the land (D-081): a trunk curving toward the sea, a crown of fronds and a few coconuts. */
export function buildPalmMesh(height: number, lean: number, seed: number): Group {
  const bark = new MeshStandardMaterial({ color: 0x8a6b4a, flatShading: true, roughness: 0.95 });
  const leaf = new MeshStandardMaterial({ color: 0x4f8a3c, flatShading: true, roughness: 0.9, side: DoubleSide });
  const nut = new MeshStandardMaterial({ color: 0x6b4a2a, flatShading: true, roughness: 0.8 });
  const palm = new Group();
  palm.name = "palm";
  const segments = 5;
  const length = height / segments;
  // The trunk bends a little more with each segment, leaning toward +X (the sea, once turned into place).
  let x = 0;
  let y = 0;
  let angle = 0;
  for (let i = 0; i < segments; i++) {
    angle += lean / segments * (1 + i * 0.35);
    const piece = new Mesh(new CylinderGeometry(0.17 - i * 0.012, 0.22 - i * 0.012, length * 1.04, 6), bark);
    piece.position.set(x + (Math.sin(angle) * length) / 2, y + (Math.cos(angle) * length) / 2, 0);
    piece.rotation.z = -angle;
    palm.add(piece);
    x += Math.sin(angle) * length;
    y += Math.cos(angle) * length;
  }
  for (let i = 0; i < 7; i++) {
    const around = (i / 7) * Math.PI * 2 + seed;
    const frond = new Mesh(new ConeGeometry(0.42, 3.2, 3), leaf);
    frond.geometry.translate(0, 1.6, 0);
    frond.scale.set(1, 1, 0.18);
    frond.position.set(x, y, 0);
    frond.rotation.set(0, around, 1.15 + 0.15 * Math.sin(seed + i * 1.7), "YXZ");
    palm.add(frond);
  }
  for (let i = 0; i < 3; i++) {
    const coconut = new Mesh(new IcosahedronGeometry(0.16, 0), nut);
    coconut.position.set(x + Math.cos(i * 2.1 + seed) * 0.22, y - 0.25, Math.sin(i * 2.1 + seed) * 0.22);
    palm.add(coconut);
  }
  return palm;
}

/** The palms and the rocks on the land (REQ-015). */
function addLand(scene: Scene): void {
  config.land.palms.forEach((spec, index) => {
    const palm = buildPalmMesh(spec.height, spec.lean, index * 1.37);
    palm.position.set(spec.x, floorHeight(spec.x, spec.z) - 0.1, spec.z);
    // The trunk was built leaning toward +X; turn it a little either way, still facing the sea in the east.
    palm.rotation.y = 0.5 * Math.sin(index * 2.3);
    scene.add(palm);
  });
  config.land.rocks.forEach((spec, index) => {
    const rock = buildRockMesh(index);
    rock.position.set(spec.x, floorHeight(spec.x, spec.z) + spec.radius * 0.15, spec.z);
    rock.scale.set(spec.radius, spec.radius * 0.7, spec.radius);
    rock.rotation.y = index * 1.9;
    scene.add(rock);
  });
}

export interface World {
  /** Advances ambient motion; `around` is the camera position. */
  update(dt: number, around: Vector3): void;
  /** REQ-005: 0 is the murky bay, 1 is the clear water after the Bloom; water, fog, light and snow blend by it. */
  setClarity(clarity: number): void;
  /** REQ-015: true while the camera is above the water: sky, sun and daylight haze instead of the water's fog. */
  setAbove(above: boolean): void;
  /** REQ-014: 0 in open water, 1 deep in the cave: the light, the fog and the marine snow darken by it, Bloom or not. */
  setCave(level: number): void;
  /** REQ-018: the grass on the land, which sways in the wind and never changes colour. */
  grass: GrassView;
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
  addLand(scene);
  const grass = createGrassView();
  scene.add(grass.mesh);
  const surface = addSurface(scene);
  const snow = addMarineSnow(scene);
  const fog = scene.fog as Fog;
  // REQ-015: the sun's disk, seen from the land; kept far away along the light's direction.
  const sunDisk = new Mesh(new CircleGeometry(14, 24), new MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
  sunDisk.visible = false;
  scene.add(sunDisk);
  const sunDirection = sun.position.clone().normalize();

  let clarity = 0;
  let above = false;
  let cave = 0;
  const apply = () => {
    const look = waterAt(clarity);
    snow.points.visible = !above;
    sunDisk.visible = above;
    if (above) {
      // Daylight over the bay: a sky-coloured haze, and the sea seen from above in the water's own colour.
      murk.setHex(land.sky);
      fog.color.setHex(land.sky);
      fog.near = land.hazeNear;
      fog.far = land.hazeFar;
      hemisphere.color.setHex(0xe6f6ff);
      hemisphere.intensity = 2.1;
      sun.intensity = 2.4;
      surface.color.setHex(look.color);
      surface.opacity = land.seaOpacity;
      return;
    }
    // REQ-014: inside the cave the water goes dark whatever the Bloom's clarity is.
    const { dark } = config.bay.cave;
    const light = 1 - cave * (1 - dark.light);
    murk.setHex(look.color).lerp(caveFog, cave);
    fog.color.copy(murk);
    fog.near = look.fogNear + (dark.fogNear - look.fogNear) * cave;
    fog.far = look.fogFar + (dark.fogFar - look.fogFar) * cave;
    hemisphere.color.setHex(look.hemiSky).lerp(caveSky, cave);
    hemisphere.intensity = look.hemiIntensity * light;
    sun.intensity = look.sunIntensity * light;
    snow.material.opacity = look.snowOpacity * (1 - cave * (1 - dark.snow));
    surface.color.setHex(look.surfaceColor);
    surface.opacity = 0.5;
  };

  return {
    grass,
    update(dt, around) {
      snow.update(dt, around);
      grass.update(dt);
      if (above) {
        sunDisk.position.copy(around).addScaledVector(sunDirection, 380);
        sunDisk.lookAt(around);
      }
    },
    setClarity(value) {
      clarity = value;
      apply();
    },
    setAbove(value) {
      if (value === above) return;
      above = value;
      apply();
    },
    setCave(value) {
      if (value === cave) return;
      cave = value;
      if (!above) apply();
    },
  };
}
