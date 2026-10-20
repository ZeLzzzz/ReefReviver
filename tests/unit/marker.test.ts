import { describe, expect, it } from "vitest";
import { placeMarker } from "../../src/game/marker";

const W = 800;
const H = 450;
const TAN = Math.tan((70 * Math.PI) / 360);
const MARGIN = 56;

describe("station marker (REQ-002 AC-2)", () => {
  it("sits on the target when it is straight ahead", () => {
    const p = placeMarker({ x: 0, y: 0, z: -20 }, TAN, W, H, MARGIN);
    expect(p.onScreen).toBe(true);
    expect(p.left).toBeCloseTo(W / 2);
    expect(p.top).toBeCloseTo(H / 2);
  });

  it("sits on a target that is in view to the right and above", () => {
    const p = placeMarker({ x: 5, y: 2, z: -20 }, TAN, W, H, MARGIN);
    expect(p.onScreen).toBe(true);
    expect(p.left).toBeGreaterThan(W / 2);
    expect(p.top).toBeLessThan(H / 2);
  });

  it("clamps to the right edge, with an arrow pointing right, when the target is off to the right", () => {
    const p = placeMarker({ x: 40, y: 0, z: -10 }, TAN, W, H, MARGIN);
    expect(p.onScreen).toBe(false);
    expect(p.left).toBeCloseTo(W - MARGIN);
    expect(p.top).toBeCloseTo(H / 2);
    expect(p.angle).toBeCloseTo(Math.PI / 2);
  });

  it("clamps to the left edge for a target on the left", () => {
    const p = placeMarker({ x: -40, y: 0, z: -10 }, TAN, W, H, MARGIN);
    expect(p.onScreen).toBe(false);
    expect(p.left).toBeCloseTo(MARGIN);
    expect(p.angle).toBeCloseTo(-Math.PI / 2);
  });

  it("points up at the top edge for a target far above", () => {
    const p = placeMarker({ x: 0, y: 40, z: -10 }, TAN, W, H, MARGIN);
    expect(p.onScreen).toBe(false);
    expect(p.top).toBeCloseTo(MARGIN);
    expect(p.angle).toBeCloseTo(0);
  });

  it("keeps a target behind the camera on the screen edge, on its side, instead of mirroring it", () => {
    const right = placeMarker({ x: 10, y: 0, z: 20 }, TAN, W, H, MARGIN);
    expect(right.onScreen).toBe(false);
    expect(right.left).toBeGreaterThan(W / 2);
    expect(right.angle).toBeGreaterThan(0);
    const left = placeMarker({ x: -10, y: 0, z: 20 }, TAN, W, H, MARGIN);
    expect(left.left).toBeLessThan(W / 2);
    expect(left.angle).toBeLessThan(0);
  });

  it("handles a target exactly behind", () => {
    const p = placeMarker({ x: 0, y: 0, z: 30 }, TAN, W, H, MARGIN);
    expect(p.onScreen).toBe(false);
    expect(Number.isFinite(p.left) && Number.isFinite(p.top)).toBe(true);
    expect(p.top).toBeGreaterThan(H / 2);
  });

  it("never leaves the screen margin", () => {
    for (const view of [
      { x: 90, y: 70, z: -3 },
      { x: -90, y: -70, z: 5 },
      { x: 1, y: -50, z: -1 },
    ]) {
      const p = placeMarker(view, TAN, W, H, MARGIN);
      expect(p.left).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      expect(p.left).toBeLessThanOrEqual(W - MARGIN + 1e-6);
      expect(p.top).toBeGreaterThanOrEqual(MARGIN - 1e-6);
      expect(p.top).toBeLessThanOrEqual(H - MARGIN + 1e-6);
    }
  });
});

describe("station marker stays clear of the bottom HUD (REQ-002 AC-2)", () => {
  // The tool panel and the notices fill the bottom of the screen; the marker must never cover them.
  const BOTTOM = 190;

  it("a target behind the camera puts the marker above the bottom band", () => {
    const p = placeMarker({ x: 0, y: 0, z: 20 }, TAN, W, H, MARGIN, BOTTOM);
    expect(p.onScreen).toBe(false);
    expect(p.top).toBeLessThanOrEqual(H - BOTTOM + 1e-9);
    expect(p.angle).toBeCloseTo(Math.PI);
  });

  it("a target low on screen, inside the bottom band, is shown at the band's edge with an arrow down", () => {
    const p = placeMarker({ x: 0, y: -12, z: -20 }, TAN, W, H, MARGIN, BOTTOM);
    expect(p.onScreen).toBe(false);
    expect(p.top).toBeCloseTo(H - BOTTOM);
    expect(p.angle).toBeCloseTo(Math.PI);
  });

  it("the top and side margins are unchanged", () => {
    const up = placeMarker({ x: 0, y: 40, z: -10 }, TAN, W, H, MARGIN, BOTTOM);
    expect(up.top).toBeCloseTo(MARGIN);
    const right = placeMarker({ x: 40, y: 0, z: -10 }, TAN, W, H, MARGIN, BOTTOM);
    expect(right.left).toBeCloseTo(W - MARGIN);
  });
});
