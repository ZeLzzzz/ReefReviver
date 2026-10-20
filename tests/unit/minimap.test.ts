import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { aimDirection } from "../../src/game/follow-camera";
import type { HudState } from "../../src/game/hud-state";
import { buildMinimap, headingDegrees, mapPoint, minimapLayout, trashVisible, type MinimapInput, type MinimapState } from "../../src/game/minimap";
import { NetField } from "../../src/game/nets";
import { ReefField } from "../../src/game/reef-sites";
import { Session } from "../../src/game/session";
import { TrashField } from "../../src/game/trash";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";
import { createHud } from "../../src/ui/hud";

const { minimap, bay, rov: rovConfig } = config;

function scene() {
  return { field: new TrashField(), nets: new NetField(), reef: new ReefField() };
}

function input(world: ReturnType<typeof scene>, cleanliness: number, rov = { x: 0, z: 0, yaw: 0 }): MinimapInput {
  return { rov, frames: world.reef.frames, patches: world.reef.patches, nets: world.nets.nets, trash: world.field.items, cleanliness };
}

describe("minimap coordinates (REQ-010 AC-1)", () => {
  it("puts the bay's centre in the middle of the map", () => {
    expect(mapPoint(0, 0)).toEqual({ x: minimap.size / 2, y: minimap.size / 2 });
  });

  it("has north (-Z) up and east (+X) to the right", () => {
    const centre = mapPoint(0, 0);
    expect(mapPoint(0, -20).y).toBeLessThan(centre.y);
    expect(mapPoint(0, -20).x).toBe(centre.x);
    expect(mapPoint(20, 0).x).toBeGreaterThan(centre.x);
    expect(mapPoint(20, 0).y).toBe(centre.y);
  });

  it("keeps the whole bay, cliffs included, inside the map", () => {
    for (const [x, z] of [[bay.cliffRadius, 0], [-bay.cliffRadius, 0], [0, bay.cliffRadius], [0, -bay.cliffRadius]]) {
      const p = mapPoint(x, z);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(minimap.size);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(minimap.size);
    }
    expect(minimapLayout.bay.radius + minimapLayout.bay.x).toBeLessThan(minimap.size);
  });

  it("puts the ROV at its map position", () => {
    const state = buildMinimap(input(scene(), 0, { x: 10, z: -20, yaw: 0 }));
    expect(state.rov.x).toBeCloseTo(mapPoint(10, -20).x);
    expect(state.rov.y).toBeCloseTo(mapPoint(10, -20).y);
  });
});

describe("the ROV arrow's heading (REQ-010 AC-1)", () => {
  /** Where an arrow drawn pointing up ends after an SVG rotate(degrees) (clockwise on screen, y down). */
  const arrowTip = (degrees: number) => {
    const a = (degrees * Math.PI) / 180;
    return { x: Math.sin(a), y: -Math.cos(a) };
  };

  it("points up at the start, where the ROV faces north", () => {
    expect(headingDegrees(rovConfig.start.yaw)).toBeCloseTo(0);
  });

  it("points the way the camera aims, on the map, for every yaw", () => {
    const aim = new Vector3();
    for (let yaw = -7; yaw <= 7; yaw += 0.37) {
      aimDirection(yaw, 0, aim);
      const tip = arrowTip(headingDegrees(yaw));
      // Map x is world x; map y is world z.
      expect(tip.x).toBeCloseTo(aim.x, 5);
      expect(tip.y).toBeCloseTo(aim.z, 5);
    }
  });

  it("points down when facing south, right for east and left for west", () => {
    expect(arrowTip(headingDegrees(0)).y).toBeCloseTo(1); // yaw 0 faces +Z, south
    expect(arrowTip(headingDegrees(Math.PI / 2)).x).toBeCloseTo(1); // turning left from south faces east
    expect(arrowTip(headingDegrees(-Math.PI / 2)).x).toBeCloseTo(-1);
  });

  it("is always in 0..360", () => {
    for (const yaw of [-100, -3.2, 0, 3.2, 100]) {
      const heading = headingDegrees(yaw);
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
    }
  });
});

