import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { constrainToBay, isSolidAt, rocks, setFrameColumns } from "../../src/game/bay";
import type { HudState } from "../../src/game/hud-state";
import { aimDirection } from "../../src/game/follow-camera";
import { frameStatus, patchStatus, ReefField } from "../../src/game/reef-sites";
import { findAimPoint, SeedLauncher } from "../../src/game/seed-launcher";
import { Session } from "../../src/game/session";
import { stationPosition } from "../../src/game/station";
import { generateTrash } from "../../src/game/trash";
import { createHud } from "../../src/ui/hud";
import idStrings from "../../src/i18n/id.json";
import enStrings from "../../src/i18n/en.json";

const { reef, seedLauncher } = config;

/** A session that has deposited `materials` trash (in tank-sized loads), so it holds that many materials. */
function depositedSession(materials = 1): Session {
  const s = new Session(config.trash.count);
  for (let left = materials; left > 0; left -= config.tank.capacity) {
    for (let i = 0; i < Math.min(left, config.tank.capacity); i++) s.collect();
    s.deposit();
  }
  return s;
}

describe("sites (REQ-004 AC-1 placement)", () => {
  const field = new ReefField();
  const all = [...field.frames, ...field.patches];

  it("has three reef sites and two seagrass patches in the east of the bay", () => {
    expect(field.frames).toHaveLength(3);
    expect(field.patches).toHaveLength(2);
    for (const site of all) {
      expect(site.x).toBeGreaterThan(12);
      expect(Math.hypot(site.x, site.z) + reef.patchRadius).toBeLessThan(config.bay.boundaryRadius - 2);
    }
  });

  it("keeps clear of the station, the start, the rocks, the trash and each other", () => {
    for (const site of all) {
      const footprint = field.frames.includes(site as never) ? reef.frame.radius : reef.patchRadius;
      expect(Math.hypot(site.x - stationPosition.x, site.z - stationPosition.z)).toBeGreaterThan(config.station.zoneRadius + reef.interactRadius + 4);
      expect(Math.hypot(site.x - config.rov.start.x, site.z - config.rov.start.z)).toBeGreaterThan(10);
      for (const rock of rocks) expect(Math.hypot(site.x - rock.x, site.z - rock.z)).toBeGreaterThan(rock.size + footprint + 1);
      for (const item of generateTrash()) expect(Math.hypot(site.x - item.home.x, site.z - item.home.z)).toBeGreaterThan(reef.patchRadius + 0.5);
    }
    for (const a of all) for (const b of all) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(8);
  });

  it("is far enough from the station that the deposit zone and a site's E zone never overlap", () => {
    for (const frame of field.frames) {
      expect(Math.hypot(frame.x - stationPosition.x, frame.z - stationPosition.z)).toBeGreaterThan(config.station.zoneRadius + reef.interactRadius);
    }
  });
});

describe("installing a frame (REQ-004 AC-2, AC-3)", () => {
  it("with 5 or more materials, a frame is bought and the materials drop by 5", () => {
    const s = depositedSession(7);
    expect(s.materials).toBe(7);
    expect(s.buyFrame()).toBe(true);
    expect(s.materials).toBe(2);
    expect(s.framesInstalled).toBe(1);
    expect(s.currentNotice).toEqual({ key: "reef.frameInstalled" });
  });

  it("exactly 5 materials is enough", () => {
    const s = depositedSession(5);
    expect(s.buyFrame()).toBe(true);
    expect(s.materials).toBe(0);
  });

  it("with fewer than 5, nothing is bought and the message says 5 materials are needed", () => {
    const s = depositedSession(4);
    expect(s.buyFrame()).toBe(false);
    expect(s.materials).toBe(4);
    expect(s.framesInstalled).toBe(0);
    expect(s.currentNotice).toEqual({ key: "reef.needMaterials" });
    expect(idStrings["reef.needMaterials"]).toBe("Butuh 5 bahan. Setor sampah di stasiun.");
  });

  it("E works within 4 m of an empty site only", () => {
    const field = new ReefField();
    const [site] = field.frames;
    expect(field.emptySiteNear(site.x + 3.9, site.z)).toBe(0);
    expect(field.emptySiteNear(site.x + 4.5, site.z)).toBe(-1);
    expect(field.emptySiteNear(config.station.x, config.station.z)).toBe(-1);
    field.install(0);
    expect(field.emptySiteNear(site.x, site.z)).toBe(-1);
    // A seagrass patch has no frame to install.
    expect(field.emptySiteNear(field.patches[0].x, field.patches[0].z)).toBe(-1);
  });

  it("an installed frame is solid for the ROV", () => {
    const field = new ReefField();
    field.install(0);
    const { x, y, z } = field.frames[0];
    try {
      setFrameColumns(field.columns());
      const p = new Vector3(x + 1.8, y + 0.8, z);
      const v = new Vector3(-2, 0, 0);
      constrainToBay(p, v);
      expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThanOrEqual(reef.frame.radius + config.rov.radius - 1e-6);
      expect(v.x).toBeGreaterThanOrEqual(0);
      // Over the top is free.
      const above = new Vector3(x, y + reef.frame.height + 3, z);
      constrainToBay(above, new Vector3());
      expect(above.y).toBe(y + reef.frame.height + 3);
    } finally {
      setFrameColumns([]);
    }
    const free = new Vector3(x + 1.8, y + 0.8, z);
    constrainToBay(free, new Vector3());
    expect(free.x).toBe(x + 1.8);
  });
});

