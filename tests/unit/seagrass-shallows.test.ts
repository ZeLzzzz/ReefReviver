import { Color, InstancedMesh, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { constrainToBay, floorHeight } from "../../src/game/bay";
import { allSpots, chooseLayout, quarterOf } from "../../src/game/layout";
import { meadows, naturalTargets } from "../../src/game/nature";
import { createNatureView } from "../../src/game/nature-model";
import { ReefField } from "../../src/game/reef-sites";
import { aimedScanTarget } from "../../src/game/scanner";
import { currentBend, meadowWeight } from "../../src/game/seagrass";
import { createSeagrassView } from "../../src/game/seagrass-model";
import { inland } from "../../src/game/terrain";

const { nature, bay, reef, rov } = config;
const setup = nature.meadows;
const depthAt = (x: number, z: number) => bay.surfaceY - floorHeight(x, z);
const blades = meadows.flatMap((m) => m.blades);

describe("where the natural seagrass grows (REQ-019 AC-1)", () => {
  it("has 8 to 12 meadows, 8 to 20 m across, along the open shore in front of the west beach", () => {
    expect(meadows.length).toBeGreaterThanOrEqual(8);
    expect(meadows.length).toBeLessThanOrEqual(12);
    for (const meadow of meadows) {
      expect(meadow.radius * 2).toBeGreaterThanOrEqual(8);
      expect(meadow.radius * 2).toBeLessThanOrEqual(20);
      expect(Math.abs(meadow.z)).toBeLessThan(bay.shore.openHalf);
      // In front of the beach: a few metres to a dozen out from the waterline.
      expect(inland(meadow.x, meadow.z)).toBeLessThan(-2);
      expect(inland(meadow.x, meadow.z)).toBeGreaterThan(-16);
    }
  });

  it("keeps every leaf on sand 1 to 7 m deep: none in the deep valleys", () => {
    expect(blades.length).toBeGreaterThan(0);
    const depths = blades.map((b) => depthAt(b.x, b.z));
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(setup.minDepth - 0.05);
    expect(Math.max(...depths)).toBeLessThanOrEqual(setup.maxDepth + 0.05);
    for (const meadow of meadows) {
      expect(depthAt(meadow.x, meadow.z)).toBeGreaterThan(1);
      expect(depthAt(meadow.x, meadow.z)).toBeLessThan(7);
    }
  });

  it("does not overlap: one meadow after the other along the shore", () => {
    const sorted = [...meadows].sort((a, b) => a.z - b.z);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].z - sorted[i].radius).toBeGreaterThan(sorted[i - 1].z + sorted[i - 1].radius - 0.01);
  });
});

