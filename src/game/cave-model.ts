import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SpotLight,
  Object3D,
} from "three";
import { config } from "../config";
import { bendAt, halfWidthAt, heightAt, massifRise, reachX, reachZ, roofAbove, smooth } from "./cave-shape";
import { caveInfo } from "./cave";
import { floorHeight } from "./terrain";

const { cave } = config.bay;

/** Where the massif's outer rock stands less than this far above the floor it is not drawn (no sliver on the ground). */
const MIN_RISE = 0.15;
/** The grid of the massif's outside, and the rings of the tunnel's inside, in metres. */
const OUTER_STEP = 1.5;
const RING_STEP = 1.25;
/** Points across the tunnel's arch, from one wall's foot over the roof to the other's. */
const ARCH_POINTS = 12;

/** A repeatable number in -1..1 for a point. */
function hash(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

const rockHigh = new Color(0x756f62);
const rockLow = new Color(0x4f5148);
const inner = new Color(0x3d444d);
const innerDeep = new Color(0x2a3037);

/** Builds a flat-shaded mesh from corner positions (3 per triangle) and one colour per corner. */
function buildMesh(positions: number[], colours: number[], name: string, material: MeshStandardMaterial): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/**
 * How far the tunnel's roof stands above the hill's top at (x, z): 0 or more where a mouth is open, with no rock over the
 * tunnel's air; below 0 under rock. The rim of each mouth is where it is 0.
 */
function openness(x: number, z: number): number {
  const a = x - cave.x;
  return roofAbove(a, z - cave.z - bendAt(a)) - (massifRise(x, z) - 0.05);
}

/**
 * The hill's outside and the tunnel's walls are cut this far into a mouth (in `openness`, metres of roof over the hill),
 * so the two overlap a little along the rim instead of leaving slits between their cuts.
 */
const RIM_OVERLAP = 0.45;

interface Corner {
  x: number;
  y: number;
  z: number;
  /** `openness` here: the corner is in a mouth from 0 on. */
  f: number;
}

/** The point on the edge from `p` to `q` where it crosses a mouth's rim, found on the rim itself (not by a straight guess). */
function rimPoint(p: Corner, q: Corner): Corner {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 10; i++) {
    const t = (low + high) / 2;
    const inMouth = openness(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t) >= RIM_OVERLAP;
    if (inMouth === p.f >= RIM_OVERLAP) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t, f: RIM_OVERLAP };
}

/**
 * The part of a triangle that is rock, cut along the rim of the mouths: the whole triangle, nothing, or one or two
 * triangles ending on the rim. So neither the hill's outside nor the tunnel's walls reach into a mouth's opening, and the
 * two meet along the rim with no gap.
 */
function rockPart<T extends Corner>(triangle: readonly T[], make: (corner: Corner) => T): T[][] {
  const rock = (p: Corner) => p.f < RIM_OVERLAP;
  if (triangle.every(rock)) return [[...triangle]];
  if (!triangle.some(rock)) return [];
  const polygon: T[] = [];
  for (let i = 0; i < 3; i++) {
    const p = triangle[i];
    const q = triangle[(i + 1) % 3];
    if (rock(p)) polygon.push(p);
    if (rock(p) !== rock(q)) polygon.push(make(rimPoint(p, q)));
  }
  const parts: T[][] = [];
  for (let k = 1; k + 1 < polygon.length; k++) parts.push([polygon[0], polygon[k], polygon[k + 1]]);
  return parts;
}

/** A corner of the hill's outside at (x, z): on its top, or at `y` when given (a point cut on a mouth's rim). */
function hillCorner(x: number, z: number, y?: number): Corner & { rise: number } {
  const rise = massifRise(x, z);
  // Toward the foot of the mound the surface sinks under the floor, so it meets the ground along a ragged line.
  const sunk = 0.3 * (1 - smooth(0, 0.5, rise));
  return { x, z, rise, f: openness(x, z), y: y ?? floorHeight(x, z) + rise - sunk };
}