describe("landmarks (REQ-010 AC-2)", () => {
  it("lays out the station, three reef sites and two seagrass patches", () => {
    expect(minimapLayout.station).toEqual(mapPoint(config.station.x, config.station.z));
    expect(minimapLayout.frames).toEqual(config.reef.frameSites.map((s) => mapPoint(s.x, s.z)));
    expect(minimapLayout.patches).toEqual(config.reef.seagrassPatches.map((s) => mapPoint(s.x, s.z)));
    expect(minimapLayout.frames).toHaveLength(3);
    expect(minimapLayout.patches).toHaveLength(2);
  });

  it("shows the rocks as faint shapes inside the bay", () => {
    expect(minimapLayout.rocks.length).toBeGreaterThan(0);
    for (const rock of minimapLayout.rocks) expect(Math.hypot(rock.x - minimapLayout.bay.x, rock.y - minimapLayout.bay.y)).toBeLessThan(minimapLayout.bay.radius);
  });

  it("reports every site as empty at the start, then started and planted as they progress", () => {
    const world = scene();
    expect(buildMinimap(input(world, 0)).frames).toEqual(["empty", "empty", "empty"]);
    expect(buildMinimap(input(world, 0)).patches).toEqual(["empty", "empty"]);
    world.reef.install(1);
    world.reef.patches[0].seeds = 1;
    let state = buildMinimap(input(world, 0));
    expect(state.frames).toEqual(["empty", "started", "empty"]);
    expect(state.patches).toEqual(["started", "empty"]);
    world.reef.frames[1].fragments = config.reef.fragmentsPerFrame;
    world.reef.patches[0].seeds = config.reef.seedsPerPatch;
    state = buildMinimap(input(world, 0));
    expect(state.frames).toEqual(["empty", "planted", "empty"]);
    expect(state.patches).toEqual(["planted", "empty"]);
  });
});

describe("nets (REQ-010 AC-3)", () => {
  it("shows both nets at the start, at their places", () => {
    const state = buildMinimap(input(scene(), 0));
    expect(state.nets.map((n) => n.id)).toEqual([0, 1]);
    const site = config.nets.sites[0];
    expect(state.nets[0].x).toBeCloseTo(mapPoint(site.x, site.z).x);
    expect(state.nets[0].y).toBeCloseTo(mapPoint(site.x, site.z).y);
  });

  it("drops a net's mark as soon as it is cut, and only that one", () => {
    const world = scene();
    world.nets.cut(0);
    expect(buildMinimap(input(world, 0)).nets.map((n) => n.id)).toEqual([1]);
    world.nets.cut(1);
    expect(buildMinimap(input(world, 0)).nets).toEqual([]);
  });

  it("shows the nets again in a new dive", () => {
    const world = scene();
    world.nets.cut(0);
    world.nets.reset();
    expect(buildMinimap(input(world, 0)).nets).toHaveLength(2);
  });
});

describe("remaining trash (REQ-010 AC-4)", () => {
  it("is hidden below the threshold, even at 69%", () => {
    const world = scene();
    expect(buildMinimap(input(world, 0)).trash).toEqual([]);
    expect(buildMinimap(input(world, minimap.trashFromCleanliness - 1)).trash).toEqual([]);
    expect(trashVisible(minimap.trashFromCleanliness - 1)).toBe(false);
  });

  it("shows every item still on the floor as soon as cleanliness reaches 70%", () => {
    const world = scene();
    expect(minimap.trashFromCleanliness).toBe(70);
    const state = buildMinimap(input(world, 70));
    expect(state.trash).toHaveLength(world.field.total);
    const item = world.field.items[3];
    expect(state.trash.find((m) => m.id === item.id)).toMatchObject(mapPoint(item.position.x, item.position.z));
    expect(buildMinimap(input(world, 100)).trash).toHaveLength(world.field.total);
  });

  it("drops an item the moment it is being sucked, and one that is collected", () => {
    const world = scene();
    world.field.items[0].state = "pulling";
    world.field.items[1].state = "collected";
    const ids = buildMinimap(input(world, 70)).trash.map((m) => m.id);
    expect(ids).toHaveLength(world.field.total - 2);
    expect(ids).not.toContain(0);
    expect(ids).not.toContain(1);
  });

  it("counts real cleanliness: 70% is reached by removing trash and cutting nets", () => {
    const world = scene();
    const session = new Session(world.field.total);
    session.trashRemoved = 28; // 28 of 42 = 66%
    expect(trashVisible(session.cleanliness)).toBe(false);
    session.trashRemoved = 29; // 29 of 42 = 69%
    expect(trashVisible(session.cleanliness)).toBe(false);
    session.trashRemoved = 30; // 30 of 42 = 71%
    expect(trashVisible(session.cleanliness)).toBe(true);
  });
});

