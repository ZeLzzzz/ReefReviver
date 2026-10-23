import { Frustum, InstancedMesh, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { arches, boulders, colonies, constrainToBay, corals, floorHeight, insideRockAt, isSolidAt, reefs, terrainSolidAt } from "../../src/game/bay";
import { createCoralView } from "../../src/game/coral-model";
import { FOOTPRINT, TOP } from "../../src/game/coral-reef";
import { followCamera, keepCameraInWater } from "../../src/game/follow-camera";
import { allSpots, chooseLayout } from "../../src/game/layout";
import { naturalTargets } from "../../src/game/nature";
import { ReefField } from "../../src/game/reef-sites";
import { aimedScanTarget, Scanner } from "../../src/game/scanner";
import { SeedLauncher } from "../../src/game/seed-launcher";
import { generateTrash } from "../../src/game/trash";
import { inCave } from "../../src/game/cave";

const { bay, rov, nature, station, trash } = config;
const spec = nature.coral;
const heads = colonies.filter((c) => c.kind === 4);
const belt = colonies.filter((c) => reefs[c.reef].kind === "belt" && c.kind !== 4);
const patchReefs = reefs.filter((r) => r.kind === "patch");
const depthOf = (c: { x: number; z: number }) => bay.surfaceY - floorHeight(c.x, c.z);

describe("the reef belt (REQ-020 AC-1)", () => {
  it("lies along the edge of the shallow shelf, 7 to 12.5 m deep, over the length of the open shore", () => {
    expect(belt.length).toBeGreaterThan(1500);
    for (const c of belt) {
      expect(depthOf(c)).toBeGreaterThanOrEqual(spec.belt.minDepth);
      expect(depthOf(c)).toBeLessThanOrEqual(spec.belt.maxDepth);
    }
    const zs = belt.map((c) => c.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(150);
    // It is a belt, not a blob: within the open shore most 5 m stretches have some of it, with sand between the rest.
    const stretches = Array.from({ length: 36 }, (_, i) => belt.some((c) => c.z >= -90 + i * 5 && c.z < -85 + i * 5));
    expect(stretches.filter(Boolean).length).toBeGreaterThanOrEqual(24);
    expect(stretches.filter((on) => !on).length).toBeGreaterThanOrEqual(2);
  });

  it("stays 8 m or more from the start, and clear of the dock, the shed and the cave", () => {
    for (const c of colonies) {
      expect(Math.hypot(c.x - rov.start.x, c.z - rov.start.z)).toBeGreaterThanOrEqual(8);
      expect(Math.hypot(c.x - station.x, c.z - station.z)).toBeGreaterThan(station.padRadius + station.padBlend);
      expect(Math.hypot(c.x - bay.dock.x, c.z - bay.dock.z)).toBeGreaterThan(bay.dock.clear);
      expect(Math.hypot(c.x - bay.cave.x, c.z - bay.cave.z)).toBeGreaterThan(bay.cave.clear);
    }
  });

  it("is already in view at the start: colonies and a big Porites head ahead on both sides of the cleared start", () => {
    const camera = new PerspectiveCamera(config.camera.fov, 16 / 9, 0.1, config.camera.far);
    const target = new Vector3();
    followCamera({ position: new Vector3(rov.start.x, rov.start.y, rov.start.z), velocity: new Vector3(), yaw: rov.start.yaw, pitch: 0 }, camera.position, target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const seen = (c: { x: number; y: number; z: number; size: number }, within: number) =>
      camera.position.distanceTo(new Vector3(c.x, c.y, c.z)) <= within && frustum.containsPoint(new Vector3(c.x, c.y + c.size * 0.3, c.z));
    expect(colonies.filter((c) => c.kind !== 4 && seen(c, 30)).length).toBeGreaterThanOrEqual(20);
    expect(heads.some((c) => seen(c, 25))).toBe(true);
  });
});

describe("the patch reefs (REQ-020 AC-2)", () => {
  it("are 8 to 12, 5 to 20 m wide, on hill tops, boulders and arches", () => {
    expect(patchReefs.length).toBeGreaterThanOrEqual(8);
    expect(patchReefs.length).toBeLessThanOrEqual(12);
    for (const r of patchReefs) {
      expect(r.width).toBeGreaterThanOrEqual(5);
      expect(r.width).toBeLessThanOrEqual(20);
      expect(r.colonies).toBeGreaterThan(25);
    }
    expect(new Set(patchReefs.map((r) => r.host))).toEqual(new Set(["hill", "boulder", "arch"]));
  });

  it("stand on what they grow on: the flat tops of boulders, the crown of an arch, the floor of a hill top", () => {
    const index = (host: string) => reefs.map((r, i) => (r.kind === "patch" && r.host === host ? i : -1)).filter((i) => i >= 0);
    for (const i of index("boulder")) {
      const boulder = boulders.find((b) => Math.hypot(b.x - reefs[i].x, b.z - reefs[i].z) < 0.5)!;
      const [lower, upper] = boulder.tiers;
      for (const c of colonies.filter((k) => k.reef === i && k.kind !== 4)) {
        const d = Math.hypot(c.x - boulder.x, c.z - boulder.z);
        const top = d < upper.radius ? upper.baseY + upper.height : lower.baseY + lower.height;
        expect(d).toBeLessThan(lower.radius);
        expect(Math.abs(c.y - top)).toBeLessThan(0.2);
      }
    }
    for (const i of index("arch")) {
      const arch = arches.find((a) => Math.hypot(a.x - reefs[i].x, a.z - reefs[i].z) < 0.5)!;
      for (const c of colonies.filter((k) => k.reef === i)) {
        // Within a tube's width of the arch's rock, and above the ring's middle.
        expect(c.y).toBeGreaterThan(arch.y + arch.radius * 0.5);
        expect(Math.hypot(c.x - arch.x, c.z - arch.z)).toBeLessThan(arch.radius + arch.tube + 0.5);
      }
    }
    for (const i of index("hill")) {
      for (const c of colonies.filter((k) => k.reef === i && k.kind !== 4)) {
        expect(Math.abs(c.y - floorHeight(c.x, c.z))).toBeLessThan(0.1);
        expect(Math.hypot(c.x - reefs[i].x, c.z - reefs[i].z)).toBeLessThan(reefs[i].width * 0.75);
      }
    }
  });

  it("leave the deep sand valleys almost empty", () => {
    const deep = colonies.filter((c) => depthOf(c) > 14 && c.y - floorHeight(c.x, c.z) < 1);
    expect(deep.length).toBeLessThanOrEqual(colonies.length * 0.03);
    // A few single heads at most: no reef, no blob, deeper than 15 m.
    expect(corals.filter((c) => bay.surfaceY - c.y > 15).length).toBeLessThanOrEqual(5);
  });
});

describe("the colonies (REQ-020 AC-3)", () => {
  it("are 0.3 to 1.5 m, of the four shapes, small ones the most, packed close together", () => {
    const small = colonies.filter((c) => c.kind !== 4);
    for (const c of small) {
      expect(c.size).toBeGreaterThanOrEqual(spec.minSize - 1e-9);
      expect(c.size).toBeLessThanOrEqual(spec.maxSize + 1e-9);
    }
    expect(new Set(small.map((c) => c.kind))).toEqual(new Set([0, 1, 2, 3]));
    for (const reef of [belt, ...patchReefs.map((_, i) => colonies.filter((c) => c.reef === i + 1 && c.kind !== 4))]) expect(new Set(reef.map((c) => c.kind)).size).toBe(4);
    expect(small.filter((c) => c.size < 0.9).length).toBeGreaterThan(small.length * 0.6);
    // Along the belt, colonies cover a good share (over 30%) of many 10 m squares.
    const cells = new Map<string, number>();
    for (const c of belt) {
      const key = `${Math.floor(c.x / 10)},${Math.floor(c.z / 10)}`;
      cells.set(key, (cells.get(key) ?? 0) + Math.PI * (c.size * FOOTPRINT[c.kind] * 0.5) ** 2);
    }
    const dense = [...cells.values()].filter((area) => area > 100 * 0.3);
    expect(dense.length).toBeGreaterThanOrEqual(10);
  });

  it("include 4 to 6 big Porites heads, 2 to 4 m across, as landmarks, solid like the reefs", () => {
    expect(heads.length).toBeGreaterThanOrEqual(4);
    expect(heads.length).toBeLessThanOrEqual(6);
    for (const head of heads) {
      expect(head.size).toBeGreaterThanOrEqual(2);
      expect(head.size).toBeLessThanOrEqual(4);
      expect(insideRockAt(head.x, head.y + head.size * TOP[4] * 0.4, head.z)).toBe(true);
    }
    expect(reefs[heads[0].reef].kind === "belt" || heads.some((h) => reefs[h.reef].kind === "belt")).toBe(true);
    // Far apart, so each is a landmark of its own.
    for (const a of heads) for (const b of heads) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(10);
  });
});

describe("the colour (REQ-020 AC-4)", () => {
  it("uses all six pastel colours, in one material each, pale before the Bloom and pastel after it, all together", () => {
    expect(new Set(colonies.map((c) => c.colour))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    const view = createCoralView();
    expect(view.materials).toHaveLength(6);
    expect(new Set(view.materials.map((m) => m.color.getHex()))).toEqual(new Set([nature.pale]));
    view.setBloom(1);
    expect(view.materials.map((m) => m.color.getHex())).toEqual([...config.bloom.coral.pastel]);
    // Halfway, every colour is between its pale and its pastel (they move together, steadily).
    view.setBloom(0.5);
    view.materials.forEach((m) => expect([nature.pale, ...config.bloom.coral.pastel]).not.toContain(m.color.getHex()));
  });
});

describe("the reef is solid (REQ-020 AC-5)", () => {
  const sample = colonies.filter((c) => c.kind !== 4);

  it("covers nearly every colony: a point inside a colony is inside a blob", () => {
    const inside = sample.filter((c) => insideRockAt(c.x, c.y + c.size * TOP[c.kind] * 0.3, c.z, 0.05));
    expect(inside.length / sample.length).toBeGreaterThan(0.93);
  });

  it("stops the submarine from going into a reef, but lets it hover over it", () => {
    for (const c of [...sample.filter((_, i) => i % 97 === 0), ...heads]) {
      const middle = new Vector3(c.x, c.y + c.size * TOP[c.kind] * 0.3, c.z);
      const p = middle.clone();
      constrainToBay(p, new Vector3());
      expect(insideRockAt(p.x, p.y, p.z, 0)).toBe(false);
      // Well above the reef (and the floor) nothing holds it.
      const above = new Vector3(c.x, c.y + 6, c.z);
      const moved = above.clone();
      constrainToBay(moved, new Vector3());
      expect(moved.distanceTo(above)).toBeLessThan(1e-6);
    }
    // Driving into a head from the side, held low: it stops at the head's surface and loses the speed into it.
    const head = heads.find((h) => reefs[h.reef].kind === "belt")!;
    const p = new Vector3(head.x - head.size / 2 - rov.radius - 2, head.y + 1, head.z);
    const v = new Vector3(3, 0, 0);
    let slowest = 3;
    for (let i = 0; i < 120; i++) {
      p.addScaledVector(v, 1 / 30);
      p.y = head.y + 1;
      constrainToBay(p, v);
      expect(insideRockAt(p.x, p.y, p.z, 0)).toBe(false);
      slowest = Math.min(slowest, v.x);
    }
    // It met the head (it lost its speed into it) and slid round it, never through it.
    expect(slowest).toBeLessThan(1);
  });

  it("stops the camera: it is pulled short of a reef between it and the vehicle", () => {
    const head = heads[0];
    const from = new Vector3(head.x - head.size, head.y + 0.9, head.z);
    const camera = new Vector3(head.x + head.size, head.y + 0.9, head.z);
    keepCameraInWater(camera, from);
    expect(camera.x).toBeLessThan(head.x);
    expect(terrainSolidAt(head.x, head.y + 0.5, head.z)).toBe(true);
  });

  it("loses a seed that hits it, without a count (REQ-013 AC-6)", () => {
    const field = new ReefField();
    const head = heads[0];
    const target = new Vector3(head.x, head.y + head.size * 0.2, head.z);
    expect(isSolidAt(target.x, target.y, target.z)).toBe(true);
    const launcher = new SeedLauncher();
    const from = new Vector3(head.x - 6, target.y, head.z);
    launcher.fire(from, target, target.clone().sub(from).normalize());
    let results: ReturnType<SeedLauncher["update"]> = [];
    for (let t = 0; t < 2; t += 1 / 60) results = results.concat(launcher.update(1 / 60, field));
    expect(results.every((r) => r.kind === "miss")).toBe(true);
    expect(field.frames.every((f) => f.fragments === 0) && field.patches.every((q) => q.seeds === 0)).toBe(true);
  });
});

describe("the reef keeps clear of everything else (REQ-020 AC-6)", () => {
  it("leaves every candidate spot, with its level pad, free of coral", () => {
    for (const spot of allSpots) {
      for (const c of colonies) expect(Math.hypot(c.x - spot.x, c.z - spot.z)).toBeGreaterThan(bay.padRadius + bay.padBlend);
      for (const c of corals) expect(Math.hypot(c.x - spot.x, c.z - spot.z) - c.radius).toBeGreaterThan(bay.padRadius);
    }
  });

  it("leaves all 60 pieces of trash clear of the reef, with room for the submarine above each", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8].map((s) => chooseLayout(s).trashSeed)) {
      for (const item of generateTrash(seed)) {
        if (inCave(item.home.x, item.home.y + 1, item.home.z) || item.onBeach) continue;
        for (const c of corals) expect(Math.hypot(item.home.x - c.x, item.home.z - c.z)).toBeGreaterThan(c.radius * 0.5);
        const above = item.home.clone().add(new Vector3(0, 2, 0));
        const moved = above.clone();
        constrainToBay(moved, new Vector3());
        expect(moved.distanceTo(above)).toBeLessThan(0.05);
      }
    }
    expect(trash.count).toBe(60);
  });
});

describe("scanning the reef (REQ-020 AC-7)", () => {
  const coralTargets = naturalTargets.filter((t) => t.entry === "coral");

  it("offers the reef's blobs, the belt's and the patch reefs' and the heads', for the coral entry", () => {
    expect(coralTargets).toHaveLength(corals.length);
  });

  it("opens the coral entry from the belt, from a patch reef and from a head, then says it is already recorded", () => {
    const belts = corals.find((c) => c.y > -13 && Math.abs(c.x + 105) < 15 && c.radius < 3.6)!;
    const hill = reefs.findIndex((r) => r.kind === "patch" && r.host === "hill");
    const patch = corals.find((c) => Math.hypot(c.x - reefs[hill].x, c.z - reefs[hill].z) < 3)!;
    for (const coral of [belts, patch, heads[0]]) {
      const target = coralTargets.find((t) => Math.abs(t.x - coral.x) < 1e-9 && Math.abs(t.z - coral.z) < 1e-9)!;
      const eye = new Vector3(target.x - 3, target.y + 4, target.z);
      const aim = new Vector3(target.x, target.y, target.z).sub(eye).normalize();
      const hit = aimedScanTarget(eye, aim, eye, coralTargets.map((t) => ({ ...t, trapped: false })))!;
      expect(hit).toMatchObject({ entry: "coral", trapped: false });
      const scanner = new Scanner();
      let event = null;
      for (let t = 0; t < config.scanner.seconds + 0.1 && !event; t += 0.05) event = scanner.update(0.05, true, hit, new Set());
      expect(event).toEqual({ kind: "scanned", entry: "coral" });
      expect(new Scanner().update(0.05, true, hit, new Set(["coral"]))).toEqual({ kind: "known" });
    }
  });
});

describe("the reef costs a few draw calls (REQ-020 AC-8)", () => {
  it("is one instanced mesh per shape and colour: at most 30, holding every colony once", () => {
    const view = createCoralView();
    const meshes = view.group.children as InstancedMesh[];
    expect(meshes.length).toBeLessThanOrEqual(30);
    expect(view.stats().meshes).toBe(meshes.length);
    expect(meshes.reduce((sum, m) => sum + m.count, 0)).toBe(colonies.length);
    // Colonies spread over the whole shelf and bay, so no instanced mesh may be culled by its own bounding sphere.
    expect(meshes.every((m) => m.frustumCulled === false)).toBe(true);
  });
});
