import { Vector3 } from "three";
import { config } from "../config";
import type { StringKey } from "../i18n/i18n";
import { floorHeight, reefs as natureReefs, terrainSolidAt } from "./bay";
import { smoothstep } from "./bloom";
import { caveLevel } from "./cave";
import { followCamera } from "./follow-camera";
import { createRovState } from "./rov";
import { stationPosition } from "./station";
import { inland } from "./terrain";

// REQ-027, REQ-028 (D-111, D-112, D-113): the cinematics. This file is the pure part: the clock and the captions, the
// camera paths and the keeping of the camera out of the rock. The game feeds it the frame time and places its camera by the
// pose it answers; nothing here draws.

const { cinematic, bay, station, land, trash } = config;

export type CinematicKind = "opening" | "bloom" | "ending";

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

/** The captions of a cinematic, as seconds from its start. Only the opening and the ending narrate. */
function captionsOf(kind: CinematicKind): readonly { key: StringKey; from: number; to: number }[] {
  if (kind === "opening") return cinematic.opening.captions;
  if (kind === "ending") {
    const start = cinematic.ending.shots.slice(0, -1).reduce((sum, seconds) => sum + seconds, 0);
    const { key, from, to } = cinematic.ending.caption;
    return [{ key, from: start + from, to: start + to }];
  }
  return [];
}