/** A HUD state fixture with a minimap. */
function hudState(map: MinimapState | undefined): HudState {
  const session = new Session(40);
  return {
    tool: session.tool,
    tank: 0,
    capacity: session.capacity,
    tankFull: false,
    score: 0,
    materials: 0,
    cleanliness: 0,
    objectives: session.objectives,
    notice: null,
    inStationZone: false,
    stationDistance: 37,
    marker: { left: 100, top: 200, onScreen: false, angle: 1 },
    sucking: false,
    cutProgress: 0,
    minimap: map,
  };
}

const kinds = (root: HTMLElement, kind: string) => [...root.querySelectorAll(`[data-kind="${kind}"]`)];

describe("the minimap in the HUD (REQ-010 AC-1, AC-2, AC-3, AC-4, AC-5)", () => {
  it("is an image with an accessible name, in both languages, from the string files", () => {
    for (const [lang, name, north] of [["id", "Peta teluk", "U"], ["en", "Bay map", "N"]] as const) {
      const hud = createHud(lang);
      hud.update(hudState(buildMinimap(input(scene(), 0))));
      const map = hud.element.querySelector(".hud-minimap svg")!;
      expect(map.getAttribute("role")).toBe("img");
      expect(map.getAttribute("aria-label")).toBe(name);
      expect(hud.element.querySelector(".mm-north")!.textContent).toBe(north);
    }
    expect(idStrings["minimap.label"]).toBeTruthy();
    expect(enStrings["minimap.label"]).toBeTruthy();
  });

  it("sits on a semi-transparent HUD panel and is not a focusable or clickable thing", () => {
    const hud = createHud("id");
    hud.update(hudState(buildMinimap(input(scene(), 0))));
    const panel = hud.element.querySelector(".hud-minimap")!;
    expect(panel.classList.contains("hud-panel")).toBe(true);
    expect(panel.querySelector("[tabindex], button, a")).toBeNull();
  });

  it("is not shown for a state without a minimap, and shows once there is one", () => {
    const hud = createHud("id");
    hud.update(hudState(undefined));
    expect(hud.element.querySelector<HTMLElement>(".hud-minimap")!.hidden).toBe(true);
    hud.update(hudState(buildMinimap(input(scene(), 0))));
    expect(hud.element.querySelector<HTMLElement>(".hud-minimap")!.hidden).toBe(false);
  });

  it("draws the ROV, the station, 3 diamonds, 2 circles and 2 nets at the start, and no trash", () => {
    const hud = createHud("id");
    hud.update(hudState(buildMinimap(input(scene(), 0))));
    expect(kinds(hud.element, "rov")).toHaveLength(1);
    expect(kinds(hud.element, "station")).toHaveLength(1);
    expect(kinds(hud.element, "frame")).toHaveLength(3);
    expect(kinds(hud.element, "patch")).toHaveLength(2);
    expect(kinds(hud.element, "net")).toHaveLength(2);
    expect(kinds(hud.element, "trash")).toHaveLength(0);
    expect(hud.element.querySelectorAll(".mm-rock")).toHaveLength(minimapLayout.rocks.length);
  });

  it("gives each landmark its own shape, not only its own colour", () => {
    const hud = createHud("id");
    hud.update(hudState(buildMinimap(input(scene(), 0))));
    const shape = (kind: string) => kinds(hud.element, kind)[0].querySelector(".mm-shape, .mm-x, .mm-rov")!.tagName.toLowerCase();
    expect(shape("station")).toBe("rect");
    expect(shape("frame")).toBe("polygon");
    expect(shape("patch")).toBe("circle");
    expect(shape("net")).toBe("path");
    expect(shape("rov")).toBe("polygon");
    // The frame's diamond and the ROV arrow are both polygons, but with different points.
    expect(kinds(hud.element, "frame")[0].querySelector("polygon")!.getAttribute("points")).not.toBe(kinds(hud.element, "rov")[0].querySelector("polygon")!.getAttribute("points"));
  });

  it("moves and turns the ROV arrow", () => {
    const hud = createHud("id");
    const world = scene();
    hud.update(hudState(buildMinimap(input(world, 0, { x: 0, z: 32, yaw: Math.PI }))));
    const rov = kinds(hud.element, "rov")[0];
    const start = mapPoint(0, 32);
    expect(rov.getAttribute("transform")).toBe(`translate(${start.x.toFixed(1)} ${start.y.toFixed(1)}) rotate(0.0)`);
    hud.update(hudState(buildMinimap(input(world, 0, { x: -20, z: 5, yaw: Math.PI / 2 }))));
    const moved = mapPoint(-20, 5);
    expect(rov.getAttribute("transform")).toBe(`translate(${moved.x.toFixed(1)} ${moved.y.toFixed(1)}) rotate(90.0)`);
  });

  it("changes a site's mark from empty to started to planted", () => {
    const hud = createHud("id");
    const world = scene();
    const status = () => kinds(hud.element, "frame").map((f) => f.getAttribute("data-status"));
    const patchStatus = () => kinds(hud.element, "patch").map((f) => f.getAttribute("data-status"));
    hud.update(hudState(buildMinimap(input(world, 0))));
    expect(status()).toEqual(["empty", "empty", "empty"]);
    world.reef.install(0);
    hud.update(hudState(buildMinimap(input(world, 0))));
    expect(status()).toEqual(["started", "empty", "empty"]);
    world.reef.frames[0].fragments = 3;
    world.reef.patches[1].seeds = 3;
    hud.update(hudState(buildMinimap(input(world, 0))));
    expect(status()).toEqual(["planted", "empty", "empty"]);
    expect(patchStatus()).toEqual(["empty", "planted"]);
    // A planted site has a check mark in its icon (shown by the stylesheet).
    expect(kinds(hud.element, "frame")[0].querySelector(".mm-check")).not.toBeNull();
  });

  it("removes a net's mark when the net is cut", () => {
    const hud = createHud("id");
    const world = scene();
    hud.update(hudState(buildMinimap(input(world, 0))));
    const first = kinds(hud.element, "net")[0];
    world.nets.cut(0);
    hud.update(hudState(buildMinimap(input(world, 0))));
    expect(kinds(hud.element, "net").map((n) => n.getAttribute("data-id"))).toEqual(["1"]);
    expect(first.isConnected).toBe(false);
  });

  it("draws one dot per remaining trash item from 70%, and removes a dot when its item is sucked", () => {
    const hud = createHud("id");
    const world = scene();
    hud.update(hudState(buildMinimap(input(world, 69))));
    expect(kinds(hud.element, "trash")).toHaveLength(0);
    hud.update(hudState(buildMinimap(input(world, 70))));
    expect(kinds(hud.element, "trash")).toHaveLength(world.field.total);
    world.field.items[5].state = "pulling";
    hud.update(hudState(buildMinimap(input(world, 70))));
    expect(kinds(hud.element, "trash")).toHaveLength(world.field.total - 1);
    expect(kinds(hud.element, "trash").some((d) => d.getAttribute("data-id") === "5")).toBe(false);
    // Back under the threshold (a new dive): the dots are gone again.
    hud.update(hudState(buildMinimap(input(world, 0))));
    expect(kinds(hud.element, "trash")).toHaveLength(0);
  });

  it("does not rebuild anything that did not change", () => {
    const hud = createHud("id");
    const world = scene();
    hud.update(hudState(buildMinimap(input(world, 80))));
    const dot = kinds(hud.element, "trash")[0];
    const net = kinds(hud.element, "net")[0];
    hud.update(hudState(buildMinimap(input(world, 80, { x: 3, z: 4, yaw: 1 }))));
    expect(kinds(hud.element, "trash")[0]).toBe(dot);
    expect(kinds(hud.element, "net")[0]).toBe(net);
  });

  it("is rebuilt with the same content for a fresh HUD (pause and resume, AC-6)", () => {
    const state = hudState(buildMinimap(input(scene(), 75, { x: 12, z: -7, yaw: 2 })));
    const before = createHud("id");
    before.update(state);
    const after = createHud("id");
    after.update(state);
    expect(after.element.querySelector(".hud-minimap")!.outerHTML).toBe(before.element.querySelector(".hud-minimap")!.outerHTML);
  });

  it("keeps the minimap clear of the crosshair, goals and messages in the DOM: its own panel, no overlay on them", () => {
    const hud = createHud("id");
    hud.update(hudState(buildMinimap(input(scene(), 0))));
    const panel = hud.element.querySelector(".hud-minimap")!;
    expect(panel.querySelector(".crosshair, .hud-goals, .hud-messages")).toBeNull();
    // The station marker comes later in the DOM, so it draws above the map if they overlap.
    const order = [...hud.element.children];
    expect(order.indexOf(hud.element.querySelector(".station-marker")!)).toBeGreaterThan(order.indexOf(panel));
  });
});
