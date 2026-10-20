import { Vector3 } from "three";
import { config } from "../config";
import { constrainToBay } from "./bay";

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
  constrainToBay(state.position, state.velocity);
}
