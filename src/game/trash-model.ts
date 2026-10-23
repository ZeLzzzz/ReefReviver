import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import { assets } from "../assets";
import { compactGroup, hasMesh } from "./model-utils";
import type { TrashItem, TrashKind } from "./trash";

/**
 * Low-poly trash models with 3 variations per kind (bottle, bag, can; D-022, DESIGN). Bright colours and
 * subtle self-illumination make them read clearly against the murky sea floor.
 */
const materials = {
  bottleCyan: new MeshStandardMaterial({ color: 0x4fd6ff, emissive: 0x0f5a73, flatShading: true, roughness: 0.35 }),
  bottleGreen: new MeshStandardMaterial({ color: 0x62f285, emissive: 0x165e28, flatShading: true, roughness: 0.35 }),
  bottleTeal: new MeshStandardMaterial({ color: 0x70e8e0, emissive: 0x185c58, flatShading: true, roughness: 0.4 }),
  capOrange: new MeshStandardMaterial({ color: 0xff5a36, emissive: 0x5a1a0a, flatShading: true }),
  capYellow: new MeshStandardMaterial({ color: 0xffd23f, emissive: 0x664e08, flatShading: true }),
  labelWhite: new MeshStandardMaterial({ color: 0xf4f8fb, emissive: 0x4a5258, flatShading: true }),
  bagWhite: new MeshStandardMaterial({ color: 0xffffff, emissive: 0x6b6b6b, flatShading: true, roughness: 0.85 }),
  bagBlue: new MeshStandardMaterial({ color: 0x9be2ff, emissive: 0x2e5c70, flatShading: true, roughness: 0.85 }),
  bagStripe: new MeshStandardMaterial({ color: 0xff7b54, emissive: 0x662814, flatShading: true, roughness: 0.85 }),
  canRed: new MeshStandardMaterial({ color: 0xff3d3d, emissive: 0x6a1010, flatShading: true, metalness: 0.35, roughness: 0.4 }),
  canGold: new MeshStandardMaterial({ color: 0xffbe2e, emissive: 0x634406, flatShading: true, metalness: 0.35, roughness: 0.4 }),
  canBlue: new MeshStandardMaterial({ color: 0x3b8dff, emissive: 0x10356b, flatShading: true, metalness: 0.3, roughness: 0.45 }),
  canMetal: new MeshStandardMaterial({ color: 0xe6e9ed, emissive: 0x55585c, flatShading: true, metalness: 0.45, roughness: 0.35 }),
};

function part(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}