describe("what a meadow looks like (REQ-019 AC-2)", () => {
  it("is far denser than the old scattered spikes: at least 15 leaves per square metre over a meadow's disc", () => {
    const area = meadows.reduce((sum, m) => sum + Math.PI * m.radius * m.radius, 0);
    expect(blades.length / area).toBeGreaterThan(15);
  });

  it("has flat ribbon leaves 20 to 35 cm tall, and taller Enhalus clumps of 0.6 to 1 m only in the shallowest water", () => {
    const plain = blades.filter((b) => !b.enhalus);
    const tall = blades.filter((b) => b.enhalus);
    expect(plain.length).toBeGreaterThan(tall.length);
    expect(tall.length).toBeGreaterThan(20);
    for (const b of plain) {
      expect(b.height).toBeGreaterThanOrEqual(0.2);
      expect(b.height).toBeLessThanOrEqual(0.35);
      expect(b.height / b.width).toBeGreaterThan(3);
    }
    for (const b of tall) {
      expect(b.height).toBeGreaterThanOrEqual(0.6);
      expect(b.height).toBeLessThanOrEqual(1);
      expect(depthAt(b.x, b.z)).toBeLessThan(setup.enhalus.depth + 0.05);
    }
  });

  it("draws every leaf as one flat ribbon, cut off blunt at the tip, in a single instanced mesh", () => {
    const view = createSeagrassView(meadows);
    const mesh = view.group.children.find((c) => c.name === "meadows") as InstancedMesh;
    expect(mesh).toBeInstanceOf(InstancedMesh);
    expect(mesh.count).toBe(blades.length);
    const position = mesh.geometry.attributes.position;
    let top = 0;
    let topHalfWidth = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > top) {
        top = position.getY(i);
        topHalfWidth = Math.abs(position.getX(i));
      }
    }
    expect(top).toBe(1);
    // A point would have no width at the tip; a blunt end is more than a third of the widest part.
    expect(topHalfWidth).toBeGreaterThan(0.2);
    expect(view.group.children.filter((c) => c instanceof InstancedMesh)).toHaveLength(1);
  });

  it("lays a green-brown sand tint under each meadow only, fading out toward the edge", () => {
    const view = createSeagrassView(meadows);
    const sand = view.group.children.find((c) => c.name === "meadow-sand") as Mesh;
    expect(sand).toBeInstanceOf(Mesh);
    const position = sand.geometry.attributes.position;
    const colour = sand.geometry.attributes.color;
    expect(colour.itemSize).toBe(4);
    let opaque = 0;
    for (let i = 0; i < position.count; i++) {
      const alpha = colour.getW(i);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
      if (alpha > 0) {
        expect(meadows.some((m) => Math.hypot(position.getX(i) - m.x, position.getZ(i) - m.z) <= m.radius * 1.3 + 1e-6)).toBe(true);
        // A hand above the floor, so it never sinks into it.
        expect(position.getY(i)).toBeGreaterThan(floorHeight(position.getX(i), position.getZ(i)));
      }
      if (alpha > 0.9) opaque++;
    }
    expect(opaque).toBeGreaterThan(100);
    const look = view.look();
    const c = new Color(look.sand);
    // Green-brown: the green channel is the strongest but the red is not far behind.
    expect(c.g).toBeGreaterThanOrEqual(c.b);
    expect(c.r).toBeGreaterThan(c.b);
  });

  it("sways in the current: smooth, gentle, never more than the amplitude, rooted at the base, and not the same everywhere", () => {
    const { amplitude, period } = setup.sway;
    expect(currentBend(10, 20, 0, 1.3)).toBe(0);
    let last = currentBend(-120, 10, 1, 0);
    let low = Infinity;
    let high = -Infinity;
    for (let t = 1 / 60; t <= period * 2; t += 1 / 60) {
      const bend = currentBend(-120, 10, 1, t);
      expect(bend).toBeGreaterThanOrEqual(0);
      expect(bend).toBeLessThanOrEqual(amplitude + 1e-9);
      // No flicker: between two frames the tip moves by a small part of its whole swing.
      expect(Math.abs(bend - last)).toBeLessThan(amplitude * 0.05);
      last = bend;
      low = Math.min(low, bend);
      high = Math.max(high, bend);
    }
    expect(high - low).toBeGreaterThan(amplitude * 0.5);
    expect(currentBend(-120, 10, 1, 0.5 * period)).not.toBeCloseTo(currentBend(-110, 22, 1, 0.5 * period), 3);
    expect(currentBend(-120, 10, 0.5, 1)).toBeLessThan(currentBend(-120, 10, 1, 1) + 1e-9);
  });

  it("builds the current into the leaf material's vertex shader, with its clock running on update", () => {
    const view = createSeagrassView(meadows);
    const mesh = view.group.children.find((c) => c.name === "meadows") as InstancedMesh;
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: "#include <common>\n#include <begin_vertex>\n#include <project_vertex>",
    };
    (mesh.material as unknown as { onBeforeCompile: (s: typeof shader) => void }).onBeforeCompile(shader);
    expect(shader.vertexShader).toContain("uCurrent");
    expect(shader.vertexShader).not.toContain("#include <project_vertex>");
    expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(["uTime", "uCurrent", "uSway", "uGrowth"]));
    expect(view.look().time).toBe(0);
    view.update(0.5);
    expect(view.look().time).toBeCloseTo(0.5);
  });
});

