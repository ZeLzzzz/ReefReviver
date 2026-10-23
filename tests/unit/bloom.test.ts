import { Fog, Scene } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { Bloom, bloomReady, lerpHex, unmetConditions, waterAt, type WaterLook } from "../../src/game/bloom";
import type { HudState } from "../../src/game/hud-state";
import { createReefView } from "../../src/game/reef-model";
import { ReefField } from "../../src/game/reef-sites";
import { Session } from "../../src/game/session";
import { buildWorld } from "../../src/game/world";
import { LOGBOOK_ENTRIES } from "../../src/logbook/entries";
import { createHud } from "../../src/ui/hud";
import idStrings from "../../src/i18n/id.json";
import enStrings from "../../src/i18n/en.json";

const { bloom, water, reef } = config;

const full = { cleanliness: 80, framesPlanted: 3, patchesPlanted: 2 };

/** A session that removed `trash` items, planted `frames` frames and `patches` patches. */
function session(trash: number, frames: number, patches: number): Session {
  const s = new Session(config.trash.count);
  s.trashRemoved = trash;
  s.framesPlanted = frames;
  s.patchesPlanted = patches;
  return s;
}

const channels = (hex: number) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];

describe("the conditions (REQ-005 AC-1, AC-4)", () => {
  it("are met at 80 % clean with 3 frames and 2 seagrass patches planted", () => {
    expect(bloomReady(full)).toBe(true);
    expect(unmetConditions(full)).toEqual([]);
  });

  it("are not met when only one of them is missing, and say which one", () => {
    expect(unmetConditions({ ...full, cleanliness: 79 })).toEqual(["clean"]);
    expect(unmetConditions({ ...full, framesPlanted: 2 })).toEqual(["frames"]);
    expect(unmetConditions({ ...full, patchesPlanted: 1 })).toEqual(["seagrass"]);
    for (const missing of [{ cleanliness: 79 }, { framesPlanted: 2 }, { patchesPlanted: 1 }]) {
      expect(bloomReady({ ...full, ...missing })).toBe(false);
    }
  });

  it("are not met at the start of a dive", () => {
    expect(unmetConditions({ cleanliness: 0, framesPlanted: 0, patchesPlanted: 0 })).toEqual(["clean", "frames", "seagrass"]);
  });

  it("follow the Session's real counters: 50 of 60 trash is 80 % of 60 trash and 2 nets", () => {
    expect(session(50, 3, 2).bloomReady).toBe(true);
    // 49 of 62 is 79 %, 2 frames or 1 patch is not enough, whatever else holds.
    expect(session(49, 3, 2).bloomReady).toBe(false);
    expect(session(60, 2, 2).bloomReady).toBe(false);
    expect(session(60, 3, 1).bloomReady).toBe(false);
  });

  it("count cut nets for cleanliness like the rest of the game, but nets are not required", () => {
    const s = session(48, 3, 2);
    expect(s.bloomReady).toBe(false);
    s.netsCut = 2;
    expect(s.bloomReady).toBe(true);
    expect(session(50, 3, 2).netsCut).toBe(0);
  });
});

describe("the Bloom's clock (AC-1, AC-6)", () => {
  /** Runs frames of `dt` until the Bloom reports it is done; returns the seconds it took. */
  function runToEnd(b: Bloom, dt: number): number {
    let seconds = 0;
    while (b.state !== "done" && seconds < 60) {
      b.update(dt, true);
      seconds += dt;
    }
    return seconds;
  }

  it("waits until the conditions hold", () => {
    const b = new Bloom();
    for (let i = 0; i < 100; i++) expect(b.update(0.1, false)).toBeNull();
    expect([b.state, b.progress]).toEqual(["idle", 0]);
  });

  it("starts the moment they hold, and takes about 6 seconds of game time", () => {
    const b = new Bloom();
    expect(b.update(0.016, true)).toBe("started");
    expect(b.state).toBe("running");
    expect(runToEnd(b, 0.016)).toBeGreaterThan(bloom.seconds - 0.5);
    expect(runToEnd(new Bloom(), 0.1)).toBeLessThan(bloom.seconds + 0.5);
    expect(bloom.seconds).toBeGreaterThanOrEqual(5);
    expect(bloom.seconds).toBeLessThanOrEqual(7);
  });

  it("reports started once and finished once", () => {
    const b = new Bloom();
    const events: (string | null)[] = [];
    for (let i = 0; i < 200; i++) events.push(b.update(0.05, true));
    expect(events.filter((e) => e === "started")).toHaveLength(1);
    expect(events.filter((e) => e === "finished")).toHaveLength(1);
    expect(events.indexOf("started")).toBeLessThan(events.indexOf("finished"));
  });

  it("keeps running once started, even if the conditions stop holding", () => {
    const b = new Bloom();
    b.update(0.1, true);
    for (let i = 0; i < 100; i++) b.update(0.1, false);
    expect(b.state).toBe("done");
  });

  it("happens once per session: after it is done nothing starts it again", () => {
    const b = new Bloom();
    runToEnd(b, 0.1);
    expect([b.state, b.progress, b.clarity]).toEqual(["done", 1, 1]);
    for (let i = 0; i < 50; i++) expect(b.update(0.1, true)).toBeNull();
    expect([b.state, b.progress]).toEqual(["done", 1]);
  });

  it("a new dive starts murky again, and can bloom again", () => {
    const b = new Bloom();
    runToEnd(b, 0.1);
    b.reset();
    expect([b.state, b.progress, b.clarity]).toEqual(["idle", 0, 0]);
    expect(b.update(0.1, true)).toBe("started");
  });

  it("copes with a zero-length frame and a very long one", () => {
    const b = new Bloom();
    expect(b.update(0, true)).toBe("started");
    expect(b.progress).toBe(0);
    expect(b.update(1000, true)).toBe("finished");
    expect(b.progress).toBe(1);
  });
});

