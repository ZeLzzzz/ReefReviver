import { Vector3 } from "three";
import { config } from "../config";
import type { StringKey } from "../i18n/i18n";
import { floorHeight, terrainSolidAt } from "./bay";
import { smoothstep } from "./bloom";
import { followCamera } from "./follow-camera";
import { createRovState } from "./rov";
import { stationPosition } from "./station";
import { inland } from "./terrain";

// REQ-027 (D-111, D-113): the opening cinematic. This file is the pure part: the clock and the captions, the camera path and
// what the camera keeps out of. The game feeds it the frame time and places its camera by the pose it answers; nothing here draws.

const { cinematic, bay, station, land, trash } = config;

export type CinematicKind = "opening";

/** Where the camera is and what it looks at. */
export interface Pose {
  position: Vector3;
  target: Vector3;
}

export const createPose = (): Pose => ({ position: new Vector3(), target: new Vector3() });

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * REQ-027 AC-6, D-021: whether the cinematics play. They always do in a build for players. Only the browser tests, which run
 * the dev server with a fixed layout seed (`VITE_TEST_SEED`), start with them off, so the tests that are not about them keep
 * playing at once; a test turns them on with `__reef.cinematics(true)`.
 */
export function cinematicsOnByDefault(dev: boolean, testSeed: string | undefined): boolean {
  return !(dev && testSeed);
}

/** What the HUD draws while a cinematic plays: the narration, and how far the black bars have slid in (0..1). */
export interface CinematicHud {
  kind: CinematicKind;
  caption: StringKey | null;
  /** 0..1, eased in and out. */
  captionOpacity: number;
  letterbox: number;
}

/** The captions of a cinematic, as seconds from its start. */
function captionsOf(_kind: CinematicKind): readonly { key: StringKey; from: number; to: number }[] {
  return cinematic.opening.captions;
}

/** How long a cinematic runs, in seconds of game time. */
export function durationOf(_kind: CinematicKind): number {
  return cinematic.opening.duration;
}

/** The line of narration shown at `time`, with how visible it is (it fades in and out); null between lines. */
export function captionAt(kind: CinematicKind, time: number): { key: StringKey; opacity: number } | null {
  const fade = cinematic.captionFadeSeconds;
  for (const caption of captionsOf(kind)) {
    if (time < caption.from || time > caption.to) continue;
    return { key: caption.key, opacity: smoothstep((time - caption.from) / fade) * smoothstep((caption.to - time) / fade) };
  }
  return null;
}

/** How far the black bars have slid in: they come in at the start and go out over the last `barSeconds`. */
export function letterboxAt(time: number, duration: number): number {
  return smoothstep(time / cinematic.barSeconds) * smoothstep((duration - time) / cinematic.barSeconds);
}

/**
 * How much of the normal camera there is in the picture: 0 in the middle of a shot, rising to 1 over the last
 * `blendSeconds`, so the camera lands exactly where the follow camera is (REQ-027 AC-5).
 */
export function blendAt(time: number, duration: number): number {
  return smoothstep((time - (duration - cinematic.blendSeconds)) / cinematic.blendSeconds);
}

export type CinematicStep = "done" | "skipped" | null;

/**
 * One cinematic's clock. It runs on the game's frame time, so a pause freezes it (REQ-027 AC-7). A skip (a click or Space,
 * AC-4) fades the screen out; at the darkest point the cinematic is over (`"skipped"`) and the game fades back in.
 */
export class Cinematic {
  time = 0;
  readonly duration: number;
  /** Seconds since a skip was asked for; null until then. */
  skipTime: number | null = null;

  constructor(readonly kind: CinematicKind) {
    this.duration = durationOf(kind);
  }

  skip(): void {
    if (this.skipTime === null) this.skipTime = 0;
  }

  step(dt: number): CinematicStep {
    if (this.skipTime !== null) {
      this.skipTime += dt;
      return this.skipTime >= cinematic.skipFadeSeconds / 2 ? "skipped" : null;
    }
    this.time += dt;
    return this.time >= this.duration ? "done" : null;
  }

