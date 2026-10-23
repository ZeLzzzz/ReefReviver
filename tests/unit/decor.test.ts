import { Color, InstancedMesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { arches, boulders, constrainToBay, floorHeight, floorSlope, insideRockAt, isSolidAt, rocks } from "../../src/game/bay";
import { createDecorView, decorColour, decorShape } from "../../src/game/decor-model";
import { allSpots, chooseLayout } from "../../src/game/layout";
import { decor, decorClearOf, type Decor, type DecorKind } from "../../src/game/nature";
import { inland } from "../../src/game/terrain";
import { generateTrash } from "../../src/game/trash";

const { bay, nature, rov, station, trash } = config;
const tuning = nature.decor;
const ALGAE: DecorKind[] = ["halimeda", "padina", "sargassum"];

/** Within `reach` m of a small rock's edge, a boulder's edge or an arch's ring (the hard ground). */
function onHardGround(d: Decor, reach: number): boolean {
  return (
    rocks.some((r) => Math.hypot(d.x - r.x, d.z - r.z) < r.size + reach) ||
    boulders.some((b) => Math.hypot(d.x - b.x, d.z - b.z) < b.tiers[0].radius + reach) ||
    arches.some((a) => Math.abs(Math.hypot(d.x - a.x, d.z - a.z) - a.radius) < a.tube + reach)
  );
}

/** On the flat top of a boulder, standing at its height. */
function onBoulderTop(d: Decor): boolean {
  return boulders.some((b) => {
    const top = b.tiers[b.tiers.length - 1];
    return Math.hypot(d.x - b.x, d.z - b.z) < top.radius && Math.abs(d.y - (top.baseY + top.height)) < 1e-9;
  });
}

/** In the shallow shelf in front of the west beach. */
const onShelf = (d: Decor) => inland(d.x, d.z) < 0 && inland(d.x, d.z) > -bay.shore.shelfWidth;

/** Metres of water over the piece. */
const depth = (d: Decor) => bay.surfaceY - d.y;

describe("decoration grows where its kind grows (REQ-021 AC-2 to AC-4)", () => {
  it("puts algae on hard ground that is shallow, or on the shallow shelf, and sargassum no deeper than 10 m (AC-2)", () => {
    for (const d of decor.filter((item) => ALGAE.includes(item.kind))) {
      expect(depth(d)).toBeGreaterThanOrEqual(tuning.shallow);
      expect(depth(d)).toBeLessThanOrEqual(d.kind === "sargassum" ? 10 : tuning.algaeDepth);
      expect(onBoulderTop(d) || onShelf(d) || onHardGround(d, tuning.hardReach)).toBe(true);
    }
  });

  it("puts sponges on rocks, boulders and slopes, never on flat sand, and at least 5 m down (AC-3)", () => {
    for (const d of decor.filter((item) => item.kind === "sponge")) {
      expect(depth(d)).toBeGreaterThanOrEqual(tuning.spongeDepth);
      expect(onHardGround(d, tuning.hardReach) || floorSlope(d.x, d.z) >= tuning.slope).toBe(true);
    }
  });

  it("puts sea fans on boulder sides, arches and slopes, deeper than 10 m, and all of them turned to the same current (AC-4)", () => {
    const fans = decor.filter((item) => item.kind === "fan");
    expect(fans).toHaveLength(tuning.fan.count);
    for (const d of fans) {
      expect(depth(d)).toBeGreaterThan(tuning.fanDepth);
      const boulderOrArch = boulders.some((b) => Math.hypot(d.x - b.x, d.z - b.z) < b.tiers[0].radius + tuning.hardReach) || arches.some((a) => Math.abs(Math.hypot(d.x - a.x, d.z - a.z) - a.radius) < a.tube + tuning.hardReach);
      expect(boulderOrArch || floorSlope(d.x, d.z) >= tuning.slope).toBe(true);
      expect(d.yaw).toBe(tuning.current);
    }
  });

  it("stands no piece inside a rock, a boulder, an arch or a coral, nor on a planting spot, a net, the shed, the start, the dock or the cave (AC-6)", () => {
    for (const d of decor) {
      expect(insideRockAt(d.x, d.y + 0.2, d.z, 0.2)).toBe(false);
      for (const spot of allSpots) expect(Math.hypot(d.x - spot.x, d.z - spot.z)).toBeGreaterThan(bay.padRadius + bay.padBlend);
      expect(Math.hypot(d.x - station.x, d.z - station.z)).toBeGreaterThan(station.padRadius + station.padBlend);
      expect(Math.hypot(d.x - rov.start.x, d.z - rov.start.z)).toBeGreaterThan(12);
      expect(Math.hypot(d.x - bay.cave.x, d.z - bay.cave.z)).toBeGreaterThan(bay.cave.clear);
      expect(Math.hypot(d.x - bay.dock.x, d.z - bay.dock.z)).toBeGreaterThan(bay.dock.clear);
    }
  });

  it("keeps every piece apart from the others", () => {
    for (let i = 0; i < decor.length; i++) {
      for (let j = i + 1; j < decor.length; j++) {
        const a = decor[i];
        const b = decor[j];
        const reachA = a.size * tuning[a.kind].reach;
        const reachB = b.size * tuning[b.kind].reach;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(reachA + reachB);
      }
    }
  });
});

describe("the shapes are the sizes the ACs give (REQ-021 AC-1, AC-3, AC-4)", () => {
  /** The size of a kind's shape at size 1, in metres. */
  const extent = (kind: DecorKind) => {
    const geometry = decorShape(kind);
    geometry.computeBoundingBox();
    return geometry.boundingBox!.getSize(new Vector3());
  };

  it("Halimeda is about 30 to 40 cm tall, Padina about 20 to 30 cm across, Sargassum about 0.5 to 1 m tall", () => {
    const [halimedaMin, halimedaMax] = tuning.halimeda.size;
    expect(extent("halimeda").y * halimedaMin).toBeGreaterThanOrEqual(0.3);
    expect(extent("halimeda").y * halimedaMax).toBeLessThanOrEqual(0.4);
    const [padinaMin, padinaMax] = tuning.padina.size;
    expect(extent("padina").x * padinaMin).toBeGreaterThanOrEqual(0.2);
    expect(extent("padina").x * padinaMax).toBeLessThanOrEqual(0.3);
    const [sargassumMin, sargassumMax] = tuning.sargassum.size;
    expect(extent("sargassum").y * sargassumMin).toBeGreaterThanOrEqual(0.5);
    expect(extent("sargassum").y * sargassumMax).toBeLessThanOrEqual(1);
  });

  it("barrel sponges are 0.4 to 1.2 m tall, sea fans 1 to 2 m", () => {
    const [spongeMin, spongeMax] = tuning.sponge.size;
    expect(extent("sponge").y * spongeMin).toBeGreaterThanOrEqual(0.4);
    expect(extent("sponge").y * spongeMax).toBeLessThanOrEqual(1.2);
    const [fanMin, fanMax] = tuning.fan.size;
    expect(extent("fan").y * fanMin).toBeGreaterThanOrEqual(1);
    expect(extent("fan").y * fanMax).toBeLessThanOrEqual(2);
  });
});

describe("decoration does not cover the trash (REQ-021 AC-6)", () => {
  const dives = [trash.seed, ...[1, 2, 3, 4, 5].map((seed) => chooseLayout(seed).trashSeed)];

  it("no piece on show lies over an item of the trash, in any of these dives", () => {
    let hidden = 0;
    for (const seed of dives) {
      const homes = generateTrash(seed).map((item) => item.home);
      const shown = decorClearOf(homes);
      hidden += decor.length - shown.length;
      for (const d of shown) {
        for (const home of homes) expect(Math.hypot(home.x - d.x, home.z - d.z)).toBeGreaterThanOrEqual(d.size * tuning[d.kind].reach + tuning.clearOfTrash);
      }
    }
    // The rule does work: in some of these dives it hides a piece.
    expect(hidden).toBeGreaterThan(0);
  });

  it("the view hides the covered pieces, and shows them all again once the trash is gone", () => {
    const view = createDecorView();
    const homes = generateTrash(dives[0]).map((item) => item.home);
    view.setTrash(homes);
    expect(view.look().shown).toBe(decorClearOf(homes).length);
    view.setTrash([]);
    expect(view.look().shown).toBe(decor.length);
  });
});

describe("the colours of the decoration (REQ-021 AC-5)", () => {
  it("are dull before the Bloom, then each piece takes its own colour, and the algae stay green or brown, never red", () => {
    const view = createDecorView();
    expect(new Set(view.look().colours)).toEqual(new Set([tuning.dull]));
    view.setBloom(1);
    const shown = view.shown();
    expect(view.look().colours).toEqual(shown.map((d) => decorColour(d)));
    for (const d of shown) {
      const hex = decorColour(d);
      const hsl = { h: 0, s: 0, l: 0 };
      new Color(hex).getHSL(hsl);
      const hue = hsl.h * 360;
      if (d.kind === "halimeda") expect(hue).toBeGreaterThan(70);
      if (d.kind === "halimeda") expect(hue).toBeLessThan(160);
      if (d.kind === "sargassum") expect(hue).toBeGreaterThan(20);
      if (d.kind === "sargassum") expect(hue).toBeLessThan(50);
      if (ALGAE.includes(d.kind)) expect(hue < 20 || hue > 330).toBe(false);
      // Padina is whitish: its three 8-bit channels are close together.
      const channels = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
      if (d.kind === "padina") expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(64);
    }
  });

  it("turn steadily from dull to their colours during the Bloom, with no flash (REQ-021 AC-5, REQ-005 AC-7)", () => {
    const view = createDecorView();
    let last = view.look().colours.map((hex) => new Color(hex));
    for (let i = 1; i <= 100; i++) {
      view.setBloom(i / 100);
      const now = view.look().colours.map((hex) => new Color(hex));
      now.forEach((colour, k) => {
        for (const channel of ["r", "g", "b"] as const) expect(Math.abs(colour[channel] - last[k][channel])).toBeLessThan(0.05);
      });
      last = now;
    }
    expect(view.look().colours).toEqual(decor.map((d) => decorColour(d)));
  });
});

describe("decoration is passable and no tool treats it as a target (REQ-021 AC-6, REQ-013 AC-6)", () => {
  it("a sponge or a sea fan is not solid: the submarine is not pushed out of it, and a seed or a shot passes through", () => {
    const pieces = decor.filter((d) => d.kind === "sponge" || d.kind === "fan");
    expect(pieces.length).toBeGreaterThan(0);
    for (const d of pieces) {
      const inside = new Vector3(d.x, floorHeight(d.x, d.z) + 1, d.z);
      if (insideRockAt(inside.x, inside.y, inside.z, 1)) continue;
      expect(isSolidAt(inside.x, inside.y, inside.z)).toBe(false);
      const pushed = inside.clone();
      constrainToBay(pushed, new Vector3());
      expect(pushed.distanceTo(inside)).toBeLessThan(1e-6);
    }
  });

  it("the view is a handful of meshes, one per kind", () => {
    const view = createDecorView();
    expect(view.group.children).toHaveLength(5);
    expect(view.group.children.every((child) => child instanceof InstancedMesh)).toBe(true);
  });
});
