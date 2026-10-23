import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { assets } from "../assets";
import { config } from "../config";
import { compactGroup, hasMesh } from "./model-utils";
import type { Net } from "./nets";

const { cutter } = config;

/**
 * Low-poly ghost net model (D-022): a knotted rope dome with diagonal webbing, translucent netting skin,
 * buoyant trawl floats along the crown and lead sinker weights around the seabed rim.
 */
const materials = {
  rope: new MeshStandardMaterial({ color: 0xff9a3c, emissive: 0x7a3a10, flatShading: true, roughness: 0.8 }),
  knot: new MeshStandardMaterial({ color: 0xd96b18, emissive: 0x522208, flatShading: true, roughness: 0.85 }),
  skin: new MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.16, side: DoubleSide, depthWrite: false }),
  floatWhite: new MeshStandardMaterial({ color: 0xffffff, emissive: 0x777777, flatShading: true }),
  floatYellow: new MeshStandardMaterial({ color: 0xffd23f, emissive: 0x664e08, flatShading: true }),
  weight: new MeshStandardMaterial({ color: 0x3a3a3a, flatShading: true, roughness: 1 }),
};

const MERIDIANS = 12;
const RINGS = 6;
const ROPE_RADIUS = 0.028;
const helper = new Object3D();

/** A thin rope between two points on the unit dome. */
function rope(from: Vector3, to: Vector3, radius = ROPE_RADIUS): BufferGeometry {
  const geometry = new CylinderGeometry(radius, radius, from.distanceTo(to), 4).rotateX(Math.PI / 2);
  helper.position.copy(from).add(to).multiplyScalar(0.5);
  helper.lookAt(to);
  helper.updateMatrix();
  return geometry.applyMatrix4(helper.matrix);
}

function unitRopeGrid(): BufferGeometry {
  const at = (theta: number, phi: number) =>
    new Vector3(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta));
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
      const theta0 = (m / MERIDIANS) * Math.PI * 2;
      const theta1 = ((m + 1) / MERIDIANS) * Math.PI * 2;
      ropes.push(rope(at(theta0, phi), at(theta1, phi)));
    }
  }
  return mergeGeometries(ropes)!;
}

/** Builds a unit-sized ghost net dome (radius 1, height 1) suitable for GLB export and per-net scaling. */
export function buildGhostNetMesh(): Group {
  const group = new Group();
  group.name = "ghost-net";
  group.add(new Mesh(unitRopeGrid(), materials.rope));

  // Knotted rope clumps at selected intersections.
  const knotGeo = new IcosahedronGeometry(0.055, 0);
  for (let m = 0; m < MERIDIANS; m += 2) {
    for (const r of [1, 3]) {
      const theta = (m / MERIDIANS) * Math.PI * 2;
      const phi = (r / RINGS) * (Math.PI / 2);
      const knot = new Mesh(knotGeo, materials.knot);
      knot.position.set(Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta));
      group.add(knot);
    }
  }

  // Buoyant trawl floats along the upper crest and lead sinker weights around the seabed skirt.
  const floatGeometry = new SphereGeometry(0.085, 6, 5).scale(1.2, 0.85, 0.85);
  const weightGeometry = new BoxGeometry(0.18, 0.14, 0.18);
  for (let i = 0; i < 6; i++) {
    const theta = (i / 6) * Math.PI * 2;
    const phi = Math.PI / 2 - 0.45;
    const float = new Mesh(floatGeometry, i % 2 === 0 ? materials.floatWhite : materials.floatYellow);
    float.position.set(Math.cos(phi) * Math.sin(theta), Math.sin(phi) + 0.04, Math.cos(phi) * Math.cos(theta));
    float.rotation.y = theta;
    group.add(float);
  }
  for (let i = 0; i < 8; i++) {
    const theta = (i / 8) * Math.PI * 2 + 0.25;
    const weight = new Mesh(weightGeometry, materials.weight);
    weight.position.set(Math.sin(theta), 0.05, Math.cos(theta));
    weight.rotation.y = theta;
    group.add(weight);
  }
  return compactGroup(group);
}

function createNetModel(net: Net): Group {
  const group = new Group();
  const loaded = assets.model("ghost-net");
  const dome = hasMesh(loaded) ? loaded : buildGhostNetMesh();
  dome.scale.set(net.width, net.height, net.length);
  group.add(dome);

  const skin = new Mesh(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.skin);
  skin.scale.set(net.width, net.height, net.length);
  group.add(skin);
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
        // REQ-012: a new dive can put the net somewhere else.
        model.position.set(net.center.x, net.center.y - gone * 0.6, net.center.z);
        model.rotation.y = net.yaw;
      }
    },
  };
}
