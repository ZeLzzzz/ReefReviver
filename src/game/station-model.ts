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
} from "three";
import { assets } from "../assets";
import { config } from "../config";
import { compactGroup, hasMesh } from "./model-utils";
import { posts } from "./bay";
import { groundHeight } from "./land";
import { counterPosition, stationPosition } from "./station";

const { station } = config;

/**
 * Low-poly recycling shed on the land (REQ-016, D-007, D-081), centred on the origin: a concrete base, painted walls
 * with a green recycling stripe, a gable roof, the counter with its awning in the east wall (facing the sea, +X),
 * sorting bins beside it, and the beacon mast on the roof.
 */
export function buildStationMesh(): Group {
  const concrete = new MeshStandardMaterial({ color: 0x9b9a92, flatShading: true, roughness: 0.95 });
  const wall = new MeshStandardMaterial({ color: 0xe4ece6, flatShading: true, roughness: 0.85 });
  const roof = new MeshStandardMaterial({ color: 0x2f7f9e, flatShading: true, roughness: 0.7, side: DoubleSide });
  const darkSteel = new MeshStandardMaterial({ color: 0x3b444b, flatShading: true, roughness: 0.85 });
  const steel = new MeshStandardMaterial({ color: 0x5f6b73, flatShading: true, roughness: 0.75, metalness: 0.25 });
  const hazard = new MeshStandardMaterial({ color: 0xe6ad2c, emissive: 0x3d2a05, flatShading: true, roughness: 0.7 });
  const green = new MeshStandardMaterial({ color: 0x6fe0a0, emissive: 0x1d5a3a, flatShading: true });
  const wood = new MeshStandardMaterial({ color: 0x8b6a45, flatShading: true, roughness: 0.9 });
  const binColours = [0x2f6fd0, 0xe6c22c, 0x3aa65a].map((color) => new MeshStandardMaterial({ color, flatShading: true, roughness: 0.6 }));

  const group = new Group();
  group.name = "station";
  const add = (mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    group.add(mesh);
    return mesh;
  };
  const { halfX, halfZ, height } = station;

  // Concrete base slab and the walls.
  add(new Mesh(new BoxGeometry(halfX * 2 + 0.8, 0.3, halfZ * 2 + 0.8), concrete), 0, 0.15, 0);
  add(new Mesh(new BoxGeometry(halfX * 2, height, halfZ * 2), wall), 0, 0.3 + height / 2, 0);
  // Green recycling stripe round the walls, and corner posts.
  add(new Mesh(new BoxGeometry(halfX * 2 + 0.04, 0.35, halfZ * 2 + 0.04), green), 0, 0.3 + height * 0.78, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new Mesh(new BoxGeometry(0.22, height, 0.22), darkSteel), sx * halfX, 0.3 + height / 2, sz * halfZ);

  // Gable roof: two panels meeting over the middle, the ridge along Z.
  const top = 0.3 + height;
  const slope = 0.42;
  const panelWidth = (halfX + 0.5) / Math.cos(slope);
  for (const side of [-1, 1]) {
    add(new Mesh(new BoxGeometry(panelWidth, 0.12, halfZ * 2 + 0.8), roof), side * (halfX + 0.5) / 2, top + Math.tan(slope) * (halfX + 0.5) / 2, 0, 0, 0, -side * slope);
  }

  // The counter (loket) in the east wall: a dark opening, a wooden shelf, a yellow awning and a recycling sign.
  add(new Mesh(new BoxGeometry(0.08, 1.1, 2.2), darkSteel), halfX + 0.02, 1.55, 0);
  add(new Mesh(new BoxGeometry(0.6, 0.1, 2.4), wood), halfX + 0.3, 1.0, 0);
  add(new Mesh(new BoxGeometry(1.1, 0.08, 2.8), hazard), halfX + 0.5, 2.35, 0, 0, 0, -0.35);
  add(new Mesh(new BoxGeometry(0.06, 0.6, 1.4), green), halfX + 0.03, top - 0.55, 0);

  // A door in the north wall.
  add(new Mesh(new BoxGeometry(1.1, 2.1, 0.08), wood), 0.6, 1.35, -halfZ - 0.02);

  // Sorting bins beside the counter: plastic, cans, glass.
  binColours.forEach((material, i) => add(new Mesh(new BoxGeometry(0.7, 0.9, 0.7), material), halfX + 0.6, 0.45, halfZ - 0.2 + (i - 2) * 0.85 - 0.2));

  // Beacon mast on the roof, with cross-arms and the lantern cage (the lantern is added fog-free by createStationModel).
  const { dx, dz, height: mastHeight } = station.mast;
  add(new Mesh(new CylinderGeometry(0.12, 0.15, mastHeight - top, 8), steel), dx, top + (mastHeight - top) / 2, dz);
  for (const y of [top + 1.2, top + 2.4]) add(new Mesh(new BoxGeometry(0.52, 0.06, 0.08), hazard), dx, y, dz);
  add(new Mesh(new CylinderGeometry(0.34, 0.22, 0.16, 8), darkSteel), dx, mastHeight - 0.4, dz);
  add(new Mesh(new CylinderGeometry(0.24, 0.34, 0.16, 8), darkSteel), dx, mastHeight + 0.4, dz);

  return compactGroup(group);
}

