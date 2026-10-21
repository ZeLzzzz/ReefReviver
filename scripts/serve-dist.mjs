// Serves the production build from a sub-path, like a static host such as itch.io does, to prove the build
// uses relative paths (REQ-009 AC-1). Everything outside the sub-path is a 404.
// Usage: node scripts/serve-dist.mjs [port] [sub-path] [folder]
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const port = Number(process.argv[2] ?? 5222);
const prefix = `/${(process.argv[3] ?? "game").replace(/^\/+|\/+$/g, "")}/`;
const root = resolve(process.argv[4] ?? "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost");
  let file = null;
  if (pathname.startsWith(prefix)) {
    const relative = decodeURIComponent(pathname.slice(prefix.length)) || "index.html";
    const candidate = normalize(join(root, relative));
    // Stay inside the build folder, whatever the URL says.
    if (candidate.startsWith(root + sep)) file = candidate;
  }
  let size = -1;
  try {
    if (file && statSync(file).isFile()) size = statSync(file).size;
  } catch {
    // Not found.
  }
  if (size < 0) {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": size,
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(response);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${prefix}`));
