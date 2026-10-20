import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from "three";
import type { TrashItem, TrashKind } from "./trash";

/**
 * Stand-in trash built from primitives until the artist's GLBs arrive (D-022). Bright colours and a little
 * glow, so the items stand out against the murky sand (DESIGN).
 */
const materials = {
  bottle: new MeshStandardMaterial({ color: 0x4fd6ff, emissive: 0x0f5a73, flatShading: true, roughness: 0.4 }),
  cap: new MeshStandardMaterial({ color: 0xff5a36, emissive: 0x5a1a0a, flatShading: true }),
  bag: new MeshStandardMaterial({ color: 0xffffff, emissive: 0x6b6b6b, flatShading: true, roughness: 0.9 }),
  can: new MeshStandardMaterial({ color: 0xff3d3d, emissive: 0x6a1010, flatShading: true, metalness: 0.4, roughness: 0.4 }),
  canTop: new MeshStandardMaterial({ color: 0xe6e6e6, emissive: 0x555555, flatShading: true }),
};

const geometries = {
  bottleBody: new CylinderGeometry(0.17, 0.17, 0.55, 8).rotateZ(Math.PI / 2),
  bottleNeck: new CylinderGeometry(0.07, 0.1, 0.18, 8).rotateZ(Math.PI / 2),
  bottleCap: new CylinderGeometry(0.08, 0.08, 0.06, 8).rotateZ(Math.PI / 2),
  bag: new IcosahedronGeometry(0.4, 0).scale(1.3, 0.22, 1),
  canBody: new CylinderGeometry(0.16, 0.16, 0.34, 8).rotateZ(Math.PI / 2),
  canTop: new CylinderGeometry(0.13, 0.13, 0.36, 8).rotateZ(Math.PI / 2),
  box: new BoxGeometry(0.1, 0.1, 0.1),
};

function part(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function createModel(kind: TrashKind): Group {
  const group = new Group();
  switch (kind) {
    case "bottle":
      group.add(
        part(geometries.bottleBody, materials.bottle),
        part(geometries.bottleNeck, materials.bottle, 0.36, 0, 0),
        part(geometries.bottleCap, materials.cap, 0.48, 0, 0),
      );
      break;
    case "bag":
      group.add(part(geometries.bag, materials.bag), part(geometries.box, materials.bag, -0.5, 0.02, 0.1));
      break;
    case "can":
      group.add(part(geometries.canBody, materials.can), part(geometries.canTop, materials.canTop));
      break;
  }
  return group;
}

/** The placeholders are drawn a bit larger than life so they read through the murk. */
const DISPLAY_SCALE = 1.4;

export interface TrashView {
  group: Group;
  /** Copies each item's state onto its model: free items rest on the floor, sucked ones spin and shrink. */
  sync(items: readonly TrashItem[]): void;
}

export function createTrashView(items: readonly TrashItem[]): TrashView {
  const group = new Group();
  const models = items.map((item) => {
    const model = createModel(item.kind);
    group.add(model);
    return model;
  });

  return {
    group,
    sync(current) {
      for (const item of current) {
        const model = models[item.id];
        model.visible = item.state !== "collected";
        if (!model.visible) continue;
        model.position.copy(item.position);
        model.rotation.set(0, item.rotation + item.pull * 9, item.pull * 6);
        model.scale.setScalar(DISPLAY_SCALE * (1 - 0.7 * item.pull));
      }
    },
  };
}
