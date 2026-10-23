import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "vite";
import { Mesh } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

if (typeof globalThis.FileReader === "undefined") {
  globalThis.FileReader = class FileReader {
    onloadend = null;
    onerror = null;
    result = null;
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = buffer;
          if (this.onloadend) this.onloadend();
        })
        .catch((err) => {
          if (this.onerror) this.onerror(err);
        });
    }
  };
}

function countTriangles(root) {
  let triangles = 0;
  root.traverse((node) => {
    if (node instanceof Mesh && node.geometry) {
      const count = node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count;
      triangles += count / 3;
    }
  });
  return Math.round(triangles);
}

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });

try {
  const { buildRovMesh } = await server.ssrLoadModule("/src/game/rov-model.ts");
  const { buildRockMesh, createCliffGeometry } = await server.ssrLoadModule("/src/game/world.ts");
  const { buildTrashMesh } = await server.ssrLoadModule("/src/game/trash-model.ts");
  const { buildStationMesh } = await server.ssrLoadModule("/src/game/station-model.ts");
  const { buildTurtleMesh, buildSharkMesh } = await server.ssrLoadModule("/src/game/animal-model.ts");
  const { buildGhostNetMesh } = await server.ssrLoadModule("/src/game/net-model.ts");
  const { buildFrameMesh, buildFragmentMesh, buildSeagrassMesh } = await server.ssrLoadModule("/src/game/reef-model.ts");
  const {
    buildClownfishMesh,
    buildAnemoneMesh,
    buildYellowtailMesh,
    buildMantaMesh,
    buildDolphinMesh,
  } = await server.ssrLoadModule("/src/game/sea-life-model.ts");

  const models = [
    { id: "rov", build: () => buildRovMesh() },
    { id: "rock-0", build: () => buildRockMesh(0) },
    { id: "rock-1", build: () => buildRockMesh(1) },
    { id: "rock-2", build: () => buildRockMesh(2) },
    { id: "trash-bottle-0", build: () => buildTrashMesh("bottle", 0) },
    { id: "trash-bottle-1", build: () => buildTrashMesh("bottle", 1) },
    { id: "trash-bottle-2", build: () => buildTrashMesh("bottle", 2) },
    { id: "trash-bag-0", build: () => buildTrashMesh("bag", 0) },
    { id: "trash-bag-1", build: () => buildTrashMesh("bag", 1) },
    { id: "trash-bag-2", build: () => buildTrashMesh("bag", 2) },
    { id: "trash-can-0", build: () => buildTrashMesh("can", 0) },
    { id: "trash-can-1", build: () => buildTrashMesh("can", 1) },
    { id: "trash-can-2", build: () => buildTrashMesh("can", 2) },
    { id: "station", build: () => buildStationMesh() },
    { id: "turtle", build: () => buildTurtleMesh() },
    { id: "reef-shark", build: () => buildSharkMesh() },
    { id: "ghost-net", build: () => buildGhostNetMesh() },
    { id: "reef-frame", build: () => buildFrameMesh() },
    { id: "coral-0", build: () => buildFragmentMesh(0) },
    { id: "coral-1", build: () => buildFragmentMesh(1) },
    { id: "coral-2", build: () => buildFragmentMesh(2) },
    { id: "seagrass-sprout", build: () => buildSeagrassMesh(false) },
    { id: "seagrass-adult", build: () => buildSeagrassMesh(true) },
    { id: "clownfish", build: () => buildClownfishMesh() },
    { id: "anemone", build: () => buildAnemoneMesh() },
    { id: "yellowtail", build: () => buildYellowtailMesh() },
    { id: "manta-ray", build: () => buildMantaMesh() },
    { id: "spinner-dolphin", build: () => buildDolphinMesh() },
  ];

  const outDir = join(process.cwd(), "public", "assets", "models");
  mkdirSync(outDir, { recursive: true });

  const exporter = new GLTFExporter();
  const manifestFiles = [];

  for (const { id, build } of models) {
    const scene = build();
    const triangles = countTriangles(scene);
    const arrayBuffer = await exporter.parseAsync(scene, { binary: true });
    const buffer = Buffer.from(arrayBuffer);
    const filename = `${id}.glb`;
    writeFileSync(join(outDir, filename), buffer);
    manifestFiles.push({ id, url: `models/${filename}` });
    console.log(`${id.padEnd(18)} | ${String(triangles).padStart(5)} tris | ${(buffer.byteLength / 1024).toFixed(1).padStart(6)} KB`);
  }

  const cliffGeo = createCliffGeometry();
  const cliffTris = cliffGeo.index ? cliffGeo.index.count / 3 : cliffGeo.attributes.position.count / 3;
  console.log(`bay-cliffs (proc)  | ${String(cliffTris).padStart(5)} tris`);

  writeFileSync(
    join(process.cwd(), "public", "assets", "manifest.json"),
    JSON.stringify({ files: manifestFiles }, null, 2) + "\n",
  );
  console.log(`\nWrote ${manifestFiles.length} GLB models and public/assets/manifest.json`);
} finally {
  await server.close();
}
