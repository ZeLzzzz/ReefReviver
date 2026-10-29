import { Vector3 } from "three";
import { config } from "../config";
import { insideRockAt } from "./bay";
import { mulberry32 } from "./nature";
import { areaReach, floorHeight, inland } from "./terrain";
import { surfaceSpotOk } from "./trash";

const { dumper: tuning, bay } = config;

/**
 * REQ-036: what the dumping boat is doing. `waiting` for its time to come (or `done` for good, after the Bloom); `arriving`
 * from the open sea; `dumping` where it stopped; `capsizing` (rolling over), `wrecked` (keel up, then sinking away) after the
 * Cutter turned it over; `leaving` when the Bloom began before that.
 */
export type DumperPhase = "waiting" | "arriving" | "dumping" | "capsizing" | "wrecked" | "leaving" | "done";

export interface CrewMember {
  /** Where the person stands on the deck, or swims with the head out of the water. */
  position: Vector3;
  /** Which way the person faces. */
  yaw: number;
  phase: "aboard" | "clinging" | "swimming" | "ashore";
  seconds: number;
}

/** A piece of trash going overboard: where it lands, and whether it floats or sinks to the floor. */
export interface Drop {
  x: number;
  z: number;
  floating: boolean;
}

/** The hull as the Cutter's ray sees it (an ellipsoid turned by `yaw`), while the boat can be capsized. */
export interface BoatTarget {
  center: Vector3;
  radii: Vector3;
  yaw: number;
}

const range = (random: () => number, [low, high]: readonly [number, number]) => low + random() * (high - low);
// Where the crew stands on the deck, from the boat's middle (across, along).
const DECK_SPOTS: readonly [number, number][] = [[-0.45, -0.9], [0.5, 0.6]];

/**
 * REQ-036 (D-134, D-135): the boat that dumps trash in the bay. It comes `firstAfter` seconds into a dive, stops and drops
 * trash every `dumpEvery` seconds until the Cutter capsizes it; then the crew swims to the beach and the next boat comes
 * `nextAfter` seconds later. None comes after the Bloom has begun.
 */
export class Dumper {
  phase: DumperPhase = "waiting";
  /** The boat's middle at the waterline (lower while it sinks). */
  readonly position = new Vector3();
  yaw = 0;
  /** 0 upright, π keel up. */
  roll = 0;
  dumped = 0;
  readonly crew: CrewMember[] = [];
  private random: () => number = Math.random;
  private seconds = 0;
  private until = 0;
  /** A boat has just set out for the bay: the next update says so. */
  private announce = false;
  private readonly stop = new Vector3();
  private readonly from = new Vector3();
  private readonly target: BoatTarget = { center: new Vector3(), radii: new Vector3(tuning.hull.halfWidth, tuning.hull.height, tuning.hull.halfLength), yaw: 0 };

  /** A new dive: no boat yet, the first one `firstAfter` seconds from now. */
  reset(seed: number): void {
    this.random = mulberry32(seed ^ 0x5d1c);
    this.phase = "waiting";
    this.until = tuning.firstAfter;
    this.dumped = 0;
    this.roll = 0;
    this.crew.length = 0;
    this.announce = false;
  }

  /** The boat is in the bay and still upright: the goal shows, the minimap marks it, and the Cutter can turn it over. */
  get active(): boolean {
    return this.phase === "arriving" || this.phase === "dumping";
  }

  /** Something of the boat or its crew is to be drawn. */
  get seen(): boolean {
    return this.phase !== "waiting" && this.phase !== "done";
  }

  get hull(): BoatTarget | null {
    if (!this.active) return null;
    this.target.center.copy(this.position);
    this.target.yaw = this.yaw;
    return this.target;
  }

  /** For the tests: the next boat now, stopping near `near` if given. */
  summon(player: Vector3, near?: { x: number; z: number }): void {
    this.arrive(player, near);
  }

  /** For the tests: the next piece of trash in `seconds`. */
  hurryDrop(seconds: number): void {
    if (this.phase === "dumping") this.until = seconds;
  }

