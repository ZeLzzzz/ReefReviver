import { Vector3 } from "three";
import { config } from "../config";
import { constrainToBay } from "./bay";

const { bay } = config;

const { rov } = config;

/** Each axis is -1, 0 or 1. `strafe` +1 is to the ROV's right, `rise` +1 is up. */
export interface MoveInput {
  forward: number;
  strafe: number;
  rise: number;
}

export interface RovState {
  position: Vector3;
  velocity: Vector3;
  /** 0 faces +Z (the front of a glTF model); increasing yaw turns left. */
  yaw: number;
  /** Where the camera and crosshair aim; the ROV itself stays level. */
  pitch: number;
}

export function createRovState(): RovState {
  const { x, y, z, yaw } = rov.start;
  return { position: new Vector3(x, y, z), velocity: new Vector3(), yaw, pitch: 0 };
}

export function forwardVector(yaw: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

export function rightVector(yaw: number, out = new Vector3()): Vector3 {
  return out.set(-Math.cos(yaw), 0, Math.sin(yaw));
}

/** Mouse movement in pixels: right turns right, up looks up. */
export function steer(state: RovState, dx: number, dy: number): void {
  state.yaw -= dx * rov.mouseSensitivity;
  state.pitch = Math.min(rov.maxPitch, Math.max(rov.minPitch, state.pitch - dy * rov.mouseSensitivity));
}

const desired = new Vector3();
const right = new Vector3();

export function stepRov(state: RovState, input: MoveInput, dt: number): void {
  forwardVector(state.yaw, desired).multiplyScalar(input.forward);
  desired.addScaledVector(rightVector(state.yaw, right), input.strafe);
  if (desired.lengthSq() > 1) desired.normalize();
  desired.multiplyScalar(rov.maxSpeed);
  desired.y = input.rise * rov.verticalSpeed;

  state.velocity.lerp(desired, 1 - Math.exp(-rov.acceleration * dt));
  state.position.addScaledVector(state.velocity, dt);
  constrainRov(state.position, state.velocity);
}

/** The ROV's limits (`constrainToBay`), with the surface letting it float with its deck out of the water (REQ-024 AC-1, AC-2). */
export function constrainRov(position: Vector3, velocity: Vector3): void {
  constrainToBay(position, velocity, rov.radius, rov.floatDepth);
}

/** The height of the ROV's centre when it floats at the surface. */
export const FLOAT_Y = bay.surfaceY - rov.floatDepth;

export interface Bob {
  /** Added to the model's height. */
  lift: number;
  roll: number;
  pitch: number;
}

/**
 * REQ-024 AC-1: the slow rocking of a floating ROV, for the model only. It fades in over `bob.reach` below the floating
 * height, so it is full at the surface and gone when diving.
 */
export function surfaceBob(y: number, seconds: number, out: Bob = { lift: 0, roll: 0, pitch: 0 }): Bob {
  const weight = Math.min(1, Math.max(0, 1 - (FLOAT_Y - y) / rov.bob.reach));
  const phase = (seconds / rov.bob.period) * Math.PI * 2;
  out.lift = weight * rov.bob.amplitude * Math.sin(phase);
  out.roll = weight * rov.bob.roll * Math.sin(phase * 0.7 + 1);
  out.pitch = weight * rov.bob.pitch * Math.sin(phase * 0.5 + 2);
  return out;
}
