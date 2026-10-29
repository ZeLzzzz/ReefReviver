import { Color, Fog, Mesh, MeshBasicMaterial, Points, Scene, type MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import type { HudState, LandHud } from "../../src/game/hud-state";
import { buildMinimap, headingDegrees, mapPoint } from "../../src/game/minimap";
import { NetField } from "../../src/game/nets";
import { ReefField } from "../../src/game/reef-sites";
import { buildRovMesh } from "../../src/game/rov-model";
import { Session } from "../../src/game/session";
import { TrashField } from "../../src/game/trash";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";
import { createHud } from "../../src/ui/hud";
import { buildWorld } from "../../src/game/world";

const onFoot: LandHud = { onLand: true, canGoAshore: false, canBoard: false, fade: 0 };
const aboard: LandHud = { onLand: false, canGoAshore: false, canBoard: false, fade: 0 };

function state(land: LandHud, overrides: Partial<HudState> = {}): HudState {
  const session = new Session(config.trash.count);
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
    stationDistance: 20,
    marker: { left: 100, top: 200, onScreen: false, angle: 1 },
    sucking: false,
    cutProgress: 0,
    land,
    ...overrides,
  };
}

const prompt = (hud: ReturnType<typeof createHud>) => hud.element.querySelector<HTMLElement>(".message-prompt")!;

describe("the prompts to go ashore and to get back in (REQ-015 AC-1, AC-4)", () => {
  it("asks to go ashore near the beach, in both languages", () => {
    for (const [lang, text] of [["id", "Tekan E untuk naik ke darat"], ["en", "Press E to go ashore"]] as const) {
      const hud = createHud(lang);
      hud.update(state({ ...aboard, canGoAshore: true }));
      expect(prompt(hud).hidden).toBe(false);
      expect(prompt(hud).textContent).toBe(text);
    }
  });

  it("asks to board next to the submarine, in both languages", () => {
    for (const [lang, text] of [["id", "Tekan E untuk masuk kapal selam mini"], ["en", "Press E to board the mini submarine"]] as const) {
      const hud = createHud(lang);
      hud.update(state({ ...onFoot, canBoard: true }));
      expect(prompt(hud).textContent).toBe(text);
    }
  });

  it("shows no prompt on foot away from the submarine, nor aboard out in the bay", () => {
    for (const land of [onFoot, aboard]) {
      const hud = createHud("id");
      hud.update(state(land));
      expect(prompt(hud).hidden).toBe(true);
    }
  });

  it("lets the station's deposit prompt win over going ashore", () => {
    const hud = createHud("id");
    hud.update(state({ ...aboard, canGoAshore: true }, { inStationZone: true }));
    expect(prompt(hud).textContent).toBe("Tekan E untuk menyetor sampah");
  });
});

describe("the HUD on foot (REQ-015 AC-2, AC-6)", () => {
  it("hides the tool panel on the land and shows it again aboard; goals, stats and the minimap stay", () => {
    const hud = createHud("id");
    const tool = hud.element.querySelector<HTMLElement>(".hud-tool")!;
    hud.update(state(onFoot, { minimap: buildMinimap(mapInput(null)) }));
    expect(tool.hidden).toBe(true);
    expect(hud.element.classList.contains("on-land")).toBe(true);
    expect(hud.element.querySelector<HTMLElement>(".hud-goals")!.hidden).toBe(false);
    expect(hud.element.querySelector<HTMLElement>(".hud-stats")!.hidden).toBe(false);
    expect(hud.element.querySelector<HTMLElement>(".hud-minimap")!.hidden).toBe(false);
    hud.update(state(aboard));
    expect(tool.hidden).toBe(false);
  });

  it("fades the screen with the transition's darkness, and is clear otherwise", () => {
    const hud = createHud("id");
    const fade = hud.element.querySelector<HTMLElement>(".hud-fade")!;
    hud.update(state({ ...aboard, fade: 0.6 }));
    expect(Number(fade.style.opacity)).toBeCloseTo(0.6);
    hud.update(state(aboard));
    expect(Number(fade.style.opacity)).toBe(0);
  });
});