describe("what a shot does (REQ-004 AC-4, AC-5, AC-6; D-044)", () => {
  it("coral fragments attach to an installed frame; the third plants it", () => {
    const field = new ReefField();
    field.install(1);
    const target = { kind: "frame", index: 1 } as const;
    expect(field.land(target)).toEqual({ kind: "coral", site: 1, planted: false });
    expect(field.land(target)).toEqual({ kind: "coral", site: 1, planted: false });
    expect(frameStatus(field.frames[1])).toBe("started");
    expect(field.land(target)).toEqual({ kind: "coral", site: 1, planted: true });
    expect(field.frames[1].fragments).toBe(3);
    expect(frameStatus(field.frames[1])).toBe("planted");
  });

  it("a planted frame takes no more: the shot is lost and not counted", () => {
    const field = new ReefField();
    field.install(0);
    for (let i = 0; i < 3; i++) field.land({ kind: "frame", index: 0 });
    expect(field.land({ kind: "frame", index: 0 })).toEqual({ kind: "miss" });
    expect(field.frames[0].fragments).toBe(3);
  });

  it("a seed on a patch plants a sprout; the third plants the patch; then it takes no more", () => {
    const field = new ReefField();
    const target = { kind: "patch", index: 0 } as const;
    expect(patchStatus(field.patches[0])).toBe("empty");
    expect(field.land(target)).toEqual({ kind: "seed", patch: 0, planted: false });
    expect(patchStatus(field.patches[0])).toBe("started");
    field.land(target);
    expect(field.land(target)).toEqual({ kind: "seed", patch: 0, planted: true });
    expect(patchStatus(field.patches[0])).toBe("planted");
    expect(field.land(target)).toEqual({ kind: "miss" });
    expect(field.patches[0].seeds).toBe(3);
  });

  it("only installed frames and patch floor are targets", () => {
    const field = new ReefField();
    const frame = field.frames[0];
    expect(field.targetAt(frame.x, frame.y + 0.8, frame.z)).toBeNull();
    field.install(0);
    expect(field.targetAt(frame.x, frame.y + 0.8, frame.z)).toEqual({ kind: "frame", index: 0 });
    expect(field.targetAt(frame.x + reef.frame.radius + 0.3, frame.y + 0.8, frame.z)).toBeNull();
    expect(field.targetAt(frame.x, frame.y + reef.frame.height + 0.5, frame.z)).toBeNull();
    const patch = field.patches[0];
    expect(field.targetAt(patch.x, patch.y - 0.5, patch.z)).toEqual({ kind: "patch", index: 0 });
    expect(field.targetAt(patch.x, patch.y + 1, patch.z)).toBeNull();
    expect(field.targetAt(patch.x + reef.patchRadius + 1, patch.y - 0.5, patch.z)).toBeNull();
  });

  it("each coral or seed counts for the objectives; planting scores +50 (D-030) and the seed launcher costs nothing", () => {
    const s = depositedSession(10);
    const before = [s.materials, s.score];
    s.coralAttached(false);
    s.seedPlanted(false);
    expect([s.materials, s.score]).toEqual(before);
    s.coralAttached(true);
    expect([s.framesPlanted, s.score, s.materials]).toEqual([1, before[1] + 50, before[0]]);
    expect(s.currentNotice).toEqual({ key: "reef.framePlanted", amount: 50 });
    s.seedPlanted(true);
    expect([s.patchesPlanted, s.score]).toEqual([1, before[1] + 100]);
    expect(s.currentNotice).toEqual({ key: "seagrass.patchPlanted", amount: 50 });
  });
});

