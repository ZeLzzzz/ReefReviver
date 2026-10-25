import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import { generateAnimals } from "../../src/game/animals";
import { floorHeight, terrainSolidAt } from "../../src/game/bay";
import { caveLevel } from "../../src/game/cave";
import {
  Cinematic,
  beachGroup,
  blendAt,
  cameraBlocked,
  captionAt,
  cinematicsOnByDefault,
  createPose,
  cutFadeAt,
  durationOf,
  floorGroup,
  letterboxAt,
  netSolidAt,
  openingCuts,
  openingPlan,
  seaFloorTrash,
  shotAt,
  startPose,
  structureSolidAt,
  type OpeningScene,
  type Pose,
} from "../../src/game/cinematic";
import { chooseLayout } from "../../src/game/layout";
import { generateNets } from "../../src/game/nets";
import { inland } from "../../src/game/terrain";
import { generateTrash } from "../../src/game/trash";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";

// The path checks walk every layout of a long list frame by frame; with the whole suite running they need more than the default 5 s.
vi.setConfig({ testTimeout: 30_000 });

const { cinematic, bay, station, trash } = config;
const seeds = Array.from({ length: 60 }, (_, i) => i * 7919 + 3);
const floatingOf = (seed: number) => generateTrash(chooseLayout(seed).trashSeed).filter((item) => item.floating);
const groupOf = (seed: number) => beachGroup(floatingOf(seed).map((item) => item.home))!;
/** Everything the opening films for the dive of `seed`: its floating group, floor group, turtle and nets (what the game hands over). */
function sceneOf(seed: number): OpeningScene {
  const layout = chooseLayout(seed);
  const items = generateTrash(layout.trashSeed);
  const [turtle, shark] = generateAnimals(layout);
  return {
    group: beachGroup(items.filter((item) => item.floating).map((item) => item.home))!,
    floor: floorGroup(seaFloorTrash(items), config.rov.start),
    turtle: { position: turtle.home, yaw: turtle.homeYaw },
    nets: generateNets(layout),
    hide: [shark.home],
  };
}
const planOf = (seed: number) => openingPlan(sceneOf(seed));

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

  it("puts line 2 on the floating trash, the floor trash and the net, and line 3 on the submarine (D-115)", () => {
    const { captions, shots } = cinematic.opening;
    // Line 1 is over the coast; line 2 begins as the glide over the floating trash begins and runs through the floor trash
    // shot and to the end of the net shot (the screen goes black for the cut to the submarine just after it).
    expect(captions[0].to).toBeLessThanOrEqual(shots.aerial);
    expect(captions[1].from).toBeGreaterThanOrEqual(shots.aerial);
    expect(captions[1].from).toBeLessThan(shots.aerial + 2);
    expect(captions[1].to).toBeGreaterThan(shots.net - 1.5);
    expect(captions[1].to).toBeLessThanOrEqual(shots.net);
    for (const t of [(shots.aerial + shots.glide) / 2, (shots.glide + shots.trash) / 2, (shots.trash + shots.net) / 2]) {
      expect(captionAt("opening", t)?.key, `at ${t} s`).toBe("cinematic.opening.2");
    }
    // Line 3 comes when the camera reaches the submarine: after the last cut.
    expect(captions[2].from).toBeGreaterThan(shots.net);
    expect(captionAt("opening", (shots.net + cinematic.opening.duration) / 2)?.key).toBe("cinematic.opening.3");
    expect(shotAt("opening", captions[2].from)).toBe(4);
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

  it("takes about 32 seconds (D-115)", () => {
    expect(opening.duration).toBeGreaterThanOrEqual(30);
    expect(opening.duration).toBeLessThanOrEqual(35);
    expect(durationOf("opening")).toBe(opening.duration);
  });

  it("goes in five parts: from high up, a low glide over the water, the trash on the sea floor, the turtle in its net, and the submarine", () => {
    const { shots } = opening;
    expect(shots.aerial).toBeLessThan(shots.glide);
    expect(shots.glide).toBeLessThan(shots.trash);
    expect(shots.trash).toBeLessThan(shots.net);
    expect(shots.net).toBeLessThan(opening.duration - 3);
    expect(shotAt("opening", 0)).toBe(0);
    expect(shotAt("opening", shots.aerial - 0.01)).toBe(0);
    expect(shotAt("opening", shots.aerial + 0.01)).toBe(1);
    expect(shotAt("opening", shots.glide - 0.01)).toBe(1);
    expect(shotAt("opening", shots.glide + 0.01)).toBe(2);
    expect(shotAt("opening", shots.trash - 0.01)).toBe(2);
    expect(shotAt("opening", shots.trash + 0.01)).toBe(3);
    expect(shotAt("opening", shots.net - 0.01)).toBe(3);
    expect(shotAt("opening", shots.net + 0.01)).toBe(4);
    expect(shotAt("opening", opening.duration)).toBe(4);
    for (const seed of seeds.slice(0, 20)) {
      const plan = planOf(seed);
      const aerial = sample(plan, 0, shots.aerial - 1);
      const glide = sample(plan, shots.aerial + 2.5, shots.glide - 0.02);
      const underwater = sample(plan, shots.glide + 0.02, opening.duration);
      // High over the sea at first, looking at the coast to the west.
      for (const { pose } of aerial) expect(pose.position.y).toBeGreaterThan(14);
      expect(aerial[0].pose.position.y).toBeGreaterThan(25);
      expect(aerial[0].pose.target.x).toBeLessThan(aerial[0].pose.position.x - 5);
      // Low over the surface, not in the water.
      for (const { pose } of glide) {
        expect(pose.position.y).toBeGreaterThan(bay.surfaceY + 1);
        expect(pose.position.y).toBeLessThan(bay.surfaceY + opening.glide.height + 4);
      }
      // Under water from the first cut to the end.
      for (const { t, pose } of underwater) expect(pose.position.y, `seed ${seed} at ${t.toFixed(2)} s`).toBeLessThan(bay.surfaceY);
    }
  });

  it("goes through the surface once, at the first cut, and not back out", () => {
    for (const seed of seeds.slice(0, 20)) {
      const samples = sample(planOf(seed), 0, opening.duration, 60);
      let crossings = 0;
      for (let i = 1; i < samples.length; i++) {
        if (samples[i - 1].pose.position.y > bay.surfaceY !== samples[i].pose.position.y > bay.surfaceY) {
          crossings += 1;
          // The camera jumps at the cut (the screen is black then): it comes out of the sample before it and into the one after.
          expect(samples[i - 1].t).toBeLessThan(opening.shots.glide + 1 / 60);
          expect(samples[i].t).toBeGreaterThanOrEqual(opening.shots.glide - 1 / 60);
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
      const pose = planOf(seed).pose(opening.duration, createPose());
      expect(pose.position.distanceTo(end.position)).toBeLessThan(1e-6);
      expect(pose.target.distanceTo(end.target)).toBeLessThan(1e-6);
    }
  });

  it("lands on the follow camera smoothly: no jump, and the last second hardly moves", () => {
    for (const seed of seeds.slice(0, 20)) {
      const plan = planOf(seed);
      const last = sample(plan, opening.duration - 1, opening.duration, 60);
      const travelled = last[0].pose.position.distanceTo(last[last.length - 1].pose.position);
      expect(travelled).toBeLessThan(2.5);
      const turn = (pose: Pose) => pose.target.clone().sub(pose.position).normalize();
      expect(Math.acos(Math.min(1, turn(last[0].pose).dot(turn(last[last.length - 1].pose))))).toBeLessThan(0.3);
    }
    expect(blendAt(cinematic.opening.duration - cinematic.blendSeconds, cinematic.opening.duration)).toBe(0);
    expect(blendAt(cinematic.opening.duration, cinematic.opening.duration)).toBe(1);
  });

  it("moves without jumps: never faster than a swooping camera, and the look-at never swings wildly, except at the cuts", () => {
    const cuts = openingCuts();
    for (const seed of seeds) {
      const samples = sample(planOf(seed), 0, opening.duration, 60);
      for (let i = 1; i < samples.length; i++) {
        // A cut is the one place the camera jumps: the screen is black there.
        if (cuts.some((cut) => samples[i - 1].t < cut && samples[i].t >= cut)) continue;
        const a = samples[i - 1].pose;
        const b = samples[i].pose;
        expect(a.position.distanceTo(b.position) * 60, `seed ${seed} at ${samples[i].t.toFixed(2)} s`).toBeLessThan(28);
        // The direction it looks changes by less than ~75 degrees a second.
        const da = a.target.clone().sub(a.position).normalize();
        const db = b.target.clone().sub(b.position).normalize();
        expect(Math.acos(Math.min(1, da.dot(db))) * 60, `seed ${seed} at ${samples[i].t.toFixed(2)} s`).toBeLessThan(1.3);
      }
    }
  });

  it("moves slowly in the two close shots: a gentle drift, not a swoop", () => {
    for (const seed of seeds.slice(0, 30)) {
      const plan = planOf(seed);
      for (const [from, to] of [
        [opening.shots.glide, opening.shots.trash],
        [opening.shots.trash, opening.shots.net],
      ]) {
        const samples = sample(plan, from, to - 0.02, 30);
        const moved = samples[0].pose.position.distanceTo(samples[samples.length - 1].pose.position);
        expect(moved, `seed ${seed} from ${from} s`).toBeGreaterThan(1.5);
        for (let i = 1; i < samples.length; i++) expect(samples[i - 1].pose.position.distanceTo(samples[i].pose.position) * 30).toBeLessThan(3);
      }
    }
  });
});

describe("the cuts (REQ-027 AC-1, D-115)", () => {
  const { cut, shots } = cinematic.opening;

  it("are at the end of the glide, of the floor trash shot and of the net shot", () => {
    expect(openingCuts()).toEqual([shots.glide, shots.trash, shots.net]);
  });

  it("go black at the cut itself, hold it a moment, and are clear a little away", () => {
    for (const at of openingCuts()) {
      expect(cutFadeAt("opening", at)).toBe(1);
      expect(cutFadeAt("opening", at - cut.holdSeconds / 2)).toBe(1);
      expect(cutFadeAt("opening", at + cut.holdSeconds / 2)).toBe(1);
      expect(cutFadeAt("opening", at - cut.holdSeconds / 2 - cut.fadeSeconds)).toBe(0);
      expect(cutFadeAt("opening", at + cut.holdSeconds / 2 + cut.fadeSeconds)).toBe(0);
      // Brief: black for well under a second in all.
      expect(cut.fadeSeconds * 2 + cut.holdSeconds).toBeLessThan(1.2);
      // Down on the way in, up on the way out, never a step.
      let last = 0;
      for (let t = at - cut.fadeSeconds - cut.holdSeconds; t <= at; t += 0.01) {
        const fade = cutFadeAt("opening", t);
        expect(fade).toBeGreaterThanOrEqual(last - 1e-9);
        expect(fade - last).toBeLessThan(0.12);
        last = fade;
      }
    }
  });

  it("are clear everywhere else, and the other cinematics have none", () => {
    for (const t of [0, 3, 6, (shots.glide + shots.trash) / 2, (shots.trash + shots.net) / 2, (shots.net + cinematic.opening.duration) / 2, cinematic.opening.duration]) {
      expect(cutFadeAt("opening", t), `at ${t} s`).toBe(0);
    }
    for (const t of [0, 3, shots.glide]) {
      expect(cutFadeAt("bloom", t)).toBe(0);
      expect(cutFadeAt("ending", t)).toBe(0);
    }
  });

  it("show on the clock, which a pause freezes and a skip does not disturb", () => {
    const clock = new Cinematic("opening");
    clock.step(shots.glide);
    expect(clock.cutFade).toBe(1);
    expect(clock.fade).toBe(0);
    clock.step(0);
    expect(clock.cutFade).toBe(1);
    clock.step(1);
    expect(clock.cutFade).toBe(0);
    expect(new Cinematic("bloom").cutFade).toBe(0);
  });

  it("put the camera in a different place on each side, in the dark (the pose jumps only at a cut)", () => {
    const plan = planOf(seeds[0]);
    for (const at of openingCuts()) {
      const before = plan.pose(at - 0.01, createPose()).position;
      const after = plan.pose(at, createPose()).position;
      expect(before.distanceTo(after)).toBeGreaterThan(3);
      expect(cutFadeAt("opening", at - 0.01)).toBe(1);
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
      const plan = planOf(seed);
      for (const { t, pose } of sample(plan, 0, opening.shots.glide - 0.02, 30)) {
        expect(inPicture(pose, group), `seed ${seed} at ${t.toFixed(2)} s`).toBe(true);
      }
    }
  });

  it("shows the shed and the dock from high up (the coast), and the headlands' rock at the sides of the picture", () => {
    for (const seed of seeds.slice(0, 30)) {
      const plan = planOf(seed);
      for (const t of [0, 1.5]) {
        const pose = plan.pose(t, createPose());
        expect(inPicture(pose, new Vector3(station.x, floorHeight(station.x, station.z) + 2, station.z)), `shed, seed ${seed} at ${t}`).toBe(true);
        expect(inPicture(pose, new Vector3(bay.dock.landX, bay.surfaceY + 1, bay.dock.z)), `dock, seed ${seed} at ${t}`).toBe(true);
      }
    }
  });

  it("is a different path for a different layout (it adapts)", () => {
    const here = seeds.map((seed) => planOf(seed).pose(opening.shots.aerial, createPose()).position);
    const apart = new Set(here.map((p) => `${Math.round(p.x)}/${Math.round(p.z)}`));
    expect(apart.size).toBeGreaterThan(10);
  });

  it("never passes through the terrain, a rock, solid coral, the headlands, the shed, the dock or a net", () => {
    for (const seed of seeds) {
      const scene = sceneOf(seed);
      const plan = openingPlan(scene);
      for (const { t, pose } of sample(plan, 0, opening.duration, 60)) {
        const { x, y, z } = pose.position;
        expect(cameraBlocked(x, y, z, 0.5), `seed ${seed} at ${t.toFixed(2)} s: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`).toBe(false);
        expect(y, `seed ${seed} at ${t.toFixed(2)} s`).toBeGreaterThan(floorHeight(x, z) + 0.5);
        expect(netSolidAt(scene.nets, x, y, z, 0.5), `net, seed ${seed} at ${t.toFixed(2)} s`).toBe(false);
      }
    }
  });

  it("has a clear line from the camera to what each close shot films: nothing solid stands between", () => {
    for (const seed of seeds) {
      const scene = sceneOf(seed);
      const plan = openingPlan(scene);
      const turtle = scene.turtle.position;
      const middle = floorMiddle(scene.floor);
      for (const { t, pose } of sample(plan, opening.shots.glide + 0.02, opening.shots.net - 0.02, 10)) {
        // Walked from a little above the subject, as the shot checks it.
        const from = t < opening.shots.trash ? middle.clone() : new Vector3(turtle.x, turtle.y, turtle.z);
        from.y += 0.7;
        const steps = Math.ceil(from.distanceTo(pose.position) / 0.25);
        for (let i = 1; i <= steps; i++) {
          const p = from.clone().lerp(pose.position, i / steps);
          expect(terrainSolidAt(p.x, p.y, p.z, 0.2), `seed ${seed} at ${t.toFixed(2)} s`).toBe(false);
        }
      }
    }
  });
});

/** The middle of a group of items, as the shot films it. */
function floorMiddle(items: readonly { x: number; y: number; z: number }[]): Vector3 {
  const middle = new Vector3();
  for (const item of items) middle.add(new Vector3(item.x, item.y, item.z));
  return middle.divideScalar(items.length);
}

describe("the floor trash and the turtle in the opening (REQ-027 AC-1, AC-8, D-115)", () => {
  const { opening } = cinematic;

  it("films the floor group nearest the start: on the floor, not floating, not on the beach, not in the cave", () => {
    for (const seed of seeds) {
      const items = generateTrash(chooseLayout(seed).trashSeed);
      const floor = seaFloorTrash(items);
      expect(floor.length).toBeGreaterThan(20);
      // None of the cave's own trash is in it, nor any that floats or lies ashore.
      for (const item of items.filter((item) => item.onBeach || item.floating)) expect(floor).not.toContain(item.home);
      for (const home of floor) {
        expect(caveLevel(home.x, home.y + 1, home.z), `seed ${seed}`).toBeLessThan(cinematic.bloom.caveHold);
        expect(home.y).toBeLessThan(bay.surfaceY - trash.minDepth + 1);
      }
      const group = floorGroup(floor, config.rov.start);
      expect(group.length).toBeGreaterThanOrEqual(3);
      const away = (item: { x: number; z: number }) => Math.hypot(item.x - config.rov.start.x, item.z - config.rov.start.z);
      // The nearest floor item of the whole bay is in it, and it is one group: all within reach of that one.
      const nearest = floor.reduce((best, item) => (away(item) < away(best) ? item : best));
      expect(group).toContain(nearest);
      for (const item of group) expect(Math.hypot(item.x - nearest.x, item.z - nearest.z)).toBeLessThanOrEqual(opening.groupReach);
      // Nothing else of its neighbourhood is left out.
      expect(floor.filter((item) => Math.hypot(item.x - nearest.x, item.z - nearest.z) <= opening.groupReach).length).toBe(group.length);
    }
  });

  it("has no group when the floor has no trash", () => {
    expect(floorGroup([], config.rov.start)).toEqual([]);
  });

  it("traps the turtle in net 0 of every layout, and the camera films that net", () => {
    for (const seed of seeds) {
      const layout = chooseLayout(seed);
      const [turtle, shark] = generateAnimals(layout);
      expect(turtle.species).toBe("turtle");
      expect(shark.species).toBe("reefShark");
      const nets = generateNets(layout);
      expect(Math.hypot(turtle.home.x - nets[0].center.x, turtle.home.z - nets[0].center.z)).toBeLessThan(1e-6);
    }
  });

  it("keeps the floor group in the picture, close and clear, through its whole shot, over every layout", () => {
    for (const seed of seeds) {
      const scene = sceneOf(seed);
      const plan = openingPlan(scene);
      const middle = floorMiddle(scene.floor);
      for (const { t, pose } of sample(plan, opening.shots.glide, opening.shots.trash - 0.02, 15)) {
        expect(inPicture(pose, middle, 0.1), `middle of the group, seed ${seed} at ${t.toFixed(2)} s`).toBe(true);
        // Close enough to read in the murk.
        expect(pose.position.distanceTo(middle), `seed ${seed} at ${t.toFixed(2)} s`).toBeLessThan(9);
        // Most of the group is on the screen at every moment.
        const seen = scene.floor.filter((item) => inPicture(pose, new Vector3(item.x, item.y, item.z)));
        expect(seen.length, `seed ${seed} at ${t.toFixed(2)} s`).toBeGreaterThanOrEqual(Math.ceil(scene.floor.length / 2));
      }
    }
  });

  it("keeps the turtle in the picture, close, through its whole shot, over every layout, and does not show the reef shark", () => {
    for (const seed of seeds) {
      const layout = chooseLayout(seed);
      const scene = sceneOf(seed);
      const plan = openingPlan(scene);
      const turtle = new Vector3(scene.turtle.position.x, scene.turtle.position.y, scene.turtle.position.z);
      const shark = generateAnimals(layout)[1].home;
      for (const { t, pose } of sample(plan, opening.shots.trash, opening.shots.net - 0.02, 15)) {
        expect(inPicture(pose, turtle, 0.15), `turtle, seed ${seed} at ${t.toFixed(2)} s`).toBe(true);
        expect(pose.position.distanceTo(turtle), `seed ${seed} at ${t.toFixed(2)} s`).toBeLessThan(6.5);
        expect(pose.position.distanceTo(turtle), `seed ${seed} at ${t.toFixed(2)} s`).toBeGreaterThan(2.5);
      }
      for (const { t, pose } of sample(plan, opening.shots.glide, opening.shots.net - 0.02, 15)) {
        // The shark, in its own net far off, is out of the picture or beyond the end of the fog.
        expect(inPicture(pose, shark) && pose.position.distanceTo(shark) < config.water.murky.fogFar, `shark, seed ${seed} at ${t.toFixed(2)} s`).toBe(false);
      }
    }
  });

  it("is a different shot for a different layout", () => {
    const spots = (at: number) => new Set(seeds.map((seed) => planOf(seed).pose(at, createPose()).position).map((p) => `${Math.round(p.x)}/${Math.round(p.z)}`));
    // The floor group nearest the start varies with the trash; the turtle's net is one of five spots, seen from a side that varies.
    expect(spots(opening.shots.glide + 1).size).toBeGreaterThan(20);
    expect(spots(opening.shots.trash + 1).size).toBeGreaterThanOrEqual(5);
  });

  it("ends in a shot that begins beside the submarine, with the submarine in the picture, and ends behind it", () => {
    const start = config.rov.start;
    const sub = new Vector3(start.x, start.y, start.z);
    for (const seed of seeds.slice(0, 20)) {
      const plan = planOf(seed);
      for (const { t, pose } of sample(plan, opening.shots.net, opening.duration - 0.5, 15)) {
        expect(inPicture(pose, sub), `submarine, seed ${seed} at ${t.toFixed(2)} s`).toBe(true);
        expect(pose.position.y).toBeLessThan(bay.surfaceY - 1);
      }
      const first = plan.pose(opening.shots.net, createPose());
      expect(first.position.distanceTo(sub)).toBeGreaterThan(6);
      expect(first.position.distanceTo(sub)).toBeLessThan(14);
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
