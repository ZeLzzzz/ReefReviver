import {
  BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, Sphere, Vector3, Vector4,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { config } from "../config";
import { beachSurface } from "./beach";
import { inland } from "./terrain";
import { shadeSea, type SeaUniforms } from "./sea-surface";
import type { SkyUniforms } from "./sky";

const { surf } = config.sea;

const waveFunctions = /* glsl */ `
uniform vec4 uSurf;
uniform vec3 uSurfArea;
float surfPhase( vec2 q ) {
  return q.x * uSurf.y + uTime * uSurf.z + 0.5 * sin( q.y * 0.11 ) + 0.2 * sin( q.y * 0.29 + uTime * 0.21 );
}
float surfExtent( vec2 q ) {
  float ends = 1.0 - smoothstep( uSurfArea.y - uSurfArea.z, uSurfArea.y, abs( q.y ) );
  float offshore = 1.0 - smoothstep( uSurfArea.x - 3.0, uSurfArea.x, q.x );
  return ends * offshore * smoothstep( -uSurf.w, -uSurf.w + 0.3, q.x );
}
float surfHeight( vec2 q ) {
  float crest = pow( 0.5 + 0.5 * cos( surfPhase( q ) ), 3.0 );
  float shoal = 0.65 + 0.35 * ( 1.0 - smoothstep( 2.0, 7.0, q.x ) );
  return uSurf.x * crest * shoal * surfExtent( q ) * ( 0.82 + 0.18 * sin( q.y * 0.08 + uTime * 0.32 ) );
}
`;

const foamFunctions = /* glsl */ `
uniform vec3 uFoamColor;
varying vec2 vSurfCoord;
varying float vSurfGround;
${waveFunctions}
float surfHash( vec2 p ) {
  uvec2 q = uvec2( ivec2( p ) ) * uvec2( 1597334673u, 3812015801u );
  uint n = ( q.x ^ q.y ) * 1597334673u;
  return float( n >> 8 ) * ( 1.0 / 16777216.0 );
}
float surfNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( surfHash( i ), surfHash( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( surfHash( i + vec2( 0.0, 1.0 ) ), surfHash( i + vec2( 1.0 ) ), f.x ), f.y );
}
vec2 surfSlope( vec2 q ) {
  float dx = ( surfHeight( q + vec2( 0.04, 0.0 ) ) - surfHeight( q - vec2( 0.04, 0.0 ) ) ) / 0.08;
  float dz = ( surfHeight( q + vec2( 0.0, 0.04 ) ) - surfHeight( q - vec2( 0.0, 0.04 ) ) ) / 0.08;
  // q.x follows the curved waterline, so convert its derivative back to world coordinates.
  float shoreTurn = ${config.bay.shore.wiggle.toFixed(4)} * 0.031 * cos( q.y * 0.031 + 0.6 ) + 0.14 * cos( q.y * 0.07 );
  return vec2( dx, dz - dx * shoreTurn );
}
`;

const foamShading = /* glsl */ `
{
  float phase = surfPhase( vSurfCoord );
  float crest = pow( 0.5 + 0.5 * cos( phase ), 3.0 );
  float height = surfHeight( vSurfCoord );
  float wet = 1.0 - smoothstep( height - 0.025, height + 0.05, vSurfGround - uLevel );
  float coverage = surfExtent( vSurfCoord ) * wet;
  if ( coverage < 0.003 ) discard;
  float pockets = surfNoise( vec2( vSurfCoord.x * 4.0 - vSurfCoord.y * 0.15, vSurfCoord.y * 3.0 ) + vec2( uTime * 0.28, -uTime * 0.1 ) );
  float front = smoothstep( 0.62, 0.92, crest * 0.92 + pockets * 0.23 );
  float wash = pow( 0.5 + 0.5 * cos( phase - 0.55 ), 3.0 ) * ( 1.0 - crest ) * 0.28;
  float breaking = 1.0 - smoothstep( 2.0, 5.5, vSurfCoord.x );
  float foam = ( front * 0.9 + wash * smoothstep( 0.35, 0.68, pockets ) ) * breaking;
  foam *= 0.55 + 0.45 * surfNoise( vec2( vSurfCoord.y * 0.35, vSurfCoord.x * 1.2 - uTime * 0.12 ) );
  float pixel = max( fwidth( vSurfCoord.x ), fwidth( vSurfCoord.y ) );
  float detail = 1.0 - smoothstep( 0.03, 0.12, pixel );
  float bubbles = surfNoise( vSurfCoord * vec2( 14.0, 12.0 ) + vec2( -uTime * 0.25, uTime * 0.1 ) );
  foam *= mix( 1.0, 0.58 + 0.42 * smoothstep( 0.18, 0.7, bubbles ), detail );
  diffuseColor.rgb = mix( diffuseColor.rgb, uFoamColor, clamp( foam, 0.0, 1.0 ) );
  diffuseColor.a = max( diffuseColor.a, foam * 0.95 ) * coverage;
}
`;

function patchSurfShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>
uniform float uTime;
uniform float uLevel;
attribute vec2 surfCoord;
attribute float surfGround;
varying vec2 vSurfCoord;
varying float vSurfGround;
${waveFunctions}`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
vSurfCoord = surfCoord;
vSurfGround = surfGround;
transformed.y = max( uLevel + 0.018 + surfHeight( surfCoord ), surfGround + 0.022 );`);
  // Keep the open sea's reflection, sun glint and fog; add the raised wave's slope before its normal is calculated.
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", `${foamFunctions}\nvoid main() {`)
    .replace("vec2 slope = vec2( 0.0 );", "vec2 slope = surfSlope( vSurfCoord );")
    .replace("#include <alphamap_fragment>", `#include <alphamap_fragment>\n${foamShading}`);
}

