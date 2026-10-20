import { Vector3 } from "three";
import { config } from "../config";
import type { LogbookId } from "../logbook/entries";
import { smoothstep } from "./bloom";
import { floorHeight } from "./bay";

const { seaLife, reef } = config;

export type SeaSpecies = "clownfish" | "yellowtail" | "mantaRay" | "dolphin";

/** A closed loop: an ellipse around a centre, travelled at a steady angular speed, with a gentle bob (AC-3). */
export interface LoopSpec {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  y: number;
  bob: number;
  bobSpeed: number;
  bobPhase: number;
  /** Radians per second along the loop. */
  speed: number;
  phase: number;
  direction: 1 | -1;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Facing along (sin yaw, cos yaw), like the ROV and the animals. */
  yaw: number;
  /** Nose-up is negative, as three.js "YXZ" rotation.x expects for a model facing +Z. */
  pitch: number;
}

/** Where something on a loop is at `time`, and which way it faces. Pure and cheap: called every frame. */
export function loopPose(loop: LoopSpec, time: number, out: Pose): Pose {
  const angle = loop.phase + loop.direction * loop.speed * time;
  const bobAngle = loop.bobSpeed * time + loop.bobPhase;
  out.x = loop.x + loop.radiusX * Math.cos(angle);
  out.z = loop.z + loop.radiusZ * Math.sin(angle);
  out.y = loop.y + loop.bob * Math.sin(bobAngle);
  const rate = loop.direction * loop.speed;
  const dx = -loop.radiusX * Math.sin(angle) * rate;
  const dz = loop.radiusZ * Math.cos(angle) * rate;
  const dy = loop.bob * loop.bobSpeed * Math.cos(bobAngle);
  out.yaw = Math.atan2(dx, dz);
  out.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
  return out;
}

export interface Anemone {
  x: number;
  y: number;
  z: number;
}

/** What REQ-006 can aim at: an id, a species and the Logbook entry it belongs to (none for the yellowtail, D-038). */
export interface SeaCreature {
  id: number;
  species: SeaSpecies;
  /** D-038: the yellowtail school is decoration and cannot be scanned. */
  scannable: boolean;
  logbookId: LogbookId | null;
  loop: LoopSpec;
  position: Vector3;
  yaw: number;
  pitch: number;
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

/** One anemone beside each reef frame (D-038). */
export function generateAnemones(): Anemone[] {
  return reef.frameSites.map(({ x, z }) => {
    const ax = x + seaLife.anemone.dx;
    const az = z + seaLife.anemone.dz;
    return { x: ax, y: floorHeight(ax, az), z: az };
  });
}

const LOGBOOK_OF: Record<SeaSpecies, LogbookId | null> = {
  clownfish: "clownfish",
  yellowtail: null,
  mantaRay: "mantaRay",
  dolphin: "dolphin",
};

/** Clownfish at each anemone, the yellowtail school, the manta rays and the dolphins, with their loops. */
export function generateCreatures(anemones: readonly Anemone[]): SeaCreature[] {
  const loops: { species: SeaSpecies; loop: LoopSpec }[] = [];
  const random = mulberry32(53);
  const spread = (amount: number) => (random() * 2 - 1) * amount;

  const { clownfish, yellowtail, dolphins } = seaLife;
  for (const anemone of anemones) {
    for (let i = 0; i < clownfish.perAnemone; i++) {
      loops.push({
        species: "clownfish",
        loop: {
          x: anemone.x,
          z: anemone.z,
          radiusX: clownfish.radiusX + i * 0.2,
          radiusZ: clownfish.radiusZ + i * 0.1,
          y: anemone.y + seaLife.anemone.height + clownfish.hover,
          bob: clownfish.bob,
          bobSpeed: 2.1,
          bobPhase: i * 2 + random() * 6,
          speed: clownfish.speed,
          phase: (i * Math.PI * 2) / clownfish.perAnemone + random(),
          direction: 1,
        },
      });
    }
  }

  for (let i = 0; i < yellowtail.count; i++) {
    loops.push({
      species: "yellowtail",
      loop: {
        x: yellowtail.centre.x,
        z: yellowtail.centre.z,
        radiusX: yellowtail.radiusX + spread(yellowtail.spreadAcross),
        radiusZ: yellowtail.radiusZ + spread(yellowtail.spreadAcross),
        y: yellowtail.y + spread(yellowtail.spreadY),
        bob: 0.25,
        bobSpeed: 1.3 + random() * 0.8,
        bobPhase: random() * 6.28,
        speed: yellowtail.speed,
        phase: spread(yellowtail.spreadAlong),
        direction: 1,
      },
    });
  }

  for (const manta of seaLife.mantaRays) {
    loops.push({
      species: "mantaRay",
      loop: {
        x: manta.x,
        z: manta.z,
        radiusX: manta.radiusX,
        radiusZ: manta.radiusZ,
        y: manta.y,
        bob: 0.6,
        bobSpeed: 0.35,
        bobPhase: manta.phase,
        speed: manta.speed,
        phase: manta.phase,
        direction: manta.direction,
      },
    });
  }

  for (let i = 0; i < dolphins.count; i++) {
    const offset = i - (dolphins.count - 1) / 2;
    loops.push({
      species: "dolphin",
      loop: {
        x: dolphins.centre.x,
        z: dolphins.centre.z,
        radiusX: dolphins.radiusX + offset * dolphins.spreadAcross,
        radiusZ: dolphins.radiusZ + offset * dolphins.spreadAcross,
        y: dolphins.y,
        bob: dolphins.bob,
        bobSpeed: 1.1,
        bobPhase: i * 1.7,
        speed: dolphins.speed,
        phase: offset * dolphins.spreadAlong,
        direction: 1,
      },
    });
  }

  return loops.map(({ species, loop }, id) => ({
    id,
    species,
    scannable: species !== "yellowtail",
    logbookId: LOGBOOK_OF[species],
    loop,
    position: new Vector3(),
    yaw: 0,
    pitch: 0,
  }));
}

/**
 * The sea life that returns with the Bloom (AC-3): clownfish at an anemone beside each frame, the yellowtail
 * school, manta rays and dolphins. Nothing is there until `start()`; then everything grows from nothing to full
 * size over `appearSeconds` and swims its loop. Pure: no rendering, no collision (the ROV passes through).
 */
export class SeaLife {
  readonly anemones = generateAnemones();
  readonly creatures = generateCreatures(this.anemones);
  /** The Bloom has finished and the animals are (appearing) in the bay. */
  active = false;
  private time = 0;
  private appearTime = 0;
  private readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  constructor() {
    this.place();
  }

  /** Seconds the animals have swum. */
  get elapsed(): number {
    return this.time;
  }

  /** 0 (not there) to 1 (full size), eased. */
  get scale(): number {
    return this.active ? smoothstep(this.appearTime / seaLife.appearSeconds) : 0;
  }

  start(): void {
    this.active = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    this.appearTime = Math.min(seaLife.appearSeconds, this.appearTime + dt);
    this.place();
  }

  /** A new dive: the bay is empty again. */
  reset(): void {
    this.active = false;
    this.time = 0;
    this.appearTime = 0;
    this.place();
  }

  private place(): void {
    for (const creature of this.creatures) {
      loopPose(creature.loop, this.time, this.pose);
      creature.position.set(this.pose.x, this.pose.y, this.pose.z);
      creature.yaw = this.pose.yaw;
      creature.pitch = this.pose.pitch;
    }
  }
}
