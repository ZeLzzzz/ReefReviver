import {
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { config } from "../config";
import { floorHeight } from "./bay";
import { smoothstep } from "./bloom";
import { currentDirection, meadowWeight, type Meadow } from "./seagrass";

const { meadows: setup } = config.nature;

/** What the seagrass shows (REQ-019): leaves on the shallow sand, the sand tint under them, swaying in the current. */
export interface SeagrassView {
  group: Group;
  /** 0 is the murky bay, 1 the clear water after the Bloom (REQ-013 AC-8): sets the colours, how many leaves show and how tall. */
  setBloom(clarity: number): void;
  /** Advances the current's clock by `dt` seconds (AC-2). */
  update(dt: number): void;
  /** For the tests: the leaf colour, how many leaves show and exist, the sand tint's colour and opacity, and the clock. */
  look(): { seagrass: number; bladesShown: number; blades: number; sand: number; sandOpacity: number; time: number };
}

/**
 * Inserted after the standard `begin_vertex`: a leaf that is not shown yet (its order is above the share that shows)
 * collapses to nothing, one that has just come in grows out of the floor, and the rest are `uGrowth.y` of their height.
 * `position.y` runs from 0 at the root to 1 at the tip, since the leaf is one unit tall before its instance matrix.
 */
const growLeaf = /* glsl */ `
#include <begin_vertex>
float seaTip = clamp( position.y, 0.0, 1.0 );
float seaShown = smoothstep( aOrder, mix( aOrder, 1.0, 0.08 ), uGrowth.x );
transformed *= vec3( seaShown, seaShown * uGrowth.y, seaShown * uGrowth.y );
`;

/**
 * The standard `project_vertex` with the current added (AC-2): the tip is pushed along the current in proportion to the
 * square of its height and to the leaf's length, so the root stays put, with a slow swell travelling along the current
 * and a smaller sideways sway of its own. Everything is smooth in time, so nothing flickers.
 */
const projectWithCurrent = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	vec3 seaRoot = instanceMatrix[ 3 ].xyz;
	float seaLength = length( instanceMatrix[ 1 ].xyz ) * uGrowth.y;
#else
	vec3 seaRoot = vec3( 0.0 );
	float seaLength = uGrowth.y;
#endif
float seaSwell = 0.55 + 0.45 * sin( uTime * uSway.y - dot( seaRoot.xz, uCurrent ) * uSway.z );
float seaSide = 0.35 * sin( uTime * uSway.y * 0.7 + seaRoot.x * 0.9 + seaRoot.z * 1.3 );
vec2 seaPush = uCurrent * seaSwell + vec2( -uCurrent.y, uCurrent.x ) * seaSide;
mvPosition.xz += seaPush * ( uSway.x * seaLength * seaTip * seaTip );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * One leaf: a flat ribbon one unit tall with its root at y = 0, one unit across in the x-y plane, a little narrower at
 * the root, widest in the middle and cut off blunt at the tip (AC-2), curving over toward +z. Each instance scales it
 * to its own width and height. The vertex colours darken the root, which gives the carpet some depth.
 */
function leafGeometry(): BufferGeometry {
  const rows: [number, number, number][] = [
    [0, 0.42, 0.62],
    [0.4, 0.5, 0.85],
    [0.8, 0.47, 1],
    [1, 0.3, 1],
  ];
  const positions: number[] = [];
  const colours: number[] = [];
  const index: number[] = [];
  rows.forEach(([y, half, shade], i) => {
    const bend = 0.22 * y * y;
    positions.push(-half, y, bend, half, y, bend);
    colours.push(shade, shade, shade, shade, shade, shade);
    if (i > 0) {
      const a = (i - 1) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * The sand under the meadows (AC-2): a skin that follows the floor a hand above it, in the colour of green-brown
 * sand, opaque where the seagrass is thick and fading to nothing at its edge, never where it does not grow. One mesh
 * for all the meadows.
 */
function sandGeometry(meadows: readonly Meadow[]): BufferGeometry | null {
  const step = 1;
  const positions: number[] = [];
  const colours: number[] = [];
  const index: number[] = [];
  for (const meadow of meadows) {
    const reach = Math.ceil((meadow.radius * 1.3) / step) * step;
    const n = (2 * reach) / step + 1;
    const weights: number[] = [];
    const first = positions.length / 3;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = meadow.x - reach + i * step;
        const z = meadow.z - reach + j * step;
        weights.push(meadowWeight(meadow, x, z));
        positions.push(x, floorHeight(x, z) + 0.05, z);
        colours.push(1, 1, 1, weights[weights.length - 1]);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const a = i * n + j;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        if (weights[a] + weights[b] + weights[c] + weights[d] <= 0) continue;
        index.push(first + a, first + b, first + c, first + b, first + d, first + c);
      }
    }
  }
  if (index.length === 0) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const scale = new Vector3();

/** REQ-019: the natural seagrass meadows, built from the leaves laid out in seagrass.ts. */
export function createSeagrassView(meadows: readonly Meadow[]): SeagrassView {
  const group = new Group();
  group.name = "seagrass";
  const blades = meadows.flatMap((meadow) => meadow.blades);
  const { sway } = setup;

  // The current's clock and settings, shared with the shader, which reads them every frame.
  const time: IUniform<number> = { value: 0 };
  const current: IUniform<Vector2> = { value: new Vector2(currentDirection.x, currentDirection.z) };
  const swing: IUniform<Vector3> = { value: new Vector3(sway.amplitude, (2 * Math.PI) / sway.period, (2 * Math.PI) / sway.waveLength) };
  // x: the share of the leaves that show (those with a lower order), y: how tall they are, as a fraction of their full height.
  const growth: IUniform<Vector2> = { value: new Vector2(1, 1) };

  // The leaves: every one an instance of a single mesh. The colour is the same for all of them, as the Bloom turns it
  // from brown to green; each leaf's own shade is its instance colour.
  const material = new MeshStandardMaterial({ color: setup.brown, flatShading: true, roughness: 0.9, side: DoubleSide, vertexColors: true });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uCurrent = current;
    shader.uniforms.uSway = swing;
    shader.uniforms.uGrowth = growth;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aOrder;\nuniform float uTime;\nuniform vec2 uCurrent;\nuniform vec3 uSway;\nuniform vec2 uGrowth;")
      .replace("#include <begin_vertex>", growLeaf)
      .replace("#include <project_vertex>", projectWithCurrent);
  };
  const mesh = new InstancedMesh(leafGeometry(), material, Math.max(1, blades.length));
  mesh.name = "meadows";
  const order = new Float32Array(mesh.count);
  const shade = new Color();
  blades.forEach((blade, i) => {
    euler.set(blade.lean, blade.yaw, 0, "YXZ");
    quaternion.setFromEuler(euler);
    // The ribbon curves over toward +z by a fraction of its height, so it is scaled alike in y and z.
    matrix.compose(position.set(blade.x, blade.y, blade.z), quaternion, scale.set(blade.width, blade.height, blade.height));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, shade.setScalar(blade.shade));
    order[i] = blade.order;
  });
  if (blades.length === 0) mesh.setColorAt(0, shade.setScalar(1));
  mesh.geometry.setAttribute("aOrder", new InstancedBufferAttribute(order, 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // The instances lie along the whole shore, so the sphere holds them all (it is culled only when none is in view); the
  // current moves the tips by up to `amplitude` of a leaf's length, which the extra metre allows for.
  mesh.computeBoundingSphere();
  mesh.boundingSphere!.radius += 1;
  group.add(mesh);

  // The sand tint under the meadows.
  const sandMaterial = new MeshStandardMaterial({
    color: setup.sand.brown,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const sandShape = sandGeometry(meadows);
  if (sandShape) {
    const sand = new Mesh(sandShape, sandMaterial);
    sand.name = "meadow-sand";
    group.add(sand);
  }

  let bladesShown = 0;
  const brown = new Color(setup.brown);
  const green = new Color(setup.green);
  const sandBrown = new Color(setup.sand.brown);
  const sandGreen = new Color(setup.sand.green);
  const setBloom = (clarity: number) => {
    const c = smoothstep(clarity);
    const show = setup.sparse + (1 - setup.sparse) * c;
    growth.value.set(show, 0.45 + 0.55 * c);
    bladesShown = blades.reduce((count, blade) => count + (blade.order < show ? 1 : 0), 0);
    material.color.copy(brown).lerp(green, c);
    sandMaterial.color.copy(sandBrown).lerp(sandGreen, c);
    sandMaterial.opacity = setup.sand.opacityBefore + (setup.sand.opacityAfter - setup.sand.opacityBefore) * c;
  };
  setBloom(0);

  return {
    group,
    setBloom,
    update(dt) {
      time.value += dt;
    },
    look() {
      return { seagrass: material.color.getHex(), bladesShown, blades: blades.length, sand: sandMaterial.color.getHex(), sandOpacity: sandMaterial.opacity, time: time.value };
    },
  };
}