describe("the water (AC-1, AC-7)", () => {
  it("is the murky bay at 0, exactly as REQ-001 built it", () => {
    const look = waterAt(0);
    expect(look.color).toBe(water.murky.color);
    expect([look.fogNear, look.fogFar]).toEqual([water.murky.fogNear, water.murky.fogFar]);
    expect(look.hemiIntensity).toBe(water.murky.hemiIntensity);
    expect(look.snowOpacity).toBe(water.murky.snowOpacity);
  });

  it("is clear blue at 1, with a far longer view and thinner marine snow", () => {
    const look = waterAt(1);
    expect(look.color).toBe(bloom.clear.color);
    const [r, g, b] = channels(look.color);
    expect(b).toBeGreaterThan(r + 100);
    expect(b).toBeGreaterThan(g);
    expect(look.fogFar).toBeGreaterThanOrEqual(80);
    expect(look.fogFar).toBeGreaterThan(water.murky.fogFar * 3);
    expect(look.fogNear).toBeGreaterThan(water.murky.fogNear);
    expect(look.snowOpacity).toBeLessThan(water.murky.snowOpacity);
  });

  it("keeps out-of-range values at the ends", () => {
    expect(waterAt(-3)).toEqual(waterAt(0));
    expect(waterAt(7)).toEqual(waterAt(1));
  });

  it("blends colour channels with lerpHex", () => {
    expect(lerpHex(0x000000, 0xfefefe, 0.5)).toBe(0x7f7f7f);
    expect(lerpHex(0x102030, 0x405060, 0)).toBe(0x102030);
    expect(lerpHex(0x102030, 0x405060, 1)).toBe(0x405060);
  });

  it("changes one way only, and by small steps, over the whole transition at any frame rate (no flash, AC-7)", () => {
    const numeric: (keyof WaterLook)[] = ["fogNear", "fogFar", "hemiIntensity", "sunIntensity", "snowOpacity"];
    const hexes: (keyof WaterLook)[] = ["color", "hemiSky", "surfaceColor"];
    const start = waterAt(0);
    const end = waterAt(1);
    // The slowest and the fastest frames the game allows: 60 fps and the 0.1 s clamp.
    for (const dt of [0.016, 0.1]) {
      const b = new Bloom();
      let last = waterAt(b.clarity);
      let frames = 0;
      while (b.state !== "done") {
        b.update(dt, true);
        const now = waterAt(b.clarity);
        for (const key of numeric) {
          const range = (end[key] as number) - (start[key] as number);
          const step = (now[key] as number) - (last[key] as number);
          // Same direction as the whole change, never back, and at most 3 % of the whole change per frame.
          expect(step * Math.sign(range)).toBeGreaterThanOrEqual(0);
          expect(Math.abs(step)).toBeLessThanOrEqual(Math.abs(range) * 0.03 + 1e-9);
        }
        for (const key of hexes) {
          const from = channels(start[key] as number);
          const to = channels(end[key] as number);
          const a = channels(last[key] as number);
          const c = channels(now[key] as number);
          for (let i = 0; i < 3; i++) {
            expect((c[i] - a[i]) * Math.sign(to[i] - from[i])).toBeGreaterThanOrEqual(0);
            expect(Math.abs(c[i] - a[i])).toBeLessThanOrEqual(Math.abs(to[i] - from[i]) * 0.03 + 1);
          }
        }
        last = now;
        frames += 1;
      }
      expect(frames).toBeGreaterThan(bloom.seconds / dt - 2);
      expect(last).toEqual(end);
    }
  });
});

