import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  type Scene,
  type Vector3,
} from "three";
import { config } from "../config";
import { cliffFaceRadius, floorHeight, rocks } from "./bay";
import { waterAt } from "./bloom";

const { bay, water } = config;

function addFloor(scene: Scene): void {
  const geometry = new PlaneGeometry(200, 200, 100, 100);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, floorHeight(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();
  scene.add(new Mesh(geometry, new MeshStandardMaterial({ color: 0xb8a984, flatShading: true, roughness: 1 })));
}

export function createCliffGeometry(): CylinderGeometry {
  const height = bay.cliffTop - bay.cliffBottom;
  const geometry = new CylinderGeometry(bay.cliffRadius, bay.cliffRadius, height, 72, 10, true);
  geometry.translate(0, bay.cliffBottom + height / 2, 0);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(x, z);
    const radius = cliffFaceRadius(angle, y);
    position.setXYZ(i, Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function addCliffs(scene: Scene): void {
  const material = new MeshStandardMaterial({ color: 0x77705f, flatShading: true, roughness: 1, side: DoubleSide });
  scene.add(new Mesh(createCliffGeometry(), material));
}

function addRocks(scene: Scene): void {
  const material = new MeshStandardMaterial({ color: 0x7a7466, flatShading: true, roughness: 1 });
  const geometry = new DodecahedronGeometry(1, 0);
  for (const rock of rocks) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(rock.x, rock.y, rock.z);
    mesh.scale.set(rock.size, rock.height, rock.size);
    mesh.rotation.y = rock.rotation;
    scene.add(mesh);
  }
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
