import { Box3, Mesh, PlaneGeometry, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { arches, atDiveEdge, boulders, colonies, constrainToBay, corals, floorHeight, rocks } from "../../src/game/bay";
import { followCamera } from "../../src/game/follow-camera";
import { allSpots } from "../../src/game/layout";
import { standable } from "../../src/game/land";
import { buildMinimap, minimapLayout, shadeAt } from "../../src/game/minimap";
import { NetField } from "../../src/game/nets";
import { decor, meadows } from "../../src/game/nature";
import { ReefField } from "../../src/game/reef-sites";
import { stepRov, type MoveInput, type RovState } from "../../src/game/rov";
import { Session } from "../../src/game/session";
import { areaReach, headland, inDiveArea, inland, squareRadius } from "../../src/game/terrain";
import { generateTrash, TrashField } from "../../src/game/trash";
import { buildTerrainChunks, buildWorld } from "../../src/game/world";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";

const { bay, rov, minimap } = config;
const { area } = bay;
const idle: MoveInput = { forward: 0, strafe: 0, rise: 0 };

function fly(state: RovState, input: Partial<MoveInput>, seconds: number, onStep?: (s: RovState) => void): RovState {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    stepRov(state, { ...idle, ...input }, dt);
    onStep?.(state);
  }
  return state;
}

function rovAt(x: number, y: number, z: number, yaw: number): RovState {
  return { position: new Vector3(x, y, z), velocity: new Vector3(), yaw, pitch: 0 };
}

/** The directions out to sea: north, north-east, east, south-east, south (the west is the shore). */
const SEAWARD: [string, number][] = [
  ["north", Math.PI],
  ["north-east", (Math.PI * 3) / 4],
  ["east", Math.PI / 2],
  ["south-east", Math.PI / 4],
  ["south", 0],
];

describe("open sea to the horizon (REQ-022 AC-1)", () => {
  it("has no rock wall: the floor stays far under the surface from the middle out to the end of the terrain, north, east and south", () => {
    for (const [, yaw] of SEAWARD) {
      for (let r = 0; r <= bay.outerSize - 2; r += 2) {
        const x = Math.sin(yaw) * r;
        const z = Math.cos(yaw) * r;
        if (Math.max(Math.abs(x), Math.abs(z)) > bay.outerSize - 2) break;
        expect(floorHeight(x, z)).toBeLessThan(bay.surfaceY - 5);
      }
    }
  });

  it("drops away outside the dive area to deep water, gently, and never rises on the way", () => {
    for (const [, yaw] of SEAWARD) {
      const sx = Math.sin(yaw);
      const sz = Math.cos(yaw);
      // Along the ray the "radius" grows with distance; sample it from the edge outward.
      const norm = squareRadius(sx, sz);
      let previous = floorHeight((sx / norm) * area.radius, (sz / norm) * area.radius);
      for (let r = area.radius; r <= area.radius + area.dropWidth + 100; r += 2) {
        const h = floorHeight((sx / norm) * r, (sz / norm) * r);
        // The rolling seabed still wiggles by a metre or two; the drop dominates.
        expect(h).toBeLessThan(previous + 0.6);
        // Gentle: never steeper than about 1 : 1.
        expect(previous - h).toBeLessThan(2 * 1.0 + 1);
        previous = h;
      }
      // Deep out there: at least 55 m under the surface well beyond the edge.
      const far = area.radius + area.dropWidth + 20;
      expect(floorHeight((sx / norm) * far, (sz / norm) * far)).toBeLessThan(-55);
    }
  });

  it("draws that floor: a coarse ring of terrain reaches far beyond what the water's fog shows from the edge", () => {
    const meshes = buildTerrainChunks();
    const box = new Box3();
    for (const mesh of meshes) box.union(new Box3().setFromObject(mesh));
    expect(box.min.x).toBeLessThanOrEqual(-bay.outerSize + 1);
    expect(box.max.x).toBeGreaterThanOrEqual(bay.outerSize - 1);
    expect(box.min.z).toBeLessThanOrEqual(-bay.outerSize + 1);
    expect(box.max.z).toBeGreaterThanOrEqual(bay.outerSize - 1);
    // From the dive area's edge the clearest water shows 90 m: the terrain goes on well past that.
    expect(bay.outerSize - area.radius).toBeGreaterThan(config.bloom.clear.fogFar + 100);
    expect(meshes.filter((m) => m.name.startsWith("terrain-outer")).length).toBe(4);
    // Cheap to draw: the whole terrain is a small number of vertices.
    const vertices = meshes.reduce((sum, m) => sum + m.geometry.attributes.position.count, 0);
    expect(vertices).toBeLessThan(40000);
  });

  it("joins the detailed and the coarse terrain with no crack: along the seam the detailed edge lies on the coarse one", () => {
    const meshes = buildTerrainChunks();
    const outer = meshes.filter((m) => m.name.startsWith("terrain-outer"));
    const inner = meshes.filter((m) => !m.name.startsWith("terrain-outer"));
    // Every vertex of the detailed terrain's outer edge, and the coarse vertices on the same line.
    const edgeY = (mesh: Mesh, pick: (x: number, z: number) => boolean) => {
      const out: { x: number; y: number; z: number }[] = [];
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) if (pick(p.getX(i), p.getZ(i))) out.push({ x: p.getX(i), y: p.getY(i), z: p.getZ(i) });
      return out;
    };
    const onEast = (x: number) => Math.abs(x - bay.halfSize) < 1e-3;
    const fine = inner.flatMap((m) => edgeY(m, (x) => onEast(x))).sort((a, b) => a.z - b.z);
    const coarse = outer.flatMap((m) => edgeY(m, (x, z) => onEast(x) && Math.abs(z) <= bay.halfSize + 1e-3)).sort((a, b) => a.z - b.z);
    expect(fine.length).toBeGreaterThan(50);
    expect(coarse.length).toBeGreaterThan(20);
    for (const f of fine) {
      const hi = coarse.findIndex((c) => c.z >= f.z - 1e-3);
      const b = coarse[hi];
      const a = coarse[Math.max(0, hi - 1)];
      const k = b.z === a.z ? 0 : (f.z - a.z) / (b.z - a.z);
      expect(f.y).toBeCloseTo(a.y + (b.y - a.y) * Math.min(1, Math.max(0, k)), 3);
    }
  });
});

