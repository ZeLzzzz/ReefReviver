import { Color, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { constrainToBay, corals, floorHeight, isSolidAt } from "../../src/game/bay";
import { allSpots } from "../../src/game/layout";
import { decor, meadows, naturalTargets } from "../../src/game/nature";
import { createNatureView } from "../../src/game/nature-model";
import { ReefField } from "../../src/game/reef-sites";
import { aimedScanTarget, collectScanTargets, Scanner } from "../../src/game/scanner";
import { SeedLauncher } from "../../src/game/seed-launcher";
import { wallness } from "../../src/game/terrain";

const { nature, bloom, bay, reef } = config;

describe("natural coral (REQ-013 AC-1, AC-2)", () => {
  it("grows as colonies on the hard ground, solid as blobs that stand clear of every spot a site or a net can be on (REQ-020 replaces the 30 scattered clusters)", () => {
    expect(corals.length).toBeGreaterThan(50);
    for (const c of corals) {
      expect(c.radius).toBeGreaterThan(0.5);
      expect(c.height).toBeGreaterThan(0.4);
      // On the belt, a hill top, a boulder or an arch; never in the deep sand valleys.
      if (c.y - floorHeight(c.x, c.z) < 1) expect(floorHeight(c.x, c.z)).toBeLessThanOrEqual(bay.surfaceY - nature.coral.belt.minDepth + 0.5);
      for (const spot of allSpots) expect(Math.hypot(c.x - spot.x, c.z - spot.z)).toBeGreaterThan(bay.padRadius);
    }
  });

  it("is pale and dull before the Bloom, and turns the six pastel colours during it, steadily, without flashing", () => {
    const view = createNatureView();
    expect(new Set(view.look().coral)).toEqual(new Set([nature.pale]));
    let last = view.look().coral.map((hex) => new Color(hex));
    for (let i = 1; i <= 100; i++) {
      view.setBloom(i / 100);
      const now = view.look().coral.map((hex) => new Color(hex));
      now.forEach((colour, k) => {
        for (const channel of ["r", "g", "b"] as const) expect(Math.abs(colour[channel] - last[k][channel])).toBeLessThan(0.05);
      });
      last = now;
    }
    expect(view.look().coral).toEqual([...bloom.coral.pastel]);
    view.setBloom(0);
    expect(new Set(view.look().coral)).toEqual(new Set([nature.pale]));
  });
});

describe("light rays (REQ-013 AC-3)", () => {
  it("show only after the Bloom, under the water", () => {
    const view = createNatureView();
    const camera = new Vector3(0, -8, 0);
    view.update(0.1, camera, false);
    expect(view.look().rays).toBe(0);
    view.setBloom(1);
    view.update(0.1, camera, false);
    expect(view.look().rays).toBeGreaterThan(0);
    view.update(0.1, new Vector3(-140, 2, 0), true);
    expect(view.look().rays).toBe(0);
    expect(view.group.children.filter((c) => c.name === "light-ray").every((r) => !r.visible)).toBe(true);
  });
});

describe("decoration (REQ-013 AC-4, AC-6)", () => {
  it("scatters sponges, sea fans and algae over the bay, and no kelp", () => {
    const count = (kind: string) => decor.filter((d) => d.kind === kind).length;
    expect(count("sponge")).toBe(nature.decor.sponges);
    expect(count("fan")).toBe(nature.decor.fans);
    expect(count("algae")).toBe(nature.decor.algae);
    expect(new Set(decor.map((d) => d.kind))).toEqual(new Set(["sponge", "fan", "algae"]));
    const quarters = new Set(decor.map((d) => (d.x > 0 ? 1 : 0) + (d.z > 0 ? 2 : 0)));
    expect(quarters.size).toBe(4);
    for (const d of decor) expect(d.y).toBeLessThan(bay.surfaceY - 5);
  });

  it("lets the submarine pass through small decoration, but not through a big coral cluster", () => {
    const sponge = decor.find((d) => d.kind === "sponge")!;
    const at = new Vector3(sponge.x, sponge.y + 1, sponge.z);
    const before = at.clone();
    constrainToBay(at, new Vector3());
    // Only the floor may move it, never the sponge itself.
    expect(Math.hypot(at.x - before.x, at.z - before.z)).toBeLessThan(0.3);
    const coral = corals.find((c) => c.y - floorHeight(c.x, c.z) < 1)!;
    const inside = new Vector3(coral.x, coral.y + coral.height * 0.3, coral.z);
    constrainToBay(inside, new Vector3());
    const d = Math.hypot((inside.x - coral.x) / (coral.radius + 0.8), (inside.y - coral.y) / (coral.height + 0.8), (inside.z - coral.z) / (coral.radius + 0.8));
    expect(d).toBeGreaterThanOrEqual(1 - 1e-6);
  });

  it("loses a seed that hits coral or a meadow: neither is a planting site", () => {
    const field = new ReefField();
    const coral = corals.find((c) => c.y - floorHeight(c.x, c.z) < 1)!;
    expect(isSolidAt(coral.x, coral.y + coral.height * 0.3, coral.z)).toBe(true);
    const launcher = new SeedLauncher();
    const target = new Vector3(coral.x, coral.y + coral.height * 0.3, coral.z);
    const from = new Vector3(coral.x - 6, target.y, coral.z);
    launcher.fire(from, target, target.clone().sub(from).normalize());
    let results: ReturnType<SeedLauncher["update"]> = [];
    for (let t = 0; t < 2; t += 1 / 60) results = results.concat(launcher.update(1 / 60, field));
    expect(results.every((r) => r.kind === "miss")).toBe(true);
    for (const meadow of meadows) expect(field.targetAt(meadow.x, meadow.y, meadow.z)).toBeNull();
    expect(field.frames.every((f) => f.fragments === 0) && field.patches.every((p) => p.seeds === 0)).toBe(true);
  });
});

describe("scanning the natural reef (REQ-013 AC-5, AC-8)", () => {
  const empty = new ReefField();

  it("offers every coral cluster for the coral entry and every meadow for the seagrass entry", () => {
    const targets = collectScanTargets([], [], 0, empty.frames, empty.patches, naturalTargets);
    expect(targets.filter((t) => t.entry === "coral")).toHaveLength(corals.length);
    expect(targets.filter((t) => t.entry === "seagrass")).toHaveLength(meadows.length);
  });

  it("opens the coral entry from a natural cluster, then says it is already recorded", () => {
    const coral = naturalTargets.find((t) => t.entry === "coral")!;
    // From above and a little to the side: the reef is dense, so a low eye could be inside it. Every natural coral is a
    // target, as in the game, so the ray meets the nearest one, outside the reef's other blobs.
    const eye = new Vector3(coral.x - 3, coral.y + 4, coral.z);
    const aim = new Vector3(coral.x, coral.y, coral.z).sub(eye).normalize();
    const hit = aimedScanTarget(eye, aim, eye, naturalTargets.map((t) => ({ ...t, trapped: false })))!;
    expect(hit).toMatchObject({ entry: "coral", trapped: false });
    const scanner = new Scanner();
    const unlocked = new Set<string>();
    let event = null;
    for (let t = 0; t < config.scanner.seconds + 0.1 && !event; t += 0.05) event = scanner.update(0.05, true, hit, unlocked as never);
    expect(event).toEqual({ kind: "scanned", entry: "coral" });
    unlocked.add("coral");
    const again = new Scanner();
    let repeat = null;
    for (let t = 0; t < config.scanner.seconds + 0.1 && !repeat; t += 0.05) repeat = again.update(0.05, true, hit, unlocked as never);
    expect(repeat).toEqual({ kind: "known" });
  });
});

describe("natural seagrass meadows (REQ-013 AC-8)", () => {
  it("are 8 to 12 meadows on the shallow sand off the west beach (REQ-019 AC-1), never on a planting spot", () => {
    expect(meadows.length).toBeGreaterThanOrEqual(8);
    expect(meadows.length).toBeLessThanOrEqual(12);
    for (const meadow of meadows) {
      expect(meadow.y).toBeGreaterThan(bay.surfaceY - 7);
      expect(wallness(meadow.x, meadow.z)).toBe(0);
      expect(meadow.blades.length).toBeGreaterThan(50);
      const spots = [...reef.patchSpots, ...reef.frameSpots];
      expect(meadow.blades.every((blade) => spots.every((spot) => Math.hypot(blade.x - spot.x, blade.z - spot.z) > bay.padRadius))).toBe(true);
      // A meadow reaches a little past its radius at the ragged edge, never further than 1.3 times.
      for (const blade of meadow.blades) expect(Math.hypot(blade.x - meadow.x, blade.z - meadow.z)).toBeLessThanOrEqual(meadow.radius * 1.3 + 1e-6);
    }
  });

  it("are sparse and brown before the Bloom, then all their blades show, taller and green", () => {
    const view = createNatureView();
    const total = meadows.reduce((sum, m) => sum + m.blades.length, 0);
    const before = view.look();
    expect(before.seagrass).toBe(nature.meadows.brown);
    expect(before.bladesShown / total).toBeGreaterThan(nature.meadows.sparse - 0.05);
    expect(before.bladesShown / total).toBeLessThan(nature.meadows.sparse + 0.05);
    view.setBloom(1);
    const after = view.look();
    expect(after.seagrass).toBe(nature.meadows.green);
    expect(after.bladesShown).toBe(total);
  });
});