/** A narrow, subdivided strip follows the beach. Its waves and foam share the sky/sea's pausable game clock. */
export function createShoreSurf(sky: SkyUniforms, sea: SeaUniforms): Mesh<BufferGeometry, MeshBasicMaterial> {
  const positions: number[] = [], coords: number[] = [], ground: number[] = [], indices: number[] = [];
  const columns = Math.ceil((surf.offshore + surf.runup) / 0.3);
  const rows = Math.ceil(surf.halfLength * 2 / 0.75);
  for (let row = 0; row <= rows; row++) {
    const z = -surf.halfLength + row / rows * surf.halfLength * 2;
    const shoreX = inland(0, z);
    for (let column = 0; column <= columns; column++) {
      const distance = -surf.runup + column / columns * (surf.offshore + surf.runup);
      const x = shoreX + distance;
      const y = beachSurface(x, z).y;
      positions.push(x, Math.max(config.bay.surfaceY + 0.018, y + 0.022), z);
      coords.push(distance, z);
      ground.push(y);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column, b = a + 1, c = a + columns + 1;
        indices.push(a, c, b, b, c, c + 1);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("surfCoord", new Float32BufferAttribute(coords, 2));
  geometry.setAttribute("surfGround", new Float32BufferAttribute(ground, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.boundingBox!.min.y = config.bay.surfaceY;
  geometry.boundingBox!.max.y = Math.max(geometry.boundingBox!.max.y, config.bay.surfaceY + surf.height + 0.04);
  geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(new Sphere());

  const material = new MeshBasicMaterial({
    color: config.water.murky.color, transparent: true, opacity: config.land.seaOpacity,
    depthWrite: false,
  });
  shadeSea(material, sky, sea);
  const compileSea = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    compileSea(shader, renderer);
    Object.assign(shader.uniforms, {
      uSurf: { value: new Vector4(surf.height, Math.PI * 2 / surf.wavelength, Math.PI * 2 / surf.period, surf.runup) },
      uSurfArea: { value: new Vector3(surf.offshore, surf.halfLength, surf.endFade) },
      uFoamColor: { value: new Color(0xeaf5ee) },
    });
    patchSurfShader(shader);
  };
  material.customProgramCacheKey = () => "shore-surf";
  const mesh = new Mesh(geometry, material);
  mesh.name = "shore-surf";
  mesh.renderOrder = 2;
  mesh.visible = false;
  return mesh;
}