describe("the sea's surface reaches the horizon (REQ-022 AC-2)", () => {
  it("is a plane much wider than the haze and the camera's far plane, so no edge shows from the beach or the dock", () => {
    const scene = new Scene();
    buildWorld(scene);
    const planes = scene.children.filter((c): c is Mesh => c instanceof Mesh && c.geometry instanceof PlaneGeometry && Math.abs(c.position.y) < 1e-6);
    const widest = Math.max(...planes.map((m) => new Box3().setFromObject(m).getSize(new Vector3()).x));
    expect(widest).toBeGreaterThan(2 * config.camera.far);
    expect(widest).toBeGreaterThan(2 * config.land.hazeFar);
    // And it is centred on the bay, so it reaches as far every way.
    for (const m of planes) {
      const box = new Box3().setFromObject(m);
      if (box.getSize(new Vector3()).x < widest) continue;
      expect(box.min.x).toBeLessThan(-config.camera.far);
      expect(box.max.x).toBeGreaterThan(config.camera.far);
      expect(box.min.z).toBeLessThan(-config.camera.far);
      expect(box.max.z).toBeGreaterThan(config.camera.far);
    }
  });
});

describe("the headlands close the west beach (REQ-022 AC-3, D-105)", () => {
  it("stand as solid rock above the sea at both ends of the beach, and not on the beach itself", () => {
    for (const side of [-1, 1]) {
      const core = { x: -120, z: side * bay.headland.z };
      expect(headland(core.x, core.z)).toBe(1);
      expect(floorHeight(core.x, core.z)).toBeGreaterThan(bay.surfaceY + 2);
      // Its tip is out in the water and lower: the cliff comes down into the sea.
      const tip = floorHeight(bay.headland.tipX, side * bay.headland.z);
      expect(tip).toBeGreaterThan(bay.surfaceY);
      expect(tip).toBeLessThan(floorHeight(-150, side * bay.headland.z));
      expect(floorHeight(bay.headland.tipX + bay.headland.core + bay.headland.fall + 8, side * bay.headland.z)).toBeLessThan(bay.surfaceY - 5);
    }
    for (let z = -bay.shore.openHalf + 4; z <= bay.shore.openHalf - 4; z += 2) expect(headland(-130, z)).toBe(0);
  });

  it("cannot be walked round or climbed: from the middle of the beach the walker reaches neither headland's far side", () => {
    // Flood fill over every spot a walker can stand on, a metre apart, from the beach's middle.
    const key = (x: number, z: number) => `${x},${z}`;
    const seen = new Set<string>([key(-130, 0)]);
    const queue: [number, number][] = [[-130, 0]];
    let farthest = 0;
    while (queue.length) {
      const [x, z] = queue.pop()!;
      farthest = Math.max(farthest, Math.abs(z));
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx;
        const nz = z + dz;
        if (seen.has(key(nx, nz)) || !standable(nx, nz)) continue;
        seen.add(key(nx, nz));
        queue.push([nx, nz]);
      }
    }
    expect(seen.size).toBeGreaterThan(500);
    // The beach is walkable up to its ends, and no further than the headland's foot.
    expect(farthest).toBeGreaterThan(bay.shore.openHalf - 20);
    expect(farthest).toBeLessThan(bay.headland.z - bay.headland.core);
  });
});