describe("the Bloom (REQ-019 AC-3, REQ-013 AC-8, REQ-005 AC-7)", () => {
  it("is sparse and brown before it, and dense and green after it", () => {
    const view = createSeagrassView(meadows);
    const before = view.look();
    expect(before.seagrass).toBe(setup.brown);
    expect(before.bladesShown / before.blades).toBeGreaterThan(setup.sparse - 0.05);
    expect(before.bladesShown / before.blades).toBeLessThan(setup.sparse + 0.05);
    expect(before.sandOpacity).toBe(setup.sand.opacityBefore);
    view.setBloom(1);
    const after = view.look();
    expect(after.seagrass).toBe(setup.green);
    expect(after.bladesShown).toBe(after.blades);
    expect(after.sand).toBe(setup.sand.green);
    expect(after.sandOpacity).toBe(setup.sand.opacityAfter);
    view.setBloom(0);
    expect(view.look().seagrass).toBe(setup.brown);
  });

  it("turns green and fills in steadily, with no jump between two steps", () => {
    const view = createNatureView();
    let last = view.look();
    for (let i = 1; i <= 100; i++) {
      view.setBloom(i / 100);
      const now = view.look();
      const a = new Color(last.seagrass);
      const b = new Color(now.seagrass);
      for (const channel of ["r", "g", "b"] as const) expect(Math.abs(a[channel] - b[channel])).toBeLessThan(0.05);
      expect(now.bladesShown).toBeGreaterThanOrEqual(last.bladesShown);
      expect(now.bladesShown - last.bladesShown).toBeLessThan(now.blades * 0.1);
      expect(Math.abs(now.sandOpacity - last.sandOpacity)).toBeLessThan(0.05);
      last = now;
    }
    expect(last.seagrass).toBe(setup.green);
  });
});

describe("the player's seagrass patches (REQ-019 AC-4, D-099)", () => {
  it("lie on the shallow sand 2 to 5 m deep, near the natural meadows", () => {
    expect(reef.patchSpots).toHaveLength(5);
    for (const spot of reef.patchSpots) {
      expect(depthAt(spot.x, spot.z)).toBeGreaterThan(2);
      expect(depthAt(spot.x, spot.z)).toBeLessThan(5);
      // Within a few metres of the leaves of some meadow.
      const nearest = Math.min(...blades.map((b) => Math.hypot(b.x - spot.x, b.z - spot.z)));
      expect(nearest).toBeLessThan(setup.spotClear + 4);
    }
  });

  it("keep clear of the reef belt that starts at 7 m, the start, the dock and each other", () => {
    for (const spot of reef.patchSpots) {
      expect(depthAt(spot.x, spot.z)).toBeLessThan(7 - 2);
      expect(Math.hypot(spot.x - rov.start.x, spot.z - rov.start.z)).toBeGreaterThan(20);
      expect(Math.hypot(spot.x - bay.dock.x, spot.z - bay.dock.z)).toBeGreaterThan(bay.dock.clear + 4);
      for (const other of allSpots) if (other !== spot) expect(Math.hypot(spot.x - other.x, spot.z - other.z)).toBeGreaterThanOrEqual(15);
    }
  });

  it("still leaves every dive's seven spots in at least 3 of the 4 quarters of the bay", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const layout = chooseLayout(seed * 104729);
      expect(new Set([...layout.frames, ...layout.patches, ...layout.nets].map(quarterOf)).size).toBeGreaterThanOrEqual(reef.spreadQuarters);
      expect(layout.patches).toHaveLength(2);
    }
  });
});