  /** 0 (clear) to 1 (black): the screen going dark after a skip. */
  get fade(): number {
    if (this.skipTime === null) return 0;
    return clamp01(this.skipTime / (cinematic.skipFadeSeconds / 2));
  }

  /** The index of the shot being shown. */
  get shot(): number {
    return shotAt(this.kind, this.time);
  }

  hud(): CinematicHud {
    const caption = captionAt(this.kind, this.time);
    return {
      kind: this.kind,
      caption: caption?.key ?? null,
      captionOpacity: caption?.opacity ?? 0,
      letterbox: letterboxAt(this.time, this.duration),
    };
  }
}

/** Which shot of a cinematic plays at `time`: the opening has three (the aerial one, the low glide and the dive). */
export function shotAt(_kind: CinematicKind, time: number): number {
  const { shots } = cinematic.opening;
  return time < shots.aerial ? 0 : time < shots.glide ? 1 : 2;
}

// ---------------------------------------------------------------------------------------------------------------------
// Keeping the camera out of things

/** A palm or rock on the land, as an upright cylinder, for the camera. */
const landThings = [
  ...land.palms.map((palm) => ({ x: palm.x, z: palm.z, radius: 1.2, height: palm.height + 1.5 })),
  ...land.rocks.map((rock) => ({ x: rock.x, z: rock.z, radius: rock.radius, height: rock.radius * 1.3 })),
];

/**
 * True when a sphere of `margin` at (x, y, z) is in a building: the recycling shed (walls, gable roof and the mast on it)
 * or the dock (its deck, and the water under it, where the posts stand), or in a palm or a rock on the land.
 */
export function structureSolidAt(x: number, y: number, z: number, margin = 0): boolean {
  const groundY = stationPosition.y;
  // The shed: walls and roof (the roof overhangs by half a metre and peaks `ridge` above the walls) and the mast.
  const ridge = 1.4;
  if (Math.abs(x - station.x) < station.halfX + 0.5 + margin && Math.abs(z - station.z) < station.halfZ + 0.5 + margin && y < groundY + 0.3 + station.height + ridge + margin) return true;
  if (Math.hypot(x - (station.x + station.mast.dx), z - (station.z + station.mast.dz)) < 0.5 + margin && y < groundY + station.mast.height + 1 + margin) return true;
  // The counter's awning and the bins stand in front of the east wall.
  if (x > station.x + station.halfX && x < station.x + station.halfX + 2.5 + margin && Math.abs(z - station.z) < station.halfZ + margin && y < groundY + 3 + margin) return true;
  const { dock } = bay;
  if (x > dock.landX - margin && x < dock.seaX + margin && Math.abs(z - dock.z) < dock.halfWidth + margin && y < bay.surfaceY + dock.deckY + 0.2 + margin) return true;
  for (const thing of landThings) {
    if (Math.hypot(x - thing.x, z - thing.z) < thing.radius + margin && y < floorHeight(thing.x, thing.z) + thing.height + margin) return true;
  }
  return false;
}

/** True when the camera (a sphere of `margin`) would be in the terrain, a rock, solid coral, the cave's rock or a building. */
export function cameraBlocked(x: number, y: number, z: number, margin: number = cinematic.clearance): boolean {
  return terrainSolidAt(x, y, z, margin) || structureSolidAt(x, y, z, margin);
}

// ---------------------------------------------------------------------------------------------------------------------
// Paths

interface Key {
  t: number;
  v: Vector3;
}

/**
 * A smooth path through points at times: cubic Hermite with the tangent at each point taken from its neighbours, so the
 * speed does not jump at a point. It stands still at both ends.
 */
export class Track {
  private readonly tangents: Vector3[];

  constructor(private readonly keys: readonly Key[]) {
    this.tangents = keys.map((_, i) => {
      if (i === 0 || i === keys.length - 1) return new Vector3();
      return keys[i + 1].v.clone().sub(keys[i - 1].v).divideScalar(keys[i + 1].t - keys[i - 1].t);
    });
  }

