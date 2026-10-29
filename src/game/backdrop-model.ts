import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute,
  Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { config } from "../config";
import { forestTrees, lighthouseSite } from "./backdrop";
import { compactGroup } from "./model-utils";

const UP = new Vector3(0, 1, 0);

function painted(geometry: BufferGeometry, color: Color): BufferGeometry {
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.deleteAttribute("uv");
  return geometry;
}

/** Flattened, scalloped crowns and visible forked branches, in a one-metre tree that instances scale up. */
function treeGeometry(variant: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const bark = new Color(0x66533b);
  const branch = (a: Vector3, b: Vector3, radius: number) => {
    const direction = b.clone().sub(a);
    const geometry = new CylinderGeometry(radius * 0.48, radius, direction.length(), 5);
    geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP, direction.normalize()));
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(painted(geometry, bark));
  };
  const dark = new Color(0x304c31), light = new Color(0x789953);
  const shade = new Color();
  const crown = (cx: number, cy: number, cz: number, radius: number, height: number, phase: number) => {
    const geometry = new BufferGeometry();
    const points: number[] = [], colors: number[] = [], indices: number[] = [];
    const sides = 12;
    const widths = [0.38, 0.96, 1, 0.67, 0.06];
    const levels = [0, 0.18, 0.42, 0.8, 1];
    for (let ring = 0; ring < widths.length; ring++) {
      for (let side = 0; side < sides; side++) {
        const angle = side * Math.PI * 2 / sides;
        const edge = 1 + 0.12 * Math.sin(angle * 3 + phase) + 0.07 * Math.cos(angle * 5 - phase);
        const r = radius * widths[ring] * edge;
        points.push(cx + Math.cos(angle) * r,
          cy + levels[ring] * height + Math.sin(angle * 3 + phase) * height * 0.045,
          cz + Math.sin(angle) * r * (0.83 + variant * 0.06));
        shade.copy(dark).lerp(light, 0.12 + levels[ring] * 0.75);
        shade.multiplyScalar(0.92 + 0.08 * Math.sin(side * 2.3 + phase));
        colors.push(shade.r, shade.g, shade.b);
        if (ring < widths.length - 1) {
          const a = ring * sides + side, b = ring * sides + (side + 1) % sides;
          indices.push(a, a + sides, b, b, a + sides, b + sides);
        }
      }
    }
    for (let side = 1; side < sides - 1; side++) {
      indices.push(0, side, side + 1);
      const top = (widths.length - 1) * sides;
      indices.push(top, top + side + 1, top + side);
    }
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    parts.push(geometry);
  };

  const fork = new Vector3(0.025 * Math.sin(variant + 1), 0.48, 0.02);
  branch(new Vector3(0, -0.035, 0), fork, 0.032);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + variant * 0.9;
    const reach = 0.17 + 0.04 * Math.sin(i * 1.8 + variant);
    const tip = new Vector3(Math.cos(angle) * reach, 0.59 + 0.1 * Math.sin(i * 1.7 + variant), Math.sin(angle) * reach);
    branch(fork, tip.clone().add(new Vector3(0, 0.1, 0)), 0.017);
    crown(tip.x, tip.y, tip.z, 0.22 + 0.035 * Math.cos(i + variant), 0.23, angle + i);
  }
  branch(fork, new Vector3(-0.025, 0.87, 0.015), 0.019);
  crown(-0.025, 0.78, 0.015, 0.29 + variant * 0.018, 0.23, variant + 1.2);
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((part) => part.dispose());
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function createForest(): Group {
  const group = new Group();
  group.name = "coastal-forest";
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const position = new Vector3(), scale = new Vector3(), turn = new Quaternion(), matrix = new Matrix4();
  const color = new Color(), near = new Color(0xffffff), far = new Color(0xa6c5bc);
  for (let variant = 0; variant < 3; variant++) {
    const geometry = treeGeometry(variant);
    for (let depth = 0; depth < 2; depth++) for (let stretch = 0; stretch < 4; stretch++) {
      const trees = forestTrees.filter((tree) => tree.variant === variant
        && (tree.x < -250 ? 1 : 0) === depth
        && Math.min(3, Math.floor((tree.z + config.land.backdrop.forest.halfLength) / (config.land.backdrop.forest.halfLength * 2) * 4)) === stretch);
      if (!trees.length) continue;
      const mesh = new InstancedMesh(geometry, material, trees.length);
      mesh.name = `forest-${variant}-${depth}-${stretch}`;
      trees.forEach((tree, index) => {
        matrix.compose(position.set(tree.x, tree.y, tree.z), turn.setFromAxisAngle(UP, tree.yaw),
          scale.set(tree.height * (0.9 + tree.shade * 0.2), tree.height, tree.height));
        mesh.setMatrixAt(index, matrix);
        color.copy(near).lerp(far, Math.min(1, (-tree.x - 170) / 180));
        mesh.setColorAt(index, color.multiplyScalar(0.85 + tree.shade * 0.15));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return group;
}

function createLighthouse(): Group {
  const group = new Group();
  group.name = "headland-lighthouse";
  const plaster = new MeshStandardMaterial({ color: 0xe9ddbd, roughness: 0.94, flatShading: true });
  const brick = new MeshStandardMaterial({ color: 0xa25e44, roughness: 0.9, flatShading: true });
  const stone = new MeshStandardMaterial({ color: 0x928a75, roughness: 1, flatShading: true });
  const metal = new MeshStandardMaterial({ color: 0x344e4a, roughness: 0.65, metalness: 0.15, flatShading: true });
  const dark = new MeshStandardMaterial({ color: 0x303c37, roughness: 0.92 });
  const lamp = new MeshBasicMaterial({ color: 0xf4d799 });
  const { height, baseRadius } = config.land.backdrop.lighthouse;
  const shoulder = height - 4.3;
  const topRadius = baseRadius * 0.62;
  const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const cylinder = (top: number, bottom: number, height: number, y: number, material: Material) => {
    const geometry = new CylinderGeometry(top, bottom, height, 8);
    geometry.rotateY(Math.PI / 8);
    return add(geometry, material, 0, y, 0);
  };
  const bar = (a: Vector3, b: Vector3, radius: number, material: Material) => {
    const direction = b.clone().sub(a);
    const middle = a.clone().add(b).multiplyScalar(0.5);
    const mesh = add(new CylinderGeometry(radius, radius, direction.length(), 5), material, middle.x, middle.y, middle.z);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  };
  const radiusAt = (y: number) => baseRadius + (topRadius - baseRadius) * (y - 0.75) / (shoulder - 0.75);
  cylinder(lighthouseSite.foundationRadius - 0.16, lighthouseSite.foundationRadius, lighthouseSite.foundationDepth, -lighthouseSite.foundationDepth / 2, stone);
  cylinder(baseRadius, baseRadius + 0.15, 0.75, 0.375, brick);
  cylinder(topRadius, baseRadius, shoulder - 0.75, (shoulder + 0.75) / 2, plaster);
  cylinder(radiusAt(shoulder - 1.1) + 0.025, radiusAt(shoulder - 2.2) + 0.025, 1.1, shoulder - 1.65, brick);
  const balcony = baseRadius * 0.97;
  cylinder(balcony, topRadius + 0.15, 0.3, shoulder + 0.15, plaster);
  cylinder(balcony, balcony, 0.12, shoulder + 0.36, metal);
  cylinder(1.56, 1.67, 0.24, shoulder + 0.54, metal);
  cylinder(1.4, 1.4, 2.04, shoulder + 1.68, lamp);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + Math.PI / 8, b = a + Math.PI / 4;
    bar(new Vector3(Math.cos(a) * 1.44, shoulder + 0.65, Math.sin(a) * 1.44), new Vector3(Math.cos(a) * 1.44, shoulder + 2.72, Math.sin(a) * 1.44), 0.055, metal);
    const rail = balcony - 0.12;
    bar(new Vector3(Math.cos(a) * rail, shoulder + 0.42, Math.sin(a) * rail), new Vector3(Math.cos(a) * rail, shoulder + 1.55, Math.sin(a) * rail), 0.04, metal);
    for (const y of [shoulder + 0.95, shoulder + 1.55]) bar(new Vector3(Math.cos(a) * rail, y, Math.sin(a) * rail), new Vector3(Math.cos(b) * rail, y, Math.sin(b) * rail), 0.035, metal);
  }
  cylinder(1.77, 1.77, 0.16, shoulder + 2.78, metal);
  add(new ConeGeometry(1.96, 1.15, 8), metal, 0, shoulder + 3.435, 0).rotation.y = Math.PI / 8;
  cylinder(0.05, 0.09, 0.29, height - 0.145, metal);
  const doorX = radiusAt(1.85) * Math.cos(Math.PI / 8);
  add(new BoxGeometry(0.24, 2.2, 1.05), dark, doorX + 0.07, 1.85, 0);
  add(new BoxGeometry(0.3, 0.18, 1.35), stone, doorX + 0.08, 3.04, 0);
  for (let step = 0; step < 3; step++) {
    add(new BoxGeometry(0.42, 0.25 * (3 - step), 1.4), stone, baseRadius * 0.94 + 0.2 + step * 0.32, 0.125 * (3 - step), 0);
  }
  for (const y of [5.3, 10.3, 15.3]) for (const angle of [0, Math.PI / 2]) {
    const r = radiusAt(y) * Math.cos(Math.PI / 8);
    const window = add(new BoxGeometry(0.2, 1.05, 0.5), dark, Math.cos(angle) * (r + 0.045), y, Math.sin(angle) * (r + 0.045));
    window.rotation.y = -angle;
    const sill = add(new BoxGeometry(0.28, 0.12, 0.7), plaster, Math.cos(angle) * (r + 0.08), y - 0.59, Math.sin(angle) * (r + 0.08));
    sill.rotation.y = -angle;
  }
  compactGroup(group);
  group.position.set(lighthouseSite.x, lighthouseSite.y, lighthouseSite.z);
  return group;
}

export function createLandBackdrop(): Group {
  const group = new Group();
  group.name = "land-backdrop";
  group.add(createForest(), createLighthouse());
  // Above-water scenery is hidden during a dive, where the water fog would obscure it anyway.
  group.visible = false;
  return group;
}
