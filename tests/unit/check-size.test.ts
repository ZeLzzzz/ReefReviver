// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// REQ-009 AC-6: `npm run build` ends with scripts/check-size.mjs, which fails a build over 50 MB.
const run = (dir: string) => spawnSync(process.execPath, ["scripts/check-size.mjs", dir], { encoding: "utf8" });
const made: string[] = [];
afterEach(() => made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A build folder with one small page and a nested file of the given size (a sparse file, so no disk is used). */
function buildOf(bigFileBytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), "reef-size-"));
  made.push(dir);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html>");
  const big = join(dir, "assets", "big.glb");
  writeFileSync(big, "");
  truncateSync(big, bigFileBytes);
  return dir;
}

describe("build size check (REQ-009 AC-6)", () => {
  it("passes a build under 50 MB and prints its size", () => {
    const result = run(buildOf(10_000_000));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("10.00 MB");
  });

  it("fails a build over 50 MB, counting files in sub-folders", () => {
    const result = run(buildOf(50_000_001));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("over the 50 MB limit");
  });

  it("fails when there is no build folder", () => {
    expect(run(join(tmpdir(), "reef-no-such-folder")).status).toBe(1);
  });
});
