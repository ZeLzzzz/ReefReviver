import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry } from "three";
import { colored, compactGroup } from "./model-utils";

// One matte material coloured per vertex: the whole attendant is a single draw call (D-136, D-137).
const MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true });

/** A stationary workshop attendant, feet at the origin and facing +Z; low-poly like the bay (D-137). */
export function buildStationAttendant(): Group {
  const skin = 0xb67f58, hair = 0x3e3832, grey = 0x918a75;
  const shirt = 0xd8b675, apron = 0x39766b, pocket = 0x548a76;
  const trousers = 0x384b51, boots = 0x4b4035, cream = 0xeee4c9;
  const frames = 0x574c39, eyes = 0x292f30, lips = 0x744c39, pencil = 0xd88b42;
  const model = new Group();
  model.name = "station-attendant";
  const add = (geometry: BufferGeometry, color: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(colored(geometry, color), MATERIAL);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  // Big parts get six sides, small ones (eyes, ears, hands) five.
  const oval = (color: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, small = false) => {
    const mesh = add(small ? new SphereGeometry(1, 5, 3) : new SphereGeometry(1, 6, 4), color, x, y, z);
    mesh.scale.set(rx, ry, rz);
    return mesh;
  };
  // A limb from `a` to `b`; its ends are hidden in a joint or the body, so it has five sides and no caps.
  const segment = (a: [number, number, number], b: [number, number, number], top: number, bottom: number, color: number, sides = 5) => {
    const from = new Vector3(...a), to = new Vector3(...b);
    const center = from.clone().add(to).multiplyScalar(0.5), direction = from.sub(to);
    const mesh = add(new CylinderGeometry(top, bottom, direction.length(), sides, 1, true), color, center.x, center.y, center.z);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
    return mesh;
  };

  oval(trousers, 0, 0.8, 0, 0.25, 0.16, 0.17);
  add(new CylinderGeometry(0.3, 0.255, 0.58, 8), shirt, 0, 1.075, 0).scale.z = 0.65;
  add(new CylinderGeometry(0.075, 0.09, 0.16, 5, 1, true), skin, 0, 1.4, 0);
  add(new CylinderGeometry(0.1, 0.1, 0.03, 5, 1, true), cream, 0, 1.362, 0);
  for (const side of [-1, 1]) {
    segment([side * 0.13, 0.78, 0], [side * 0.14, 0.13, 0], 0.115, 0.078, trousers);
    oval(boots, side * 0.14, 0.08, 0.065, 0.108, 0.08, 0.18);
    oval(shirt, side * 0.29, 1.245, 0, 0.13, 0.17, 0.12);
    add(new CylinderGeometry(0.102, 0.102, 0.055, 5, 1, true), cream, side * 0.31, 1.14, 0);
    segment([side * 0.31, 1.14, 0], [side * 0.33, 0.97, 0.04], 0.082, 0.067, skin);
    oval(skin, side * 0.33, 0.97, 0.04, 0.07, 0.07, 0.07, true);
    segment([side * 0.33, 0.97, 0.04], [side * 0.265, 0.744, 0.3], 0.067, 0.048, skin);
    oval(skin, side * 0.265, 0.744, 0.325, 0.075, 0.038, 0.095, true);
    segment([side * 0.19, 1.36, 0.035], [side * 0.15, 1.27, 0.19], 0.026, 0.026, apron, 4);
  }
  const bib = new Shape();
  bib.moveTo(-0.15, 1.31);
  bib.lineTo(0.15, 1.31);
  bib.lineTo(0.17, 1.1);
  bib.lineTo(0.27, 0.78);
  bib.lineTo(0.245, 0.69);
  bib.lineTo(-0.245, 0.69);
  bib.lineTo(-0.27, 0.78);
  bib.lineTo(-0.17, 1.1);
  bib.closePath();
  add(new ExtrudeGeometry(bib, { depth: 0.025, bevelEnabled: false }), apron, 0, 0, 0.19);
  add(new BoxGeometry(0.22, 0.15, 0.02), pocket, 0, 0.94, 0.226);
  add(new BoxGeometry(0.23, 0.02, 0.02), cream, 0, 1.01, 0.236);
  add(new CylinderGeometry(0.011, 0.011, 0.15, 4), pencil, 0.067, 1.04, 0.247).rotation.z = -0.12;
  add(new BoxGeometry(0.095, 0.055, 0.02), cream, -0.065, 1.22, 0.222);

  add(new SphereGeometry(1, 8, 5), skin, 0, 1.63, 0.015).scale.set(0.215, 0.255, 0.185);
  for (const side of [-1, 1]) {
    oval(skin, side * 0.215, 1.65, 0.005, 0.044, 0.065, 0.04, true);
    oval(cream, side * 0.083, 1.71, 0.181, 0.043, 0.037, 0.022, true);
    oval(eyes, side * 0.083, 1.71, 0.203, 0.02, 0.024, 0.012, true);
    add(new TorusGeometry(0.065, 0.011, 3, 8), frames, side * 0.083, 1.71, 0.218);
    segment([side * 0.147, 1.72, 0.218], [side * 0.214, 1.72, 0.02], 0.011, 0.011, frames, 4);
    const brow = oval(hair, side * 0.083, 1.785, 0.16, 0.052, 0.02, 0.02, true);
    brow.rotation.z = side * 0.08;
  }
  segment([-0.018, 1.715, 0.222], [0.018, 1.715, 0.222], 0.011, 0.011, frames, 4);
  oval(skin, 0, 1.637, 0.202, 0.038, 0.048, 0.045, true);
  add(new TorusGeometry(0.052, 0.011, 3, 4, Math.PI * 2 / 3), lips, 0, 1.56, 0.19).rotation.z = Math.PI * 7 / 6;

  const crown = add(new SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, 0, 1.79, -0.015);
  crown.scale.set(0.223, 0.148, 0.19);
  oval(hair, -0.074, 1.845, 0.095, 0.145, 0.07, 0.1).rotation.z = 0.17;
  oval(hair, 0.115, 1.81, 0.09, 0.09, 0.055, 0.09).rotation.z = -0.25;
  for (const side of [-1, 1]) oval(grey, side * 0.204, 1.744, -0.005, 0.025, 0.063, 0.07, true);
  return compactGroup(model);
}
