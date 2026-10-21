// Fails when the production build is bigger than the contest allows (REQ-009 AC-6). Run by `npm run build`.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LIMIT_BYTES = 50 * 1000 * 1000;
const dir = process.argv[2] ?? "dist";

function sizeOf(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

let bytes;
try {
  bytes = sizeOf(dir);
} catch {
  console.error(`check-size: no ${dir}/ folder; build first.`);
  process.exit(1);
}
const megabytes = (bytes / 1e6).toFixed(2);
if (bytes > LIMIT_BYTES) {
  console.error(`check-size: ${dir}/ is ${megabytes} MB, over the ${LIMIT_BYTES / 1e6} MB limit.`);
  process.exit(1);
}
console.log(`check-size: ${dir}/ is ${megabytes} MB (limit ${LIMIT_BYTES / 1e6} MB).`);
