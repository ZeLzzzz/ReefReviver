import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Shape,
  TorusGeometry,
  Vector3,
} from "three";
import { assets } from "../assets";
import { config } from "../config";
import { compactGroup, hasMesh } from "./model-utils";
import { posts } from "./bay";
import { groundHeight } from "./land";
import { counterPosition, stationPosition } from "./station";

const { station } = config;

/** Coastal timber house; the counter faces the sea (+X) and stays inside the existing interaction footprint. */
export function buildStationMesh(): Group {
  const matte = (color: number, roughness = 0.9) => new MeshStandardMaterial({ color, roughness, flatShading: true });
  const stone = matte(0xa7a28c);
  const cream = matte(0xeee3c9);
  const siding = [cream, matte(0xdfd1b4), matte(0xe8dabe)];
  const timber = matte(0x77543b);
  const endGrain = matte(0x493e30);
  const wood = matte(0xb38a59);
  const teal = matte(0x39766b);
  const paleTeal = matte(0x639486);
  const recess = matte(0x253d3b);
  const glazing = matte(0x618a91, 0.35);
  const tiles = [matte(0xb96543), matte(0xcb7950), matte(0xa9563a)];
  const steel = matte(0x4c5854, 0.65);
  steel.metalness = 0.25;
  const brass = matte(0xc5a05a, 0.65);
  const binColours = [matte(0x4c8296), brass, teal];

  const group = new Group();
  group.name = "station";
  const add = (mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent = group) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, material: MeshStandardMaterial, x: number, y: number, z: number, parent = group) =>
    add(new Mesh(new BoxGeometry(w, h, d), material), x, y, z, 0, 0, 0, parent);
  const beam = (from: [number, number, number], to: [number, number, number], width: number, material: MeshStandardMaterial, parent = group) => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const direction = b.clone().sub(a);
    const mesh = new Mesh(new BoxGeometry(width, direction.length(), width), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
    parent.add(mesh);
  };
  const { halfX, halfZ, height } = station;
  const base = 0.3;
  const top = base + height;

  box(halfX * 2 + 0.24, base, halfZ * 2 + 0.24, stone, 0, base / 2, 0);
  box(halfX * 2 + 0.12, 0.09, halfZ * 2 + 0.12, cream, 0, base, 0);
  box(halfX * 2 - 0.36, height, halfZ * 2 - 0.2, recess, 0, base + height / 2, 0);

  // Individual clapboards leave shallow seams; the front is cut around a recessed service hatch.
  const courses = 14;
  const courseHeight = height / courses;
  const hatchBottom = base + courseHeight * 3;
  const hatchTop = base + courseHeight * 9;
  const hatchHalf = 1.25;
  for (let row = 0; row < courses; row++) {
    const y = base + (row + 0.5) * courseHeight;
    const material = row < 3 ? wood : siding[row % siding.length];
    const h = courseHeight - 0.012;
    box(0.13, h, halfZ * 2, material, -halfX + 0.04, y, 0);
    for (const side of [-1, 1]) box(halfX * 2, h, 0.13, material, 0, y, side * (halfZ - 0.04));
    if (row >= 3 && row < 9) {
      for (const side of [-1, 1]) {
        box(0.13, h, halfZ - hatchHalf, material, halfX - 0.04, y, side * (halfZ + hatchHalf) / 2);
      }
    } else {
      box(0.13, h, halfZ * 2, material, halfX - 0.04, y, 0);
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(0.18, height + 0.05, 0.18, timber, sx * (halfX - 0.04), base + height / 2, sz * (halfZ - 0.04));
      box(0.22, 0.15, 0.22, endGrain, sx * (halfX - 0.04), base + 0.09, sz * (halfZ - 0.04));
    }
    box(0.17, 0.16, halfZ * 2, timber, sx * halfX, top - 0.06, 0);
    box(0.14, 0.1, halfZ * 2, timber, sx * halfX, hatchBottom - 0.03, 0);
  }
  for (const side of [-1, 1]) box(halfX * 2, 0.16, 0.17, timber, 0, top - 0.06, side * halfZ);

  // The gable faces the bay, giving the house a readable silhouette from the dock.
  const roofRise = 1.85;
  const ridge = top + roofRise;
  const roofX = halfX + 0.62;
  const roofZ = halfZ + 0.6;
  const pitch = Math.atan2(roofRise, halfZ);
  const slopeLength = roofZ / Math.cos(pitch);
  const gable = new Shape();
  gable.moveTo(-halfZ, 0);
  gable.lineTo(halfZ, 0);
  gable.lineTo(0, roofRise);
  gable.closePath();
  const gableGeometry = new ExtrudeGeometry(gable, { depth: 0.12, bevelEnabled: false });
  for (const side of [-1, 1]) {
    add(new Mesh(gableGeometry, siding[1]), side * halfX - 0.06, top, 0, 0, Math.PI / 2);
    for (let row = 0; row < 8; row++) {
      const y = (row + 0.5) * roofRise / 8;
      const width = halfZ * 2 * (1 - (y + roofRise / 16) / roofRise);
      if (width > 0) box(0.15, roofRise / 8 - 0.015, width, siding[row % siding.length], side * halfX, top + y, 0);
    }
    for (const edge of [-1, 1]) {
      beam([side * (halfX + 0.08), top, edge * halfZ], [side * (halfX + 0.08), ridge, 0], 0.14, timber);
    }
    box(0.18, roofRise - 0.12, 0.12, timber, side * (halfX + 0.07), top + roofRise / 2, 0);
  }

  // Low, curved clay tiles are shared geometry, merged by colour after placement.
  const tileColumns = 12;
  const tileRows = 8;
  const tileWidth = roofX * 2 / tileColumns;
  const tileLength = slopeLength / tileRows;
  const tileSection = new Shape();
  tileSection.moveTo(-tileWidth / 2, 0);
  tileSection.lineTo(tileWidth / 2, 0);
  tileSection.lineTo(tileWidth / 2, 0.025);
  tileSection.lineTo(tileWidth / 4, 0.065);
  tileSection.lineTo(0, 0.085);
  tileSection.lineTo(-tileWidth / 4, 0.065);
  tileSection.lineTo(-tileWidth / 2, 0.025);
  tileSection.closePath();
  const tileGeometry = new ExtrudeGeometry(tileSection, { depth: tileLength + 0.025, bevelEnabled: false });
  tileGeometry.translate(0, 0, -(tileLength + 0.025) / 2);
  for (const side of [-1, 1]) {
    const roof = box(roofX * 2, 0.12, slopeLength, endGrain, 0, ridge - Math.sin(pitch) * slopeLength / 2, side * roofZ / 2);
    roof.rotation.x = side * pitch;
    for (let row = 0; row < tileRows; row++) {
      const along = (row + 0.5) * tileLength;
      for (let column = 0; column < tileColumns; column++) {
        const shade = Math.sin(column * 1.7 + row * 2.3) + Math.cos(column * 3.1 - row * 0.9);
        add(new Mesh(tileGeometry, tiles[shade > 1.2 ? 1 : shade < -1.3 ? 2 : 0]),
          -roofX + (column + 0.5) * tileWidth, ridge - along * Math.sin(pitch) + 0.065,
          side * along * Math.cos(pitch), side * pitch);
      }
    }
    const eaveY = ridge - roofZ * Math.tan(pitch);
    box(roofX * 2 + 0.12, 0.2, 0.14, timber, 0, eaveY - 0.04, side * roofZ);
    for (const end of [-1, 1]) {
      beam([end * roofX, ridge + 0.02, 0], [end * roofX, eaveY, side * roofZ], 0.18, cream);
    }
    for (let rafter = -2; rafter <= 2; rafter++) {
      beam([rafter * 1.2, ridge - 0.15, 0], [rafter * 1.2, eaveY - 0.15, side * roofZ], 0.11, timber);
    }
  }
  for (let i = 0; i < tileColumns; i++) {
    add(new Mesh(new CylinderGeometry(0.16, 0.16, tileWidth - 0.015, 8), tiles[1]),
      -roofX + (i + 0.5) * tileWidth, ridge + 0.09, 0, 0, 0, Math.PI / 2);
  }

  const window = (x: number, y: number, z: number, yaw: number, width = 0.9) => {
    const frame = new Group();
    frame.position.set(x, y, z);
    frame.rotation.y = yaw;
    box(0.055, 1.18, width, recess, 0, 0, 0, frame);
    box(0.025, 1.03, width - 0.12, glazing, 0.036, 0, 0, frame);
    for (const side of [-1, 1]) {
      box(0.12, 1.34, 0.09, cream, 0.07, 0, side * (width / 2 + 0.035), frame);
      box(0.12, 0.09, width + 0.16, cream, 0.07, side * 0.625, 0, frame);
      const shutterZ = side * (width / 2 + 0.27);
      box(0.09, 1.28, 0.34, teal, 0.035, 0, shutterZ, frame);
      for (let slat = 0; slat < 7; slat++) {
        const louver = box(0.08, 0.11, 0.27, paleTeal, 0.095, -0.51 + slat * 0.17, shutterZ, frame);
        louver.rotation.z = -0.3;
      }
      for (const end of [-1, 1]) box(0.06, 0.07, 0.12, steel, 0.1, end * 0.42, shutterZ + side * 0.1, frame);
    }
    box(0.08, 1.16, 0.055, cream, 0.07, 0, 0, frame);
    box(0.08, 0.055, width, cream, 0.07, 0.04, 0, frame);
    box(0.3, 0.1, width + 0.27, wood, 0.1, -0.72, 0, frame);
    // Static joinery shares the house's material batches rather than adding draw calls for each window.
    frame.updateMatrix();
    for (const part of [...frame.children]) {
      part.applyMatrix4(frame.matrix);
      group.add(part);
    }
  };
  window(halfX + 0.04, 1.99, -2.43, 0, 0.72);
  window(-1.1, 1.99, -halfZ - 0.04, Math.PI / 2);
  window(-0.85, 1.99, halfZ + 0.04, -Math.PI / 2, 1.15);
  window(-halfX - 0.04, 1.99, 0, Math.PI, 1.15);

  for (const side of [-1, 1]) {
    box(0.23, hatchTop - hatchBottom + 0.2, 0.12, timber, halfX + 0.03, (hatchTop + hatchBottom) / 2, side * (hatchHalf + 0.02));
  }
  box(0.22, 0.12, hatchHalf * 2 + 0.22, timber, halfX + 0.02, hatchTop + 0.03, 0);
  box(0.7, 0.12, hatchHalf * 2 + 0.3, wood, halfX + 0.12, hatchBottom, 0);
  box(0.08, 0.14, hatchHalf * 2 + 0.3, timber, halfX + 0.44, hatchBottom - 0.015, 0);
  for (let plank = 0; plank < 9; plank++) {
    box(0.1, hatchBottom - base - 0.15, 0.26, plank % 3 ? teal : paleTeal,
      halfX + 0.03, (hatchBottom + base) / 2, (plank - 4) * 0.28);
  }
  box(0.1, 0.09, hatchHalf * 2 + 0.1, timber, halfX + 0.08, base + 0.07, 0);
  box(0.12, 0.08, hatchHalf * 2 - 0.2, wood, halfX - 0.16, hatchBottom + 0.49, 0);
  for (let i = 0; i < 3; i++) {
    box(0.12, 0.19 + i * 0.035, 0.24, i === 1 ? wood : paleTeal, halfX - 0.13, hatchBottom + 0.64, -0.7 + i * 0.7);
  }

  // Wall brackets support the awning above head height, leaving the approach free of new collision obstacles.
  const canopyDepth = 1.65;
  const canopyWidth = 3.25;
  for (let stripe = 0; stripe < 7; stripe++) {
    const z = -canopyWidth / 2 + (stripe + 0.5) * canopyWidth / 7;
    const cloth = box(canopyDepth, 0.055, canopyWidth / 7, stripe % 2 ? paleTeal : cream,
      halfX + 0.68, hatchTop + 0.39, z);
    cloth.rotation.z = -0.18;
    box(0.07, 0.16, canopyWidth / 7 - 0.012, stripe % 2 ? teal : cream,
      halfX + 0.68 + canopyDepth / 2 * Math.cos(0.18), hatchTop + 0.16, z);
  }
  for (const side of [-1, 1]) {
    beam([halfX + 0.08, 1.97, side * 1.5], [halfX + 1.35, hatchTop + 0.2, side * 1.5], 0.09, timber);
    box(0.12, 0.63, 0.16, timber, halfX + 0.05, 2.28, side * 1.5);
  }

  // A geometric recycling emblem needs no texture or language-specific lettering.
  const signY = top + 0.62;
  add(new Mesh(new CylinderGeometry(0.56, 0.56, 0.12, 16), timber), halfX + 0.15, signY, 0, 0, 0, Math.PI / 2);
  add(new Mesh(new CylinderGeometry(0.48, 0.48, 0.025, 16), teal), halfX + 0.225, signY, 0, 0, 0, Math.PI / 2);
  const arrow = new Shape();
  arrow.moveTo(0.072, 0.3);
  arrow.lineTo(0.234, 0.021);
  arrow.lineTo(0.292, 0.054);
  arrow.lineTo(0.272, -0.131);
  arrow.lineTo(0.101, -0.056);
  arrow.lineTo(0.159, -0.023);
  arrow.lineTo(-0.002, 0.258);
  arrow.closePath();
  const arrowGeometry = new ExtrudeGeometry(arrow, { depth: 0.018, bevelEnabled: false });
  for (let i = 0; i < 3; i++) {
    add(new Mesh(arrowGeometry, cream), halfX + 0.25, signY, 0, i * Math.PI * 2 / 3, Math.PI / 2);
  }
  box(0.06, 0.26, 0.55, recess, halfX + 0.11, ridge - 0.38, 0);
  for (let i = 0; i < 3; i++) box(0.09, 0.035, 0.56, wood, halfX + 0.15, ridge - 0.46 + i * 0.08, 0);

  // Planked side door and a life ring tie the house to its shore-side workshop role.
  const doorX = 0.85;
  box(1.23, 2.32, 0.09, endGrain, doorX, base + 1.16, -halfZ - 0.04);
  for (let i = 0; i < 6; i++) box(0.17, 2.16, 0.1, i % 2 ? wood : timber, doorX - 0.45 + i * 0.18, base + 1.12, -halfZ - 0.09);
  for (const side of [-1, 1]) {
    box(0.11, 2.4, 0.16, cream, doorX + side * 0.64, base + 1.2, -halfZ - 0.1);
    box(1.12, 0.09, 0.08, wood, doorX, base + (side < 0 ? 0.32 : 1.55), -halfZ - 0.18);
  }
  beam([doorX - 0.5, base + 0.36, -halfZ - 0.2], [doorX + 0.5, base + 1.51, -halfZ - 0.2], 0.085, wood);
  box(1.39, 0.12, 0.17, cream, doorX, base + 2.38, -halfZ - 0.1);
  box(0.07, 0.2, 0.08, brass, doorX - 0.36, base + 1.06, -halfZ - 0.2);
  box(1.3, 0.1, 0.25, stone, doorX, base + 0.02, -halfZ - 0.07);
  box(0.1, 0.14, 0.12, steel, 1.34, 2.67, halfZ + 0.07);
  add(new Mesh(new TorusGeometry(0.48, 0.105, 5, 24), cream), 1.34, 2.08, halfZ + 0.13);
  for (let i = 0; i < 4; i++) {
    add(new Mesh(new TorusGeometry(0.48, 0.111, 5, 3, Math.PI / 6), tiles[0]),
      1.34, 2.08, halfZ + 0.13, 0, 0, i * Math.PI / 2 - Math.PI / 12);
  }

  // The three bins retain the positions covered by landObstacles in land.ts.
  binColours.forEach((material, i) => {
    const x = halfX + 0.6;
    const z = halfZ - 0.4 + (i - 2) * 0.85;
    box(0.66, 0.78, 0.66, material, x, 0.48, z);
    box(0.61, 0.1, 0.61, endGrain, x, 0.09, z);
    box(0.73, 0.13, 0.73, steel, x, 0.94, z);
    box(0.04, 0.12, 0.33, recess, x + 0.375, 0.94, z);
    box(0.025, 0.19, 0.28, cream, x + 0.342, 0.62, z);
    box(0.04, 0.06, 0.17, material, x + 0.36, 0.62, z);
    for (const side of [-1, 1]) box(0.17, 0.07, 0.06, steel, x, 0.8, z + side * 0.35);
  });

  const { dx, dz, height: mastHeight } = station.mast;
  const mastBase = ridge - Math.abs(dz) * Math.tan(pitch);
  box(0.46, 0.16, 0.44, steel, dx, mastBase + 0.06, dz);
  add(new Mesh(new CylinderGeometry(0.065, 0.09, mastHeight - mastBase - 0.3, 8), steel), dx, (mastBase + mastHeight - 0.3) / 2, dz);
  beam([dx - 0.5, mastBase + 0.02, dz], [dx, mastBase + 0.9, dz], 0.045, steel);
  beam([dx + 0.5, mastBase + 0.02, dz], [dx, mastBase + 0.9, dz], 0.045, steel);
  add(new Mesh(new CylinderGeometry(0.35, 0.26, 0.13, 8), brass), dx, mastHeight - 0.34, dz);
  for (const x of [-0.23, 0.23]) for (const z of [-0.23, 0.23]) {
    box(0.035, 0.64, 0.035, steel, dx + x, mastHeight, dz + z);
  }
  add(new Mesh(new ConeGeometry(0.43, 0.24, 8), teal), dx, mastHeight + 0.42, dz);
  add(new Mesh(new CylinderGeometry(0.045, 0.045, 0.13, 6), brass), dx, mastHeight + 0.59, dz);

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
  const lantern = new Mesh(new CylinderGeometry(0.23, 0.23, 0.52, 8), beacon);
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