describe("Phase 2 goals (REQ-004 AC-7)", () => {
  const rows = (s: Session) => s.phase2Objectives.map((o) => [o.id, o.current, o.target, o.done]);

  it("are hidden until the first deposit, then show 0/3, 0/3, 0/2", () => {
    const s = new Session(config.trash.count);
    expect(s.phase2Objectives).toEqual([]);
    s.collect();
    expect(s.phase2Objectives).toEqual([]);
    s.deposit();
    expect(rows(s)).toEqual([
      ["frames", 0, 3, false],
      ["coral", 0, 3, false],
      ["seagrass", 0, 2, false],
    ]);
  });

  it("count frames installed, frames planted and patches planted, and tick when met", () => {
    const s = depositedSession(15);
    for (let i = 0; i < 3; i++) s.buyFrame();
    for (let i = 0; i < 2; i++) s.coralAttached(true);
    s.seedPlanted(true);
    expect(rows(s)).toEqual([
      ["frames", 3, 3, true],
      ["coral", 2, 3, false],
      ["seagrass", 1, 2, false],
    ]);
  });
});

describe("the seed launcher (REQ-004 AC-4 to AC-6)", () => {
  const world = (field: ReefField) => field;

  /** A shot from `distance` metres west of the frame, level with its top, aimed straight at it. */
  function shootAt(field: ReefField, aimAt: Vector3, from: Vector3, dt = 1 / 30): ReturnType<SeedLauncher["update"]> {
    const launcher = new SeedLauncher();
    expect(launcher.fire(from, aimAt, new Vector3(1, 0, 0))).toBe(true);
    const results = [];
    for (let i = 0; i < 200 && launcher.shots.length > 0; i++) results.push(...launcher.update(dt, world(field)));
    expect(launcher.shots).toHaveLength(0);
    return results;
  }

  it("a shot at an installed frame lands on it, also when the frame step is large", () => {
    const field = new ReefField();
    field.install(0);
    const f = field.frames[0];
    const target = new Vector3(f.x, f.y + 1, f.z);
    for (const dt of [1 / 60, 0.1]) {
      const from = new Vector3(f.x - 12, f.y + 1, f.z);
      expect(shootAt(field, target, from, dt)).toEqual([{ kind: "coral", site: 0, planted: false }]);
    }
    expect(field.frames[0].fragments).toBe(2);
  });

  it("a shot at a site without a frame is lost on the sand", () => {
    const field = new ReefField();
    const f = field.frames[0];
    const results = shootAt(field, new Vector3(f.x, f.y + 0.2, f.z), new Vector3(f.x - 8, f.y + 4, f.z));
    expect(results).toEqual([{ kind: "miss" }]);
    expect(field.frames[0].fragments).toBe(0);
  });

  it("a shot at plain sand, a cliff or a rock is lost", () => {
    const field = new ReefField();
    const sand = new Vector3(0, -5, 20);
    expect(shootAt(field, new Vector3(0, -12, 20), sand)).toEqual([{ kind: "miss" }]);
    // Toward the boundary: lost at the edge of the bay, not counted anywhere.
    expect(shootAt(field, new Vector3(100, -6, 0), new Vector3(40, -6, 0))).toEqual([{ kind: "miss" }]);
    const rock = rocks[0];
    expect(shootAt(field, new Vector3(rock.x, rock.y, rock.z), new Vector3(rock.x - 6, rock.y, rock.z))).toEqual([{ kind: "miss" }]);
    expect(field.frames.every((f) => f.fragments === 0) && field.patches.every((p) => p.seeds === 0)).toBe(true);
  });

  it("a shot into the station is lost", () => {
    const field = new ReefField();
    const { x, y, z } = stationPosition;
    expect(shootAt(field, new Vector3(x, y + 1.5, z), new Vector3(x + 8, y + 1.5, z))).toEqual([{ kind: "miss" }]);
  });

  it("a seed on a patch plants it; a seed on a planted frame or patch is lost", () => {
    const field = new ReefField();
    const p = field.patches[0];
    const down = new Vector3(p.x, p.y - 1, p.z);
    expect(shootAt(field, down, new Vector3(p.x - 6, p.y + 3, p.z))).toEqual([{ kind: "seed", patch: 0, planted: false }]);
    expect(field.patches[0].seeds).toBe(1);
    field.land({ kind: "patch", index: 0 });
    field.land({ kind: "patch", index: 0 });
    expect(shootAt(field, down, new Vector3(p.x - 6, p.y + 3, p.z))).toEqual([{ kind: "miss" }]);
    expect(field.patches[0].seeds).toBe(3);
  });

  it("a shot has a range and is lost at its end", () => {
    const field = new ReefField();
    const from = new Vector3(0, -6, 30);
    const launcher = new SeedLauncher();
    launcher.fire(from, new Vector3(0, -6, 0), new Vector3(0, 0, -1));
    let steps = 0;
    let results: ReturnType<SeedLauncher["update"]> = [];
    while (results.length === 0 && steps++ < 400) results = launcher.update(1 / 60, field);
    expect(results).toEqual([{ kind: "miss" }]);
    // About range / speed seconds of flight.
    expect(steps / 60).toBeGreaterThan((seedLauncher.range - 2) / seedLauncher.speed);
    expect(steps / 60).toBeLessThan((seedLauncher.range + 2) / seedLauncher.speed);
  });

  it("reloads between shots", () => {
    const launcher = new SeedLauncher();
    const field = new ReefField();
    const dir = new Vector3(0, 0, -1);
    expect(launcher.fire(new Vector3(0, -6, 30), new Vector3(0, -6, 0), dir)).toBe(true);
    expect(launcher.fire(new Vector3(0, -6, 30), new Vector3(0, -6, 0), dir)).toBe(false);
    launcher.update(seedLauncher.interval + 0.01, field);
    expect(launcher.ready).toBe(true);
  });

  it("flies to the point under the crosshair even though the camera sits behind and above the ROV", () => {
    const field = new ReefField();
    field.install(2);
    const f = field.frames[2];
    // ROV 9 m south of the frame, looking north (yaw pi) and a little down. The camera sits 6 m behind and 2 m
    // above, so its ray starts higher than the ROV and comes down onto the frame.
    const rov = new Vector3(f.x, f.y + 1, f.z + 9);
    const aim = aimDirection(Math.PI, -0.2);
    const cam = rov.clone().addScaledVector(aim, -config.camera.distance);
    cam.y += config.camera.height;
    const point = findAimPoint(cam, aim, field);
    expect(field.targetAt(point.x, point.y, point.z)).toEqual({ kind: "frame", index: 2 });
    const launcher = new SeedLauncher();
    launcher.fire(rov, point, aim);
    let results: ReturnType<SeedLauncher["update"]> = [];
    for (let i = 0; i < 300 && results.length === 0; i++) results = launcher.update(1 / 30, field);
    expect(results).toEqual([{ kind: "coral", site: 2, planted: false }]);
  });

  it("with nothing to hit, the aim point is the far end of the ray, and a wall right ahead falls back to the aim", () => {
    const field = new ReefField();
    const cam = new Vector3(0, -3, 20);
    const aim = new Vector3(0, 0, -1);
    const far = findAimPoint(cam, aim, field);
    // The ray runs north across open water until the boundary or a rock stops it.
    expect(far.z).toBeLessThan(cam.z);
    expect(isSolidAt(far.x, far.y, far.z) || Math.abs(far.z - (cam.z - seedLauncher.aimDistance)) < 1e-6).toBe(true);
    const launcher = new SeedLauncher();
    const origin = new Vector3(0, -3, 20);
    launcher.fire(origin, origin.clone(), aim);
    expect(launcher.shots[0].direction.z).toBeCloseTo(-1);
  });
});

