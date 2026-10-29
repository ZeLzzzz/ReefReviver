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
 * edge (inset by `margin`, and by `bottomMargin` at the bottom, where the hotbar and notices sit) in the
 * target's direction, with an angle for the arrow.
 */
export function placeMarker(
  view: ViewPoint,
  tanHalfFov: number,
  width: number,
  height: number,
  margin: number,
  bottomMargin: number = margin,
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
  // Room above and below the screen centre.
  const up = height / 2 - margin;
  const down = Math.max(0, height / 2 - bottomMargin);
  const screenY = -(ny * height) / 2;
  if (inFront && Math.abs(nx) * (width / 2) <= halfW && screenY >= -up && screenY <= down) {
    return { left: width / 2 + (nx * width) / 2, top: height / 2 + screenY, onScreen: true, angle: 0 };
  }

  // Direction in pixels from the screen centre (screen y grows downward).
  let dx = inFront ? (nx * width) / 2 : nx;
  let dy = inFront ? -(ny * height) / 2 : -ny;
  if (Math.hypot(dx, dy) < 1e-6) {
    // Straight behind: point down, as a "turn around" cue.
    dx = 0;
    dy = 1;
  }
  const scale = Math.min(halfW / Math.max(Math.abs(dx), 1e-6), (dy > 0 ? down : up) / Math.max(Math.abs(dy), 1e-6));
  return {
    left: width / 2 + dx * scale,
    top: height / 2 + dy * scale,
    onScreen: false,
    angle: Math.atan2(dx, -dy),
  };
}

/** A box on the screen, in CSS pixels. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * REQ-016 AC-5: moves a label `width` x `height` centred at (x, y) off every rect (each grown by `gap`), to the nearest
 * spot that covers none of them and stays on the screen, so the marker never covers a HUD panel. Spots are found by
 * stepping out of the first rect a spot overlaps, to its left, right, top or bottom, a few times over, so a label
 * squeezed between two panels gets past both. Empty rects (hidden panels) are ignored. Returns the label's new centre;
 * if no free spot is found, the original one.
 */
export function avoidRects(
  x: number,
  y: number,
  width: number,
  height: number,
  rects: readonly ScreenRect[],
  screenWidth: number,
  screenHeight: number,
  gap = 6,
): { x: number; y: number } {
  const hw = width / 2;
  const hh = height / 2;
  const solid = rects
    .filter((rect) => rect.right - rect.left > 0 && rect.bottom - rect.top > 0)
    .map((rect) => ({ left: rect.left - gap, right: rect.right + gap, top: rect.top - gap, bottom: rect.bottom + gap }));
  const firstOverlap = (cx: number, cy: number) => solid.find((r) => cx + hw > r.left && cx - hw < r.right && cy + hh > r.top && cy - hh < r.bottom);
  const onScreen = (cx: number, cy: number) => cx - hw >= 0 && cx + hw <= screenWidth && cy - hh >= 0 && cy + hh <= screenHeight;

  let frontier = [{ x, y }];
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (let round = 0; round < 4 && frontier.length > 0; round++) {
    const next: { x: number; y: number }[] = [];
    for (const spot of frontier) {
      const hit = firstOverlap(spot.x, spot.y);
      if (!hit) {
        const distance = Math.hypot(spot.x - x, spot.y - y);
        if (distance < bestDistance) {
          best = spot;
          bestDistance = distance;
        }
        continue;
      }
      for (const escape of [
        { x: hit.left - hw, y: spot.y },
        { x: hit.right + hw, y: spot.y },
        { x: spot.x, y: hit.top - hh },
        { x: spot.x, y: hit.bottom + hh },
      ]) {
        if (onScreen(escape.x, escape.y)) next.push(escape);
      }
    }
    frontier = next;
  }
  return best ?? { x, y };
}
