import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Material } from "three";
import { config } from "../config";
import { compactGroup } from "./model-utils";
import { ShipTraffic, shipPlace, type ShipKind } from "./ships";

type Outline = readonly (readonly [number, number])[];

const matte = (color: number) => new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
// Shared by every ship of every kind, so a new ship costs no new material.
const PAINT = {
  white: matte(0xe9e7e0),
  windows: matte(0x2b3540),
  antifouling: matte(0x9a3a2e),
  navy: matte(0x2c3e57),
  black: matte(0x24282c),
  deckGreen: matte(0x5d6b58),
  grey: matte(0x8b9196),
  red: matte(0xb5452f),
  blue: matte(0x2f6fa8),
  green: matte(0x3f8a5a),
  orange: matte(0xd08a2c),
  yellow: matte(0xc4b23a),
};
const WAKE = new MeshBasicMaterial({ color: 0xf1f6f2, transparent: true, opacity: 0.5, depthWrite: false });

/** A hull section: the outline seen from above (x across, z along, bow toward +z), walled from `bottom` to `top` and decked. */
function prism(outline: Outline, bottom: number, top: number): BufferGeometry {
  const positions: number[] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % n];
    positions.push(ax, bottom, az, bx, top, bz, bx, bottom, bz, ax, bottom, az, ax, top, az, bx, top, bz);
  }
  // The deck: a fan, as the outlines are convex.
  for (let i = 1; i < n - 1; i++) {
    const [ax, az] = outline[0], [bx, bz] = outline[i], [cx, cz] = outline[i + 1];
    positions.push(ax, top, az, cx, top, cz, bx, top, bz);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A hull outline `width` wide with the bow narrowing from `shoulder` (a share of the length) to a point at +0.5. */
function hullOutline(width: number, shoulder: number, bluntness = 0.5): Outline {
  const w = width / 2;
  return [
    [-w, -0.5], [w, -0.5], [w, shoulder], [w * bluntness, shoulder + (0.5 - shoulder) * 0.65], [0, 0.5],
    [-w * bluntness, shoulder + (0.5 - shoulder) * 0.65], [-w, shoulder],
  ];
}

/** A ship one unit long, bow toward +z, waterline at y = 0; it is drawn `length` × `config.ships.scale` long (D-133). */
export function buildShipMesh(kind: ShipKind): Group {
  const ship = new Group();
  ship.name = `ship-${kind}`;
  const add = (geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    ship.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, l: number, material: Material, x: number, y: number, z: number) =>
    add(new BoxGeometry(w, h, l), material, x, y + h / 2, z);
  /** A white block with a dark band of windows near its top. */
  const block = (w: number, h: number, l: number, x: number, y: number, z: number) => {
    box(w, h, l, PAINT.white, x, y, z);
    box(w + 0.004, h * 0.16, l + 0.004, PAINT.windows, x, y + h * 0.7, z);
  };
  /** The foam the ship leaves behind it, narrowing to nothing. */
  const wake = (width: number, length: number) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([-width / 2, 0, -0.5, width / 2, 0, -0.5, 0, 0, -0.5 - length], 3));
    geometry.computeVertexNormals();
    add(geometry, WAKE, 0, 0.004, 0);
  };

  if (kind === "container") {
    // A long dark hull over a red waterline, stacks of coloured containers, the bridge and funnel aft.
    const outline = hullOutline(0.14, 0.28);
    add(prism(outline, 0, 0.012), PAINT.antifouling);
    add(prism(outline, 0.012, 0.06), PAINT.navy);
    const colours = [PAINT.red, PAINT.blue, PAINT.green, PAINT.orange, PAINT.grey, PAINT.yellow];
    for (let bay = 0; bay < 8; bay++) {
      for (const side of [-1, 1]) {
        const height = 0.03 + ((bay * 7 + (side + 1) * 5) % 4) * 0.008;
        box(0.06, height, 0.068, colours[(bay * 2 + (side + 1) / 2) % colours.length], side * 0.031, 0.06, -0.3 + bay * 0.075);
      }
    }
    block(0.12, 0.09, 0.06, 0, 0.06, -0.42);
    box(0.03, 0.12, 0.028, PAINT.black, 0, 0.06, -0.475);
    box(0.008, 0.05, 0.008, PAINT.grey, 0, 0.06, 0.43);
    wake(0.14, 0.7);
  } else if (kind === "tanker") {
    // A red-and-black hull, a low green deck with a pipe down the middle, a white house and a tall funnel aft.
    const outline = hullOutline(0.16, 0.3, 0.62);
    add(prism(outline, 0, 0.014), PAINT.antifouling);
    add(prism(outline, 0.014, 0.05), PAINT.black);
    add(prism(hullOutline(0.15, 0.3, 0.6), 0.05, 0.054), PAINT.deckGreen);
    box(0.014, 0.01, 0.62, PAINT.grey, 0, 0.054, -0.02);
    for (let i = 0; i < 4; i++) box(0.11, 0.008, 0.012, PAINT.grey, 0, 0.054, -0.24 + i * 0.16);
    box(0.06, 0.03, 0.06, PAINT.deckGreen, 0, 0.054, 0.42);
    block(0.13, 0.1, 0.08, 0, 0.054, -0.4);
    box(0.035, 0.15, 0.03, PAINT.red, 0, 0.054, -0.47);
    box(0.037, 0.02, 0.032, PAINT.black, 0, 0.184, -0.47);
    wake(0.16, 0.6);
  } else if (kind === "cruise") {
    // Tall and white over a navy waterline: decks in tiers, each with a band of windows, and a blue funnel.
    const outline = hullOutline(0.13, 0.2, 0.55);
    add(prism(outline, 0, 0.02), PAINT.navy);
    add(prism(outline, 0.02, 0.07), PAINT.white);
    box(0.134, 0.012, 0.66, PAINT.windows, 0, 0.045, -0.12);
    block(0.12, 0.035, 0.74, 0, 0.07, -0.1);
    block(0.11, 0.03, 0.6, 0, 0.105, -0.12);
    block(0.095, 0.028, 0.44, 0, 0.135, -0.14);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) box(0.012, 0.012, 0.05, PAINT.orange, side * 0.066, 0.075, -0.35 + i * 0.09);
    }
    box(0.035, 0.05, 0.07, PAINT.blue, 0, 0.163, -0.3);
    box(0.037, 0.012, 0.072, PAINT.red, 0, 0.2, -0.3);
    wake(0.13, 0.7);
  } else {
    // A small blue boat with a red waterline, a white wheelhouse forward and a mast with a boom.
    const outline = hullOutline(0.34, 0.12, 0.55);
    add(prism(outline, 0, 0.04), PAINT.antifouling);
    add(prism(outline, 0.04, 0.16), PAINT.blue);
    add(prism(hullOutline(0.35, 0.12, 0.55), 0.16, 0.18), PAINT.white);
    block(0.22, 0.2, 0.2, 0, 0.18, 0.08);
    box(0.24, 0.025, 0.22, PAINT.red, 0, 0.38, 0.08);
    box(0.025, 0.55, 0.025, PAINT.grey, 0, 0.18, -0.12);
    box(0.02, 0.02, 0.4, PAINT.grey, 0, 0.5, -0.3);
    wake(0.34, 1.2);
  }
  return compactGroup(ship);
}

