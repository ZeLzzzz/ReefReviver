import {
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { config } from "../config";
import { grassBlades, windDirection } from "./grass";

const { grass } = config.land;

/** What the grass on the land looks like (REQ-018): one instanced mesh of every blade, swaying in the wind. */
export interface GrassView {
  /** Every blade. Its bounding sphere holds them all, so the mesh is culled only when none of it is in view. */
  mesh: InstancedMesh;
  /** Advances the wind's clock by `dt` seconds (AC-4). */
  update(dt: number): void;
  /** For the tests: how many blades there are, their average colour, and the wind's clock. */
  look(): { blades: number; colour: number; time: number };
}

/**
 * The standard vertex shader's `project_vertex`, with the wind added (REQ-018 AC-4). The tip is pushed sideways in
 * proportion to the square of its height, so the root stays put, and the gusts roll across the field with the wind.
 * `transformed.y` runs from 0 at the root to 1 at the tip, since the blade is one unit tall before its instance matrix.
 */
const projectWithWind = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
float grassTip = clamp( transformed.y, 0.0, 1.0 );
#ifdef USE_INSTANCING
	vec3 grassRoot = instanceMatrix[ 3 ].xyz;
#else
	vec3 grassRoot = vec3( 0.0 );
#endif
float grassGust = 0.5 + 0.5 * sin( uTime * uSway.y - dot( grassRoot.xz, uWind ) * uSway.z );
mvPosition.xz += uWind * ( uSway.x * grassTip * grassTip * grassGust );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const matrix = new Matrix4();
const quaternion = new Quaternion();
const euler = new Euler();
const position = new Vector3();
const scale = new Vector3();

/**
 * One blade: a tapered leaf, one unit tall with its root at y = 0 and one unit across, in the x-y plane (each instance
 * scales it to its own width and height). Three triangles: the lower body, its upper half and the point.
 */
function bladeGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        -0.5, 0, 0, 0.5, 0, 0, 0.38, 0.55, 0,
        -0.5, 0, 0, 0.38, 0.55, 0, -0.38, 0.55, 0,
        -0.38, 0.55, 0, 0.38, 0.55, 0, 0, 1, 0,
      ],
      3,
    ),
  );
  geometry.computeBoundingSphere();
  return geometry;
}

/** REQ-018: the grass on the land, built from the blades laid out in grass.ts. */
export function createGrassView(): GrassView {
  const { sway } = grass;
  // The wind's clock and its settings, shared with the shader, which reads them every frame.
  const time: IUniform<number> = { value: 0 };
  const wind: IUniform<Vector2> = { value: new Vector2(windDirection.x, windDirection.z) };
  const swing: IUniform<Vector3> = { value: new Vector3(sway.amplitude, (2 * Math.PI) / sway.period, (2 * Math.PI) / sway.waveLength) };

  // Flat-shaded and double-sided, like the rest of the low-poly land. The blades are white here: the shade of each comes
  // from its instance colour.
  const material = new MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, side: DoubleSide });
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWind = wind;
    shader.uniforms.uSway = swing;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform vec3 uSway;")
      .replace("#include <project_vertex>", projectWithWind);
  };

  const mesh = new InstancedMesh(bladeGeometry(), material, grassBlades.length);
  mesh.name = "grass";

  const dark = new Color(grass.shades[0]);
  const light = new Color(grass.shades[1]);
  const shade = new Color();
  const average = new Color(0, 0, 0);
  grassBlades.forEach((blade, i) => {
    euler.set(blade.lean, blade.yaw, 0, "YXZ");
    quaternion.setFromEuler(euler);
    matrix.compose(position.set(blade.x, blade.y, blade.z), quaternion, scale.set(blade.width, blade.height, blade.width));
    mesh.setMatrixAt(i, matrix);
    shade.lerpColors(dark, light, blade.shade);
    mesh.setColorAt(i, shade);
    average.add(shade);
  });
  average.multiplyScalar(1 / Math.max(1, grassBlades.length));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // Instances spread along the whole west beach, so the sphere holds every blade; the wind moves the tips by up to
  // `amplitude` more, which the sphere allows for.
  mesh.computeBoundingSphere();
  mesh.boundingSphere!.radius += sway.amplitude;

  return {
    mesh,
    update(dt) {
      time.value += dt;
    },
    look() {
      return { blades: grassBlades.length, colour: average.getHex(), time: time.value };
    },
  };
}