describe("the invisible edge of the dive area (REQ-022 AC-4, D-104)", () => {
  it("slows the submarine down before the edge, then stops it there", () => {
    const state = rovAt(0, -10, 0, Math.PI / 2);
    let speedAtBand = Infinity;
    let speedBefore = 0;
    fly(state, { forward: 1 }, 60, (s) => {
      const r = squareRadius(s.position.x, s.position.z);
      if (r < area.radius - area.slowBand - 2) speedBefore = Math.hypot(s.velocity.x, s.velocity.z);
      if (r > area.radius - 4 && r < area.radius - 3) speedAtBand = Math.min(speedAtBand, Math.hypot(s.velocity.x, s.velocity.z));
    });
    expect(speedBefore).toBeGreaterThan(rov.maxSpeed * 0.9);
    expect(speedAtBand).toBeLessThan(rov.maxSpeed * 0.6);
    expect(atDiveEdge(state.position.x, state.position.z)).toBe(true);
    expect(squareRadius(state.position.x, state.position.z)).toBeLessThanOrEqual(area.radius + 1e-6);
    const end = state.position.clone();
    fly(state, { forward: 1 }, 2);
    expect(state.position.distanceTo(end)).toBeLessThan(0.05);
    expect(Math.hypot(state.velocity.x, state.velocity.z)).toBeLessThan(0.5);
  });

  it("lets the submarine turn round at once and swim away from the edge", () => {
    const state = rovAt(0, -10, 0, Math.PI / 2);
    fly(state, { forward: 1 }, 60);
    const at = state.position.x;
    state.yaw = -Math.PI / 2;
    fly(state, { forward: 1 }, 1);
    expect(state.position.x).toBeLessThan(at - 1);
    fly(state, { forward: 1 }, 3);
    expect(squareRadius(state.position.x, state.position.z)).toBeLessThan(area.radius - area.slowBand);
  });

  it("slides along the edge instead of sticking when it swims at it at a slant", () => {
    const state = rovAt(0, -10, 0, Math.PI / 2 - 0.6);
    fly(state, { forward: 1 }, 60);
    const before = state.position.clone();
    state.yaw = Math.PI / 2 - 1.2; // still toward the edge, more along it
    fly(state, { forward: 1 }, 3);
    expect(state.position.distanceTo(before)).toBeGreaterThan(1);
    expect(squareRadius(state.position.x, state.position.z)).toBeLessThanOrEqual(area.radius + 1e-6);
  });

  it("holds animals, and anything else moved with constrainToBay, in the area", () => {
    for (const [x, z] of [[400, 0], [0, 400], [0, -400], [250, 250], [-90, 300]]) {
      const p = new Vector3(x, -10, z);
      const v = new Vector3(3, 0, 3);
      constrainToBay(p, v);
      expect(squareRadius(p.x, p.z)).toBeLessThanOrEqual(area.radius + 1e-6);
    }
  });

  it("does not hold the camera: at the edge, looking in, the camera floats behind it outside the area", () => {
    for (const [, yaw] of SEAWARD) {
      const state = rovAt(0, -10, 0, yaw);
      fly(state, { forward: 1 }, 60);
      state.yaw = yaw + Math.PI;
      const camera = new Vector3();
      followCamera(state, camera, new Vector3());
      expect(squareRadius(camera.x, camera.z)).toBeGreaterThan(squareRadius(state.position.x, state.position.z) + 2);
    }
  });

  it("shows 'Batas area penyelaman' / 'Edge of the dive area' for about 2 seconds", () => {
    expect(idStrings["hud.diveEdge"]).toBe("Batas area penyelaman");
    expect(enStrings["hud.diveEdge"]).toBe("Edge of the dive area");
    expect(area.messageSeconds).toBeGreaterThanOrEqual(1.5);
    expect(area.messageSeconds).toBeLessThanOrEqual(2.5);
    const session = new Session(60);
    session.say({ key: "hud.diveEdge" }, area.messageSeconds);
    session.tick(area.messageSeconds - 0.2);
    expect(session.currentNotice?.key).toBe("hud.diveEdge");
    session.tick(0.4);
    expect(session.currentNotice).toBeNull();
  });
});

