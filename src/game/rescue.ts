import { Group, Vector3 } from "three";
import { createAnimalView } from "./animal-model";
import { AnimalField } from "./animals";
import { Cutter, aimedHull, aimedNet, type NetHit, type Sphere } from "./cutter";
import type { BoatTarget } from "./dumper";
import { followCamera } from "./follow-camera";
import { createCutterBeam, createNetView, placeCutterBeam } from "./net-model";
import { NetField, type Net } from "./nets";
import type { Layout } from "./layout";
import type { RovState } from "./rov";
import type { Session } from "./session";
import type { TrashItem } from "./trash";

/** Trash is small; the cutter ray counts it as a sphere this big, so a bottle in front of a net blocks it. */
const TRASH_RADIUS = 0.5;
/** Where the beam leaves the ROV: just ahead of the nose, a little up. */
const NOSE = 0.8;
/** REQ-036: the cutter's target id for the dumping boat (nets are 0 and up). */
const BOAT_TARGET = -1;

/**
 * Everything of REQ-003 in one place: the ghost nets, the animals in them, the cutter and its beam. The game
 * calls step() once per simulated frame and reset() for a new dive.
 */
export class Rescue {
  readonly nets = new NetField();
  readonly animals = new AnimalField();
  readonly cutter = new Cutter();
  readonly group = new Group();
  private readonly netView = createNetView(this.nets.nets);
  private readonly animalView = createAnimalView(this.animals.animals);
  private readonly beam = createCutterBeam();
  private readonly origin = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly nose = new Vector3();

  constructor() {
    this.group.add(this.netView.group, this.animalView.group, this.beam);
    this.sync(0);
  }

  /** 0..1: how far the cutter has cut the net (or the dumping boat's hull, REQ-036) it aims at. */
  get progress(): number {
    return this.cutter.progress;
  }

  /** REQ-036: the cutter is working on the dumping boat, not a net. */
  atBoat = false;

  /**
   * `aim` is the unit vector the ROV and the camera look along. While `firing` (cutter selected, button held)
   * the ray from the camera along it must hit a net first; when the net is cut, `session` pays out (AC-1, AC-2).
   */
  step(dt: number, rov: RovState, aim: Vector3, firing: boolean, trash: readonly TrashItem[], session: Session, hull: BoatTarget | null = null): boolean {
    let hit: NetHit | null = null;
    let hullPoint: Vector3 | null = null;
    if (firing) {
      followCamera(rov, this.origin, this.lookAt);
      const blockers: Sphere[] = this.animals.bodySpheres();
      for (const item of trash) {
        if (item.state !== "collected") blockers.push({ x: item.position.x, y: item.position.y, z: item.position.z, r: TRASH_RADIUS });
      }
      hit = aimedNet(this.origin, aim, rov.position, this.nets.nets, blockers);
      // REQ-036 AC-4: the dumping boat's hull is cut at like a net, whichever the ray meets first.
      if (hull) hullPoint = aimedHull(this.origin, aim, rov.position, hull, hit ? hit.point.distanceTo(this.origin) : Infinity);
    }

    const cutId = this.cutter.update(dt, firing, hullPoint ? BOAT_TARGET : hit ? hit.net.id : null);
    this.atBoat = hullPoint !== null && cutId === null;
    if (cutId !== null && cutId !== BOAT_TARGET) {
      const net: Net = this.nets.cut(cutId);
      this.animals.free(cutId, rov.position);
      session.freeAnimal(net.species);
    }
    this.nets.update(dt);
    this.animals.update(dt);
    this.sync(dt);

    const target = hullPoint ?? hit?.point ?? null;
    this.beam.visible = target !== null && cutId === null;
    if (this.beam.visible && target) {
      this.nose.set(rov.position.x + Math.sin(rov.yaw) * NOSE, rov.position.y + 0.2, rov.position.z + Math.cos(rov.yaw) * NOSE);
      placeCutterBeam(this.beam, this.nose, target, 0.5 + 0.5 * Math.sin(performance.now() / 50));
    }
    return cutId === BOAT_TARGET;
  }

  /** Puts everything back for a new dive, at the new layout's spots when one is given (REQ-012). */
  reset(layout?: Layout): void {
    this.nets.reset(layout);
    this.animals.reset(layout);
    this.cutter.reset();
    this.atBoat = false;
    this.beam.visible = false;
    this.sync(0);
  }

  private sync(dt: number): void {
    this.netView.sync(this.nets.nets);
    this.animalView.sync(this.animals.animals, dt);
  }
}
