import { Triangle, Vector3 } from "three";

/** A single irregular outcrop. Rendering, collision and attached coral use these same faces. */
export interface Boulder {
  x: number;
  z: number;
  /** The original layout's outer clearance radius, in metres. */
  radius: number;
  baseY: number;
  topY: number;
  vertices: readonly Vector3[];
  indices: readonly number[];
  faces: readonly { triangle: Triangle; normal: Vector3 }[];
}

const variation = (n: number) => {
  const h = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Broken shoulders, leaning flanks and an off-centre crown; no horizontal stacked discs. */
export function makeBoulderShape(x: number, z: number, radius: number, baseY: number, topY: number, seed: number): Boulder {
  const vertices: Vector3[] = [];
  const indices: number[] = [];
  const faces: { triangle: Triangle; normal: Vector3 }[] = [];
  const segments = 14;
  const height = topY - baseY;
  const phase = seed * 1.73 + 0.4;
  const shiftX = Math.cos(phase) * radius * 0.16;
  const shiftZ = Math.sin(phase) * radius * 0.16;
  const profiles = [1, 0.91, 0.69, 0.34];
  const levels = [0, 0.2, 0.63, 0.86];
  for (let ring = 0; ring < profiles.length; ring++) {
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2 + phase;
      // A shared jagged outline joins the strata into one solid mass. The upper rings lean to one side.
      const edge = 0.84 + 0.10 * variation(i + seed * 31) + 0.06 * Math.sin(angle * 3 + phase);
      const distance = radius * profiles[ring] * edge;
      const lean = ring / (profiles.length - 1);
      const rough = ring === 0 ? 0 : 0.065 * Math.sin(angle * 3 + ring * 1.8 + phase) + 0.035 * (variation(i * 3 + ring * 19 + seed * 7) - 0.5);
      vertices.push(new Vector3(x + Math.cos(angle) * distance + shiftX * lean, baseY + height * (levels[ring] + rough), z + Math.sin(angle) * distance + shiftZ * lean));
    }
  }
  const crown = vertices.length;
  vertices.push(new Vector3(x + shiftX * 1.2, topY, z + shiftZ * 1.2));
  const bottom = vertices.length;
  vertices.push(new Vector3(x, baseY, z));
  const face = (a: number, b: number, c: number, up = true) => {
    let triangle = new Triangle(vertices[a], vertices[b], vertices[c]);
    const normal = triangle.getNormal(new Vector3());
    if ((normal.y >= 0) !== up) {
      [b, c] = [c, b];
      // Triangle owns references to these shared vertices. set() copies into them and would collapse a swapped edge.
      triangle = new Triangle(vertices[a], vertices[b], vertices[c]);
      normal.negate();
    }
    indices.push(a, b, c);
    faces.push({ triangle, normal });
  };
  for (let ring = 0; ring < profiles.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const a = ring * segments + i;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + i;
      const d = (ring + 1) * segments + next;
      face(a, b, c);
      face(b, d, c);
    }
  }
  for (let i = 0; i < segments; i++) {
    face(3 * segments + i, 3 * segments + (i + 1) % segments, crown);
    face(i, (i + 1) % segments, bottom, false);
  }
  return { x, z, radius, baseY, topY, vertices, indices, faces };
}

/** Height of the visible face directly under (x, z), or null beyond the irregular outline. */
export function boulderSurfaceHeight(boulder: Boulder, x: number, z: number): number | null {
  if (Math.abs(x - boulder.x) > boulder.radius || Math.abs(z - boulder.z) > boulder.radius) return null;
  for (const { triangle: { a, b, c }, normal } of boulder.faces) {
    if (normal.y <= 0) continue;
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(denominator) < 1e-9) continue;
    const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
    const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
    if (u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8) return a.y * u + b.y * v + c.y * (1 - u - v);
  }
  return null;
}

const nearest = new Vector3();
const candidate = new Vector3();
const outward = new Vector3();
const probe = new Vector3();

function broadphase(b: Boulder, p: Vector3, margin: number): boolean {
  return Math.abs(p.x - b.x) <= b.radius + margin && Math.abs(p.z - b.z) <= b.radius + margin && p.y >= b.baseY - margin && p.y <= b.topY + margin;
}

function nearestFace(b: Boulder, p: Vector3): number {
  let distance2 = Infinity;
  for (const { triangle, normal } of b.faces) {
    triangle.closestPointToPoint(p, candidate);
    const d2 = candidate.distanceToSquared(p);
    if (d2 >= distance2) continue;
    distance2 = d2;
    nearest.copy(candidate);
    outward.copy(normal);
  }
  return Math.sqrt(distance2);
}

/** Exact surface distance for camera/seed probes, with a cheap outer bounding-box rejection. */
export function insideBoulder(b: Boulder, x: number, y: number, z: number, margin = 0): boolean {
  probe.set(x, y, z);
  if (!broadphase(b, probe, margin)) return false;
  const surface = boulderSurfaceHeight(b, x, z);
  if (surface !== null && y >= b.baseY && y < surface) return true;
  return margin > 0 && nearestFace(b, probe) < margin - 1e-8;
}

/** The ROV slides along the actual low-poly faces, including the shoulders and sloping crown. */
export function pushOutOfBoulder(p: Vector3, velocity: Vector3, b: Boulder, radius: number): void {
  if (!broadphase(b, p, radius)) return;
  // At a concave seam a push off one face can meet its neighbour. Resolve the contacts together.
  for (let pass = 0; pass < 8; pass++) {
    const surface = boulderSurfaceHeight(b, p.x, p.z);
    const inside = surface !== null && p.y >= b.baseY && p.y < surface;
    const distance = nearestFace(b, p);
    if (!inside && distance >= radius - 1e-6) return;
    if (distance > 1e-8) outward.subVectors(inside ? nearest : p, inside ? p : nearest).divideScalar(distance);
    p.copy(nearest).addScaledVector(outward, radius + 1e-5);
    const inward = velocity.dot(outward);
    if (inward < 0) velocity.addScaledVector(outward, -inward);
  }
}
