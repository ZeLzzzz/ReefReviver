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

function addSurface(scene: Scene): void {
  const geometry = new PlaneGeometry(200, 200);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, bay.surfaceY, 0);
  const material = new MeshBasicMaterial({ color: 0xa9c4b2, transparent: true, opacity: 0.5, side: DoubleSide });
  scene.add(new Mesh(geometry, material));
}

/** Drifting particles ("marine snow") around the camera, so the murky water reads as water. */
function addMarineSnow(scene: Scene): (dt: number, around: Vector3) => void {
  const half = 15;
  const positions = new Float32Array(water.snowCount * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() * 2 - 1) * half;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const points = new Points(
    geometry,
    new PointsMaterial({ color: 0xdfe6d8, size: 0.06, transparent: true, opacity: 0.7 }),
  );
  points.frustumCulled = false;
  scene.add(points);

  const wrap = (value: number, centre: number) => centre - half + ((((value - centre + half) % (half * 2)) + half * 2) % (half * 2));
  return (dt, around) => {
    for (let i = 0; i < positions.length; i += 3) {
      positions[i + 1] -= 0.15 * dt;
      positions[i] = wrap(positions[i], around.x);
      positions[i + 1] = wrap(positions[i + 1], around.y);
      positions[i + 2] = wrap(positions[i + 2], around.z);
    }
    geometry.attributes.position.needsUpdate = true;
  };
}

export interface World {
  /** Advances ambient motion; `around` is the camera position. */
  update(dt: number, around: Vector3): void;
}

/** The bay before the Bloom: murky green-grey water with short visibility (REQ-001 AC-3). */
export function buildWorld(scene: Scene): World {
  const murk = new Color(water.murky.color);
  scene.background = murk;
  scene.fog = new Fog(murk, water.murky.fogNear, water.murky.fogFar);

  scene.add(new HemisphereLight(0xcfe3d4, 0x4a4636, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(10, 30, 5);
  scene.add(sun);

  addFloor(scene);
  addCliffs(scene);
  addRocks(scene);
  addSurface(scene);
  const updateSnow = addMarineSnow(scene);

  return { update: updateSnow };
}
