import { BufferGeometry, Group, Mesh, Object3D, Uint16BufferAttribute, type Material } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** True when `root` is a Group containing at least one Mesh. */
export function hasMesh(root: Object3D | null): root is Group {
  let found = false;
  root?.traverse((child) => {
    if (child instanceof Mesh) found = true;
  });
  return found;
}

function ensureIndexed(geometry: BufferGeometry): BufferGeometry {
  const clone = geometry.clone();
  if (!clone.index) {
    const count = clone.attributes.position.count;
    const indices = new Uint16Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    clone.setIndex(new Uint16BufferAttribute(indices, 1));
  }
  clone.deleteAttribute("uv");
  return clone;
}

/**
 * Merges unnamed sibling Meshes that share the same Material inside `group` (and recursively inside any
 * child Groups such as articulated tails, flippers, or wings) into one indexed Mesh per Material.
 */
export function compactGroup(group: Group): Group {
  const byMaterial = new Map<Material, BufferGeometry[]>();
  const kept: Object3D[] = [];

  for (const child of group.children) {
    if (child instanceof Group && !(child instanceof Mesh)) {
      compactGroup(child);
      kept.push(child);
    } else if (child instanceof Mesh && !child.name && !Array.isArray(child.material)) {
      child.updateMatrix();
      const indexed = ensureIndexed(child.geometry);
      indexed.applyMatrix4(child.matrix);
      indexed.computeVertexNormals();
      indexed.normalizeNormals();
      const list = byMaterial.get(child.material) ?? [];
      list.push(indexed);
      byMaterial.set(child.material, list);
    } else {
      kept.push(child);
    }
  }

  group.clear();
  for (const [material, geos] of byMaterial) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (merged) {
      merged.computeVertexNormals();
      merged.normalizeNormals();
      group.add(new Mesh(merged, material));
    }
  }
  for (const child of kept) {
    group.add(child);
  }
  return group;
}
