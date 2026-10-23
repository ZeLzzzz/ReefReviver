import { Vector3 } from "three";
import { config } from "../config";
import { floorHeight, terrainSolidAt } from "./bay";
import type { RovState } from "./rov";

const { camera, bay } = config;

export function aimDirection(yaw: number, pitch: number, out = new Vector3()): Vector3 {
  return out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

const blocked = (x: number, y: number, z: number) => y > bay.surfaceY - camera.surfaceGap || terrainSolidAt(x, y, z, camera.clearance);

/**
 * Pulls a camera position back into open water: under the surface and above the floor, and short of any slope,
 * rock, boulder, arch or wall on the line from `from` (the ROV) to it, so the view is never inside them (REQ-011 AC-4).
 */
export function keepCameraInWater(p: Vector3, from: Vector3): void {
  p.y = Math.max(p.y, floorHeight(p.x, p.z) + camera.floorGap);
  p.y = Math.min(p.y, bay.surfaceY - camera.surfaceGap);
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const dz = p.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  let free = 0;
  for (let t = camera.step; t < length + camera.step; t += camera.step) {
    const k = Math.min(t, length) / length;
    if (blocked(from.x + dx * k, from.y + dy * k, from.z + dz * k)) {
      p.set(from.x + (dx * free) / length, from.y + (dy * free) / length, from.z + (dz * free) / length);
      return;
    }
    free = Math.min(t, length);
  }
}

const aim = new Vector3();
const level = new Vector3();

/**
 * Third-person camera behind and above the ROV, looking along the aim direction, so the screen
 * centre (the crosshair) is where the ROV aims (D-029).
 */
export function followCamera(state: RovState, outPosition: Vector3, outTarget: Vector3): void {
  aimDirection(state.yaw, state.pitch, aim);
  outPosition.copy(state.position).addScaledVector(aim, -camera.distance);
  outPosition.y += camera.height;
  keepCameraInWater(outPosition, state.position);
  // REQ-014: under a low roof (the cave) the raised camera is stopped right behind the vehicle; level with it, it
  // can stay further back, so the vehicle is seen whole.
  if (outPosition.distanceTo(state.position) < camera.distance * 0.6) {
    level.copy(state.position).addScaledVector(aim, -camera.distance);
    keepCameraInWater(level, state.position);
    if (level.distanceTo(state.position) > outPosition.distanceTo(state.position)) outPosition.copy(level);
  }
  outTarget.copy(outPosition).add(aim);
}
