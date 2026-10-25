import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import { floorHeight } from "../../src/game/bay";
import { caveInfo, caveLevel } from "../../src/game/cave";
import {
  BloomShot,
  Cinematic,
  EndingShot,
  bloomMode,
  cameraBlocked,
  captionAt,
  createPose,
  durationOf,
  letterboxAt,
  patchReefs,
  shotAt,
  type EndingScene,
  type Pose,
} from "../../src/game/cinematic";
import { followCamera } from "../../src/game/follow-camera";
import { chooseLayout } from "../../src/game/layout";
import { FLOAT_Y, constrainRov } from "../../src/game/rov";
import { SeaLife } from "../../src/game/sea-life";
import enStrings from "../../src/i18n/en.json";
import idStrings from "../../src/i18n/id.json";

const { cinematic, bay, bloom, station } = config;

// Each of these plays a whole shot for many places, at 60 frames a second.
vi.setConfig({ testTimeout: 120_000 });
const lens = new PerspectiveCamera(config.camera.fov, 16 / 9, 0.1, config.camera.far);
const barShare = 2 * cinematic.letterbox;

function inPicture(pose: Pose, point: Vector3, inset = 0): boolean {
  lens.position.copy(pose.position);
  lens.lookAt(pose.target);
  lens.updateMatrixWorld();
  lens.updateProjectionMatrix();
  const p = point.clone().project(lens);
  return p.z < 1 && Math.abs(p.x) <= 1 - inset && Math.abs(p.y) <= 1 - barShare - inset;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** The follow camera's pose for a submarine at `position`, facing `yaw`. */
function followPose(position: Vector3, yaw: number): Pose {
  const pose = createPose();
  followCamera({ position, velocity: new Vector3(), yaw, pitch: 0 }, pose.position, pose.target);
  return pose;
}

interface Run {
  poses: { t: number; position: Vector3; target: Vector3 }[];
  mode: string;
  normal: Pose;
}

/** Plays a Bloom shot for a player at `focus` at 60 frames a second, the follow camera standing still. */
function playBloom(focus: Vector3, yaw: number, ashore = false, fps = 60): Run {
  const normal = ashore ? { position: focus.clone(), target: focus.clone().add(new Vector3(Math.sin(yaw), 0, Math.cos(yaw))) } : followPose(focus, yaw);
  const duration = durationOf("bloom");
  const shot = new BloomShot(focus, normal, ashore);
  const dt = 1 / fps;
  const poses: Run["poses"] = [];
  const out = createPose();
  for (let t = 0; t <= duration + 1e-9; t += dt) {
    shot.pose(Math.min(t, duration), duration, dt, focus, normal, out);
    poses.push({ t, position: out.position.clone(), target: out.target.clone() });
  }
  return { poses, mode: shot.mode, normal };
}

/** Open water where the submarine fits: `count` random places in the dive area at random depths. */
function openWaterSpots(count: number, seed: number): { at: Vector3; yaw: number }[] {
  const random = mulberry32(seed);
  const spots: { at: Vector3; yaw: number }[] = [];
  const reach = config.bay.area.radius - config.bay.area.inset - 6;
  while (spots.length < count) {
    const at = new Vector3((random() * 2 - 1) * reach, -2 - random() * 12, (random() * 2 - 1) * reach);
    const fitted = at.clone();
    constrainRov(fitted, new Vector3());
    if (fitted.distanceTo(at) > 1e-6 || at.y > FLOAT_Y - 0.6) continue;
    if (caveLevel(at.x, at.y, at.z) > 0) continue;
    spots.push({ at, yaw: random() * Math.PI * 2 });
  }
  return spots;
}

describe("the Bloom's cinematic (REQ-028 AC-1)", () => {
  it("lasts as long as the Bloom's transition, which is 6 seconds, and starts and ends on the follow camera", () => {
    expect(durationOf("bloom")).toBe(bloom.seconds);
    expect(durationOf("bloom")).toBe(6);
    for (const { at, yaw } of openWaterSpots(10, 3)) {
      const normal = followPose(at, yaw);
      const { poses } = playBloom(at, yaw);
      expect(poses[0].position.distanceTo(normal.position), "at the start").toBeLessThan(1e-6);
      expect(poses[0].target.distanceTo(normal.target)).toBeLessThan(1e-6);
      const last = poses[poses.length - 1];
      expect(last.position.distanceTo(normal.position), "at the end").toBeLessThan(1e-6);
      expect(last.target.distanceTo(normal.target)).toBeLessThan(1e-6);
    }
  });

  it("knows where the player is: under water, at the surface, on land, or in the cave", () => {
    expect(bloomMode(new Vector3(-30, -9, 30), false)).toBe("under");
    expect(bloomMode(new Vector3(-60, FLOAT_Y, 20), false)).toBe("high");
    expect(bloomMode(new Vector3(-140, 1.6, 20), true)).toBe("high");
    const middle = caveInfo.path[Math.floor(caveInfo.path.length / 2)];
    expect(bloomMode(new Vector3(middle.x, middle.y, middle.z), false)).toBe("cave");
  });

  it("pulls away from a player under water and circles round them, in water, over the whole transition", () => {
    for (const { at, yaw } of openWaterSpots(20, 11)) {
      const { poses, mode, normal } = playBloom(at, yaw, false, 30);
      expect(mode).toBe("under");
      const farthest = Math.max(...poses.map((pose) => pose.position.distanceTo(at)));
      // It climbs away from the follow camera (6 m behind) to a place that shows the bay round them, unless a wall is near.
      expect(farthest).toBeGreaterThan(config.camera.distance - 1e-6);
      // It circles: the direction from the player to the camera turns.
      const azimuth = (p: Vector3) => Math.atan2(p.x - at.x, p.z - at.z);
      let turned = 0;
      for (let i = 1; i < poses.length; i++) {
        let step = azimuth(poses[i].position) - azimuth(poses[i - 1].position);
        step -= Math.round(step / (Math.PI * 2)) * Math.PI * 2;
        turned += Math.abs(step);
      }
      if (farthest > 8) expect(turned).toBeGreaterThan(0.4);
      // Under the surface all the way (it never leaves the water, which would show the sky and break the clear water).
      // (Near the surface the follow camera itself may be above that; the shot only goes no higher than it.)
      for (const pose of poses) {
        const { x, y, z } = pose.position;
        expect(y).toBeLessThanOrEqual(Math.max(bay.surfaceY - 0.2, normal.position.y, floorHeight(x, z) + config.camera.floorGap) + 1e-6);
      }
    }
});

  it("pulls well away in open water: at the middle of it, further than the follow camera and above", () => {
    let farther = 0;
    const spots = openWaterSpots(24, 5);
    for (const { at, yaw } of spots) {
      const mid = playBloom(at, yaw).poses[180];
      if (mid.position.distanceTo(at) > 9) farther += 1;
    }
    expect(farther / spots.length).toBeGreaterThan(0.6);
  });

  it("rises high over a player at the surface, showing the sea round them", () => {
    for (const x of [-100, -60, -10, 40, 90]) {
      const at = new Vector3(x, FLOAT_Y, -30 + x / 3);
      const { poses, mode } = playBloom(at, 1.1);
      expect(mode).toBe("high");
      const highest = Math.max(...poses.map((pose) => pose.position.y));
      expect(highest - at.y).toBeGreaterThan(14);
      // And it looks down on them.
      const mid = poses[180];
      expect(mid.target.y).toBeLessThan(mid.position.y - 5);
    }
  });

  it("rises over a player on land too, to look out over the sea", () => {
    for (const z of [-60, -20, 8, 30, 70]) {
      const eye = new Vector3(-137, floorHeight(-137, z) + config.land.eyeHeight, z);
      const { poses, mode } = playBloom(eye, -Math.PI / 2, true);
      expect(mode).toBe("high");
      expect(Math.max(...poses.map((pose) => pose.position.y)) - eye.y).toBeGreaterThan(10);
      // It looks out toward the sea (east) from the middle of the shot.
      const mid = poses[180];
      expect(mid.target.x).toBeGreaterThan(mid.position.x - 1);
    }
  });

  it("keeps the camera in the tunnel when the Bloom comes in the cave, wherever in it the player is", () => {
    for (const share of [0.04, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.96]) {
      const point = caveInfo.path[Math.floor((caveInfo.path.length - 1) * share)];
      const at = new Vector3(point.x, point.y, point.z);
      for (const yaw of [Math.PI / 2, -Math.PI / 2, 0]) {
        const { poses, mode, normal } = playBloom(at, yaw);
        if (mode !== "cave") continue;
        // Near a mouth the follow camera can itself be outside; then only the first and last moments are, as it merges with it.
        const followInside = caveLevel(normal.position.x, normal.position.y, normal.position.z) >= cinematic.bloom.caveHold;
        for (const pose of poses) {
          const { x, y, z } = pose.position;
          const merging = pose.t < cinematic.bloom.leaveSeconds || pose.t > durationOf("bloom") - cinematic.blendSeconds;
          if (followInside || !merging) expect(caveLevel(x, y, z), `at ${(share * 100).toFixed(0)} % of the way, yaw ${yaw}, ${pose.t.toFixed(2)} s`).toBeGreaterThanOrEqual(cinematic.bloom.caveHold - 1e-6);
          expect(cameraBlocked(x, y, z, 0.3)).toBe(false);
        }
      }
    }
  });

  it("never goes through the terrain, a rock, solid coral or the cave's walls and roof, in hundreds of places", () => {
    const spots = [...openWaterSpots(70, 21)];
    // And right against things: beside every rock, boulder and arch, and over the cave's roof.
    const random = mulberry32(8);
    for (const { at } of openWaterSpots(60, 33)) {
      const near = at.clone().add(new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(3));
      const fitted = near.clone();
      constrainRov(fitted, new Vector3());
      if (fitted.distanceTo(near) < 1e-6 && near.y < FLOAT_Y - 0.6) spots.push({ at: near, yaw: random() * 6.28 });
    }
    for (const point of caveInfo.path.filter((_, i) => i % 3 === 0)) spots.push({ at: new Vector3(point.x, point.y, point.z), yaw: random() * 6.28 });
    for (const { at, yaw } of spots) {
      for (const { t, position } of playBloom(at, yaw, false, 20).poses) {
        expect(cameraBlocked(position.x, position.y, position.z, 0.3), `player at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)}), ${t.toFixed(2)} s`).toBe(false);
      }
    }
    expect(spots.length).toBeGreaterThan(100);
  });

  it("never goes through the terrain or the buildings on land and at the surface either", () => {
    const random = mulberry32(17);
    for (let i = 0; i < 30; i++) {
      const z = (random() * 2 - 1) * 90;
      const x = -125 - random() * 20;
      const ashore = random() < 0.5;
      const at = ashore ? new Vector3(x, floorHeight(x, z) + config.land.eyeHeight, z) : new Vector3(-60 + random() * 120, FLOAT_Y, z);
      for (const { t, position } of playBloom(at, random() * 6.28, ashore, 20).poses) {
        expect(cameraBlocked(position.x, position.y, position.z, 0.3), `${ashore ? "ashore" : "afloat"} at (${at.x.toFixed(1)}, ${at.z.toFixed(1)}), ${t.toFixed(2)} s`).toBe(false);
      }
    }
  });

  it("moves smoothly: the camera never jumps from one frame to the next", () => {
    for (const { at, yaw } of openWaterSpots(16, 41)) {
      const { poses } = playBloom(at, yaw);
      for (let i = 1; i < poses.length; i++) expect(poses[i].position.distanceTo(poses[i - 1].position)).toBeLessThan(0.7);
    }
  });
});

describe("the ending's flight (REQ-028 AC-2)", () => {
  const { ending } = cinematic;

  it("takes 15 to 20 seconds, in five shots", () => {
    expect(durationOf("ending")).toBeGreaterThanOrEqual(15);
    expect(durationOf("ending")).toBeLessThanOrEqual(20);
    expect(ending.shots).toHaveLength(5);
    expect(shotAt("ending", 0)).toBe(0);
    expect(shotAt("ending", durationOf("ending") - 0.01)).toBe(4);
    expect(shotAt("ending", durationOf("ending") + 5)).toBe(4);
  });

  it("has one closing line, in both languages, in the last shot, and no other narration", () => {
    expect(idStrings["cinematic.ending"]).toBe("Teluk ini hidup kembali.");
    expect(enStrings["cinematic.ending"]).toBe("The bay is alive again.");
    const start = ending.shots.slice(0, 4).reduce((a, b) => a + b, 0);
    const lines = new Set<string>();
    for (let t = 0; t < durationOf("ending"); t += 0.1) {
      const caption = captionAt("ending", t);
      if (caption) {
        lines.add(caption.key);
        expect(t).toBeGreaterThanOrEqual(start);
      }
    }
    expect([...lines]).toEqual(["cinematic.ending"]);
    expect(captionAt("ending", start + (ending.caption.from + ending.caption.to) / 2)?.opacity).toBe(1);
  });

  it("has the same bars as the opening", () => {
    const duration = durationOf("ending");
    expect(letterboxAt(0, duration)).toBe(0);
    expect(letterboxAt(duration / 2, duration)).toBe(1);
    expect(letterboxAt(duration, duration)).toBe(0);
  });

  /** A bay at the end of a dive: the layout's frames and a sea life that has swum for `swum` seconds. */
  function makeBay(seed: number, swum: number): { scene: EndingScene; life: SeaLife } {
    const layout = chooseLayout(seed);
    const life = new SeaLife(layout.frames);
    life.start();
    life.update(swum);
    const of = (species: string) => life.creatures.filter((creature) => creature.species === species);
    const kinds = { yellowtail: of("yellowtail"), mantaRay: of("mantaRay"), dolphin: of("dolphin") };
    const frames = layout.frames.map((spot) => ({ x: spot.x, y: floorHeight(spot.x, spot.z), z: spot.z }));
    return { scene: { frames, reefs: patchReefs, creature: (species, index) => kinds[species][index] ?? null }, life };
  }

  /** Flies the ending at 30 frames a second while the sea life swims on. */
  function fly(seed: number, swum: number) {
    const { scene, life } = makeBay(seed, swum);
    const shot = new EndingShot(scene);
    const out = createPose();
    const poses: { t: number; position: Vector3; target: Vector3; shot: number; subjects: Record<string, Vector3> }[] = [];
    const dt = 1 / 30;
    for (let t = 0; t < durationOf("ending"); t += dt) {
      shot.pose(t, dt, out);
      const subjects = { yellowtail: scene.creature("yellowtail", 0)!.position.clone(), mantaRay: scene.creature("mantaRay", 0)!.position.clone(), dolphin: scene.creature("dolphin", 1)!.position.clone() };
      poses.push({ t, position: out.position.clone(), target: out.target.clone(), shot: shotAt("ending", t), subjects });
      life.update(dt);
    }
    return { poses, scene };
  }

  it("never goes through the terrain, a rock, solid coral or the cave, for any layout and wherever the animals are in their loops", () => {
    for (const [index, swum] of [0, 23, 61, 140, 333, 480, 777, 1000].entries()) {
      for (const seed of [index * 7 + 1, index * 13 + 5, index * 29 + 2]) {
        for (const { t, position } of fly(seed, swum).poses) {
          expect(cameraBlocked(position.x, position.y, position.z, 0.3), `seed ${seed}, animals ${swum} s into their loops, ${t.toFixed(2)} s`).toBe(false);
        }
      }
    }
  });

  it("moves without jumps", () => {
    for (const [seed, swum] of [[1, 0], [2, 100], [3, 350], [4, 600], [5, 900]]) {
      const { poses } = fly(seed, swum);
      for (let i = 1; i < poses.length; i++) {
        if (poses[i].shot !== poses[i - 1].shot) continue;
        expect(poses[i].position.distanceTo(poses[i - 1].position), `seed ${seed}, ${poses[i].t.toFixed(2)} s`).toBeLessThan(2.2);
      }
    }
  });

  it("shows the yellowtail school, a manta ray and the dolphins, each in the picture for nearly all of its shot", () => {
    for (const [seed, swum] of [[1, 0], [2, 100], [3, 350], [4, 600], [5, 900], [6, 40]]) {
      const { poses } = fly(seed, swum);
      for (const [shot, species] of [[1, "yellowtail"], [2, "mantaRay"], [3, "dolphin"]] as const) {
        const own = poses.filter((pose) => pose.shot === shot && pose.t >= ending.shots.slice(0, shot).reduce((a, b) => a + b, 0) + 0.5);
        const seen = own.filter((pose) => inPicture(pose, pose.subjects[species])).length;
        expect(seen / own.length, `${species}, seed ${seed}`).toBeGreaterThan(0.8);
      }
    }
  });

  it("circles a patch reef in the first shot, close enough to see its coral", () => {
    for (const seed of [1, 2, 3, 4]) {
      const { poses } = fly(seed, 50);
      const first = poses.filter((pose) => pose.shot === 0);
      const reef = patchReefs.reduce((best, r) => (Math.hypot(r.x - first[0].target.x, r.z - first[0].target.z) < Math.hypot(best.x - first[0].target.x, best.z - first[0].target.z) ? r : best));
      for (const pose of first) {
        expect(pose.position.distanceTo(new Vector3(reef.x, reef.y, reef.z))).toBeLessThan(18);
        expect(pose.position.y).toBeLessThan(bay.surfaceY);
      }
    }
  });

  it("ends with a climb through the surface to the beach and the sky", () => {
    for (const [seed, swum] of [[1, 0], [2, 100], [3, 350]]) {
      const { poses } = fly(seed, swum);
      const last = poses.filter((pose) => pose.shot === 4);
      expect(last[0].position.y).toBeLessThan(bay.surfaceY - 2);
      expect(last[last.length - 1].position.y).toBeGreaterThan(bay.surfaceY + 5);
      let crossings = 0;
      for (let i = 1; i < last.length; i++) if (last[i - 1].position.y > bay.surfaceY !== last[i].position.y > bay.surfaceY) crossings += 1;
      expect(crossings).toBe(1);
      // At the end: the beach and the shed in the picture, and the sky above the horizon.
      const end = last[last.length - 1];
      const shed = new Vector3(station.x, floorHeight(station.x, station.z) + 2, station.z);
      expect(inPicture(end, shed)).toBe(true);
      const look = end.target.clone().sub(end.position).normalize();
      const pitch = Math.asin(look.y);
      expect(pitch + (config.camera.fov * Math.PI) / 360).toBeGreaterThan(0.15);
    }
  });
});

describe("skipping (REQ-028 AC-4)", () => {
  it("takes the Bloom's cinematic back to the player at once, with a fade", () => {
    const clock = new Cinematic("bloom");
    clock.step(2);
    clock.skip();
    expect(clock.step(cinematic.skipFadeSeconds / 2)).toBe("skipped");
    expect(clock.fade).toBe(1);
  });

  it("takes the ending straight to the end screen: no fade, over on the next step", () => {
    const clock = new Cinematic("ending");
    clock.step(4);
    clock.skip();
    expect(clock.fade).toBe(0);
    expect(clock.step(1 / 60)).toBe("skipped");
    expect(clock.fade).toBe(0);
  });

  it("runs the ending to its end and says it is done", () => {
    const clock = new Cinematic("ending");
    let result = null;
    let seconds = 0;
    while (!result) {
      result = clock.step(1 / 30);
      seconds += 1 / 30;
    }
    expect(result).toBe("done");
    expect(seconds).toBeCloseTo(durationOf("ending"), 1);
  });
});