  /**
   * Advances by `dt` of play. `bloom` is whether the Bloom has begun; `player` is where the player is (the boat stops away
   * from it). Returns `arrived` on the frame the boat comes into view, and the trash it drops this frame, if any.
   */
  update(dt: number, bloom: boolean, player: Vector3): { arrived: boolean; drop: Drop | null } {
    let drop: Drop | null = null;
    this.seconds += dt;
    if (bloom && this.phase === "waiting") this.phase = "done";
    if (bloom && this.active) this.leave();
    switch (this.phase) {
      case "waiting":
        this.until -= dt;
        if (this.until <= 0) this.arrive(player);
        break;
      case "arriving": {
        const way = this.stop.distanceTo(this.from);
        const t = Math.min(1, (this.seconds * tuning.speed) / way);
        this.position.lerpVectors(this.from, this.stop, t);
        if (t >= 1) {
          this.phase = "dumping";
          this.until = tuning.firstDrop;
        }
        break;
      }
      case "dumping":
        this.until -= dt;
        if (this.until <= 0 && this.dumped < tuning.maxDrops) {
          drop = this.drop();
          this.dumped += 1;
          this.until = tuning.dumpEvery;
        }
        break;
      case "capsizing":
        this.roll = Math.min(Math.PI, (this.seconds / tuning.rollSeconds) * Math.PI);
        if (this.seconds >= tuning.rollSeconds) this.enter("wrecked");
        break;
      case "wrecked": {
        const sinking = Math.max(0, this.seconds - tuning.floatSeconds) / tuning.sinkSeconds;
        this.position.y = bay.surfaceY - Math.min(1, sinking) * tuning.sinkDepth;
        if (sinking >= 1 && this.crew.every((person) => person.phase === "ashore")) this.next();
        break;
      }
      case "leaving":
        this.position.addScaledVector(new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), tuning.speed * dt);
        if (this.seconds >= tuning.leaveSeconds) this.enter("done");
        break;
    }
    this.stepCrew(dt);
    const arrived = this.announce;
    this.announce = false;
    return { arrived, drop };
  }

  /** The Cutter turned the boat over (AC-4): it stops dumping, rolls over, and the crew goes into the water. */
  capsize(): void {
    if (!this.active) return;
    this.enter("capsizing");
    this.crew.forEach((person, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      person.phase = "clinging";
      person.seconds = 0;
      person.position.set(
        this.position.x + Math.cos(this.yaw) * side * (tuning.hull.halfWidth + 0.5),
        bay.surfaceY,
        this.position.z - Math.sin(this.yaw) * side * (tuning.hull.halfWidth + 0.5),
      );
    });
  }

  private enter(phase: DumperPhase): void {
    this.phase = phase;
    this.seconds = 0;
  }

  private next(): void {
    this.enter("waiting");
    this.crew.length = 0;
    this.roll = 0;
    this.until = range(this.random, tuning.nextAfter);
  }

  private leave(): void {
    // Out to sea, the way it came.
    this.yaw = Math.atan2(this.from.x - this.position.x, this.from.z - this.position.z);
    this.enter("leaving");
  }

  private arrive(player: Vector3, near?: { x: number; z: number }): void {
    this.pickStop(player, near);
    // In from the open sea to the east.
    this.from.set(this.stop.x + tuning.arriveFrom, bay.surfaceY, this.stop.z);
    this.position.copy(this.from);
    this.yaw = -Math.PI / 2;
    this.roll = 0;
    this.dumped = 0;
    this.crew.length = 0;
    for (let i = 0; i < tuning.crew.count; i++) {
      this.crew.push({ position: new Vector3(), yaw: 0, phase: "aboard", seconds: 0 });
    }
    this.enter("arriving");
    this.announce = true;
  }

  private pickStop(player: Vector3, near?: { x: number; z: number }): void {
    const reach = areaReach(20);
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = near ? near.x + (attempt === 0 ? 0 : (this.random() * 2 - 1) * 10) : (this.random() * 2 - 1) * reach;
      const z = near ? near.z + (attempt === 0 ? 0 : (this.random() * 2 - 1) * 10) : (this.random() * 2 - 1) * reach;
      if (!surfaceSpotOk(x, z)) continue;
      if (!near && Math.hypot(x - player.x, z - player.z) < tuning.clearOfPlayer) continue;
      this.stop.set(x, bay.surfaceY, z);
      return;
    }
    this.stop.set(near?.x ?? 60, bay.surfaceY, near?.z ?? 40);
  }

  private drop(): Drop {
    const angle = this.random() * Math.PI * 2;
    const distance = range(this.random, tuning.dropRadius);
    const x = this.position.x + Math.cos(angle) * distance;
    const z = this.position.z + Math.sin(angle) * distance;
    // Every other piece sinks, where the water is deep enough and no rock is in the way; the rest float.
    const sinks = this.dumped % 2 === 1 && floorHeight(x, z) < bay.surfaceY - 1.5 && !insideRockAt(x, floorHeight(x, z) + 0.3, z, 0.4);
    return { x, z, floating: !sinks };
  }

  private stepCrew(dt: number): void {
    const { crew } = tuning;
    this.crew.forEach((person, i) => {
      person.seconds += dt;
      if (person.phase === "aboard") {
        const [across, along] = DECK_SPOTS[i % DECK_SPOTS.length];
        const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
        person.position.set(this.position.x + cos * across + sin * along, this.position.y, this.position.z - sin * across + cos * along);
        person.yaw = this.yaw + (i % 2 === 0 ? Math.PI / 2 : -Math.PI / 2);
        return;
      }
      if (person.phase === "clinging" && person.seconds >= crew.clingSeconds) {
        person.phase = "swimming";
        person.seconds = 0;
      }
      if (person.phase !== "swimming") return;
      // Straight for the beach, kept to the open beach between the headlands.
      const shoreZ = Math.max(-config.trash.surface.beachHalfLength, Math.min(config.trash.surface.beachHalfLength, person.position.z));
      const shoreX = inland(0, shoreZ) + 1;
      const dx = shoreX - person.position.x, dz = shoreZ - person.position.z;
      const left = Math.hypot(dx, dz);
      person.yaw = Math.atan2(dx, dz);
      const step = Math.min(left, crew.swimSpeed * dt);
      if (left > 0) person.position.set(person.position.x + (dx / left) * step, bay.surfaceY, person.position.z + (dz / left) * step);
      if (left - step < 0.2 || person.seconds >= crew.maxSwimSeconds) person.phase = "ashore";
    });
  }
}