/** The massif seen from outside: the rock hill the tunnel goes through, standing on the sea floor. */
export function buildMassifOutside(): Mesh {
  const columns = Math.ceil((reachX * 2) / OUTER_STEP);
  const rows = Math.ceil((reachZ * 2) / OUTER_STEP);
  const x0 = cave.x - reachX;
  const z0 = cave.z - reachZ;
  const point = (i: number, j: number) => {
    const x = x0 + i * OUTER_STEP;
    const z = z0 + j * OUTER_STEP;
    return hillCorner(x, z);
  };
  const grid: ReturnType<typeof point>[][] = [];
  for (let i = 0; i <= columns; i++) {
    grid.push([]);
    for (let j = 0; j <= rows; j++) grid[i].push(point(i, j));
  }
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new Color();
  const corner = (p: ReturnType<typeof point>) => {
    positions.push(p.x, p.y, p.z);
    // Lighter toward the crown, darker at the foot, with some grain.
    colour.copy(rockLow).lerp(rockHigh, Math.min(1, p.rise / cave.rise)).multiplyScalar(1 + 0.12 * hash(p.x, p.y, p.z));
    colours.push(colour.r, colour.g, colour.b);
  };
  for (let i = 0; i < columns; i++) {
    for (let j = 0; j < rows; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      // Both ways of cutting the square into two triangles look the same; alternate them for a less regular surface.
      const triangles = (i + j) % 2 === 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
      for (const triangle of triangles) {
        if (triangle.every((p) => p.rise < MIN_RISE || p.f >= RIM_OVERLAP)) continue;
        // Where the tunnel opens there is no rock over its air: the hill's outside stops at the mouth's rim.
        for (const part of rockPart(triangle, (c) => hillCorner(c.x, c.z, c.y))) for (const p of part) corner(p);
      }
    }
  }
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: DoubleSide });
  return buildMesh(positions, colours, "cave-massif", material);
}

/**
 * The tunnel's inside: the walls and roof, rings of points along the centre line across the arch, each at the height
 * the collision says (never above the massif's own top, where the tunnel meets the outside at the mouths).
 */
export function buildTunnelInside(): Mesh {
  type Spot = Corner;
  const rings: Spot[][] = [];
  const from = caveInfo.mouths[0].x - cave.x - 4;
  const to = caveInfo.mouths[1].x - cave.x + 4;
  for (let a = from; a <= to + 1e-6; a += RING_STEP) {
    const centreZ = cave.z + bendAt(a);
    const half = halfWidthAt(a);
    const ring: Spot[] = [];
    for (let k = 0; k <= ARCH_POINTS; k++) {
      const u = half * Math.cos((k / ARCH_POINTS) * Math.PI);
      const x = cave.x + a;
      const z = centreZ + u;
      const floor = floorHeight(x, z);
      const roof = roofAbove(a, u);
      const top = massifRise(x, z) - 0.04;
      // The walls' feet go a little under the floor, so there is no gap or seam along it.
      const up = k === 0 || k === ARCH_POINTS ? -0.3 : Math.min(roof, top);
      // Rock wherever the hill stands over the arch; in a mouth's opening, nothing (cut along the rim below).
      ring.push({ x, y: floor + up, z, f: openness(x, z) });
    }
    rings.push(ring);
  }
  const positions: number[] = [];
  const colours: number[] = [];
  const colour = new Color();
  const corner = (p: Spot) => {
    positions.push(p.x, p.y, p.z);
    colour.copy(innerDeep).lerp(inner, 0.5 + 0.5 * hash(p.x * 0.7, p.y, p.z * 0.7)).multiplyScalar(1 + 0.1 * hash(p.x, p.y, p.z));
    colours.push(colour.r, colour.g, colour.b);
  };
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let k = 0; k < ARCH_POINTS; k++) {
      const a = rings[r][k];
      const b = rings[r + 1][k];
      const c = rings[r + 1][k + 1];
      const d = rings[r][k + 1];
      // Open to the water (no rock over it) is the mouth, not wall: the walls and roof stop at its rim.
      for (const triangle of (r + k) % 2 === 0 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]]) {
        for (const part of rockPart(triangle, (c) => c)) for (const p of part) corner(p);
      }
    }
  }
  const material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: DoubleSide });
  return buildMesh(positions, colours, "cave-inside", material);
}

