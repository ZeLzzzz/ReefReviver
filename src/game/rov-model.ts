import {
  BoxGeometry, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial, Object3D,
  SphereGeometry, SpotLight, TorusGeometry, Vector2, Vector3, type BufferGeometry,
} from "three";
import { assets } from "../assets";
import { compactGroup, hasMesh } from "./model-utils";

/**
 * Low-poly mini submarine facing +Z (D-022, D-029, D-070): a closed round hull with a deck hatch instead of a cockpit
 * (D-123), side buoyancy tanks, two rear ducted thrusters whose propellers spin with the speed, landing skids and the
 * three tools at the front. It keeps the old vehicle's footprint, and its few large facets (at most 10 sides, no
 * part thinner than ±2 cm) match the rest of the world. In the code it is still called the ROV.
 */
export function buildRovMesh(): Group {
  const matte = (color: number, roughness = 0.85, metalness = 0.05) =>
    new MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
  const yellow = matte(0xe9b746, 0.8), teal = matte(0x315d5a);
  const rubber = matte(0x25363b, 0.95), steel = matte(0x879894, 0.6, 0.3);
  const orange = matte(0xc87842);
  const pipeInside = matte(0x172d32, 0.95);
  pipeInside.side = DoubleSide;
  const lamp = matte(0xffedbd, 0.25);
  lamp.emissive.setHex(0xffe0a1);
  lamp.emissiveIntensity = 1.2;
  const display = matte(0x7bc7c5, 0.3);
  display.emissive.setHex(0x245c61);
  display.emissiveIntensity = 0.5;
  const cutter = matte(0xd65678);
  cutter.emissive.setHex(0x691d40);
  const model = new Group();
  model.name = "rov";
  const add = (geometry: BufferGeometry, material: MeshStandardMaterial, x: number, y: number, z: number, parent: Object3D = model) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, material: MeshStandardMaterial, x: number, y: number, z: number, parent: Object3D = model) =>
    add(new BoxGeometry(w, h, d), material, x, y, z, parent);
  const oval = (rx: number, ry: number, rz: number, material: MeshStandardMaterial, x: number, y: number, z: number) => {
    const mesh = add(new SphereGeometry(1, 8, 6), material, x, y, z);
    mesh.scale.set(rx, ry, rz);
    return mesh;
  };
  const tube = (from: Vector3, to: Vector3, radius: number, material: MeshStandardMaterial, parent: Object3D = model) => {
    const direction = to.clone().sub(from), center = from.clone().add(to).multiplyScalar(0.5);
    const mesh = add(new CylinderGeometry(radius, radius, direction.length(), 6), material, center.x, center.y, center.z, parent);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  };
  // Rings around the Z axis, with their 8 corners where the tanks' and ducts' corners are.
  const ring = (radius: number, thickness: number, material: MeshStandardMaterial, x: number, y: number, z: number) =>
    add(new TorusGeometry(radius, thickness, 4, 8), material, x, y, z);
  const barrel = (radius: number, length: number, material: MeshStandardMaterial, x: number, y: number, z: number, open = false) => {
    const geometry = new CylinderGeometry(radius, radius, length, 8, 1, open);
    geometry.rotateX(Math.PI / 2);
    return add(geometry, material, x, y, z);
  };
  // The hull: a yellow upper half over a dark teal belly.
  for (const [theta, height, rings, material] of [[0, 0.41, 4, yellow], [Math.PI / 2, 0.29, 3, teal]] as const) {
    const shell = new SphereGeometry(1, 10, rings, 0, Math.PI * 2, theta, Math.PI / 2);
    shell.scale(0.49, height, 0.8);
    add(shell, material, 0, 0.04, 0.02);
  }

  const hatch = add(new CylinderGeometry(0.18, 0.205, 0.065, 8), teal, 0, 0.432, 0.03);
  hatch.scale.z = 1.25;
  hatch.name = "deck-hatch";
  for (const side of [-1, 1]) box(0.03, 0.03, 0.03, steel, side * 0.075, 0.478, 0.03);
  box(0.18, 0.03, 0.03, steel, 0, 0.5, 0.03);

  const vent = new Group();
  vent.position.set(0, 0.377, -0.43);
  vent.rotation.x = -0.34;
  model.add(vent);
  add(new CylinderGeometry(0.15, 0.16, 0.025, 8), rubber, 0, 0, 0, vent).scale.z = 1.25;
  for (let i = 0; i < 3; i++) box(0.18, 0.025, 0.035, steel, 0, 0.02, (i - 1) * 0.08, vent);
  const beacon = oval(0.042, 0.022, 0.05, display, 0, 0.291, -0.61);
  beacon.rotation.x = -0.8;

  const ductProfile = [[0.18, -0.14], [0.205, -0.11], [0.205, 0.11], [0.18, 0.14], [0.15, 0.12], [0.15, -0.12], [0.18, -0.14]];
  for (const side of [-1, 1]) {
    // A side tank, its ends pointing fore and aft.
    const tank = new SphereGeometry(1, 8, 6);
    tank.rotateX(Math.PI / 2);
    tank.scale(0.145, 0.185, 0.63);
    add(tank, yellow, side * 0.55, 0.04, -0.03);
    for (const z of [-0.3, 0.28]) {
      ring(0.15, 0.025, teal, side * 0.55, 0.04, z).scale.y = 1.18;
      box(0.15, 0.05, 0.09, steel, side * 0.46, 0.07, z);
    }
    tube(new Vector3(side * 0.42, -0.08, -0.37), new Vector3(side * 0.45, -0.34, -0.4), 0.031, steel);
    tube(new Vector3(side * 0.42, -0.08, 0.37), new Vector3(side * 0.45, -0.34, 0.4), 0.031, steel);
    tube(new Vector3(side * 0.45, -0.35, -0.62), new Vector3(side * 0.45, -0.35, 0.58), 0.043, rubber);
    tube(new Vector3(side * 0.45, -0.35, 0.58), new Vector3(side * 0.45, -0.25, 0.75), 0.043, rubber);
    oval(0.045, 0.045, 0.045, rubber, side * 0.45, -0.35, -0.62);
    box(0.17, 0.08, 0.15, teal, side * 0.5, -0.01, -0.48);
    const duct = new LatheGeometry(ductProfile.map(([r, z]) => new Vector2(r, z)), 8);
    duct.rotateX(Math.PI / 2);
    add(duct, rubber, side * 0.59, 0, -0.62);
    ring(0.19, 0.03, yellow, side * 0.59, 0, -0.76);
    const rotor = new Group();
    rotor.name = side < 0 ? "propeller-left" : "propeller-right";
    rotor.position.set(side * 0.59, 0, -0.65);
    model.add(rotor);
    add(new SphereGeometry(0.05, 6, 4), steel, 0, 0, 0, rotor).scale.z = 1.4;
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      box(0.12, 0.06, 0.02, steel, Math.cos(angle) * 0.085, Math.sin(angle) * 0.085, 0, rotor).rotation.set(0.35, side * 0.4, angle);
    }
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      tube(new Vector3(side * 0.59, 0, -0.72), new Vector3(side * 0.59 + Math.cos(angle) * 0.15, Math.sin(angle) * 0.15, -0.72), 0.02, teal);
    }
    barrel(0.1, 0.12, teal, side * 0.34, 0.15, 0.64);
    oval(0.075, 0.075, 0.024, lamp, side * 0.34, 0.15, 0.7);
    box(0.03, 0.1, 0.26, teal, side * 0.7, 0.06, -0.03).rotation.z = side * -0.1;
  }
  barrel(0.11, 0.05, rubber, 0, 0.07, 0.8);
  oval(0.085, 0.085, 0.036, display, 0, 0.07, 0.825);
  box(0.49, 0.09, 0.19, teal, 0, -0.19, 0.61);
  // The tools, as seen from behind: the Vacuum's intake in the middle, the Cutter on the right (-X) and the Seed
  // launcher's tube on the left.
  barrel(0.102, 0.21, steel, 0, -0.2, 0.77, true);
  barrel(0.086, 0.19, pipeInside, 0, -0.2, 0.77, true);
  ring(0.104, 0.025, rubber, 0, -0.2, 0.88);
  barrel(0.086, 0.02, rubber, 0, -0.2, 0.69);
  barrel(0.04, 0.22, steel, -0.23, -0.19, 0.75);
  oval(0.036, 0.036, 0.02, cutter, -0.23, -0.19, 0.87);
  barrel(0.055, 0.22, orange, 0.23, -0.19, 0.75, true);
  barrel(0.042, 0.21, pipeInside, 0.23, -0.19, 0.75, true);
  return compactGroup(model);
}

