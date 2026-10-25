import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { floorHeight } from "../../src/game/bay";
import {
  Cinematic,
  beachGroup,
  blendAt,
  cameraBlocked,
  captionAt,
  cinematicsOnByDefault,
  createPose,
  durationOf,
  letterboxAt,
  openingPlan,
  shotAt,
  startPose,
  structureSolidAt,
  type Pose,
} from "../../src/game/cinematic";
import { chooseLayout } from "../../src/game/layout";
import { inland } from "../../src/game/terrain";
import { generateTrash } from "../../src/game/trash";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";

const { cinematic, bay, station, trash } = config;
const seeds = Array.from({ length: 60 }, (_, i) => i * 7919 + 3);
const floatingOf = (seed: number) => generateTrash(chooseLayout(seed).trashSeed).filter((item) => item.floating);
const groupOf = (seed: number) => beachGroup(floatingOf(seed).map((item) => item.home))!;

/** The screen's picture: the camera's frustum less the black bars at the top and bottom. */
const lens = new PerspectiveCamera(config.camera.fov, 16 / 9, 0.1, config.camera.far);
const barShare = 2 * cinematic.letterbox;

/** Whether `point` shows in the part of the screen the bars leave, from `pose` (`inset` keeps it off the very edge). */
function inPicture(pose: Pose, point: Vector3, inset = 0): boolean {
  lens.position.copy(pose.position);
  lens.lookAt(pose.target);
  lens.updateMatrixWorld();
  lens.updateProjectionMatrix();
  const p = point.clone().project(lens);
  return p.z < 1 && Math.abs(p.x) <= 1 - inset && Math.abs(p.y) <= 1 - barShare - inset;
}

function sample(plan: { pose(t: number, out: Pose): Pose }, from: number, to: number, fps = 30): { t: number; pose: Pose }[] {
  const out: { t: number; pose: Pose }[] = [];
  for (let t = from; t <= to + 1e-9; t += 1 / fps) {
    const pose = createPose();
    plan.pose(t, pose);
    out.push({ t, pose });
  }
  return out;
}

describe("whether the cinematics play (REQ-027 AC-6, D-021)", () => {
  it("they always do in a build for players, whatever the environment says", () => {
    expect(cinematicsOnByDefault(false, undefined)).toBe(true);
    expect(cinematicsOnByDefault(false, "1")).toBe(true);
    expect(cinematicsOnByDefault(false, "")).toBe(true);
  });

  it("only the dev server with the browser tests' layout seed starts with them off", () => {
    expect(cinematicsOnByDefault(true, undefined)).toBe(true);
    expect(cinematicsOnByDefault(true, "")).toBe(true);
    expect(cinematicsOnByDefault(true, "1")).toBe(false);
  });
});

describe("the narration (REQ-027 AC-2)", () => {
  it("is three lines, in order, one at a time, in both languages with the same keys (G-004)", () => {
    const { captions } = cinematic.opening;
    expect(captions.map((c) => c.key)).toEqual(["cinematic.opening.1", "cinematic.opening.2", "cinematic.opening.3"]);
    expect(idStrings["cinematic.opening.1"]).toBe("Teluk ini dulu penuh kehidupan.");
    expect(idStrings["cinematic.opening.2"]).toBe("Kini sampah, jaring hantu, dan karang yang memucat menguasainya.");
    expect(idStrings["cinematic.opening.3"]).toBe("Saatnya memulihkannya.");
    expect(enStrings["cinematic.opening.1"]).toBe("This bay was once full of life.");
    expect(enStrings["cinematic.opening.2"]).toBe("Now trash, ghost nets and bleaching corals have taken over.");
    expect(enStrings["cinematic.opening.3"]).toBe("Time to bring it back.");
    expect(Object.keys(idStrings).sort()).toEqual(Object.keys(enStrings).sort());
    for (let i = 1; i < captions.length; i++) expect(captions[i].from).toBeGreaterThanOrEqual(captions[i - 1].to);
    for (const caption of captions) {
      expect(caption.to - caption.from).toBeGreaterThanOrEqual(4);
      expect(caption.to).toBeLessThanOrEqual(cinematic.opening.duration);
    }
  });

  it("shows the line whose time it is, fading in and out, and nothing between the lines", () => {
    const seen: string[] = [];
    for (let t = 0; t < cinematic.opening.duration; t += 0.1) {
      const caption = captionAt("opening", t);
      if (caption && seen[seen.length - 1] !== caption.key) seen.push(caption.key);
    }
    expect(seen).toEqual(["cinematic.opening.1", "cinematic.opening.2", "cinematic.opening.3"]);
    const [first] = cinematic.opening.captions;
    expect(captionAt("opening", first.from)?.opacity).toBe(0);
    expect(captionAt("opening", (first.from + first.to) / 2)?.opacity).toBe(1);
    expect(captionAt("opening", first.to - 0.05)!.opacity).toBeLessThan(0.1);
    expect(captionAt("opening", 0.2)).toBeNull();
    expect(captionAt("opening", (cinematic.opening.captions[0].to + cinematic.opening.captions[1].from) / 2)).toBeNull();
  });

});