/** How long a cinematic runs, in seconds of game time. */
export function durationOf(kind: CinematicKind): number {
  if (kind === "opening") return cinematic.opening.duration;
  if (kind === "bloom") return config.bloom.seconds;
  return cinematic.ending.shots.reduce((sum, seconds) => sum + seconds, 0);
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
 * `blendSeconds`, so the camera lands exactly where the follow camera is (REQ-027 AC-5, REQ-028 AC-1).
 */
export function blendAt(time: number, duration: number): number {
  return smoothstep((time - (duration - cinematic.blendSeconds)) / cinematic.blendSeconds);
}

export type CinematicStep = "done" | "skipped" | null;

/**
 * One cinematic's clock. It runs on the game's frame time, so a pause freezes it (REQ-027 AC-7). A skip (a click or Space,
 * AC-4) fades the screen out; at the darkest point the cinematic is over (`"skipped"`) and the game fades back in. The
 * ending has nothing to fade to: its skip goes straight to the end screen (REQ-028 AC-4).
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
    if (this.skipTime === null) this.skipTime = this.kind === "ending" ? cinematic.skipFadeSeconds / 2 : 0;
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
    if (this.skipTime === null || this.kind === "ending") return 0;
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

/** Which shot of a cinematic plays at `time` (the opening has three, the Bloom one, the ending five). */
export function shotAt(kind: CinematicKind, time: number): number {
  if (kind === "opening") {
    const { shots } = cinematic.opening;
    return time < shots.aerial ? 0 : time < shots.glide ? 1 : 2;
  }
  if (kind === "bloom") return 0;
  let end = 0;
  const { shots } = cinematic.ending;
  for (const [index, seconds] of shots.entries()) {
    end += seconds;
    if (time < end) return index;
  }
  return shots.length - 1;
}

/** The time at which a shot of the ending starts. */
function endingShotStart(shot: number): number {
  return cinematic.ending.shots.slice(0, shot).reduce((sum, seconds) => sum + seconds, 0);
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

const step = config.camera.step;

/**
 * Pulls `p` back toward `from` (a point in free space: the player, an animal) until nothing lies between them, and
 * returns the share of the way that was free (1 when none of it was blocked). The camera is then never in the rock and
 * always has a clear line to what it films. With `inCave` the camera also stays where the cave level is `caveHold` or more:
 * it does not leave the tunnel it started in (REQ-028 AC-7).
 */
export function clipFrom(from: Vector3, p: Vector3, inCave = false, margin: number = cinematic.clearance): number {
  p.y = Math.max(p.y, floorHeight(p.x, p.z) + config.camera.floorGap);
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const dz = p.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return 1;
  let free = 0;
  for (let t = step; t < length + step; t += step) {
    const d = Math.min(t, length);
    const k = d / length;
    const x = from.x + dx * k;
    const y = from.y + dy * k;
    const z = from.z + dz * k;
    if (cameraBlocked(x, y, z, margin) || (inCave && caveLevel(x, y, z) < cinematic.bloom.caveHold)) break;
    free = d;
  }
  const share = free / length;
  p.set(from.x + dx * share, from.y + dy * share, from.z + dz * share);
  return share;
}

/**
 * A camera that holds a distance from its subject. It never goes further than is free now, so it is never in a wall; it
 * comes in ahead of a wall that the wish is about to meet (`ahead`, where the wish will be a moment from now) at `pullIn`
 * metres a second, and goes back out at `growth`, so the picture does not pop when a rock comes into the way or leaves it.
 */
class Lead {
  private share = 1;
  private readonly far = new Vector3();

  constructor(
    private readonly growth: number,
    private readonly pullIn: number = Infinity,
  ) {}

  /** Places `p` (a wish) as far from `from` as it can be. */
  place(from: Vector3, p: Vector3, dt: number, inCave = false, margin: number = cinematic.clearance, ahead: Vector3 | null = null): void {
    const wish = from.distanceTo(p);
    const free = clipFrom(from, p, inCave, margin);
    let target = free;
    if (ahead && wish > 1e-6) {
      this.far.copy(ahead);
      const aheadWish = from.distanceTo(ahead);
      target = Math.min(free, (clipFrom(from, this.far, inCave, margin) * aheadWish) / wish);
    }
    if (wish > 1e-6) {
      if (target < this.share) this.share = Math.max(target, this.share - (this.pullIn * dt) / wish);
      else this.share = Math.min(target, this.share + (this.growth * dt) / wish);
      this.share = Math.min(this.share, free);
    }
    // `p` is at `free`; move it back to `share` along the same line.
    p.lerpVectors(from, p, wish > 1e-6 && free > 1e-6 ? this.share / free : 1);
  }

  reset(): void {
    this.share = 1;
  }
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

const track = (keys: [number, number, number, number][]): Track => new Track(keys.map(([t, x, y, z]) => ({ t, v: new Vector3(x, y, z) })));

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

// ---------------------------------------------------------------------------------------------------------------------
// The Bloom

export type BloomMode = "under" | "high" | "cave";

/** How the Bloom's camera moves, from where the player is: in a cave, at the surface or on land, or under water. */
export function bloomMode(focus: Vector3, ashore: boolean): BloomMode {
  if (!ashore && caveLevel(focus.x, focus.y, focus.z) >= config.bay.cave.lamp.lampOn) return "cave";
  return ashore || focus.y > cinematic.bloom.surfaceAbove ? "high" : "under";
}

/**
 * REQ-028 AC-1, AC-7: the camera during the Bloom's transition. It leaves the follow camera, climbs and circles the player
 * (under water: the reef around them; at the surface or on land: high over the sea turning blue; in the cave: low along
 * the tunnel) and lands back on the follow camera at the end. It is always clipped from the player, so it is never in the
 * rock, and in the cave never outside the tunnel.
 */
export class BloomShot {
  readonly mode: BloomMode;
  private readonly azimuth: number;
  /** The follow camera is in the tunnel too (not out of a mouth the player is near). */
  private readonly followInside: boolean;
  private readonly sweep: number;
  private readonly lead = new Lead(cinematic.bloom.pullOut, cinematic.bloom.pullIn);
  private readonly rise: { height: number; radius: number };
  private readonly wish = new Vector3();
  private readonly ahead = new Vector3();
  private readonly look = new Vector3();

  /** `focus` is the player (the eye on land), `normal` the camera the game would place now. */
  constructor(focus: Vector3, normal: Pose, ashore: boolean) {
    this.mode = bloomMode(focus, ashore);
    this.followInside = caveLevel(normal.position.x, normal.position.y, normal.position.z) >= cinematic.bloom.caveHold;
    const spec = this.mode === "high" ? cinematic.bloom.high : this.mode === "cave" ? cinematic.bloom.cave : cinematic.bloom.under;
    this.rise = { height: spec.height, radius: spec.radius };
    const away = Math.hypot(normal.position.x - focus.x, normal.position.z - focus.z);
    // Behind the player, as the follow camera is; on foot (no distance) inland, to the west, so that it looks out over the sea.
    const preferred = away > 0.5 ? Math.atan2(normal.position.x - focus.x, normal.position.z - focus.z) : -Math.PI / 2;
    // The direction with the most room, nearest the preferred one, and the sweep goes toward the side with more room.
    let best = -1;
    let bestAzimuth = preferred;
    for (let k = 0; k < 16; k++) {
      const offset = (Math.ceil(k / 2) * (Math.PI * 2)) / 16 * (k % 2 === 0 ? 1 : -1);
      const room = this.room(focus, preferred + offset, spec);
      if (room > best + 0.3) {
        best = room;
        bestAzimuth = preferred + offset;
      }
    }
    this.azimuth = bestAzimuth;
    const left = this.room(focus, bestAzimuth - spec.sweep / 2, spec);
    const right = this.room(focus, bestAzimuth + spec.sweep / 2, spec);
    this.sweep = (right >= left ? 1 : -1) * spec.sweep;
  }

  /** How far from `focus` the camera could be at `azimuth`, at the full height and radius, before something is in the way. */
  private room(focus: Vector3, azimuth: number, spec: { height: number; radius: number }): number {
    const p = this.wish.set(focus.x + Math.sin(azimuth) * spec.radius, focus.y + spec.height, focus.z + Math.cos(azimuth) * spec.radius);
    this.limit(p);
    clipFrom(focus, p, this.mode === "cave");
    return p.distanceTo(focus);
  }

  /** Under water the camera stays below the surface. */
  private limit(p: Vector3): void {
    if (this.mode !== "high") p.y = Math.min(p.y, bay.surfaceY - cinematic.bloom.ceilingGap);
  }

  /** Where the orbit would have the camera at `time`, before anything is in the way, and what it would look at. */
  private orbit(time: number, duration: number, focus: Vector3, normal: Pose, position: Vector3, look: Vector3 | null): void {
    const u = clamp01(time / duration);
    const rise = smoothstep(u / 0.45);
    const away = Math.max(cinematic.bloom.minRadius, Math.hypot(normal.position.x - focus.x, normal.position.z - focus.z));
    const startHeight = Math.max(0, normal.position.y - focus.y);
    const radius = lerp(away, this.rise.radius, rise);
    const height = lerp(startHeight, this.rise.height, rise);
    const angle = this.azimuth + this.sweep * smoothstep(u);
    position.set(focus.x + Math.sin(angle) * radius, focus.y + height, focus.z + Math.cos(angle) * radius);
    this.limit(position);
    if (!look) return;
    // High up it looks on across the player (out over the sea), under water at the player.
    const lookOut = this.mode === "high" ? cinematic.bloom.high.lookOut : 0;
    look.set(focus.x - Math.sin(angle) * lookOut, focus.y + 0.5, focus.z - Math.cos(angle) * lookOut);
  }

  /** The pose at `time` of `duration`, with the follow camera `normal` the pose falls back to. */
  pose(time: number, duration: number, dt: number, focus: Vector3, normal: Pose, out: Pose): Pose {
    const inCave = this.mode === "cave";
    // The follow camera's own clearance, so that the follow camera itself is never moved by it.
    const margin = config.camera.clearance;
    const wish = this.wish;
    this.orbit(time, duration, focus, normal, wish, this.look);
    this.orbit(Math.min(duration, time + cinematic.bloom.lookAheadSeconds), duration, focus, normal, this.ahead, null);
    this.lead.place(focus, wish, dt, inCave, margin, this.ahead);
    // Merge with the follow camera at both ends: out of it at the start, back into it at the end (exactly on it).
    const w = Math.min(smoothstep(time / cinematic.bloom.leaveSeconds), 1 - blendAt(time, duration));
    out.position.lerpVectors(normal.position, wish, w);
    out.target.lerpVectors(normal.target, this.look, w);
    // Two safe places can have a corner of rock between them; the line from the player to the camera is always clear. (Where the
    // follow camera itself stands outside the cave, as near a mouth, the way out to it is not held to the tunnel.)
    if (w > 1e-6 && w < 1 - 1e-6) clipFrom(focus, out.position, inCave && this.followInside, margin);
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The ending

/** How high above the floor a patch reef's top is, by what it grows on (a hill top, a boulder, an arch). */
const REEF_TOP = { shelf: 2, hill: 2.5, boulder: 6.5, arch: 8 } as const;

/** REQ-028 AC-2: a point above each patch reef, with how wide the reef is: what the ending's first shot circles. */
export const patchReefs: readonly (Placed & { width: number })[] = natureReefs
  .filter((reef) => reef.kind === "patch")
  .map((reef) => ({ x: reef.x, y: floorHeight(reef.x, reef.z) + REEF_TOP[reef.host], z: reef.z, width: reef.width }));

/** What the ending films: the planted frames, the patch reefs (a point above each, and how wide it is), and the swimming animals. */
export interface EndingScene {
  frames: readonly Placed[];
  reefs: readonly (Placed & { width: number })[];
  /** The `index`th animal of a kind (the yellowtail, manta rays and dolphins), or null when there is none. */
  creature(species: "yellowtail" | "mantaRay" | "dolphin", index: number): { position: Vector3; yaw: number } | null;
}

/**
 * REQ-028 AC-2, AC-7: the ending's flight over the restored bay, in five shots: round the patch reef nearest the planted frames
 * (the coral coloured, the clownfish at their anemones), beside the yellowtail school, beside a manta ray, below the dolphins
 * that swim near the surface, and a climb through the surface to the beach and the sky. Each shot follows its subject from a
 * distance and is clipped from it, so the camera is never in the rock or the coral.
 */
export class EndingShot {
  private readonly lead = new Lead(cinematic.bloom.pullOut);
  private lastShot = -1;
  private readonly anchor = new Vector3();
  private readonly wish = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly reefCentre: Placed & { width: number };
  private readonly climbPosition: Track;
  private readonly climbTarget: Track;

  constructor(private readonly scene: EndingScene) {
    // The patch reef nearest the first planted frame, or that frame itself when the bay has none.
    const frame = scene.frames[0] ?? { x: 0, y: -8, z: 0 };
    this.reefCentre = scene.reefs.reduce<(Placed & { width: number }) | null>(
      (best, reef) => (best === null || Math.hypot(reef.x - frame.x, reef.z - frame.z) < Math.hypot(best.x - frame.x, best.z - frame.z) ? reef : best),
      null,
    ) ?? { x: frame.x, y: frame.y + 1.2, z: frame.z, width: 2 };
    const { climb, shots } = cinematic.ending;
    const length = shots[shots.length - 1];
    this.climbPosition = track([
      [0, climb.fromX, climb.fromY, climb.fromZ],
      [length * 0.38, lerp(climb.fromX, climb.toX, 0.55), -3, lerp(climb.fromZ, climb.toZ, 0.6)],
      [length * 0.66, lerp(climb.fromX, climb.toX, 0.86), 0.9, lerp(climb.fromZ, climb.toZ, 0.9)],
      [length, climb.toX, climb.toY, climb.toZ],
    ]);
    this.climbTarget = track([
      [0, climb.fromX - 40, -4, climb.fromZ - 6],
      [length * 0.38, climb.lookX, 0, climb.toZ + 4],
      [length * 0.66, climb.lookX, climb.lookY - 2, climb.toZ],
      [length, climb.lookX, climb.lookY, climb.toZ],
    ]);
  }

  pose(time: number, dt: number, out: Pose): Pose {
    const shot = shotAt("ending", time);
    if (shot !== this.lastShot) this.lead.reset();
    this.lastShot = shot;
    const local = time - endingShotStart(shot);
    const length = cinematic.ending.shots[shot];
    const u = clamp01(local / length);
    const { follow, reef, dolphins } = cinematic.ending;

    if (shot === 4) {
      this.climbPosition.at(local, out.position);
      this.climbTarget.at(local, out.target);
      return out;
    }

    let subject: { position: Vector3; yaw: number } | null = null;
    if (shot === 0) {
      const centre = this.reefCentre;
      this.anchor.set(centre.x, centre.y, centre.z);
      const angle = 0.6 + reef.sweep * smoothstep(u);
      const radius = Math.max(reef.radius, centre.width / 2 + reef.radius * 0.6);
      this.wish.set(this.anchor.x + Math.sin(angle) * radius, this.anchor.y + reef.height, this.anchor.z + Math.cos(angle) * radius);
      out.target.copy(this.anchor);
    } else {
      subject = this.scene.creature(shot === 1 ? "yellowtail" : shot === 2 ? "mantaRay" : "dolphin", shot === 3 ? 1 : 0);
      this.anchor.copy(subject?.position ?? this.anchor.set(0, -5, 0));
      const yaw = subject?.yaw ?? 0;
      this.forward.set(Math.sin(yaw), 0, Math.cos(yaw));
      const near = shot === 3 ? dolphins : follow;
      const swing = Math.sin(u * Math.PI) * 0.35;
      const side = near.side * (1 + swing);
      // Behind the animal and to its right (a body that faces (sin yaw, cos yaw) has its right at (cos yaw, 0, -sin yaw)); a little
      // above the school and the manta ray, and below the dolphins, so that they show against the surface.
      this.right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      this.wish.copy(this.anchor).addScaledVector(this.forward, -near.back).addScaledVector(this.right, side);
      this.wish.y += shot === 3 ? -dolphins.below : follow.height;
      out.target.copy(this.anchor).addScaledVector(this.forward, 2.5);
    }
    out.position.copy(this.wish);
    this.lead.place(this.anchor, out.position, dt);
    return out;
  }
}
