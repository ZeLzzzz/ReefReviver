import { Vector3 } from "three";
import { config } from "../config";
import { isSolidAt } from "./bay";
import type { ShotResult, ShotTarget } from "./reef-sites";

const { seedLauncher, camera } = config;

/** What the shots can touch: a frame or patch (anything else solid ends a shot as a miss). */
export interface ShotWorld {
  targetAt(x: number, y: number, z: number): ShotTarget | null;
  land(target: ShotTarget): ShotResult;
}

export interface Shot {
  position: Vector3;
  direction: Vector3;
  travelled: number;
}

const point = new Vector3();

/**
 * The point under the crosshair: the first frame, patch or solid thing along the camera's ray, or the far
 * end of the ray. The search starts at the ROV's depth along the ray, so nothing behind the ROV counts.
 */
export function findAimPoint(cameraPosition: Vector3, aim: Vector3, world: ShotWorld, out = new Vector3()): Vector3 {
  for (let distance = camera.distance; distance <= seedLauncher.aimDistance; distance += seedLauncher.rayStep) {
    point.copy(cameraPosition).addScaledVector(aim, distance);
    if (world.targetAt(point.x, point.y, point.z) || isSolidAt(point.x, point.y, point.z)) return out.copy(point);
  }
  return out.copy(cameraPosition).addScaledVector(aim, seedLauncher.aimDistance);
}

/**
 * Shots of the seed launcher. They never use materials. A shot lands where it touches a frame or a patch,
 * and is lost without a trace on anything else or at the end of its range (AC-6).
 */
export class SeedLauncher {
  readonly shots: Shot[] = [];
  private cooldown = 0;

  get ready(): boolean {
    return this.cooldown <= 0;
  }

  clear(): void {
    this.shots.length = 0;
    this.cooldown = 0;
  }

  /** Starts a shot from `origin` toward `target`; false while the launcher is still reloading. */
  fire(origin: Vector3, target: Vector3, fallback: Vector3): boolean {
    if (!this.ready) return false;
    this.cooldown = seedLauncher.interval;
    const direction = target.clone().sub(origin);
    // A target at the muzzle (a wall right in front of the ROV): shoot along the aim instead.
    if (direction.length() < 0.3) direction.copy(fallback);
    direction.normalize();
    this.shots.push({ position: origin.clone().addScaledVector(direction, seedLauncher.muzzle), direction, travelled: 0 });
    return true;
  }

  /** Moves the shots; returns what each finished shot did (misses included). */
  update(dt: number, world: ShotWorld): ShotResult[] {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const results: ShotResult[] = [];
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const result = this.advance(this.shots[i], dt, world);
      if (!result) continue;
      this.shots.splice(i, 1);
      results.unshift(result);
    }
    return results;
  }

  private advance(shot: Shot, dt: number, world: ShotWorld): ShotResult | null {
    const total = Math.min(seedLauncher.speed * dt, seedLauncher.range - shot.travelled);
    const steps = Math.max(1, Math.ceil(total / seedLauncher.hitStep));
    const step = total / steps;
    for (let n = 0; n < steps; n++) {
      shot.position.addScaledVector(shot.direction, step);
      shot.travelled += step;
      const { x, y, z } = shot.position;
      const target = world.targetAt(x, y, z);
      if (target) return world.land(target);
      if (isSolidAt(x, y, z)) return { kind: "miss" };
    }
    return shot.travelled >= seedLauncher.range - 1e-9 ? { kind: "miss" } : null;
  }
}