describe("the world blends with the Bloom (AC-1)", () => {
  it("setClarity moves the background, fog colour, fog range and the lights", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const fog = scene.fog as Fog;
    expect(fog.far).toBe(water.murky.fogFar);
    world.setClarity(0.5);
    const middle = { far: fog.far, color: fog.color.getHex() };
    expect(middle.far).toBeGreaterThan(water.murky.fogFar);
    expect(middle.far).toBeLessThan(bloom.clear.fogFar);
    world.setClarity(1);
    expect(fog.far).toBe(bloom.clear.fogFar);
    expect(fog.near).toBe(bloom.clear.fogNear);
    expect(fog.color.getHex()).toBe(bloom.clear.color);
    expect((scene.background as { getHex(): number }).getHex()).toBe(bloom.clear.color);
    world.setClarity(0);
    expect(fog.far).toBe(water.murky.fogFar);
    expect(fog.color.getHex()).toBe(water.murky.color);
  });
});

describe("coral and seagrass grow (AC-2)", () => {
  const view = createReefView(new ReefField());

  it("start pale and small, with one material for each of the nine fragments", () => {
    view.setBloom(0);
    expect(view.coralMaterials).toHaveLength(reef.frames * reef.fragmentsPerFrame);
    expect(new Set(view.coralMaterials.map((m) => m.color.getHex())).size).toBe(1);
    expect(view.look()).toEqual({ coralScale: 1, seagrassHeight: 1 });
  });

  it("end in several bright pastel colours, bigger, with taller seagrass", () => {
    view.setBloom(1);
    const colours = view.coralMaterials.map((m) => m.color.getHex());
    // Every frame holds three different colours: the reef is multi-coloured.
    expect(new Set(colours).size).toBeGreaterThanOrEqual(5);
    for (let f = 0; f < reef.frames; f++) expect(new Set(colours.slice(f * 3, f * 3 + 3)).size).toBe(3);
    // Pastel: light (every channel at least 0x80) but not white.
    for (const colour of colours) {
      const [r, g, b] = channels(colour);
      expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(0x80);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(0x20);
    }
    expect(view.look().coralScale).toBeCloseTo(bloom.coral.scale, 5);
    expect(view.look().seagrassHeight).toBeCloseTo(bloom.seagrass.heightScale, 5);
    expect(view.seagrassMaterial.color.getHex()).toBe(bloom.seagrass.color);
  });

  it("grow steadily with the Bloom, never shrinking on the way", () => {
    let lastCoral = 1;
    let lastGrass = 1;
    for (let i = 0; i <= 100; i++) {
      view.setBloom(i / 100);
      const { coralScale, seagrassHeight } = view.look();
      expect(coralScale).toBeGreaterThanOrEqual(lastCoral);
      expect(seagrassHeight).toBeGreaterThanOrEqual(lastGrass);
      expect(coralScale - lastCoral).toBeLessThan(0.05);
      lastCoral = coralScale;
      lastGrass = seagrassHeight;
    }
  });

  it("go back to pale and small for a new dive", () => {
    view.setBloom(1);
    view.setBloom(0);
    expect(new Set(view.coralMaterials.map((m) => m.color.getHex())).size).toBe(1);
    expect(view.coralMaterials[0].emissive.getHex()).toBe(0);
    expect(view.look()).toEqual({ coralScale: 1, seagrassHeight: 1 });
  });
});

describe("the site markers fade out (AC-8, D-052)", () => {
  const view = createReefView(new ReefField());
  const markers = reef.frames + reef.patches;

  it("show every marker before the Bloom", () => {
    view.setBloom(0);
    expect(view.markerOpacity()).toEqual(Array(markers).fill(1));
  });

  it("fade steadily while the Bloom runs, never coming back on the way", () => {
    let last = 1;
    for (let i = 0; i <= 100; i++) {
      view.setBloom(i / 100);
      const opacity = view.markerOpacity();
      expect(new Set(opacity).size).toBe(1);
      expect(opacity[0]).toBeLessThanOrEqual(last);
      expect(last - opacity[0]).toBeLessThan(0.05);
      last = opacity[0];
    }
  });

  it("are gone when the Bloom is over, and come back for a new dive", () => {
    view.setBloom(1);
    expect(view.markerOpacity()).toEqual(Array(markers).fill(0));
    view.setBloom(0);
    expect(view.markerOpacity()).toEqual(Array(markers).fill(1));
  });
});

