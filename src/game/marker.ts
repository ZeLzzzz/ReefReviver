/** A point in camera space: x right, y up, and z negative in front of the camera (three.js convention). */
export interface ViewPoint {
  x: number;
  y: number;
  z: number;
}

export interface MarkerPlacement {
  /** Position in CSS pixels from the top-left corner of the screen. */
  left: number;
  top: number;
  /** True when the target is visible; the marker then sits on it and shows no arrow. */
  onScreen: boolean;
  /** Direction to turn toward, in radians clockwise from "up"; only meaningful when not on screen. */
  angle: number;
}

/**
 * Where to draw the marker for a target: on the target when it is in view, otherwise clamped to the screen
 * edge (inset by `margin`) in the target's direction, with an angle for the arrow.
 */
export function placeMarker(
  view: ViewPoint,
  tanHalfFov: number,
  width: number,
  height: number,
  margin: number,
): MarkerPlacement {
  const aspect = width / height;
  const inFront = view.z < -1e-6;
  // Normalised device coordinates, x right and y up, -1..1 across the screen. Behind the camera they are
  // meaningless, so the direction comes from the camera-space offset alone.
  let nx: number;
  let ny: number;
  if (inFront) {
    nx = view.x / (-view.z * tanHalfFov * aspect);
    ny = view.y / (-view.z * tanHalfFov);
  } else {
    nx = view.x;
    ny = view.y;
  }

  const halfW = width / 2 - margin;
  const halfH = height / 2 - margin;
  if (inFront && Math.abs(nx) * (width / 2) <= halfW && Math.abs(ny) * (height / 2) <= halfH) {
    return { left: width / 2 + (nx * width) / 2, top: height / 2 - (ny * height) / 2, onScreen: true, angle: 0 };
  }

  // Direction in pixels from the screen centre (screen y grows downward).
  let dx = inFront ? (nx * width) / 2 : nx;
  let dy = inFront ? -(ny * height) / 2 : -ny;
  if (Math.hypot(dx, dy) < 1e-6) {
    // Straight behind: point down, as a "turn around" cue.
    dx = 0;
    dy = 1;
  }
  const scale = Math.min(halfW / Math.max(Math.abs(dx), 1e-6), halfH / Math.max(Math.abs(dy), 1e-6));
  return {
    left: width / 2 + dx * scale,
    top: height / 2 + dy * scale,
    onScreen: false,
    angle: Math.atan2(dx, -dy),
  };
}