  at(t: number, out: Vector3): Vector3 {
    const { keys, tangents } = this;
    if (t <= keys[0].t) return out.copy(keys[0].v);
    const last = keys.length - 1;
    if (t >= keys[last].t) return out.copy(keys[last].v);
    let i = 0;
    while (keys[i + 1].t < t) i++;
    const h = keys[i + 1].t - keys[i].t;
    const s = (t - keys[i].t) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const a = 2 * s3 - 3 * s2 + 1;
    const b = s3 - 2 * s2 + s;
    const c = -2 * s3 + 3 * s2;
    const d = s3 - s2;
    return out
      .copy(keys[i].v)
      .multiplyScalar(a)
      .addScaledVector(tangents[i], b * h)
      .addScaledVector(keys[i + 1].v, c)
      .addScaledVector(tangents[i + 1], d * h);
  }
}

/** Anything with a position: what the floating trash is made of for this file. */
export interface Placed {
  x: number;
  y: number;
  z: number;
}

/**
 * REQ-027 AC-8: the centre of the group of floating trash that lies near the west beach (REQ-025 AC-1): the item nearest the
 * waterline among those within `nearShore` m of it and between z = ±`beachHalfLength`, and the items around it. Null when
 * nothing floats.
 */
export function beachGroup(floating: readonly Placed[]): Vector3 | null {
  const { surface } = trash;
  const fromShore = (item: Placed) => -inland(item.x, item.z);
  let pool = floating.filter((item) => fromShore(item) <= surface.nearShore && Math.abs(item.z) <= surface.beachHalfLength);
  if (pool.length === 0) pool = [...floating];
  if (pool.length === 0) return null;
  const first = pool.reduce((best, item) => (fromShore(item) < fromShore(best) ? item : best));
  const group = floating.filter((item) => Math.hypot(item.x - first.x, item.z - first.z) <= surface.groupRadius * 2.5);
  const centre = new Vector3();
  for (const item of group) centre.add(new Vector3(item.x, item.y, item.z));
  return centre.divideScalar(group.length);
}

const startState = createRovState();

/** Where the normal follow camera is at the start: where the opening ends (REQ-027 AC-1, AC-5). */
export function startPose(out: Pose = createPose()): Pose {
  followCamera(startState, out.position, out.target);
  return out;
}

/**
 * REQ-027 AC-1, AC-8: the opening's path for a dive whose beach group of floating trash is at `group`. From high out to sea
 * the camera looks at the coast (beach, headlands, shed, dock) and the sea with the trash on it; it comes down and glides
 * low past the group, with the beach behind it; then it goes through the surface toward the submarine, turning to face the
 * way the submarine does, and ends where the follow camera stands behind it. The group is kept in view until the dive; the
 * way down is open water.
 */