describe("the look of a cinematic (REQ-027 AC-3)", () => {
  it("slides the black bars in at the start and out at the end", () => {
    const duration = durationOf("opening");
    expect(letterboxAt(0, duration)).toBe(0);
    expect(letterboxAt(cinematic.barSeconds, duration)).toBe(1);
    expect(letterboxAt(duration / 2, duration)).toBe(1);
    expect(letterboxAt(duration, duration)).toBe(0);
    expect(cinematic.letterbox).toBeGreaterThan(0.05);
    expect(cinematic.letterbox).toBeLessThan(0.2);
  });

  it("has the skip hint in both languages", () => {
    expect(idStrings["cinematic.skip"]).toBe("Klik atau Spasi untuk melewati");
    expect(enStrings["cinematic.skip"]).toBe("Click or Space to skip");
  });

  it("tells the HUD the kind, the line and the bars of the moment", () => {
    const clock = new Cinematic("opening");
    clock.step(cinematic.opening.captions[0].from + 1);
    const hud = clock.hud();
    expect(hud).toMatchObject({ kind: "opening", caption: "cinematic.opening.1", letterbox: 1 });
    expect(hud.captionOpacity).toBeGreaterThan(0.9);
  });
});

describe("the clock (REQ-027 AC-4, AC-7)", () => {
  it("runs for the opening's length and then says it is done", () => {
    const clock = new Cinematic("opening");
    let result = null;
    let steps = 0;
    while (!result) {
      result = clock.step(1 / 60);
      steps++;
    }
    expect(result).toBe("done");
    expect(steps / 60).toBeCloseTo(cinematic.opening.duration, 1);
  });

  it("stands still while nobody steps it, which is what a pause is", () => {
    const clock = new Cinematic("opening");
    clock.step(3);
    const time = clock.time;
    expect(clock.time).toBe(time);
    clock.step(0);
    expect(clock.time).toBe(time);
  });

  it("fades the screen out after a skip, and is over at the darkest point", () => {
    const clock = new Cinematic("opening");
    clock.step(5);
    expect(clock.fade).toBe(0);
    clock.skip();
    expect(clock.fade).toBe(0);
    const half = cinematic.skipFadeSeconds / 2;
    expect(clock.step(half / 2)).toBeNull();
    expect(clock.fade).toBeCloseTo(0.5, 5);
    expect(clock.step(half / 2)).toBe("skipped");
    expect(clock.fade).toBeCloseTo(1, 5);
    // The picture stood still while it went dark.
    expect(clock.time).toBe(5);
  });

  it("takes a second skip as the first", () => {
    const clock = new Cinematic("opening");
    clock.skip();
    clock.step(0.1);
    const fade = clock.fade;
    clock.skip();
    expect(clock.fade).toBe(fade);
  });
});

