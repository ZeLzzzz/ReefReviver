import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry } from "three";
import { colored, compactGroup } from "./model-utils";

// One matte material coloured per vertex: each joint of a person is a single draw call (D-136).
const MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: true });
const cream = 0xf1e4c5, dark = 0x303b3c, white = 0xfff4dd;
const red = 0xc34d3c, blue = 0x477b83, brass = 0xc59a54;

export interface CrewRig {
  model: Group;
  body: Group;
  head: Group;
  arms: Group[];
  elbows: Group[];
  legs: Group[];
  knees: Group[];
}

/** The body pivots at the hips; each limb keeps its joints through material batching. Low-poly like the bay (D-136). */
export function buildCrewMember(index: number): CrewRig {
  const model = new Group();
  model.name = "dumper-crew";
  const body = new Group();
  body.name = "crew-body";
  body.position.y = 0.86;
  model.add(body);
  const skin = index === 0 ? 0xb98358 : 0xd5a577;
  const hair = index === 0 ? 0xcba54b : 0x5b4030;
  const shirt = index === 0 ? red : blue;
  const add = (parent: Group, geometry: BufferGeometry, color: number, x: number, y: number, z: number) => {
    const mesh = new Mesh(colored(geometry, color), MATERIAL);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  // Big parts get six sides, small ones (eyes, ears, hands) five.
  const oval = (parent: Group, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, small = false) => {
    const mesh = add(parent, small ? new SphereGeometry(1, 5, 3) : new SphereGeometry(1, 6, 4), color, x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  };
  // A limb or band whose ends are hidden in a joint or the body: five sides, no caps.
  const limb = (top: number, bottom: number, length: number, sides = 5) => new CylinderGeometry(top, bottom, length, sides, 1, true);
  const joint = (parent: Group, name: string, x: number, y: number) => {
    const group = new Group();
    group.name = name;
    group.position.set(x, y, 0);
    parent.add(group);
    return group;
  };
  add(body, new CylinderGeometry(0.255, 0.19, 0.58, 8), shirt, 0, 0.29, 0).scale.z = 0.7;
  // The stripes run down the shirt's eight edges.
  for (let stripe = 0; stripe < 8; stripe++) {
    const arc = new CylinderGeometry(0.258, 0.193, 0.565, 2, 1, true, stripe * Math.PI / 4 - 0.06, 0.12);
    add(body, arc, cream, 0, 0.29, 0).scale.z = 0.7;
  }
  oval(body, dark, 0, -0.015, 0, 0.205, 0.13, 0.15);
  add(body, limb(0.2, 0.2, 0.045, 8), dark, 0, 0.035, 0).scale.z = 0.76;
  add(body, new BoxGeometry(0.065, 0.045, 0.02), brass, 0, 0.035, 0.157);
  for (const side of [-1, 1]) {
    const collar = add(body, new BoxGeometry(0.115, 0.16, 0.025), cream, side * 0.075, 0.525, 0.163);
    collar.rotation.z = side * -0.4;
  }
  add(body, limb(0.073, 0.09, 0.17), skin, 0, 0.635, 0);
  const head = joint(body, "crew-head", 0, 0.7);
  add(head, new SphereGeometry(1, 8, 5), skin, 0, 0.29, 0.015).scale.set(index === 0 ? 0.195 : 0.225, 0.31, 0.175);
  oval(head, skin, 0, 0.07, 0.06, 0.14, 0.12, 0.14);
  for (const side of [-1, 1]) {
    oval(head, skin, side * 0.205, 0.28, 0, 0.045, 0.077, 0.045, true);
    oval(head, white, side * 0.09, 0.365, 0.163, 0.075, 0.088, 0.05, true);
    oval(head, dark, side * 0.09 + 0.012, 0.36, 0.207, 0.023, 0.032, 0.02, true);
    const brow = add(head, new BoxGeometry(0.105, 0.022, 0.03), hair, side * 0.09, 0.47 + side * 0.012, 0.17);
    brow.rotation.z = side * (index === 0 ? 0.14 : -0.18);
  }
  oval(head, skin, 0.005, 0.27, 0.205, 0.043, 0.072, 0.07, true);
  const mouth = add(head, new BoxGeometry(0.09, 0.02, 0.02), dark, 0.018, 0.14, 0.167);
  mouth.rotation.z = -0.12;
  oval(head, hair, 0, 0.43, -0.075, 0.205, 0.21, 0.135);
  if (index === 0) {
    for (const side of [-1, 1]) {
      const lock = oval(head, hair, side * 0.18, 0.24, -0.035, 0.06, 0.26, 0.12);
      lock.rotation.z = side * -0.08;
    }
    add(head, new CylinderGeometry(0.195, 0.215, 0.12, 8), red, 0, 0.59, 0).scale.z = 0.85;
    for (const y of [0.562, 0.608]) add(head, limb(0.21, 0.21, 0.02, 8), cream, 0, y, 0).scale.z = 0.85;
  } else {
    oval(head, blue, 0, 0.59, -0.015, 0.24, 0.1, 0.2);
    add(head, limb(0.225, 0.225, 0.055, 8), dark, 0, 0.54, 0).scale.z = 0.85;
    oval(head, dark, 0, 0.52, 0.17, 0.21, 0.025, 0.12);
    for (const side of [-1, 1]) oval(head, hair, side * 0.045, 0.195, 0.18, 0.065, 0.026, 0.027, true).rotation.z = side * 0.2;
  }
  const arms: Group[] = [], elbows: Group[] = [], legs: Group[] = [], knees: Group[] = [];
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? "left" : "right";
    const arm = joint(body, `shoulder-${suffix}`, side * 0.265, 0.51);
    oval(arm, shirt, 0, -0.065, 0, 0.105, 0.145, 0.105);
    add(arm, limb(0.094, 0.094, 0.04), cream, 0, -0.15, 0);
    add(arm, limb(0.073, 0.055, 0.19), skin, 0, -0.235, 0);
    const elbow = joint(arm, `elbow-${suffix}`, 0, -0.33);
    oval(elbow, skin, 0, 0, 0, 0.06, 0.065, 0.06, true);
    add(elbow, limb(0.057, 0.043, 0.26), skin, 0, -0.13, 0);
    oval(elbow, skin, 0, -0.295, 0.01, 0.065, 0.083, 0.039, true);
    const leg = joint(body, `hip-${suffix}`, side * 0.115, -0.04);
    add(leg, limb(0.105, 0.079, 0.34), dark, 0, -0.17, 0);
    const knee = joint(leg, `knee-${suffix}`, 0, -0.34);
    oval(knee, dark, 0, 0, 0, 0.08, 0.08, 0.08, true);
    add(knee, limb(0.078, 0.063, 0.32), dark, 0, -0.16, 0);
    add(knee, limb(0.081, 0.081, 0.065), cream, 0, -0.245, 0);
    oval(knee, dark, 0, -0.38, 0.055, 0.09, 0.08, 0.16);
    arms.push(arm); elbows.push(elbow); legs.push(leg); knees.push(knee);
  }
  if (index === 1) head.scale.set(1.02, 0.88, 1.02);
  compactGroup(model);
  return { model, body, head, arms, elbows, legs, knees };
}

export function poseCrew(rig: CrewRig, phase: "aboard" | "clinging" | "swimming" | "ashore", seconds: number, index: number): void {
  const cycle = seconds * 4.6 + index * 1.9;
  const swimming = phase === "swimming";
  const blend = swimming ? Math.min(1, seconds / 0.65) : 0;
  rig.body.rotation.set(blend * 1.22, 0, swimming ? Math.sin(cycle) * 0.09 * blend : Math.sin(seconds * 1.7 + index) * 0.025);
  rig.head.rotation.set(-0.95 * blend, Math.sin(seconds * 0.7 + index) * (swimming ? 0.08 : 0.14), 0);
  rig.arms.forEach((arm, i) => {
    const side = i === 0 ? -1 : 1;
    const stroke = cycle + i * Math.PI;
    if (swimming) {
      arm.rotation.set(-1.65 * (1 - blend) - stroke * blend, 0, side * (0.18 + 0.12 * Math.sin(stroke)));
      rig.elbows[i].rotation.x = -0.25 - 0.95 * Math.max(0, -Math.sin(stroke)) * blend;
      rig.legs[i].rotation.x = Math.sin(stroke * 2 + i * Math.PI) * 0.22 * blend;
      rig.knees[i].rotation.x = 0.18 + Math.max(0, Math.cos(stroke * 2 + i * Math.PI)) * 0.3 * blend;
    } else if (phase === "clinging") {
      arm.rotation.set(-1.65 + 0.15 * Math.sin(stroke), 0, side * 0.4);
      rig.elbows[i].rotation.x = -0.65;
      rig.legs[i].rotation.x = Math.sin(stroke) * 0.12;
      rig.knees[i].rotation.x = 0.35;
    } else {
      arm.rotation.set((index === 1 ? -0.32 : -0.08) + Math.sin(cycle * 0.35 + i) * 0.06, 0, side * (index === 1 ? -0.22 : 0.12));
      rig.elbows[i].rotation.x = index === 1 ? -0.6 : -0.15;
      rig.legs[i].rotation.x = 0;
      rig.knees[i].rotation.x = 0;
    }
  });
}
