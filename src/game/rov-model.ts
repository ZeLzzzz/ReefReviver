import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
} from "three";
import { assets } from "../assets";
import { compactGroup, hasMesh } from "./model-utils";

/**
 * Low-poly mini submarine facing +Z (D-022, D-029, D-070). Built so the rear thrusters, top buoyancy hull, the
 * glass cockpit with its pilot (D-082), landing skids, viewport dome and tool bay read clearly from the third-person
 * camera. In the code it is still called the ROV.
 */
export function buildRovMesh(): Group {
  const hull = new MeshStandardMaterial({ color: 0xf2b134, flatShading: true, roughness: 0.55 });
  const accent = new MeshStandardMaterial({ color: 0xe06d1a, flatShading: true, roughness: 0.6 });
  const frame = new MeshStandardMaterial({ color: 0x2f3a40, flatShading: true, roughness: 0.85 });
  const steel = new MeshStandardMaterial({ color: 0x647580, flatShading: true, roughness: 0.5, metalness: 0.35 });
  const lens = new MeshStandardMaterial({ color: 0x9fd3e6, emissive: 0x1d3c48, flatShading: true, roughness: 0.25 });
  const lamp = new MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff4d6, emissiveIntensity: 1.5, flatShading: true });
  const strobe = new MeshStandardMaterial({ color: 0x6ff2ff, emissive: 0x2ab8cc, flatShading: true });
  const cutterTip = new MeshStandardMaterial({ color: 0xff2d95, emissive: 0x7a1044, flatShading: true });

  const model = new Group();
  model.name = "rov";
  const add = (mesh: Mesh, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    model.add(mesh);
    return mesh;
  };

  // Main syntactic foam hull and bevelled top canopy.
  add(new Mesh(new BoxGeometry(0.96, 0.42, 1.36), hull), 0, 0.12, 0.02);
  const canopy = new CylinderGeometry(0.34, 0.48, 1.24, 6);
  canopy.rotateX(Math.PI / 2);
  canopy.scale(1.05, 0.45, 1);
  add(new Mesh(canopy, hull), 0, 0.34, 0.0);

  // Vertical dorsal thruster tunnel and top grab handle.
  add(new Mesh(new CylinderGeometry(0.18, 0.18, 0.48, 8), frame), 0, 0.16, -0.02);
  add(new Mesh(new CylinderGeometry(0.13, 0.13, 0.5, 8), steel), 0, 0.16, -0.02);
  add(new Mesh(new BoxGeometry(0.46, 0.05, 0.06), frame), 0, 0.46, -0.32);
  for (const side of [-1, 1]) {
    add(new Mesh(new BoxGeometry(0.05, 0.14, 0.06), frame), side * 0.2, 0.39, -0.32);
  }

  // Rear telemetry beacon. (A crewed submarine has no tether, so there is no umbilical boot.)
  add(new Mesh(new SphereGeometry(0.07, 6, 5), strobe), 0, 0.42, -0.52);

  // D-082: the glass cockpit dome on top of the hull, with the pilot's head and shoulders inside, so it reads as crewed.
  const pilot = new Mesh(new SphereGeometry(0.11, 8, 6), new MeshStandardMaterial({ color: 0x2b3440, flatShading: true, roughness: 0.7 }));
  pilot.name = "pilot";
  add(pilot, 0, 0.66, 0.16);
  const shoulders = new Mesh(new SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), new MeshStandardMaterial({ color: 0xe06d1a, flatShading: true, roughness: 0.7 }));
  shoulders.name = "pilot-suit";
  add(shoulders, 0, 0.5, 0.16);
  const glass = new MeshStandardMaterial({ color: 0xbfe8f5, transparent: true, opacity: 0.38, roughness: 0.08, metalness: 0.2, depthWrite: false });
  const dome = new Mesh(new SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.name = "cockpit-dome";
  add(dome, 0, 0.5, 0.16);

  // Lower equipment chassis tray.
  add(new Mesh(new BoxGeometry(1.12, 0.08, 1.48), frame), 0, -0.16, 0);

  // Side buoyancy sponsons, landing skids, rear ducted thrusters and forward LED pods.
  const sponsonGeo = new CylinderGeometry(0.16, 0.18, 1.38, 6);
  sponsonGeo.rotateX(Math.PI / 2);
  const bandGeo = new CylinderGeometry(0.185, 0.185, 0.14, 6);
  bandGeo.rotateX(Math.PI / 2);
  const shroudGeo = new CylinderGeometry(0.2, 0.22, 0.36, 8);
  shroudGeo.rotateX(Math.PI / 2);
  const ringGeo = new TorusGeometry(0.2, 0.025, 6, 8);

  for (const side of [-1, 1]) {
    // Side sponson with orange hazard bands.
    add(new Mesh(sponsonGeo, hull), side * 0.52, 0.16, 0.02);
    add(new Mesh(bandGeo, accent), side * 0.52, 0.16, 0.42);
    add(new Mesh(bandGeo, accent), side * 0.52, 0.16, -0.36);

    // Bottom landing skid runner and vertical struts.
    add(new Mesh(new BoxGeometry(0.1, 0.09, 1.54), frame), side * 0.46, -0.34, 0);
    add(new Mesh(new BoxGeometry(0.1, 0.08, 0.22), accent), side * 0.46, -0.31, 0.82, -0.35, 0, 0);
    add(new Mesh(new BoxGeometry(0.08, 0.18, 0.1), frame), side * 0.46, -0.25, 0.46);
    add(new Mesh(new BoxGeometry(0.08, 0.18, 0.1), frame), side * 0.46, -0.25, -0.46);

    // Rear ducted thruster with hub and rotor blades.
    add(new Mesh( new BoxGeometry(0.16, 0.08, 0.14), frame), side * 0.56, 0.04, -0.42);
    add(new Mesh(shroudGeo, frame), side * 0.68, 0.04, -0.48);
    add(new Mesh(ringGeo, accent), side * 0.68, 0.04, -0.66);
    add(new Mesh(new ConeGeometry(0.065, 0.24, 6), steel), side * 0.68, 0.04, -0.5, -Math.PI / 2, 0, 0);
    for (let b = 0; b < 4; b++) {
      const angle = (b * Math.PI) / 2 + 0.4;
      add(
        new Mesh(new BoxGeometry(0.16, 0.025, 0.07), steel),
        side * 0.68 + Math.cos(angle) * 0.08,
        0.04 + Math.sin(angle) * 0.08,
        -0.48,
        0.35,
        0,
        angle,
      );
    }

    // Forward LED floodlight housing and glowing lens.
    add(new Mesh(new BoxGeometry(0.18, 0.13, 0.14), frame), side * 0.36, 0.29, 0.7);
    add(new Mesh(new BoxGeometry(0.14, 0.09, 0.04), lamp), side * 0.36, 0.29, 0.77);
  }

  // Front acrylic camera dome, bezel ring and internal lens.
  add(new Mesh(new TorusGeometry(0.24, 0.035, 6, 10), frame), 0, 0.06, 0.68);
  add(new Mesh(new CylinderGeometry(0.09, 0.11, 0.14, 8), steel), 0, 0.06, 0.68, Math.PI / 2, 0, 0);
  add(new Mesh(new SphereGeometry(0.23, 10, 8), lens), 0, 0.06, 0.72);

  // Lower multi-tool manifold: vacuum intake (centre), cutter emitter (left), seed tube (right).
  add(new Mesh(new CylinderGeometry(0.13, 0.08, 0.26, 8), steel), 0, -0.24, 0.74, Math.PI / 2, 0, 0);
  add(new Mesh(new CylinderGeometry(0.045, 0.055, 0.28, 6), steel), -0.3, -0.22, 0.74, Math.PI / 2, 0, 0);
  add(new Mesh(new SphereGeometry(0.045, 6, 4), cutterTip), -0.3, -0.22, 0.88);
  add(new Mesh(new CylinderGeometry(0.065, 0.075, 0.28, 6), accent), 0.3, -0.22, 0.74, Math.PI / 2, 0, 0);

  return compactGroup(model);
}

/** The submarine's model with its forward headlight; uses the loaded GLB from `assets` when available (D-022). */
export function createRovModel(): Group {
  const loaded = assets.model("rov");
  const model = new Group();
  model.add(hasMesh(loaded) ? loaded : buildRovMesh());
  // Headlight, so the floor ahead is lit in murky water.
  const light = new SpotLight(0xfff2d6, 40, 30, 0.5, 0.6, 1.5);
  light.position.set(0, 0.25, 0.8);
  const target = new Object3D();
  target.position.set(0, -1.5, 8);
  light.target = target;
  model.add(light, target);

  return model;
}
