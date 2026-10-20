import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight } from "./bay";
import type { RovState } from "./rov";

const { camera, bay } = config;

export function aimDirection(yaw: number, pitch: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/** Pulls a camera position back into open water: under the surface, above the floor, short of the cliffs. */
export function keepCameraInWater(p: Vector3): void {
  const maxDistance = bay.cliffRadius - bay.cliffJag - 0.5;
  const distance = Math.hypot(p.x, p.z);
  if (distance > maxDistance) {
    p.x *= maxDistance / distance;
    p.z *= maxDistance / distance;
  }
  p.y = Math.max(p.y, floorHeight(p.x, p.z) + camera.floorGap);
  p.y = Math.min(p.y, bay.surfaceY - camera.surfaceGap);
}

const aim = new Vector3();

/**
 * Third-person camera behind and above the ROV, looking along the aim direction, so the screen
 * centre (the crosshair) is where the ROV aims (D-029).
 */
export function followCamera(state: RovState, outPosition: Vector3, outTarget: Vector3): void {
  aimDirection(state.yaw, state.pitch, aim);
  outPosition.copy(state.position).addScaledVector(aim, -camera.distance);
  outPosition.y += camera.height;
  keepCameraInWater(outPosition);
  outTarget.copy(outPosition).add(aim);
}
