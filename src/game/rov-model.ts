import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, SpotLight } from "three";

/** Stand-in ROV built from primitives until the artist's GLB arrives (D-022). Faces +Z like a glTF model. */
export function createRovModel(): Group {
  const hull = new MeshStandardMaterial({ color: 0xf2b134, flatShading: true, roughness: 0.7 });
  const frame = new MeshStandardMaterial({ color: 0x2f3a40, flatShading: true, roughness: 0.9 });
  const lens = new MeshStandardMaterial({ color: 0x9fd3e6, emissive: 0x1d3c48, flatShading: true });
  const lamp = new MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff4d6, emissiveIntensity: 1.5 });

  const model = new Group();
  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };

  add(new Mesh(new BoxGeometry(1.1, 0.55, 1.5), hull), 0, 0.1, 0);
  add(new Mesh(new BoxGeometry(1.2, 0.08, 1.6), frame), 0, -0.2, 0);
  for (const side of [-1, 1]) {
    add(new Mesh(new BoxGeometry(0.12, 0.12, 1.4), frame), side * 0.45, -0.32, 0);
    add(new Mesh(new CylinderGeometry(0.16, 0.16, 0.45, 8), frame), side * 0.7, 0.05, -0.35).rotation.x = Math.PI / 2;
    add(new Mesh(new BoxGeometry(0.14, 0.1, 0.06), lamp), side * 0.35, 0.28, 0.76);
  }
  add(new Mesh(new SphereGeometry(0.22, 8, 6), lens), 0, 0.05, 0.75);

  // Headlight, so the floor ahead is lit in murky water.
  const light = new SpotLight(0xfff2d6, 40, 30, 0.5, 0.6, 1.5);
  light.position.set(0, 0.25, 0.8);
  const target = new Object3D();
  target.position.set(0, -1.5, 8);
  light.target = target;
  model.add(light, target);

  return model;
}
