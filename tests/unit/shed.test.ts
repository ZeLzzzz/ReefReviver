import { Mesh, Vector3, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight } from "../../src/game/bay";
import { ashoreSpot, createWalker, groundHeight, insideShed, landObstacles, onDock, standable, stepWalker, type Walker } from "../../src/game/land";
import { buildStationMesh } from "../../src/game/station-model";
import { avoidRects, type ScreenRect } from "../../src/game/marker";
import { mapPoint, minimapLayout } from "../../src/game/minimap";
import { Session } from "../../src/game/session";
import { counterPosition, inStationZone, stationPosition } from "../../src/game/station";
import { inland } from "../../src/game/terrain";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";

const { station, land, bay } = config;
const { dock } = bay;

function walk(walker: Walker, forward: number, seconds: number, onStep?: (w: Walker) => void): Walker {
  for (let t = 0; t < seconds; t += 1 / 60) {
    stepWalker(walker, { forward, strafe: 0, rise: 0 }, 1 / 60);
    onStep?.(walker);
  }
  return walker;
}

describe("the shed and the dock (REQ-016 AC-1, AC-7)", () => {
  it("puts the shed on dry, level land and the dock from the beach out over the water", () => {
    expect(stationPosition.y).toBeGreaterThan(bay.surfaceY + 2);
    for (const [dx, dz] of [[station.halfX, station.halfZ], [-station.halfX, -station.halfZ], [station.halfX, -station.halfZ]]) {
      expect(Math.abs(floorHeight(station.x + dx, station.z + dz) - stationPosition.y)).toBeLessThan(0.05);
    }
    expect(floorHeight(dock.landX, dock.z)).toBeGreaterThan(bay.surfaceY);
    expect(floorHeight(dock.seaX, dock.z)).toBeLessThan(bay.surfaceY - 3);
  });

  it("stops a walking player at the shed's walls from every side", () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      // Start 6 m out from the shed's centre, walking straight at it.
      const walker = createWalker(station.x - Math.sin(yaw) * 6, station.z - Math.cos(yaw) * 6, yaw);
      if (!standable(walker.position.x, walker.position.z)) continue;
      walk(walker, 1, 4, (w) => expect(insideShed(w.position.x, w.position.z, land.radius - 1e-9)).toBe(false));
    }
  });

  it("lets the player walk out on the dock over the water, standing on its deck, and stops them at its end", () => {
    const walker = createWalker(dock.landX - 2, dock.z, Math.PI / 2);
    walk(walker, 1, 8);
    expect(onDock(walker.position.x, walker.position.z)).toBe(true);
    expect(walker.position.x).toBeGreaterThan(dock.seaX - 0.5);
    expect(walker.position.x).toBeLessThanOrEqual(dock.seaX);
    expect(walker.position.y).toBeCloseTo(bay.surfaceY + dock.deckY, 6);
    expect(groundHeight(walker.position.x, walker.position.z)).toBeGreaterThan(floorHeight(walker.position.x, walker.position.z));
  });

  it("parks the submarine beside the dock, never under it, when the player goes ashore there", () => {
    let x = -110;
    while (!ashoreSpot(x, dock.z)) x -= 0.5;
    for (const z of [dock.z - 1, dock.z, dock.z + 1]) {
      const spot = ashoreSpot(x - 2, z)!;
      expect(Math.abs(spot.park.z - dock.z)).toBeGreaterThanOrEqual(dock.halfWidth + land.dockGap - 1e-9);
      expect(onDock(spot.park.x, spot.park.z)).toBe(false);
      expect(standable(spot.landing.x, spot.landing.z)).toBe(true);
    }
  });
});

describe("depositing at the counter (REQ-016 AC-2, AC-3, AC-4)", () => {
  it("is reached on foot from the beach by walking up to the counter", () => {
    const walker = createWalker(counterPosition.x + 8, counterPosition.z, -Math.PI / 2);
    expect(inland(walker.position.x, walker.position.z)).toBeGreaterThan(0);
    let reached = false;
    walk(walker, 1, 4, (w) => {
      reached ||= inStationZone(w.position);
    });
    expect(reached).toBe(true);
  });

  it("turns the tank into materials, then says the tank is empty", () => {
    const session = new Session(config.trash.count);
    for (let i = 0; i < 5; i++) session.collect();
    expect(session.deposit()).toEqual({ deposited: 5 });
    expect(session.materials).toBe(5);
    expect(session.objectives.find((o) => o.id === "deposit")!.done).toBe(true);
    expect(session.deposit()).toBe("empty");
    expect(session.materials).toBe(5);
  });

  it("never counts the submarine under the water as at the counter", () => {
    for (let y = -20; y < -1; y += 1) expect(inStationZone(new Vector3(counterPosition.x, y, counterPosition.z))).toBe(false);
  });
});