/** The recycling shed with its fog-free beacon, and a ring on the ground marking the counter's zone (REQ-016, D-022). */
export function createStationModel(): Group {
  const beacon = new MeshBasicMaterial({ color: 0xfff1a8, fog: false });
  const ringMaterial = new MeshBasicMaterial({ color: 0xffd23f, fog: false, side: DoubleSide });

  const group = new Group();
  group.position.set(stationPosition.x, stationPosition.y, stationPosition.z);

  const loaded = assets.model("station");
  group.add(hasMesh(loaded) ? loaded : buildStationMesh());

  // The counter's zone: a flat ring on the ground in front of the east wall.
  const ring = new Mesh(new RingGeometry(station.zoneRadius - 0.25, station.zoneRadius, 40), ringMaterial);
  ring.position.set(counterPosition.x - stationPosition.x, groundHeight(counterPosition.x, counterPosition.z) - stationPosition.y + 0.05, 0);
  ring.rotation.x = -Math.PI / 2;

  // Fog-free beacon core at the top of the mast, visible from across the bay.
  const lantern = new Mesh(new OctahedronGeometry(0.45, 0), beacon);
  lantern.position.set(station.mast.dx, station.mast.height, station.mast.dz);

  group.add(ring, lantern);
  return group;
}

/** Height above the shed's ground where the HUD marker points: the beacon's lantern. */
export const STATION_MARKER_HEIGHT = config.station.mast.height + 0.3;

/** REQ-016: the wooden dock from the beach out over the water, on its posts. */
export function buildDockMesh(): Group {
  const deck = new MeshStandardMaterial({ color: 0x9a7650, flatShading: true, roughness: 0.9 });
  const darkWood = new MeshStandardMaterial({ color: 0x5e4630, flatShading: true, roughness: 0.95 });
  const { dock } = config.bay;
  const group = new Group();
  group.name = "dock";
  const length = dock.seaX - dock.landX;
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const width = (dock.halfWidth * 2) / planks;
    const plank = new Mesh(new BoxGeometry(length, 0.12, width * 0.92), i % 2 ? deck : darkWood);
    plank.position.set(dock.landX + length / 2, config.bay.surfaceY + dock.deckY - 0.06, dock.z - dock.halfWidth + width * (i + 0.5));
    group.add(plank);
  }
  for (const post of posts) {
    const mesh = new Mesh(new CylinderGeometry(post.radius, post.radius, post.height + 0.4, 6), darkWood);
    mesh.position.set(post.x, post.baseY + (post.height + 0.4) / 2, post.z);
    group.add(mesh);
  }
  return compactGroup(group);
}