describe("the opening's path (REQ-027 AC-1)", () => {
  const { opening } = cinematic;

  it("takes about 20 to 25 seconds", () => {
    expect(opening.duration).toBeGreaterThanOrEqual(20);
    expect(opening.duration).toBeLessThanOrEqual(25);
    expect(durationOf("opening")).toBe(opening.duration);
  });

  it("goes in three parts: from high up, a low glide over the water, and a dive", () => {
    expect(shotAt("opening", 0)).toBe(0);
    expect(shotAt("opening", opening.shots.aerial - 0.01)).toBe(0);
    expect(shotAt("opening", opening.shots.aerial + 0.01)).toBe(1);
    expect(shotAt("opening", opening.shots.glide + 0.01)).toBe(2);
    for (const seed of seeds.slice(0, 20)) {
      const plan = openingPlan(groupOf(seed));
      const aerial = sample(plan, 0, opening.shots.aerial - 1);
      const glide = sample(plan, opening.shots.aerial + 2.5, opening.shots.glide);
      const dive = sample(plan, opening.shots.surface + 1, opening.duration);
      // High over the sea at first, looking at the coast to the west.
      for (const { pose } of aerial) expect(pose.position.y).toBeGreaterThan(14);
      expect(aerial[0].pose.position.y).toBeGreaterThan(25);
      expect(aerial[0].pose.target.x).toBeLessThan(aerial[0].pose.position.x - 5);
      // Low over the surface, not in the water.
      for (const { pose } of glide) {
        expect(pose.position.y).toBeGreaterThan(bay.surfaceY + 1);
        expect(pose.position.y).toBeLessThan(bay.surfaceY + opening.glide.height + 4);
      }
      // Under water at the end.
      for (const { pose } of dive) expect(pose.position.y).toBeLessThan(bay.surfaceY);
    }
  });

  it("goes through the surface once, as the shots say, and not back out", () => {
    for (const seed of seeds.slice(0, 20)) {
      const samples = sample(openingPlan(groupOf(seed)), 0, opening.duration, 60);
      let crossings = 0;
      for (let i = 1; i < samples.length; i++) {
        if (samples[i - 1].pose.position.y > bay.surfaceY !== samples[i].pose.position.y > bay.surfaceY) {
          crossings += 1;
          expect(samples[i].t).toBeGreaterThan(opening.shots.glide);
          expect(samples[i].t).toBeLessThan(opening.shots.surface + 1.5);
        }
      }
      expect(crossings).toBe(1);
    }
  });

  it("ends behind the submarine at the start, exactly where the follow camera stands, looking where it looks (AC-5)", () => {
    const end = startPose();
    const start = config.rov.start;
    // Behind the submarine (it faces east) and a little above it, as the follow camera is.
    expect(end.position.x).toBeLessThan(start.x - 3);
    expect(end.position.z).toBeCloseTo(start.z, 5);
    for (const seed of seeds.slice(0, 20)) {
      const pose = openingPlan(groupOf(seed)).pose(opening.duration, createPose());
      expect(pose.position.distanceTo(end.position)).toBeLessThan(1e-6);
      expect(pose.target.distanceTo(end.target)).toBeLessThan(1e-6);
    }
  });

  it("lands on the follow camera smoothly: no jump, and the last second hardly moves", () => {
    for (const seed of seeds.slice(0, 20)) {
      const plan = openingPlan(groupOf(seed));
      const last = sample(plan, opening.duration - 1, opening.duration, 60);
      const travelled = last[0].pose.position.distanceTo(last[last.length - 1].pose.position);
      expect(travelled).toBeLessThan(2.5);
      const turn = (pose: Pose) => pose.target.clone().sub(pose.position).normalize();
      expect(Math.acos(Math.min(1, turn(last[0].pose).dot(turn(last[last.length - 1].pose))))).toBeLessThan(0.3);
    }
    expect(blendAt(cinematic.opening.duration - cinematic.blendSeconds, cinematic.opening.duration)).toBe(0);
    expect(blendAt(cinematic.opening.duration, cinematic.opening.duration)).toBe(1);
  });

  it("moves without jumps: never faster than a swooping camera, and the look-at never swings wildly", () => {
    for (const seed of seeds) {
      const samples = sample(openingPlan(groupOf(seed)), 0, opening.duration, 60);
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1].pose;
        const b = samples[i].pose;
        expect(a.position.distanceTo(b.position) * 60).toBeLessThan(28);
        // The direction it looks changes by less than ~75 degrees a second.
        const da = a.target.clone().sub(a.position).normalize();
        const db = b.target.clone().sub(b.position).normalize();
        expect(Math.acos(Math.min(1, da.dot(db))) * 60).toBeLessThan(1.3);
      }
    }
  });
});