describe("not in the way (REQ-019 AC-5)", () => {
  it("does not grow within a patch's pad, at the dock, or at the start: a patch stays bare sand", () => {
    const nearest = (to: { x: number; z: number }[]) => blades.reduce((best, b) => to.reduce((m, p) => Math.min(m, Math.hypot(b.x - p.x, b.z - p.z)), best), Infinity);
    expect(nearest([...allSpots])).toBeGreaterThan(bay.padRadius);
    expect(nearest([bay.dock])).toBeGreaterThan(setup.dockClear - 2);
    expect(nearest([rov.start])).toBeGreaterThan(12);
    for (const spot of reef.patchSpots) {
      expect(meadowWeight({ x: spot.x, z: spot.z, radius: 8, phase: 0 }, spot.x, spot.z)).toBe(0);
      for (let a = 0; a < Math.PI * 2; a += 0.3) expect(meadowWeight({ x: spot.x, z: spot.z, radius: 8, phase: 0 }, spot.x + Math.cos(a) * reef.patchRadius, spot.z + Math.sin(a) * reef.patchRadius)).toBe(0);
    }
  });

  it("lets the submarine pass over and through the leaves, and loses a seed that lands on them", () => {
    const blade = blades[Math.floor(blades.length / 2)];
    // Hovering at the height of the tallest leaves (1 m): nothing in the way, so nothing moves the ship.
    for (const rise of [1.2, 1.6]) {
      const at = new Vector3(blade.x, blade.y + rise, blade.z);
      const before = at.clone();
      constrainToBay(at, new Vector3());
      expect(at.distanceTo(before)).toBe(0);
    }
    const field = new ReefField();
    expect(field.targetAt(blade.x, blade.y + 0.02, blade.z)).toBeNull();
    for (const meadow of meadows) expect(field.targetAt(meadow.x, meadow.y, meadow.z)).toBeNull();
  });
});

describe("scanning a meadow (REQ-019 AC-6, REQ-013 AC-8)", () => {
  it("offers every meadow for the seagrass entry, and a ship hovering above it can aim at it", () => {
    const targets = naturalTargets.filter((t) => t.entry === "seagrass");
    expect(targets).toHaveLength(meadows.length);
    for (const target of targets) {
      const eye = new Vector3(target.x + 9, target.y + 1.5, target.z);
      expect(eye.y).toBeLessThan(bay.surfaceY);
      const aim = new Vector3(target.x, target.y, target.z).sub(eye).normalize();
      expect(aimedScanTarget(eye, aim, eye, [{ ...target, trapped: false }])).toMatchObject({ entry: "seagrass", trapped: false });
    }
  });

  it("can be scanned from directly above, with the camera just under the surface and well inside the old sphere", () => {
    const down = new Vector3(0, -1, 0);
    for (const target of naturalTargets.filter((t) => t.entry === "seagrass")) {
      expect(target.flat).toBe(true);
      const camera = new Vector3(target.x, bay.surfaceY - 0.3, target.z);
      const hit = aimedScanTarget(camera, down, camera, [{ ...target, trapped: false }]);
      expect(hit).toMatchObject({ entry: "seagrass", trapped: false });
      expect(hit!.point.y - floorHeight(hit!.point.x, hit!.point.z)).toBeCloseTo(config.scanner.meadowHeight, 1);
      // Slightly off the centre, tilted, and from the ship's side of it, as the third-person camera sees it.
      const behind = new Vector3(target.x + 3, bay.surfaceY - 0.3, target.z);
      const aim = new Vector3(target.x + 1, target.y, target.z).sub(behind).normalize();
      expect(aimedScanTarget(behind, aim, behind, [{ ...target, trapped: false }])).not.toBeNull();
    }
  });

  it("is missed when the ray lands beside the meadow, runs level, goes up, or ends beyond the scanner's range", () => {
    const target = naturalTargets.find((t) => t.entry === "seagrass")!;
    const camera = new Vector3(target.x, bay.surfaceY - 0.3, target.z);
    const beside = new Vector3(target.x + target.r + 3, target.y, target.z).sub(camera).normalize();
    expect(aimedScanTarget(camera, beside, camera, [{ ...target, trapped: false }])).toBeNull();
    expect(aimedScanTarget(camera, new Vector3(1, 0, 0), camera, [{ ...target, trapped: false }])).toBeNull();
    expect(aimedScanTarget(camera, new Vector3(0, 1, 0), camera, [{ ...target, trapped: false }])).toBeNull();
    const far = new Vector3(target.x, bay.surfaceY - 0.3, target.z + 20);
    expect(aimedScanTarget(camera, new Vector3(0, -1, 0), far, [{ ...target, trapped: false }])).toBeNull();
  });
});

describe("cost (REQ-019 AC-7)", () => {
  it("keeps the leaf count where the land's grass already runs at 60 fps", () => {
    expect(blades.length).toBeGreaterThan(8000);
    expect(blades.length).toBeLessThan(60000);
  });
});
