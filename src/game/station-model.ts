import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
} from "three";
import { config } from "../config";
import { stationPosition } from "./station";

const { station } = config;

/**
 * Stand-in recycling station built from primitives until the artist's GLB arrives (D-022): a pad, a
 * container with a hopper, a tall beacon, and a bright ring that marks the deposit zone. The ring and
 * beacon ignore the fog so the station can be found from across the bay.
 */
export function createStationModel(): Group {
  const steel = new MeshStandardMaterial({ color: 0x5f6b73, flatShading: true, roughness: 0.8 });
  const hopper = new MeshStandardMaterial({ color: 0x5f6b73, flatShading: true, side: DoubleSide });
  const paint = new MeshStandardMaterial({ color: 0x2f7f9e, flatShading: true, roughness: 0.7 });
  const green = new MeshStandardMaterial({ color: 0x6fe0a0, emissive: 0x1d5a3a, flatShading: true });
  const beacon = new MeshBasicMaterial({ color: 0xfff1a8, fog: false });
  const ringMaterial = new MeshBasicMaterial({ color: 0xffd23f, fog: false, side: DoubleSide });
  const zoneMaterial = new MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.12, side: DoubleSide, depthWrite: false });

  const group = new Group();
  group.position.set(stationPosition.x, stationPosition.y, stationPosition.z);

  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // Deposit zone: a flat ring on the floor plus a faint wall up to the zone's height.
  const ring = add(new Mesh(new RingGeometry(station.zoneRadius - 0.45, station.zoneRadius, 48), ringMaterial), 0, 0.06, 0);
  ring.rotation.x = -Math.PI / 2;
  add(new Mesh(new CylinderGeometry(station.zoneRadius, station.zoneRadius, station.zoneHeight, 48, 1, true), zoneMaterial), 0, station.zoneHeight / 2, 0);

  // Pad, container and hopper in the middle of the zone.
  add(new Mesh(new CylinderGeometry(2.4, 2.8, 0.4, 10), steel), 0, 0.15, 0);
  add(new Mesh(new BoxGeometry(2.6, 1.8, 1.8), paint), 0, 1.25, 0);
  add(new Mesh(new CylinderGeometry(1.0, 0.45, 0.9, 8, 1, true), hopper), 0, 2.6, 0);
  add(new Mesh(new BoxGeometry(2.2, 0.35, 0.1), green), 0, 1.5, 0.95);

  // Beacon mast, visible from far away.
  add(new Mesh(new CylinderGeometry(0.12, 0.12, 6, 6), steel), 1.1, 3.2, -0.5);
  add(new Mesh(new BoxGeometry(0.7, 0.7, 0.7), beacon), 1.1, 6.5, -0.5);

  return group;
}

/** Height above the floor where the HUD marker points. */
export const STATION_MARKER_HEIGHT = 7.6;
