import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { config } from "../config";
import type { Net } from "./nets";

const { cutter } = config;

/**
 * Stand-in ghost net built from primitives until the artist's GLB arrives (D-022): a rope grid over a dome,
 * a faint skin, white floats on top and dark weights on the floor. It is a separate model from the animal, so
 * it can vanish when cut. Bright orange and white, to stand out against the murky green and sand (DESIGN).
 */
const materials = {
  rope: new MeshStandardMaterial({ color: 0xff9a3c, emissive: 0x7a3a10, flatShading: true, roughness: 0.8 }),
  skin: new MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.16, side: DoubleSide, depthWrite: false }),
  float: new MeshStandardMaterial({ color: 0xffffff, emissive: 0x777777, flatShading: true }),
  weight: new MeshStandardMaterial({ color: 0x3a3a3a, flatShading: true, roughness: 1 }),
};

const MERIDIANS = 12;
const RINGS = 6;
const ROPE_RADIUS = 0.04;
const helper = new Object3D();

/** A thin rope between two points, as geometry in world coordinates of the net's frame. */
function rope(from: Vector3, to: Vector3): BufferGeometry {
  const geometry = new CylinderGeometry(ROPE_RADIUS, ROPE_RADIUS, from.distanceTo(to), 4).rotateX(Math.PI / 2);
  helper.position.copy(from).add(to).multiplyScalar(0.5);
  helper.lookAt(to);
  helper.updateMatrix();
  return geometry.applyMatrix4(helper.matrix);
}

function ropeGrid(net: Net): BufferGeometry {
  // Point on the dome at angle `theta` around the axis and `phi` up from the floor.
  const at = (theta: number, phi: number) =>
    new Vector3(net.width * Math.cos(phi) * Math.sin(theta), net.height * Math.sin(phi), net.length * Math.cos(phi) * Math.cos(theta));
  const ropes: BufferGeometry[] = [];
  for (let m = 0; m < MERIDIANS; m++) {
    const theta = (m / MERIDIANS) * Math.PI * 2;
    for (let r = 0; r < RINGS; r++) {
      ropes.push(rope(at(theta, (r / RINGS) * (Math.PI / 2)), at(theta, ((r + 1) / RINGS) * (Math.PI / 2))));
    }
  }
  for (let r = 0; r < RINGS - 1; r++) {
    const phi = (r / RINGS) * (Math.PI / 2);
    for (let m = 0; m < MERIDIANS; m++) {
      ropes.push(rope(at((m / MERIDIANS) * Math.PI * 2, phi), at(((m + 1) / MERIDIANS) * Math.PI * 2, phi)));
    }
  }
  return mergeGeometries(ropes)!;
}

function createNetModel(net: Net): Group {
  const group = new Group();
  group.add(new Mesh(ropeGrid(net), materials.rope));

  const skin = new Mesh(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.skin);
  skin.scale.set(net.width, net.height, net.length);
  group.add(skin);

  // Floats along the top and weights around the rim.
  const floatGeometry = new SphereGeometry(0.11, 6, 4);
  const weightGeometry = new BoxGeometry(0.28, 0.2, 0.28);
  for (let i = 0; i < 5; i++) {
    const theta = (i / 5) * Math.PI * 2;
    const phi = Math.PI / 2 - 0.45;
    const float = new Mesh(floatGeometry, materials.float);
    float.position.set(net.width * Math.cos(phi) * Math.sin(theta), net.height * Math.sin(phi) + 0.05, net.length * Math.cos(phi) * Math.cos(theta));
    group.add(float);
  }
  for (let i = 0; i < 6; i++) {
    const theta = (i / 6) * Math.PI * 2 + 0.3;
    const weight = new Mesh(weightGeometry, materials.weight);
    weight.position.set(net.width * Math.sin(theta), 0.05, net.length * Math.cos(theta));
    weight.rotation.y = theta;
    group.add(weight);
  }
  return group;
}

/** The cutter's beam, a thin glowing line along +Z of length 1; see placeCutterBeam(). Hidden until used. */
export function createCutterBeam(): Mesh {
  const geometry = new CylinderGeometry(0.06, 0.06, 1, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  // A hot pink, not additive, so it stays pink over the pale floor and the orange net.
  const material = new MeshBasicMaterial({ color: 0xff2d95, fog: false });
  const beam = new Mesh(geometry, material);
  beam.visible = false;
  beam.frustumCulled = false;
  return beam;
}

/** Stretches the beam from `from` to `to`; `pulse` (0..1) makes it throb. */
export function placeCutterBeam(beam: Mesh, from: Vector3, to: Vector3, pulse: number): void {
  beam.position.copy(from);
  beam.lookAt(to);
  const width = 0.8 + 0.5 * pulse;
  beam.scale.set(width, width, from.distanceTo(to));
}

export interface NetView {
  group: Group;
  /** Shows each net where it stands; a cut net shrinks and sinks away, then disappears. */
  sync(nets: readonly Net[]): void;
}

export function createNetView(nets: readonly Net[]): NetView {
  const group = new Group();
  const models = nets.map((net) => {
    const model = createNetModel(net);
    model.position.copy(net.center);
    model.rotation.y = net.yaw;
    group.add(model);
    return model;
  });

  return {
    group,
    sync(current) {
      for (const net of current) {
        const model = models[net.id];
        const gone = net.cut ? Math.min(1, net.cutAge / cutter.netFadeSeconds) : 0;
        model.visible = gone < 1;
        model.scale.setScalar(1 - gone);
        model.position.y = net.center.y - gone * 0.6;
      }
    },
  };
}