export interface ShipsView {
  group: Group;
  /** A new dive's traffic. */
  reset(seed: number): void;
  /** Moves the ships on and puts them around the camera at `around`; `above` is whether the camera is above the water. */
  update(dt: number, around: Vector3, above: boolean): void;
  /** True once after a horn came due (REQ-035 AC-5); the game plays it. */
  takeHorn(): boolean;
  /** For the tests: the ships, their real distance and bearing from the camera, and where they are drawn. */
  shown(): { kind: ShipKind; distance: number; bearing: number; x: number; z: number; drawn: number }[];
  hurryHorn(seconds: number): void;
}

/**
 * REQ-035: the ships at sea, drawn above the water only, each a copy of its kind's model (shared geometry and paint). D-133:
 * each is drawn `config.ships.scale` times as far from the camera and as big as it really is, on its real line of sight.
 */
export function createShipsView(): ShipsView {
  const group = new Group();
  group.name = "ships";
  group.visible = false;
  const traffic = new ShipTraffic();
  const models = new Map<ShipKind, Group>();
  const placed = new Map<number, Group>();
  let horn = false;
  // The camera at the last update, which the ships were drawn around.
  const last = new Vector3();
  return {
    group,
    reset(seed) {
      traffic.reset(seed);
      horn = false;
    },
    update(dt, around, above) {
      if (traffic.update(dt, above, around)) horn = true;
      last.copy(around);
      const alive = new Set(traffic.ships.map((ship) => ship.id));
      for (const [id, model] of placed) {
        if (alive.has(id)) continue;
        group.remove(model);
        placed.delete(id);
      }
      for (const ship of traffic.ships) {
        let model = placed.get(ship.id);
        if (!model) {
          if (!models.has(ship.kind)) models.set(ship.kind, buildShipMesh(ship.kind));
          model = models.get(ship.kind)!.clone();
          model.scale.setScalar(config.ships.kinds[ship.kind].length * config.ships.scale);
          group.add(model);
          placed.set(ship.id, model);
        }
        const place = shipPlace(ship, around);
        model.position.set(around.x + place.x, config.bay.surfaceY, around.z + place.z);
        model.rotation.y = place.yaw;
      }
    },
    takeHorn() {
      const due = horn;
      horn = false;
      return due;
    },
    shown() {
      return traffic.ships.map((ship) => {
        const place = shipPlace(ship, last);
        const model = placed.get(ship.id);
        return {
          kind: ship.kind,
          distance: place.distance,
          bearing: (Math.atan2(place.x, -place.z) * 180) / Math.PI,
          x: model?.position.x ?? NaN,
          z: model?.position.z ?? NaN,
          drawn: Math.hypot(place.x, place.z),
        };
      });
    },
    hurryHorn(seconds) {
      traffic.hurryHorn(seconds);
    },
  };
}