/** A bell across, bright in the middle and gone at both edges, as a texture: the cross-section of a light shaft. */
function bellTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 4;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 64, 0);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const bell = Math.exp(-((t - 0.5) ** 2) / 0.045);
    const level = Math.round(255 * bell);
    gradient.addColorStop(t, `rgb(${level},${level},${level})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 4);
  return new CanvasTexture(canvas);
}

/**
 * The light shaft through the hole in the roof: three soft sheets crossing on its axis, each a bell across and
 * narrow at the hole, wide at the floor, brightest at the hole and fading toward the floor. Seen from any side the
 * sheets overlap into one soft beam.
 */
function buildShaft(): Group {
  const { hole } = caveInfo;
  const floor = floorHeight(hole.x, hole.z);
  const map = bellTexture();
  const group = new Group();
  group.name = "cave-shaft";
  const top = hole.under;
  const half = [hole.radius * 1.6, 3.4];
  const positions = [-half[0], top, 0, half[0], top, 0, -half[1], floor, 0, half[1], floor, 0];
  const shade = [1, 1, 0.2, 0.2];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
  geometry.setAttribute("color", new Float32BufferAttribute(shade.flatMap((v) => [v, v, v]), 3));
  geometry.setIndex([0, 2, 1, 1, 2, 3]);
  const material = new MeshBasicMaterial({
    color: cave.shaft.color,
    map,
    vertexColors: true,
    transparent: true,
    opacity: 0.42,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  for (let i = 0; i < 3; i++) {
    const sheet = new Mesh(geometry, material);
    sheet.position.set(hole.x, 0, hole.z);
    sheet.rotation.y = (i * Math.PI) / 3 + 0.3;
    sheet.renderOrder = 2;
    group.add(sheet);
  }
  return group;
}

/** A soft white-blue glow, bright in the middle and gone at the edge, as a texture. */
function glowTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/**
 * The daylight seen through a mouth from inside the tunnel: a soft glow across the opening, facing into the tunnel,
 * so it shows from inside only. (The water is darkened all over while the camera is in the cave; this is the way
 * out showing bright.)
 */
function buildMouthGlows(): Mesh[] {
  const map = glowTexture();
  return caveInfo.mouths.map((mouth, index) => {
    const a = mouth.x - cave.x;
    const geometry = new PlaneGeometry(halfWidthAt(a) * 2.6, heightAt(a) * 1.6);
    geometry.rotateY(index === 0 ? Math.PI / 2 : -Math.PI / 2);
    const material = new MeshBasicMaterial({
      color: cave.mouthGlow,
      map,
      transparent: true,
      opacity: 0.8,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glow = new Mesh(geometry, material);
    glow.position.set(mouth.x, floorHeight(mouth.x, mouth.z) + heightAt(a) * 0.45, mouth.z);
    glow.name = "cave-mouth-glow";
    glow.renderOrder = 3;
    return glow;
  });
}

export interface CaveView {
  group: Group;
  /** The spot light of the shaft. */
  light: SpotLight;
  /** Lets the shaft shimmer a little; `time` in seconds. */
  update(time: number): void;
}

/** The cave's rock, its roof hole with the light shaft through it, and the light that falls on the floor. */
export function createCaveView(): CaveView {
  const group = new Group();
  group.name = "cave";
  group.add(buildMassifOutside(), buildTunnelInside(), ...buildMouthGlows());

  const { hole } = caveInfo;
  const floor = floorHeight(hole.x, hole.z);
  // The hole: a bright disc just under the roof, where the light comes in.
  const glowGeometry = new CircleGeometry(hole.radius, 9);
  glowGeometry.rotateX(Math.PI / 2);
  const glow = new Mesh(glowGeometry, new MeshBasicMaterial({ color: cave.shaft.glow, fog: false, side: DoubleSide }));
  glow.position.set(hole.x, hole.under - 0.04, hole.z);
  glow.name = "cave-hole";
  group.add(glow);
  // A soft halo around it, as the hole glares from below.
  const haloGeometry = new CircleGeometry(hole.radius * 6, 20);
  haloGeometry.rotateX(Math.PI / 2);
  const halo = new Mesh(
    haloGeometry,
    new MeshBasicMaterial({ color: cave.shaft.color, map: glowTexture(), transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide }),
  );
  halo.position.set(hole.x, hole.under - 0.06, hole.z);
  group.add(halo);

  const shaft = buildShaft();
  group.add(shaft);

  const light = new SpotLight(cave.shaft.color, cave.shaft.intensity, cave.shaft.reach, cave.shaft.angle, 0.6, 1.5);
  light.position.set(hole.x, hole.under, hole.z);
  const target = new Object3D();
  target.position.set(hole.x, floor, hole.z);
  light.target = target;
  light.name = "cave-shaft-light";
  group.add(light, target);

  return {
    group,
    light,
    update(time) {
      const shimmer = 1 + 0.06 * Math.sin(time * 1.7) + 0.04 * Math.sin(time * 3.1 + 1);
      light.intensity = cave.shaft.intensity * shimmer;
      shaft.scale.set(1 + 0.03 * Math.sin(time * 0.9), 1, 1 + 0.03 * Math.cos(time * 1.1));
    },
  };
}
