import { BackSide, Color, type IUniform, Mesh, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from "three";
import { config } from "../config";

const { sky, land } = config;

/**
 * What the sky and the sea surface share (REQ-023): the sky's colours, the sun, and one clock. The sea reflects the same
 * gradient and glints in the same sun, so the two are drawn from one set of uniforms.
 */
export interface SkyUniforms {
  [uniform: string]: IUniform;
  /** Seconds of game time; the clouds drift and the waves move by it. */
  uTime: IUniform<number>;
  /** The colour at the horizon: the haze's colour (REQ-023 AC-1). */
  uHorizon: IUniform<Color>;
  uZenith: IUniform<Color>;
  uSunDir: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  /** The exponent of the gradient's height. */
  uCurve: IUniform<number>;
}

/** The sun's unit direction above the water, which the sky's sun disc and the daylight both follow (AC-2). */
export const sunDirection = new Vector3(sky.sun.direction.x, sky.sun.direction.y, sky.sun.direction.z).normalize();
/** The light's unit direction under the water, steeper because the light bends toward the vertical going into the sea. */
export const underwaterSunDirection = new Vector3(sky.sun.underwater.x, sky.sun.underwater.y, sky.sun.underwater.z).normalize();

export function createSkyUniforms(): SkyUniforms {
  return {
    uTime: { value: 0 },
    uHorizon: { value: new Color(land.sky) },
    uZenith: { value: new Color(sky.zenith) },
    uSunDir: { value: sunDirection.clone() },
    uSunColor: { value: new Color(sky.sun.color) },
    uCurve: { value: sky.curve },
  };
}

/** The uniforms the gradient needs, and the colour of the sky in the direction `d` (a unit vector) without sun or clouds. */
export const skyGradientGlsl = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uCurve;
vec3 skyGradient( vec3 d ) {
	float t = clamp( d.y, 0.0, 1.0 );
	return mix( uHorizon, uZenith, pow( t, uCurve ) );
}
`;

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * The sky: the gradient, the sun with its glow, and clouds. The clouds are fractal noise on a plane overhead, seen in
 * perspective and drifted by the clock. The noise is smooth (quintic) so no edge is cut, a cloud's edge is a wide soft
 * step, and each octave fades out where a pixel covers more than a few of its cycles, so nothing shimmers near the
 * horizon, where the clouds fade into the haze.
 */
const fragmentShader = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec2 uCloud;
uniform vec2 uDrift;
uniform vec3 uShade;
uniform float uSunRadius;
${skyGradientGlsl}

// An integer hash: a float one (fract of a sine, say) gives a different value for the same corner once the compiler folds
// the "+ 1.0" into it, and the noise then jumps along the cell edges. p is a whole-number point.
float hash( vec2 p ) {
	uvec2 q = uvec2( ivec2( p ) ) * uvec2( 1597334673u, 3812015801u );
	uint n = ( q.x ^ q.y ) * 1597334673u;
	return float( n >> 8 ) * ( 1.0 / 16777216.0 );
}

float vnoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	float a = hash( i );
	float b = hash( i + vec2( 1.0, 0.0 ) );
	float c = hash( i + vec2( 0.0, 1.0 ) );
	float d = hash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

// Five octaves; an octave whose cycle is shorter than a few pixels (width = the uv change across one pixel) is faded out.
float cloudNoise( vec2 p, float width ) {
	float sum = 0.0;
	float norm = 0.0;
	float amp = 0.5;
	float freq = 1.0;
	for ( int i = 0; i < 5; i ++ ) {
		float keep = 1.0 - smoothstep( 0.12, 0.4, width * freq );
		sum += amp * keep * vnoise( p * freq );
		norm += amp * keep;
		amp *= 0.5;
		freq *= 2.03;
		p += vec2( 17.3, 9.1 );
	}
	return sum / max( norm, 0.0001 );
}

void main() {
	vec3 d = normalize( vDir );
	vec3 col = skyGradient( d );

	// The sun: a bright disc with a soft edge, and a glow around it.
	float sunSide = dot( d, uSunDir );
	float angle = length( cross( d, uSunDir ) );
	float gate = step( 0.0, sunSide );
	float glow = ( 0.55 * exp( - angle * 16.0 ) + 0.22 * exp( - angle * 4.5 ) ) * gate;
	col += uSunColor * glow;

	// Clouds on a plane overhead, drifting.
	float up = max( d.y, 0.0 );
	vec2 uv = d.xz / ( up + 0.12 ) * uCloud.x + uDrift * uTime;
	float width = max( fwidth( uv.x ), fwidth( uv.y ) );
	float fade = smoothstep( 0.02, 0.24, up );
	float n = cloudNoise( uv, width );
	float density = smoothstep( uCloud.y, uCloud.y + 0.28, n ) * fade;
	if ( density > 0.001 ) {
		// The side toward the sun is brighter, and the thick middle is shaded.
		float toward = cloudNoise( uv + normalize( uSunDir.xz + 0.0001 ) * 0.09, width );
		float lit = clamp( 0.72 + ( n - toward ) * 3.2 - ( density - 0.5 ) * 0.5, 0.0, 1.0 );
		vec3 cloud = mix( uShade, vec3( 1.0 ), lit );
		cloud += uSunColor * 0.35 * pow( max( sunSide, 0.0 ), 6.0 ) * ( 1.0 - density * 0.5 );
		// Far clouds take on the haze.
		cloud = mix( uHorizon, cloud, 0.55 + 0.45 * smoothstep( 0.0, 0.45, up ) );
		col = mix( col, cloud, clamp( density, 0.0, 0.96 ) );
	}

	// The disc is on top of the clouds' thin edge only; thick cloud hides it.
	float disc = ( 1.0 - smoothstep( uSunRadius * 0.82, uSunRadius, angle ) ) * gate;
	col = mix( col, vec3( 1.0, 0.98, 0.9 ) * 1.4, disc * ( 1.0 - density * 0.9 ) );

	gl_FragColor = vec4( col, 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** The sky dome (REQ-023): drawn only above the water, and never in the cave, which is under the water. */
export interface SkyView {
  mesh: Mesh;
  /** The dome follows `around` (the camera) so it is always the same distance away. */
  update(around: Vector3): void;
  setVisible(visible: boolean): void;
  /** For the tests: whether it is drawn, the sun's direction, and the clock. */
  look(): { visible: boolean; sun: [number, number, number]; time: number; horizon: number; zenith: number };
}

export function createSky(uniforms: SkyUniforms): SkyView {
  const { clouds } = sky;
  const material = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uCloud: { value: new Vector2(clouds.scale, 1 - clouds.cover) },
      uDrift: { value: new Vector2(clouds.drift.x, clouds.drift.z) },
      uShade: { value: new Color(clouds.shade) },
      uSunRadius: { value: Math.sin(sky.sun.radius) },
    },
    vertexShader,
    fragmentShader,
    side: BackSide,
    fog: false,
    // Drawn after the solid scene, only where nothing is in front of it, so what is hidden by the land costs nothing.
    depthWrite: false,
    depthTest: true,
  });
  // The dome sits just inside the camera's far plane, so the whole of it is drawn.
  const radius = config.camera.far * sky.domeShare;
  const mesh = new Mesh(new SphereGeometry(radius, 48, 24), material);
  mesh.name = "sky";
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    update(around) {
      mesh.position.copy(around);
    },
    setVisible(visible) {
      mesh.visible = visible;
    },
    look() {
      const { uSunDir, uTime, uHorizon, uZenith } = uniforms;
      return {
        visible: mesh.visible,
        sun: uSunDir.value.toArray() as [number, number, number],
        time: uTime.value,
        horizon: uHorizon.value.getHex(),
        zenith: uZenith.value.getHex(),
      };
    },
  };
}