function mapInput(sub: { x: number; z: number; yaw: number } | null) {
  return {
    rov: { x: -140, z: 5, yaw: -Math.PI / 2 },
    sub,
    frames: new ReefField().frames,
    patches: new ReefField().patches,
    nets: new NetField().nets,
    trash: new TrashField().items,
    cleanliness: 0,
  };
}

describe("the minimap on foot (REQ-015 AC-6)", () => {
  it("puts the arrow at the player and marks the parked submarine with its own shape", () => {
    const map = buildMinimap(mapInput({ x: -125, z: 5, yaw: Math.PI / 2 }));
    expect(map.rov).toMatchObject(mapPoint(-140, 5));
    expect(map.sub).toMatchObject({ ...mapPoint(-125, 5), heading: headingDegrees(Math.PI / 2) });
    const hud = createHud("id");
    hud.update(state(onFoot, { minimap: map }));
    const sub = hud.element.querySelector<SVGGElement>('[data-kind="sub"]')!;
    expect(sub.style.display).toBe("");
    expect(sub.querySelector("path")).not.toBeNull();
    expect(hud.element.querySelector('[data-kind="rov"] polygon')).not.toBeNull();
  });

  it("has no submarine mark aboard", () => {
    const map = buildMinimap(mapInput(null));
    expect(map.sub).toBeNull();
    const hud = createHud("id");
    hud.update(state(aboard, { minimap: map }));
    expect(hud.element.querySelector<SVGGElement>('[data-kind="sub"]')!.style.display).toBe("none");
  });
});

describe("the mini submarine (REQ-015 AC-7, REQ-032 AC-1, D-123)", () => {
  it("has an opaque deck hatch without a cockpit dome or visible pilot", () => {
    const model = buildRovMesh();
    const hatch = model.getObjectByName("deck-hatch") as Mesh;
    expect(hatch).toBeInstanceOf(Mesh);
    expect(model.getObjectByName("cockpit-dome")).toBeUndefined();
    expect(model.getObjectByName("pilot")).toBeUndefined();
    expect(model.getObjectByName("pilot-suit")).toBeUndefined();
    expect((hatch.material as MeshStandardMaterial).transparent).toBe(false);
  });

  it("is never called ROV in the game's texts, in either language", () => {
    for (const strings of [idStrings, enStrings]) {
      for (const text of Object.values(strings)) expect(text).not.toMatch(/\bROV\b/);
    }
    expect(idStrings["controls.look.action"]).toContain("kapal selam mini");
    expect(enStrings["controls.look.action"]).toContain("mini submarine");
  });
});

describe("above the water (REQ-015 AC-5)", () => {
  /** The bay's surface plane: the transparent water seen from above or below. */
  const surfaceOf = (scene: Scene) => {
    let found: Mesh | null = null;
    scene.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshBasicMaterial && o.material.transparent && o.geometry.type === "PlaneGeometry") found = o;
    });
    return found!.material as MeshBasicMaterial;
  };
  const snowOf = (scene: Scene) => scene.children.find((o): o is Points => o instanceof Points)!;

  it("shows the sky and a light haze instead of the water's fog, without marine snow", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    world.setAbove(true);
    const fog = scene.fog as Fog;
    expect((scene.background as Color).getHex()).toBe(config.land.sky);
    expect(fog.color.getHex()).toBe(config.land.sky);
    expect(fog.far).toBe(config.land.hazeFar);
    expect(snowOf(scene).visible).toBe(false);
    world.setAbove(false);
    expect((scene.background as Color).getHex()).toBe(config.water.murky.color);
    expect(fog.far).toBe(config.water.murky.fogFar);
    expect(snowOf(scene).visible).toBe(true);
  });

  it("colours the sea seen from above murky before the Bloom and clear after it", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    world.setAbove(true);
    const sea = surfaceOf(scene);
    expect(sea.color.getHex()).toBe(config.water.murky.color);
    expect(sea.opacity).toBe(config.land.seaOpacity);
    world.setClarity(1);
    expect(sea.color.getHex()).toBe(config.bloom.clear.color);
    // Still the sky above the water after the Bloom.
    expect((scene.background as Color).getHex()).toBe(config.land.sky);
  });
});