describe("what fills the bay stays inside the dive area (REQ-022 AC-5)", () => {
  const inside = (x: number, z: number) => expect(squareRadius(x, z)).toBeLessThanOrEqual(areaReach());

  it("keeps the placing test inside the edge and off the headlands", () => {
    expect(inDiveArea(0, 0)).toBe(true);
    expect(inDiveArea(area.radius - 1, 0)).toBe(false);
    expect(inDiveArea(0, -(area.radius - 2))).toBe(false);
    expect(inDiveArea(-100, bay.headland.z)).toBe(false);
    expect(inDiveArea(0, 0, area.radius)).toBe(false);
  });

  it("has the reef sites, nets, seagrass patches, cave, rocks, boulders, arches, corals, algae and trash in the area", () => {
    for (const spot of allSpots) inside(spot.x, spot.z);
    inside(bay.cave.x, bay.cave.z);
    for (const rock of rocks) inside(rock.x, rock.z);
    for (const boulder of boulders) inside(boulder.x, boulder.z);
    for (const arch of arches) inside(arch.x, arch.z);
    for (const coral of corals) inside(coral.x, coral.z);
    for (const colony of colonies) inside(colony.x, colony.z);
    for (const d of decor) inside(d.x, d.z);
    for (const meadow of meadows) expect(squareRadius(meadow.x, meadow.z)).toBeLessThanOrEqual(area.radius);
    for (const item of generateTrash()) {
      if (item.onBeach) continue;
      inside(item.home.x, item.home.z);
      expect(headland(item.home.x, item.home.z)).toBe(0);
    }
  });
});

describe("the minimap without the wall (REQ-022 AC-6)", () => {
  it("draws no rock wall: every land square is the shore or a headland, and nothing is shaded 'wall'", () => {
    const shades = new Set(minimapLayout.terrain.map((t) => t.shade as string));
    expect(shades.has("wall")).toBe(false);
    // North, east and south of the bay, out to the map's edge, there is only water.
    for (const edge of [minimap.extent - 2, area.radius - 2]) {
      for (const [x, z] of [[edge, 0], [0, edge], [0, -edge]]) expect(shadeAt(x, z)).toMatch(/^depth-/);
    }
  });

  it("shows the headlands as land", () => {
    for (const side of [-1, 1]) {
      expect(shadeAt(-120, side * bay.headland.z)).toBe("land");
      expect(shadeAt(bay.headland.tipX - 4, side * bay.headland.z)).toBe("land");
    }
  });

  it("marks the edge of the dive area with a thin line round it, inside the map", () => {
    const edge = minimapLayout.edge;
    expect(edge.length).toBeGreaterThan(50);
    const centre = minimap.size / 2;
    const scale = minimap.size / (2 * minimap.extent);
    for (const point of edge) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(minimap.size);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(minimap.size);
      // On the area's edge: its radius in the shape of the area.
      const wx = (point.x - centre) / scale;
      const wz = (point.y - centre) / scale;
      expect(squareRadius(wx, wz)).toBeCloseTo(area.radius, 0);
    }
  });

  it("still builds its state with the new layout", () => {
    const state = buildMinimap({ rov: { x: 0, z: 0, yaw: 0 }, frames: new ReefField().frames, patches: new ReefField().patches, nets: new NetField().nets, trash: new TrashField().items, cleanliness: 0 });
    expect(state.rov.x).toBeCloseTo(minimap.size / 2);
  });
});

describe("the shore is unchanged by the open sea", () => {
  it("keeps the beach and the land to the west", () => {
    expect(floorHeight(-155, 0)).toBeGreaterThan(bay.surfaceY + 2);
    expect(inland(-120, 0)).toBeLessThan(0);
  });
});