describe("the bay's solid check", () => {
  it("is true under the floor, above the surface, outside the boundary and inside rocks, false in open water", () => {
    expect(isSolidAt(0, -6, 30)).toBe(false);
    expect(isSolidAt(0, -40, 30)).toBe(true);
    expect(isSolidAt(0, 1, 30)).toBe(true);
    expect(isSolidAt(60, -6, 0)).toBe(true);
    expect(isSolidAt(rocks[0].x + 0.1, rocks[0].y, rocks[0].z)).toBe(true);
  });
});

describe("HUD for reef work (REQ-004 AC-7, E prompt)", () => {
  function hudState(s: Session, canInstall = false, inStationZone = false): HudState {
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
      inStationZone,
      stationDistance: 30,
      marker: { left: 10, top: 10, onScreen: false, angle: 0 },
      sucking: false,
      cutProgress: 0,
      reef: { phase2: s.phase2Objectives, canInstall },
    };
  }
  const goals = (el: HTMLElement) => [...el.querySelectorAll(".goal-text")].map((g) => g.textContent);

  it("shows the Phase 2 list below the Phase 1 list after the first deposit, and the counts follow the progress", () => {
    const s = new Session(config.trash.count);
    const hud = createHud("id");
    hud.update(hudState(s));
    expect(goals(hud.element)).toEqual(["Bersihkan teluk 0%/80%", "Bebaskan satwa 0/2", "Setor sampah ke stasiun"]);
    expect(hud.element.querySelector<HTMLElement>(".goal-list-phase2")!.hidden).toBe(true);
    for (let i = 0; i < 6; i++) s.collect();
    s.deposit();
    hud.update(hudState(s));
    expect(goals(hud.element)).toEqual([
      "Bersihkan teluk 14%/80%",
      "Bebaskan satwa 0/2",
      "Setor sampah ke stasiun",
      "Pasang rangka 0/3",
      "Tanam koral 0/3",
      "Tanam lamun 0/2",
    ]);
    const list = hud.element.querySelector<HTMLElement>(".goal-list-phase2")!;
    expect(list.hidden).toBe(false);
    expect(list.previousElementSibling).toBe(hud.element.querySelector(".goal-list"));
    s.buyFrame();
    s.coralAttached(true);
    s.seedPlanted(true);
    hud.update(hudState(s));
    expect(goals(hud.element).slice(3)).toEqual(["Pasang rangka 1/3", "Tanam koral 1/3", "Tanam lamun 1/2"]);
  });

  it("an English HUD shows the English list", () => {
    const s = depositedSession(1);
    const hud = createHud("en");
    hud.update(hudState(s));
    expect(goals(hud.element).slice(3)).toEqual(["Install frames 0/3", "Plant coral 0/3", "Plant seagrass 0/2"]);
  });

  it("the prompt shows near an empty site, and depositing wins in the station zone", () => {
    const s = depositedSession(5);
    const hud = createHud("id");
    const prompt = () => hud.element.querySelector<HTMLElement>(".message-prompt")!;
    hud.update(hudState(s));
    expect(prompt().hidden).toBe(true);
    hud.update(hudState(s, true));
    expect(prompt().hidden).toBe(false);
    expect(prompt().textContent).toBe("Tekan E untuk memasang rangka (5 bahan)");
    hud.update(hudState(s, true, true));
    expect(prompt().textContent).toBe("Tekan E untuk menyetor sampah");
  });

  it("shows the Seed launcher with key 3 and its hint", () => {
    const s = new Session(config.trash.count);
    s.select("seedLauncher");
    const hud = createHud("id");
    hud.update(hudState(s));
    expect(hud.element.querySelector(".tool-name")!.textContent).toBe("3 Seed launcher");
    expect(hud.element.querySelector(".tool-hint")!.textContent).toBe("Klik kiri untuk menembak bibit ke rangka atau petak lamun");
  });
});

describe("texts (REQ-004, G-003, G-004)", () => {
  const keys = (Object.keys(idStrings) as (keyof typeof idStrings)[]).filter((k) => /^(reef|seed|seagrass)\.|^objectives\.phase2|^tools\.seed|^controls\.seed/.test(k));

  it("exist in both languages", () => {
    expect(keys).toHaveLength(14);
    for (const key of keys) {
      expect(enStrings[key]).toBeTruthy();
      expect(idStrings[key]).toBeTruthy();
    }
  });

  it("never describe the frame or reef as made of plastic or trash, or plastic as returned to the sea", () => {
    for (const key of keys) {
      for (const value of [idStrings[key], enStrings[key]]) {
        expect(value).not.toMatch(/plastik|plastic|kembalikan|dikembalikan|lepas|release|return/i);
        // Trash is only mentioned as something to deposit at the station.
        if (/sampah|trash/i.test(value)) expect(value).toMatch(/Setor sampah di stasiun|Deposit trash at the station/);
      }
    }
  });
});