export function buildTrashMesh(kind: TrashKind, variant = 0): Group {
  const v = ((variant % 3) + 3) % 3;
  const group = new Group();
  group.name = `trash-${kind}-${v}`;

  if (kind === "bottle") {
    if (v === 0) {
      // Dented cyan water bottle with white label band and orange cap.
      group.add(
        part(new CylinderGeometry(0.16, 0.17, 0.26, 8).rotateZ(Math.PI / 2), materials.bottleCyan, -0.14, 0, 0),
        part(new CylinderGeometry(0.145, 0.145, 0.14, 8).rotateZ(Math.PI / 2), materials.labelWhite, 0.04, -0.01, 0),
        part(new CylinderGeometry(0.16, 0.15, 0.18, 8).rotateZ(Math.PI / 2), materials.bottleCyan, 0.18, 0, 0),
        part(new CylinderGeometry(0.065, 0.14, 0.16, 8).rotateZ(Math.PI / 2), materials.bottleCyan, 0.34, 0, 0),
        part(new CylinderGeometry(0.075, 0.075, 0.07, 8).rotateZ(Math.PI / 2), materials.capOrange, 0.45, 0, 0),
      );
    } else if (v === 1) {
      // Lime-green soda bottle with pinched waist and yellow cap.
      group.add(
        part(new CylinderGeometry(0.15, 0.18, 0.28, 7).rotateZ(Math.PI / 2), materials.bottleGreen, -0.16, 0, 0),
        part(new CylinderGeometry(0.17, 0.14, 0.24, 7).rotateZ(Math.PI / 2), materials.bottleGreen, 0.08, 0.01, 0, 0, 0, 0.08),
        part(new ConeGeometry(0.16, 0.22, 7).rotateZ(-Math.PI / 2), materials.bottleGreen, 0.3, 0.02, 0),
        part(new CylinderGeometry(0.07, 0.07, 0.07, 7).rotateZ(Math.PI / 2), materials.capYellow, 0.43, 0.02, 0),
      );
    } else {
      // Rectangular detergent jug with handle loop and orange spout.
      group.add(
        part(new BoxGeometry(0.46, 0.24, 0.3), materials.bottleTeal, -0.05, 0, 0),
        part(new BoxGeometry(0.22, 0.25, 0.31), materials.labelWhite, -0.06, 0, 0),
        part(new CylinderGeometry(0.06, 0.11, 0.16, 6).rotateZ(Math.PI / 2), materials.bottleTeal, 0.25, 0.04, 0),
        part(new CylinderGeometry(0.07, 0.07, 0.07, 6).rotateZ(Math.PI / 2), materials.capOrange, 0.36, 0.04, 0),
        part(new TorusGeometry(0.09, 0.03, 5, 8), materials.bottleTeal, 0.14, 0.11, 0),
      );
    }
  } else if (kind === "bag") {
    if (v === 0) {
      // Crumpled white grocery bag with dual loop handles.
      group.add(
        part(new IcosahedronGeometry(0.36, 0).scale(1.3, 0.3, 1.05), materials.bagWhite, 0.04, 0.02, 0),
        part(new DodecahedronGeometry(0.22, 0).scale(1.1, 0.35, 0.9), materials.bagWhite, -0.22, 0.04, 0.12),
        part(new TorusGeometry(0.13, 0.035, 5, 7).scale(1.3, 0.5, 1), materials.bagWhite, -0.38, 0.03, 0.14, Math.PI / 2, 0, 0.3),
        part(new TorusGeometry(0.13, 0.035, 5, 7).scale(1.3, 0.5, 1), materials.bagWhite, -0.38, 0.03, -0.14, Math.PI / 2, 0, -0.3),
      );
    } else if (v === 1) {
      // Billowing sky-blue bag puffed up like a drifting dome.
      group.add(
        part(new DodecahedronGeometry(0.34, 0).scale(1.15, 0.55, 1.1), materials.bagBlue, 0, 0.08, 0),
        part(new ConeGeometry(0.14, 0.28, 5).rotateZ(1.2), materials.bagBlue, -0.32, 0.02, 0.14),
        part(new ConeGeometry(0.14, 0.28, 5).rotateZ(1.3), materials.bagBlue, -0.32, 0.02, -0.14),
      );
    } else {
      // Striped carrier bag with orange bands and splayed handles.
      group.add(
        part(new IcosahedronGeometry(0.35, 0).scale(1.35, 0.26, 1.0), materials.bagWhite, 0.05, 0.01, 0),
        part(new BoxGeometry(0.48, 0.12, 0.12), materials.bagStripe, 0.05, 0.04, 0.14),
        part(new BoxGeometry(0.48, 0.12, 0.12), materials.bagStripe, 0.05, 0.04, -0.14),
        part(new BoxGeometry(0.24, 0.06, 0.08), materials.bagWhite, -0.38, 0.02, 0.15, 0, 0.25, 0),
        part(new BoxGeometry(0.24, 0.06, 0.08), materials.bagWhite, -0.38, 0.02, -0.15, 0, -0.25, 0),
      );
    }
  } else {
    if (v === 0) {
      // Red soda can with metallic rims, white stripe and pull-tab.
      group.add(
        part(new CylinderGeometry(0.155, 0.155, 0.34, 8).rotateZ(Math.PI / 2), materials.canRed),
        part(new CylinderGeometry(0.16, 0.16, 0.06, 8).rotateZ(Math.PI / 2), materials.labelWhite, 0.02, 0, 0),
        part(new CylinderGeometry(0.145, 0.145, 0.38, 8).rotateZ(Math.PI / 2), materials.canMetal),
        part(new BoxGeometry(0.02, 0.08, 0.05), materials.canMetal, 0.2, 0.02, 0),
      );
    } else if (v === 1) {
      // Crushed yellow beverage can bent in the middle.
      group.add(
        part(new CylinderGeometry(0.15, 0.13, 0.19, 8).rotateZ(Math.PI / 2), materials.canGold, -0.09, 0.01, 0, 0, 0, 0.22),
        part(new CylinderGeometry(0.13, 0.15, 0.19, 8).rotateZ(Math.PI / 2), materials.canGold, 0.09, 0.01, 0, 0, 0, -0.22),
        part(new CylinderGeometry(0.145, 0.145, 0.04, 8).rotateZ(Math.PI / 2), materials.canMetal, -0.19, 0.03, 0, 0, 0, 0.22),
        part(new CylinderGeometry(0.145, 0.145, 0.04, 8).rotateZ(Math.PI / 2), materials.canMetal, 0.19, 0.03, 0, 0, 0, -0.22),
      );
    } else {
      // Ribbed tin food can with blue label and peeled-back lid.
      group.add(
        part(new CylinderGeometry(0.17, 0.17, 0.32, 8).rotateZ(Math.PI / 2), materials.canMetal),
        part(new CylinderGeometry(0.175, 0.175, 0.16, 8).rotateZ(Math.PI / 2), materials.canBlue),
        part(new CylinderGeometry(0.15, 0.15, 0.03, 8), materials.canMetal, 0.2, 0.12, 0, 0, 0, -0.65),
      );
    }
  }
  return compactGroup(group);
}

function createModel(kind: TrashKind, id: number): Group {
  const variant = Math.floor(id / 3) % 3;
  const loaded = assets.model(`trash-${kind}-${variant}`);
  if (hasMesh(loaded)) {
    const wrapper = new Group();
    wrapper.add(loaded);
    return wrapper;
  }
  return buildTrashMesh(kind, variant);
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
    const model = createModel(item.kind, item.id);
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
