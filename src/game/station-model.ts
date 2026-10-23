import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  TorusGeometry,
} from "three";
import { assets } from "../assets";
import { config } from "../config";
import { compactGroup, hasMesh } from "./model-utils";
import { stationPosition } from "./station";

const { station } = config;

/**
 * Low-poly underwater recycling station mesh (D-007, D-022, D-041): an octagonal seabed pad, marine-teal
 * processing chamber with steel ribs, mineral/concrete aggregate silos, top funnel hopper, and beacon mast.
 */
export function buildStationMesh(): Group {
  const steel = new MeshStandardMaterial({ color: 0x5f6b73, flatShading: true, roughness: 0.75, metalness: 0.25 });
  const darkSteel = new MeshStandardMaterial({ color: 0x3b444b, flatShading: true, roughness: 0.85 });
  const hopper = new MeshStandardMaterial({ color: 0x687680, flatShading: true, roughness: 0.7, side: DoubleSide });
  const paint = new MeshStandardMaterial({ color: 0x2f7f9e, flatShading: true, roughness: 0.65 });
  const concrete = new MeshStandardMaterial({ color: 0x9b9a92, flatShading: true, roughness: 0.95 });
  const hazard = new MeshStandardMaterial({ color: 0xe6ad2c, emissive: 0x3d2a05, flatShading: true, roughness: 0.7 });
  const green = new MeshStandardMaterial({ color: 0x6fe0a0, emissive: 0x1d5a3a, flatShading: true });

  const group = new Group();
  group.name = "station";
  const add = (mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  };

  // Octagonal seabed pad with four hazard anchor blocks.
  add(new Mesh(new CylinderGeometry(2.45, 2.85, 0.36, 8), steel), 0, 0.18, 0);
  add(new Mesh(new CylinderGeometry(1.95, 2.2, 0.14, 8), darkSteel), 0, 0.4, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(new Mesh(new BoxGeometry(0.42, 0.24, 0.42), hazard), sx * 1.65, 0.26, sz * 1.65, 0, Math.PI / 4, 0);
    }
  }

  // Central marine-teal processing chamber and vertical corner ribs (within body radius 1.6, height 3.1).
  add(new Mesh(new BoxGeometry(2.3, 1.82, 1.72), paint), 0, 1.28, 0);
  add(new Mesh(new BoxGeometry(2.38, 0.18, 1.8), darkSteel), 0, 2.15, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(new Mesh(new BoxGeometry(0.16, 1.88, 0.16), darkSteel), sx * 1.12, 1.28, sz * 0.82);
    }
  }

  // Side mineral/concrete aggregate silos (D-007: reef frame materials).
  for (const sz of [-0.44, 0.44]) {
    add(new Mesh(new CylinderGeometry(0.32, 0.32, 1.5, 8), concrete), -1.25, 1.18, sz);
    add(new Mesh(new CylinderGeometry(0.35, 0.35, 0.12, 8), darkSteel), -1.25, 1.95, sz);
  }

  // Illuminated status display panels on front and back faces.
  for (const side of [-1, 1]) {
    add(new Mesh(new BoxGeometry(1.75, 0.52, 0.08), darkSteel), 0, 1.48, side * 0.88);
    add(new Mesh(new BoxGeometry(1.58, 0.36, 0.06), green), 0, 1.48, side * 0.91);
  }

  // Top intake hopper funnel with rim ring and internal sorting cross-bars.
  add(new Mesh(new CylinderGeometry(1.06, 0.48, 0.88, 8, 1, true), hopper), 0, 2.62, 0);
  add(new Mesh(new TorusGeometry(1.05, 0.065, 6, 8), hazard), 0, 3.04, 0, Math.PI / 2, 0, 0);
  add(new Mesh(new BoxGeometry(1.7, 0.07, 0.08), darkSteel), 0, 2.75, 0);
  add(new Mesh(new BoxGeometry(0.08, 0.07, 1.7), darkSteel), 0, 2.75, 0);

  // Beacon mast at (station.mast.dx, _, station.mast.dz) with base collar, cross-arms and lantern cage.
  const { dx, dz } = station.mast;
  add(new Mesh(new CylinderGeometry(0.26, 0.32, 0.6, 8), darkSteel), dx, 0.65, dz);
  add(new Mesh(new CylinderGeometry(0.12, 0.15, 6.0, 8), steel), dx, 3.2, dz);
  for (const y of [2.8, 4.4, 5.8]) {
    add(new Mesh(new BoxGeometry(0.52, 0.06, 0.08), hazard), dx, y, dz);
  }
  add(new Mesh(new CylinderGeometry(0.34, 0.22, 0.16, 8), darkSteel), dx, 6.1, dz);
  add(new Mesh(new CylinderGeometry(0.24, 0.34, 0.16, 8), darkSteel), dx, 6.9, dz);

  return compactGroup(group);
}

/**
 * Recycling station with fog-free beacon and deposit-zone boundary ring (REQ-002, D-022, D-041).
 */
export function createStationModel(): Group {
  const beacon = new MeshBasicMaterial({ color: 0xfff1a8, fog: false });
  const ringMaterial = new MeshBasicMaterial({ color: 0xffd23f, fog: false, side: DoubleSide });
  const zoneMaterial = new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false });

  const group = new Group();
  group.position.set(stationPosition.x, stationPosition.y, stationPosition.z);

  const loaded = assets.model("station");
  group.add(hasMesh(loaded) ? loaded : buildStationMesh());

  // Deposit zone: a flat ring on the floor plus a faint wall up to the zone's height.
  const ring = new Mesh(new RingGeometry(station.zoneRadius - 0.45, station.zoneRadius, 48), ringMaterial);
  ring.position.set(0, 0.06, 0);
  ring.rotation.x = -Math.PI / 2;
  const wall = new Mesh(new CylinderGeometry(station.zoneRadius, station.zoneRadius, station.zoneHeight, 48, 1, true), zoneMaterial);
  wall.position.set(0, station.zoneHeight / 2, 0);

  // Fog-free beacon core at the top of the mast, visible from across the bay.
  const lantern = new Mesh(new OctahedronGeometry(0.45, 0), beacon);
  lantern.position.set(station.mast.dx, 6.5, station.mast.dz);

  group.add(ring, wall, lantern);
  return group;
}
/** Height above the floor where the HUD marker points. */
export const STATION_MARKER_HEIGHT = 7.6;
