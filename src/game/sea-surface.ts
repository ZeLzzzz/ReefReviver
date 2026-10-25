import { Vector4, type IUniform, type MeshBasicMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { config } from "../config";
import { skyGradientGlsl, type SkyUniforms } from "./sky";

const { sea } = config;

/** The sea surface's own uniforms (REQ-023). */
export interface SeaUniforms {
  /** One wave each: x and y the direction it travels, z the wave number, w the steepest slope. */
  uWaves: IUniform<Vector4[]>;
  /** The speed of each wave in radians per second. */
  uOmega: IUniform<number[]>;
  /** How much of the sky the water mirrors (and of the sun's glint): 0.5 when murky, 1 when clear. */
  uMirror: IUniform<number>;
  /** The sea level, to tell whether the camera is above or below the surface. */
  uLevel: IUniform<number>;
}

export function createSeaUniforms(level: number): SeaUniforms {
  return {
    uWaves: {
      value: sea.waves.map((w) => new Vector4(Math.cos(w.angle), Math.sin(w.angle), (2 * Math.PI) / w.length, w.slope)),
    },
    uOmega: { value: sea.waves.map((w) => ((2 * Math.PI) / w.length) * w.speed) },
    uMirror: { value: sea.reflection.murky },
    uLevel: { value: level },
  };
}

/** How much the water mirrors at `clarity` (0 murky, 1 clear): it blends with the Bloom like the water's own colour. */
export function mirrorAt(clarity: number): number {
  const t = Math.min(1, Math.max(0, clarity));
  return sea.reflection.murky + (sea.reflection.clear - sea.reflection.murky) * t;
}

const WAVES = sea.waves.length;

const vertexPars = /* glsl */ `
varying vec3 vSeaPos;
`;

const vertexWorld = /* glsl */ `
vSeaPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

/**
 * The surface's fragment shader, added to the basic material's (REQ-023). The material's colour and opacity stay what the
 * game sets by the Bloom (murky, then clear); this adds, per pixel:
 *   above the water: gentle waves (the slope of a few moving sines, each faded out where a pixel is wider than it can show),
 *     the sky mirrored by Fresnel's law, and the sun's glint, wider where the waves are too fine to see;
 *   below the water: ripples of light, and a brighter window straight up.
 * Fog is applied after, so the sea fades into the haze at the horizon and into the murk under the water.
 */
const fragmentPars = /* glsl */ `
varying vec3 vSeaPos;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec4 uWaves[ ${WAVES} ];
uniform float uOmega[ ${WAVES} ];
uniform float uMirror;
uniform float uLevel;
uniform vec4 uTune;
${skyGradientGlsl}
`;

const fragmentShading = /* glsl */ `
{
	vec3 toEye = cameraPosition - vSeaPos;
	float dist = length( toEye );
	vec3 V = toEye / max( dist, 0.0001 );
	vec2 footprint = fwidth( vSeaPos.xz );
	float pixel = max( footprint.x, footprint.y );
	if ( cameraPosition.y > uLevel ) {
		// Above: the slope of the waves, and the part of the slope too fine to see, which only widens the glint.
		vec2 slope = vec2( 0.0 );
		float hidden = 0.0;
		for ( int i = 0; i < ${WAVES}; i ++ ) {
			vec4 w = uWaves[ i ];
			float wl = 6.2831853 / w.z;
			float seen = 1.0 - smoothstep( wl * 0.1, wl * 0.45, pixel );
			float phase = w.z * dot( w.xy, vSeaPos.xz ) - uOmega[ i ] * uTime;
			slope += w.xy * ( w.w * seen * cos( phase ) );
			hidden += w.w * w.w * 0.5 * ( 1.0 - seen * seen );
		}
		vec3 N = normalize( vec3( - slope.x, 1.0, - slope.y ) );
		float cosView = clamp( dot( N, V ), 0.0, 1.0 );
		float fresnel = 0.03 + 0.97 * pow( 1.0 - cosView, 5.0 );
		vec3 R = reflect( - V, N );
		R.y = abs( R.y );
		vec3 mirrored = skyGradient( normalize( R ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, mirrored, clamp( fresnel * uMirror * 1.15, 0.0, 1.0 ) );
		diffuseColor.a = mix( diffuseColor.a, 1.0, fresnel * uMirror );
		// The sun's glint: how close the half vector is to the normal, in slopes (a Gaussian of that slope).
		vec3 H = normalize( uSunDir + V );
		float c = clamp( dot( N, H ), 0.0001, 1.0 );
		float tan2 = ( 1.0 - c * c ) / ( c * c );
		float base = uTune.x;
		float spread2 = base * base + hidden;
		float glint = exp( - tan2 / ( 2.0 * spread2 ) ) * ( base * base / spread2 );
		float lit = smoothstep( 0.0, 0.08, uSunDir.y ) * smoothstep( 0.0, 0.05, V.y + 0.02 );
		diffuseColor.rgb += uSunColor * ( glint * uTune.y * uMirror * lit );
		diffuseColor.a = clamp( diffuseColor.a + glint * 0.5 * uMirror, 0.0, 1.0 );
	} else {
		// Below: bright ridges where the moving waves focus the light, finer ones fading with distance.
		vec2 p = vSeaPos.xz * uTune.w;
		float t = uTime * 0.45;
		float a = sin( p.x + sin( p.y * 1.3 + t ) * 1.4 + t );
		float b = sin( p.y * 1.1 + sin( p.x * 0.9 - t * 1.1 ) * 1.4 - t * 0.8 );
		float c2 = sin( ( p.x + p.y ) * 0.8 + sin( ( p.x - p.y ) * 1.2 + t * 1.3 ) * 1.2 );
		float ridge = pow( 1.0 - abs( a * b ), 4.0 ) * 0.6 + pow( 1.0 - abs( b * c2 ), 6.0 ) * 0.4;
		float seen = 1.0 - smoothstep( 0.3, 1.2, pixel * uTune.w );
		float ripple = ridge * seen;
		// Straight up the light comes in through a window; further round, the surface mirrors the dark.
		float window = smoothstep( 0.55, 0.85, - V.y );
		diffuseColor.rgb += uHorizon * ( ripple * uTune.z * ( 0.35 + 0.65 * window ) + window * 0.18 );
		diffuseColor.a = clamp( diffuseColor.a + ripple * 0.3 + window * 0.12, 0.0, 1.0 );
	}
}
`;

/**
 * Adds the waves, the mirrored sky and the glint (above) and the ripples (below) to the surface's basic material
 * (REQ-023). Pure string work, so a unit test can check it; `apply` hands it the shared uniforms.
 */
export function patchSeaShader(shader: Pick<WebGLProgramParametersWithUniforms, "vertexShader" | "fragmentShader">): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${vertexPars}`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${vertexWorld}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${fragmentPars}`)
    .replace("#include <color_fragment>", `#include <color_fragment>\n${fragmentShading}`);
}

/**
 * Gives the surface's material the sea shader. The material keeps its colour and opacity, which follow the Bloom; the
 * waves come from the world position of each pixel, not from the plane's vertices, so any plane will do.
 */
export function shadeSea(material: MeshBasicMaterial, sky: SkyUniforms, uniforms: SeaUniforms): void {
  // The glint's spread and brightness (above), the ripples' brightness (below) and their frequency (per metre).
  const tune: IUniform<Vector4> = { value: new Vector4(sea.glint.spread, sea.glint.intensity, sea.ripples.brightness, 1 / sea.ripples.size) };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sky, uniforms, { uTune: tune });
    patchSeaShader(shader);
  };
  material.customProgramCacheKey = () => "sea-surface";
}
