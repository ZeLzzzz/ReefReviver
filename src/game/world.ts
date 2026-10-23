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
  type Vector3,
} from "three";
import { assets } from "../assets";
import { config } from "../config";
import { cliffFaceRadius, floorHeight, rocks } from "./bay";
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

function addFloor(scene: Scene): void {
  const geometry = new PlaneGeometry(200, 200, 100, 100);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const sandBase = new Color(0xb8a984);
  const sandRidge = new Color(0xc9bc98);
  const sandTrough = new Color(0x968968);
  const temp = new Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = floorHeight(x, z);
    position.setY(i, y);
    const ripple = 0.5 + 0.5 * Math.sin(x * 0.35 + z * 0.25) * Math.cos(z * 0.4 - x * 0.15);
    temp.copy(sandTrough).lerp(sandBase, Math.min(1, Math.max(0, (y + 15) / 5))).lerp(sandRidge, ripple * 0.45);
    colors[i * 3] = temp.r;
    colors[i * 3 + 1] = temp.g;
    colors[i * 3 + 2] = temp.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  scene.add(new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
}

export function createCliffGeometry(): CylinderGeometry {
  const height = bay.cliffTop - bay.cliffBottom;
  const geometry = new CylinderGeometry(bay.cliffRadius, bay.cliffRadius, height, 72, 10, true);
  geometry.translate(0, bay.cliffBottom + height / 2, 0);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const deepRock = new Color(0x585346);
  const midRock = new Color(0x77705f);
  const topRock = new Color(0x968d78);
  const temp = new Color();

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(x, z);
    const radius = cliffFaceRadius(angle, y);
    position.setXYZ(i, Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    const h = Math.min(1, Math.max(0, (y - bay.cliffBottom) / height));
    const strata = 0.5 + 0.5 * Math.sin(y * 1.4 + Math.sin(angle * 7) * 0.8);
    temp.copy(deepRock).lerp(midRock, h).lerp(topRock, h * strata * 0.65);
    colors[i * 3] = temp.r;
    colors[i * 3 + 1] = temp.g;
    colors[i * 3 + 2] = temp.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addCliffs(scene: Scene): void {
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: DoubleSide });
  scene.add(new Mesh(createCliffGeometry(), material));
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
  const geometry = new PlaneGeometry(200, 200);
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

  addFloor(scene);
  addCliffs(scene);
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