const rotors = new WeakMap<Object3D, (Object3D | undefined)[]>();

/** Named rotor groups survive GLB export; cache them once for either loaded or procedural models. */
export function updateRovPropellers(model: Object3D, dt: number, speed: number): void {
  let pair = rotors.get(model);
  if (!pair) {
    pair = [model.getObjectByName("propeller-left"), model.getObjectByName("propeller-right")];
    rotors.set(model, pair);
  }
  const turn = dt * (speed > 0.05 ? 5 + Math.min(speed, 6) * 3 : 0);
  pair.forEach((rotor, i) => { if (rotor) rotor.rotation.z = (rotor.rotation.z + turn * (i ? -1 : 1)) % (Math.PI * 2); });
}

/** Sets how bright the model's headlight is, 0 (off) to `full` (the lamp at full power). */
export function setHeadlight(model: Object3D, level: number, full: number): void {
  const light = model.getObjectByName("headlight");
  if (light instanceof SpotLight) light.intensity = full * level;
}

/** The loaded GLB, or the procedural sub, with its cave headlight attached at runtime. */
export function createRovModel(): Group {
  const loaded = assets.model("rov");
  const model = new Group();
  model.add(hasMesh(loaded) ? loaded : buildRovMesh());
  // Headlight, so the floor ahead is lit. REQ-014: it is off in open water and lit inside the cave (setHeadlight).
  const light = new SpotLight(0xfff2d6, 0, 30, 0.5, 0.6, 1.5);
  light.name = "headlight";
  light.position.set(0, 0.25, 0.8);
  const target = new Object3D();
  target.position.set(0, -1.5, 8);
  light.target = target;
  model.add(light, target);
  return model;
}