describe("texts and the map (REQ-016 AC-5, AC-6)", () => {
  it("says where to deposit when the tank is full, and names the shed, in both languages", () => {
    expect(idStrings["hud.tankFull"]).toBe("Tangki penuh, setor di gudang daur ulang di darat");
    expect(enStrings["hud.tankFull"]).toBe("Tank full, deposit it at the recycling shed on land");
    expect(idStrings["station.name"]).toBe("Gudang daur ulang");
    expect(enStrings["station.name"]).toBe("Recycling shed");
  });

  it("puts the shed's square on the land and draws the dock as a line out over the water", () => {
    expect(minimapLayout.station).toEqual(mapPoint(station.x, station.z));
    expect(minimapLayout.dock.from).toEqual(mapPoint(dock.landX, dock.z));
    expect(minimapLayout.dock.to).toEqual(mapPoint(dock.seaX, dock.z));
  });
});

describe("the marker keeps off the HUD panels (REQ-016 AC-5)", () => {
  const screen = { width: 1280, height: 720 };
  const goals: ScreenRect = { left: 16, top: 16, right: 278, bottom: 142 };
  const column: ScreenRect = { left: 1054, top: 16, right: 1264, bottom: 376 };
  const tool: ScreenRect = { left: 16, top: 658, right: 402, bottom: 704 };
  const overlaps = (x: number, y: number, w: number, h: number, r: ScreenRect) => x + w / 2 > r.left && x - w / 2 < r.right && y + h / 2 > r.top && y - h / 2 < r.bottom;

  it("leaves a marker that covers nothing where it is", () => {
    expect(avoidRects(640, 300, 200, 30, [goals, column, tool], screen.width, screen.height)).toEqual({ x: 640, y: 300 });
  });

  it("moves a marker off the right column and off the goal list, by the shortest way, staying on screen", () => {
    for (const [x, y] of [[1150, 200], [1200, 30], [100, 60], [140, 680]]) {
      const placed = avoidRects(x, y, 200, 30, [goals, column, tool], screen.width, screen.height);
      for (const rect of [goals, column, tool]) expect(overlaps(placed.x, placed.y, 200, 30, rect)).toBe(false);
      expect(placed.x - 100).toBeGreaterThanOrEqual(0);
      expect(placed.x + 100).toBeLessThanOrEqual(screen.width);
    }
  });

  it("gets past two panels with a gap too narrow for it, as the minimap and the stats in a small window", () => {
    const small = { width: 800, height: 450 };
    const minimap: ScreenRect = { left: 621, top: 16, right: 784, bottom: 179 };
    const stats: ScreenRect = { left: 574, top: 187, right: 784, bottom: 329 };
    const placed = avoidRects(697, 179, 190, 50, [minimap, stats], small.width, small.height);
    for (const rect of [minimap, stats]) expect(overlaps(placed.x, placed.y, 190, 50, rect)).toBe(false);
    expect(placed.y + 25).toBeLessThanOrEqual(small.height);
  });

  it("ignores hidden panels, which have no size", () => {
    const hidden: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
    expect(avoidRects(5, 5, 20, 10, [hidden], screen.width, screen.height)).toEqual({ x: 5, y: 5 });
  });
});

describe("the coastal timber house (REQ-031 AC-5)", () => {
  const vertices = () => {
    const house = buildStationMesh();
    house.updateMatrixWorld(true);
    const points: Vector3[] = [];
    house.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const position = node.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) points.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld));
    });
    return points;
  };

  it("keeps everything at body height within half a metre of the walls, or within the bins' obstacle", () => {
    // The bins' obstacle in the land (REQ-016), relative to the shed's centre.
    const bins = landObstacles[landObstacles.length - 1];
    const binX = bins.x - station.x, binZ = bins.z - station.z;
    let checked = 0;
    for (const p of vertices()) {
      if (p.y < 0.35 || p.y > 1.9) continue;
      checked++;
      if (Math.hypot(p.x - binX, p.z - binZ) <= bins.radius + land.radius) continue;
      expect(Math.abs(p.x)).toBeLessThanOrEqual(station.halfX + 0.5);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(station.halfZ + 0.5);
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("has a low-poly attendant behind the counter, facing out through the hatch, drawn in one call (D-137)", () => {
    const attendant = buildStationMesh().getObjectByName("station-attendant")!;
    const parts: Mesh[] = [];
    attendant.traverse((node) => {
      if (node instanceof Mesh) parts.push(node);
    });
    expect(parts).toHaveLength(1);
    const [body] = parts;
    expect(body.geometry.index!.count / 3).toBeLessThanOrEqual(1100);
    const material = body.material as MeshStandardMaterial;
    expect(material.flatShading).toBe(true);
    expect(material.roughness).toBeGreaterThanOrEqual(0.8);
    // Inside the walls, by the counter on the east wall, looking east.
    expect(attendant.position.x).toBeLessThan(station.halfX);
    expect(attendant.position.x).toBeGreaterThan(station.halfX - 1);
    expect(new Vector3(0, 0, 1).applyQuaternion(attendant.quaternion).x).toBeGreaterThan(0.99);
  });

  it("raises the beacon's mast to the lantern, clear above the roof", () => {
    const { dx, dz, height } = station.mast;
    let mast = 0, roof = 0;
    for (const p of vertices()) {
      if (Math.hypot(p.x - dx, p.z - dz) < 0.6) mast = Math.max(mast, p.y);
      else roof = Math.max(roof, p.y);
    }
    expect(mast).toBeGreaterThanOrEqual(height);
    expect(roof).toBeLessThan(height - 1);
  });
});
