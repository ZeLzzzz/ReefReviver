import { Vector3 } from "three";
import { config } from "../config";
import { constrainToBay, floorHeight } from "./bay";
import type { Sphere } from "./cutter";
import { defaultLayout, type Layout } from "./layout";
import { generateNets, type AnimalSpecies } from "./nets";

const { nets } = config;
const { wander } = nets;

/** Trapped in a net, swimming straight away after the cut, or wandering in the bay for good (AC-2, AC-3, AC-6). */
export type AnimalState = "trapped" | "fleeing" | "wandering";

export interface Animal {
  /** The id of the net that held it. */
  id: number;
  species: AnimalSpecies;
  state: AnimalState;
  /** The centre of the body. */
  position: Vector3;
  velocity: Vector3;
  /** Facing along (sin yaw, cos yaw), like the ROV. */
  yaw: number;
  /** Seconds in the current state. */
  age: number;
  /** Where it lies in the net; trapped animals stay near it. */
  home: Vector3;
  homeYaw: number;
  /** Offsets the motion of animals from each other. */
  phase: number;
  turnRate: number;
  turnLeft: number;
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

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** One animal per net, lying where its net stands. */
export function generateAnimals(layout: Layout = defaultLayout): Animal[] {
  return generateNets(layout).map((net) => {
    const home = new Vector3(net.center.x, net.center.y + 0.1 + nets.species[net.species].restHeight, net.center.z);
    return {
      id: net.id,
      species: net.species,
      state: "trapped",
      position: home.clone(),
      velocity: new Vector3(),
      yaw: net.yaw,
      age: 0,
      home,
      homeYaw: net.yaw,
      phase: net.id * 2.1,
      turnRate: 0,
      turnLeft: 0,
    };
  });
}

/**
 * The trapped animals and, once freed, the wandering ones. They are never removed and never hurt (AC-3, AC-5).
 * Pure: no rendering, no DOM. Trash lives in its own field, so the vacuum can never take an animal.
 */
export class AnimalField {
  readonly animals: Animal[];
  private layout: Layout;
  private time = 0;
  private random = mulberry32(31);

  constructor(layout: Layout = defaultLayout) {
    this.layout = layout;
    this.animals = generateAnimals(layout);
  }

  /** Seconds of game time the animals have been simulated; the end-to-end tests use it as a game clock. */
  get elapsed(): number {
    return this.time;
  }

  /** Lets a trapped animal go: it swims away from `awayFrom`, then wanders. Freed animals are left alone. */
  free(id: number, awayFrom: Vector3): void {
    const animal = this.animals[id];
    if (animal.state !== "trapped") return;
    animal.state = "fleeing";
    animal.age = 0;
    const dx = animal.position.x - awayFrom.x;
    const dz = animal.position.z - awayFrom.z;
    if (Math.hypot(dx, dz) > 1e-3) animal.yaw = Math.atan2(dx, dz);
    animal.turnLeft = 0;
  }

  update(dt: number): void {
    this.time += dt;
    for (const animal of this.animals) {
      animal.age += dt;
      if (animal.state === "trapped") this.struggle(animal);
      else this.swim(animal, dt);
    }
  }

  /** Spheres that make up the animals' bodies as they are now; they stop the cutter ray (AC-5). */
  bodySpheres(): Sphere[] {
    return this.animals.flatMap((animal) => {
      const { body } = nets.species[animal.species];
      return body.map(({ along, radius }) => ({
        x: animal.position.x + Math.sin(animal.yaw) * along,
        y: animal.position.y,
        z: animal.position.z + Math.cos(animal.yaw) * along,
        r: radius,
      }));
    });
  }

  /** Puts every animal back into its net, for a new dive. */
  reset(layout?: Layout): void {
    if (layout) this.layout = layout;
    this.time = 0;
    this.random = mulberry32(31);
    const fresh = generateAnimals(this.layout);
    this.animals.forEach((animal, i) => Object.assign(animal, fresh[i]));
  }

  /** Trapped: twists and shifts inside the net, never far from where it lies (AC-6). */
  private struggle(animal: Animal): void {
    const s = nets.species[animal.species].struggle;
    const t = this.time + animal.phase;
    animal.position.set(
      animal.home.x + Math.sin(t * 7.1) * s,
      animal.home.y + Math.sin(t * 5.3) * s * 0.4,
      animal.home.z + Math.cos(t * 6.3) * s,
    );
    animal.yaw = animal.homeYaw + Math.sin(t * 9.7) * 0.45;
    animal.velocity.set(0, 0, 0);
  }

  private swim(animal: Animal, dt: number): void {
    const species = nets.species[animal.species];
    const { position, velocity } = animal;
    if (animal.state === "fleeing" && animal.age >= nets.fleeSeconds) {
      animal.state = "wandering";
      animal.age = 0;
    }
    const fleeing = animal.state === "fleeing";
    const speed = fleeing ? species.fleeSpeed : species.wanderSpeed;

    animal.turnLeft -= dt;
    if (animal.turnLeft <= 0) {
      animal.turnRate = (this.random() * 2 - 1) * species.turnRate;
      animal.turnLeft = 1.5 + this.random() * 3;
    }
    let turn = fleeing ? 0 : animal.turnRate;
    if (Math.hypot(position.x, position.z) > wander.keepInside) {
      // Too close to the shore or the rock wall: turn back toward the middle of the bay.
      const toCentre = wrapAngle(Math.atan2(-position.x, -position.z) - animal.yaw);
      turn = clamp(toCentre, -1, 1) * species.turnRate * 2;
    }
    animal.yaw += turn * dt;

    const k = 1 - Math.exp(-2 * dt);
    velocity.x += (Math.sin(animal.yaw) * speed - velocity.x) * k;
    velocity.z += (Math.cos(animal.yaw) * speed - velocity.z) * k;
    const floor = floorHeight(position.x, position.z);
    const targetY = clamp(floor + wander.height + Math.sin(this.time * 0.3 + animal.phase) * 0.7, floor + wander.minAboveFloor, wander.maxY);
    velocity.y += (clamp((targetY - position.y) * 0.8, -1, 1) - velocity.y) * k;

    position.addScaledVector(velocity, dt);
    const [fromX, fromY, fromZ] = [position.x, position.y, position.z];
    constrainToBay(position, velocity, species.radius);
    // Pushed by a rock, a slope or the rock wall: turn away from it.
    if (Math.hypot(position.x - fromX, position.y - fromY, position.z - fromZ) > 1e-4) {
      animal.yaw += (animal.id % 2 === 0 ? 1 : -1) * wander.blockedTurn * dt;
    }
  }
}