describe("Phase 3 (AC-5)", () => {
  it("has no list before the Bloom is over", () => {
    expect(new Session(40).phase3Objectives).toEqual([]);
    expect(session(50, 3, 2).phase3Objectives).toEqual([]);
  });

  it("opens the Scanner with a notice and a 'scan 0 of every Logbook entry' goal", () => {
    const s = session(50, 3, 2);
    s.openScanner();
    expect(s.currentNotice).toEqual({ key: "bloom.scannerOpen" });
    expect(s.phase3Objectives).toEqual([{ id: "scan", current: 0, target: LOGBOOK_ENTRIES.length, done: false }]);
    expect(LOGBOOK_ENTRIES.length).toBe(7);
  });

  it("leaves the remaining trash to be vacuumed", () => {
    const s = session(50, 3, 2);
    s.openScanner();
    expect(s.collect()).toBe(true);
    expect(s.trashRemoved).toBe(51);
    expect(s.tank).toBe(1);
  });

  it("does not tell the player which key opens the Scanner (REQ-006 adds that)", () => {
    for (const text of [idStrings["bloom.scannerOpen"], enStrings["bloom.scannerOpen"]]) expect(text).not.toMatch(/\b4\b|tekan|press/i);
  });
});

describe("HUD lists (AC-4, AC-5, D-043, D-049)", () => {
  function hudState(s: Session, extra: Partial<HudState> = {}): HudState {
    return {
      tool: s.tool,
      tank: s.tank,
      capacity: s.capacity,
      tankFull: s.tankFull,
      score: s.score,
      materials: s.materials,
      cleanliness: s.cleanliness,
      objectives: s.objectives,
      notice: s.currentNotice,
      inStationZone: false,
      stationDistance: 30,
      marker: { left: 0, top: 0, onScreen: false, angle: 0 },
      sucking: false,
      cutProgress: 0,
      reef: { phase2: s.phase2Objectives, canInstall: false },
      phase3: s.phase3Objectives,
      ...extra,
    };
  }
  const visibleGoals = (el: HTMLElement) =>
    [...el.querySelectorAll(".goal")].filter((g) => !g.closest("[hidden]")).map((g) => [g.querySelector(".goal-text")!.textContent, g.classList.contains("done")]);

  it("shows the unmet condition without a check mark while only some conditions hold (AC-4)", () => {
    // Deposited at least once, so the Phase 2 list is up; 90 % clean, frames planted, one patch missing.
    const s = session(56, 3, 1);
    s.trashDeposited = 56;
    s.framesInstalled = 3;
    const hud = createHud("en");
    hud.update(hudState(s));
    expect(visibleGoals(hud.element)).toEqual([
      ["Clean the bay 90%/80%", true],
      ["Free the animals 0/2", false],
      ["Deposit trash at the station", true],
      ["Install frames 3/3", true],
      ["Plant coral 3/3", true],
      ["Plant seagrass 1/2", false],
    ]);
    expect(s.bloomReady).toBe(false);
    expect(hud.element.querySelector("[data-goal=seagrass] .goal-mark")!.textContent).toBe("○");
    expect(hud.element.querySelector("[data-goal=seagrass] .visually-hidden")!.textContent).toBe(enStrings["objectives.todo"]);
  });

  it("replaces the Phase 1 and 2 lists by 'Pindai 0/7' once the Bloom is over (AC-5)", () => {
    const s = session(50, 3, 2);
    s.trashDeposited = 50;
    s.framesInstalled = 3;
    const hud = createHud("id");
    hud.update(hudState(s));
    expect(visibleGoals(hud.element)).toHaveLength(6);
    s.openScanner();
    hud.update(hudState(s));
    expect(visibleGoals(hud.element)).toEqual([["Pindai 0/7", false]]);
    expect(hud.element.querySelector(".message-notice")!.textContent).toBe("Teluk kembali jernih. Scanner terbuka!");
  });

  it("shows the Phase 3 list in English too", () => {
    const s = session(50, 3, 2);
    s.openScanner();
    const hud = createHud("en");
    hud.update(hudState(s));
    expect(visibleGoals(hud.element)).toEqual([["Scan 0/7", false]]);
    expect(hud.element.querySelector(".message-notice")!.textContent).toBe("The bay is clear again. Scanner unlocked!");
  });

  it("brings the Phase 1 list back for a state without Phase 3", () => {
    const s = session(50, 3, 2);
    s.openScanner();
    const hud = createHud("id");
    hud.update(hudState(s));
    hud.update(hudState(new Session(40)));
    expect(visibleGoals(hud.element).map(([text]) => text)).toEqual(["Bersihkan teluk 0%/80%", "Bebaskan satwa 0/2", "Setor sampah ke stasiun"]);
  });

  it("renders a state without any Phase 3 field (older fixtures)", () => {
    const hud = createHud("id");
    const state = hudState(new Session(40));
    delete state.phase3;
    hud.update(state);
    expect(visibleGoals(hud.element)).toHaveLength(3);
  });
});

describe("texts (REQ-005, G-004)", () => {
  it("exist in both languages", () => {
    for (const key of ["bloom.scannerOpen", "objectives.phase3.scan"] as const) {
      expect(idStrings[key]).toBeTruthy();
      expect(enStrings[key]).toBeTruthy();
    }
  });
});