describe("the opening follows this dive's layout (REQ-027 AC-8)", () => {
  const { opening } = cinematic;

  it("finds the group of floating trash near the west beach that REQ-025 AC-1 puts there, for every layout", () => {
    for (const seed of seeds) {
      const floating = floatingOf(seed);
      const group = beachGroup(floating.map((item) => item.home))!;
      expect(-inland(group.x, group.z)).toBeLessThanOrEqual(trash.surface.nearShore);
      expect(Math.abs(group.z)).toBeLessThanOrEqual(trash.surface.beachHalfLength);
      // It is the first group laid, and the centre of the items round it.
      const near = floating.filter((item) => Math.hypot(item.home.x - group.x, item.home.z - group.z) <= trash.surface.groupRadius * 2);
      expect(near.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("answers null when nothing floats", () => {
    expect(beachGroup([])).toBeNull();
  });

  it("keeps that group in the picture from the first frame to the end of the glide, before the dive turns to the submarine (the bars left out)", () => {
    for (const seed of seeds) {
      const group = groupOf(seed);
      const plan = openingPlan(group);
      for (const { t, pose } of sample(plan, 0, opening.shots.glide, 30)) {
        expect(inPicture(pose, group), `seed ${seed} at ${t.toFixed(2)} s`).toBe(true);
      }
    }
  });

  it("shows the shed and the dock from high up (the coast), and the headlands' rock at the sides of the picture", () => {
    for (const seed of seeds.slice(0, 30)) {
      const plan = openingPlan(groupOf(seed));
      for (const t of [0, 1.5]) {
        const pose = plan.pose(t, createPose());
        expect(inPicture(pose, new Vector3(station.x, floorHeight(station.x, station.z) + 2, station.z)), `shed, seed ${seed} at ${t}`).toBe(true);
        expect(inPicture(pose, new Vector3(bay.dock.landX, bay.surfaceY + 1, bay.dock.z)), `dock, seed ${seed} at ${t}`).toBe(true);
      }
    }
  });

  it("is a different path for a different layout (it adapts)", () => {
    const here = seeds.map((seed) => openingPlan(groupOf(seed)).pose(opening.shots.aerial, createPose()).position);
    const apart = new Set(here.map((p) => `${Math.round(p.x)}/${Math.round(p.z)}`));
    expect(apart.size).toBeGreaterThan(10);
  });

  it("never passes through the terrain, a rock, the headlands, the shed or the dock", () => {
    for (const seed of seeds) {
      const plan = openingPlan(groupOf(seed));
      for (const { t, pose } of sample(plan, 0, opening.duration, 60)) {
        const { x, y, z } = pose.position;
        expect(cameraBlocked(x, y, z, 0.5), `seed ${seed} at ${t.toFixed(2)} s: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
        expect(y, `seed ${seed} at ${t.toFixed(2)} s`).toBeGreaterThan(floorHeight(x, z) + 0.5);
      }
    }
  });
});

describe("what the camera keeps out of", () => {
  it("knows the shed, its mast, the dock's deck and the water under it", () => {
    const ground = floorHeight(station.x, station.z);
    expect(structureSolidAt(station.x, ground + 1.5, station.z)).toBe(true);
    expect(structureSolidAt(station.x, ground + 4.2, station.z)).toBe(true);
    expect(structureSolidAt(station.x + station.mast.dx, ground + 6, station.z + station.mast.dz)).toBe(true);
    expect(structureSolidAt(station.x, ground + 20, station.z)).toBe(false);
    const { dock } = bay;
    expect(structureSolidAt((dock.landX + dock.seaX) / 2, bay.surfaceY + 0.5, dock.z)).toBe(true);
    expect(structureSolidAt((dock.landX + dock.seaX) / 2, bay.surfaceY - 3, dock.z)).toBe(true);
    expect(structureSolidAt((dock.landX + dock.seaX) / 2, bay.surfaceY + 4, dock.z)).toBe(false);
    expect(structureSolidAt(dock.seaX + 5, bay.surfaceY + 0.5, dock.z)).toBe(false);
  });

  it("knows the terrain: the land and the floor", () => {
    expect(cameraBlocked(-130, floorHeight(-130, 40) - 1, 40)).toBe(true);
    expect(cameraBlocked(-60, bay.surfaceY - 3, 20)).toBe(false);
  });
});