export function openingPlan(group: Vector3): { pose(t: number, out: Pose): Pose } {
  const { aerial, glide, shots, duration: finish } = cinematic.opening;
  const start = config.rov.start;
  const end = startPose();
  const shore = group.x + inland(group.x, group.z);
  // Along the beach, the way the glide goes: toward the submarine's side.
  const way = Math.sign(start.z - group.z) || 1;
  const middle = lerp(group.z, station.z, 0.45);
  const surfaceY = bay.surfaceY;
  const h = surfaceY + glide.height;
  // The glide passes on the sea side of the group, `glide.pass` m from it; for a group far out it passes closer, so that it stays
  // short of the submarine and the dive comes at it from behind.
  const pass = group.x + Math.max(Math.min(glide.pass, end.position.x - 10 - group.x), glide.pass * 0.7);
  const diveX = Math.min(pass + 2, end.position.x - 6);
  // From the middle of the glide on, it moves along the shore toward the submarine's z in steps of the way left to go.
  const zAbeam = group.z + way * 2;
  const along = (progress: number) => lerp(zAbeam, end.position.z, progress);
  const glideEnd = shots.glide;
  const dive = new Vector3(diveX, surfaceY - 0.25, along(0.5));
  const down = new Vector3(lerp(diveX, end.position.x, 0.6), end.position.y - 0.4, along(0.85));
  const late = new Vector3(lerp(diveX, end.position.x, 0.9), lerp(down.y, end.position.y, 0.8), along(0.96));
  const midGroup = new Vector3(group.x, surfaceY + 0.4, group.z);

  const at = (t: number, x: number, y: number, z: number): [number, Vector3] => [t, new Vector3(x, y, z)];
  const position = new Track(
    [
      at(0, shore + aerial.back, aerial.height, middle),
      at(shots.aerial * 0.5, shore + aerial.back * 0.62, aerial.height * 0.72, lerp(middle, group.z, 0.5)),
      at(shots.aerial, group.x + 34, 11, group.z - way * 22),
      at(lerp(shots.aerial, glideEnd, 0.45), pass, h + 0.6, group.z - way * 12),
      at(lerp(shots.aerial, glideEnd, 0.8), pass, h, zAbeam),
      at(glideEnd, pass + 1, h, along(0.25)),
      at(shots.surface, dive.x, dive.y, dive.z),
      at(lerp(shots.surface, finish, 0.55), down.x, down.y, down.z),
      at(finish - 1.6, late.x, late.y, late.z),
      at(finish, end.position.x, end.position.y, end.position.z),
    ].map(([t, v]) => ({ t, v })),
  );

  // What it looks at. Until the end of the glide, points: the coast, tilted toward the trash that floats off it, and then the
  // trash. After it, directions that turn evenly from where the trash is to the way the submarine faces. The turning is smoothed
  // as angles, so the camera never whips round when the point it looks at passes near it.
  const coast = new Vector3(shore - 12, 1, middle);
  const coastLater = new Vector3(shore - 10, 1, lerp(middle, group.z, 0.7));
  const points: [number, Vector3][] = [
    [0, new Vector3().lerpVectors(coast, midGroup, 0.3)],
    [shots.aerial * 0.5, new Vector3().lerpVectors(coastLater, midGroup, 0.6)],
    [shots.aerial, midGroup],
    ...[0.25, 0.45, 0.62, 0.8, 1].map((k): [number, Vector3] => [lerp(shots.aerial, glideEnd, k), midGroup]),
  ];
  const angles: { t: number; v: Vector3 }[] = [];
  let yaw = 0;
  const addAngle = (t: number, wantedYaw: number, pitch: number) => {
    if (angles.length > 0) wantedYaw += Math.round((yaw - wantedYaw) / (Math.PI * 2)) * Math.PI * 2;
    yaw = wantedYaw;
    angles.push({ t, v: new Vector3(yaw, pitch, 0) });
  };
  const away = new Vector3();
  for (const [t, to] of points) {
    away.copy(to).sub(position.at(t, new Vector3()));
    addAngle(t, Math.atan2(away.x, away.z), Math.atan2(away.y, Math.hypot(away.x, away.z)));
  }
  const first = angles[angles.length - 1];
  const faceYaw = Math.atan2(end.target.x - end.position.x, end.target.z - end.position.z);
  const facePitch = Math.atan2(end.target.y - end.position.y, Math.hypot(end.target.x - end.position.x, end.target.z - end.position.z));
  // The turn to the submarine's heading: the short way round, evenly eased between the end of the glide and the end.
  let turn = faceYaw - first.v.x;
  turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
  for (const k of [0.18, 0.4, 0.62, 0.8, 0.92, 1]) {
    const eased = smoothstep(k);
    addAngle(lerp(glideEnd, finish, k), first.v.x + turn * eased, lerp(first.v.y, facePitch, eased));
  }

  const anglesTrack = new Track(angles);
  const angle = new Vector3();
  const normal = startPose();
  return {
    pose(t, out) {
      position.at(t, out.position);
      anglesTrack.at(t, angle);
      out.target.set(Math.sin(angle.x) * Math.cos(angle.y), Math.sin(angle.y), Math.cos(angle.x) * Math.cos(angle.y)).multiplyScalar(cinematic.lookAhead).add(out.position);
      // The last seconds merge into the follow camera (which, at the start, is where the path ends).
      const w = blendAt(t, finish);
      if (w > 0) {
        out.position.lerp(normal.position, w);
        out.target.lerp(normal.target, w);
      }
      return out;
    },
  };
}
