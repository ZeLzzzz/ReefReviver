import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from "three";
import { config } from "../config";
import { shadeSea, type SeaUniforms } from "./sea-surface";
import type { SkyUniforms } from "./sky";

export interface OilSurface {
  sky: SkyUniforms;
  uniforms: SeaUniforms;
}

const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function filmMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
}

/** Two feathered faces straddle the sea's depth-writing plane, so the film is visible from either side without a solid rim. */
export function buildOilSlick(variant: number): Group {
  const segments = 48, rings = 8;
  const radius = config.trash.oil.size / 2;
  const stretch = [1.1, 0.98, 1.14][variant];
  const phase = variant * 2.13;
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const dark = new Color(0x172629), bronze = new Color(0x51452d), blue = new Color(0x354a53);
  const color = new Color();
  const vertex = (x: number, y: number, z: number, radial: number) => {
    const flow = Math.sin(x * 3.4 + Math.sin(z * 4.1 + phase) * 1.3 + phase);
    const pools = 0.5 + 0.5 * Math.sin(z * 5.2 - x * 2.7 + flow * 1.7);
    color.copy(dark).lerp(pools > 0.5 ? bronze : blue, 0.08 + 0.18 * pools);
    const coverage = (1 - smooth(0.88, 1, radial)) * (0.66 + 0.16 * pools + 0.04 * flow);
    positions.push(x * radius, y, z * radius);
    colors.push(color.r, color.g, color.b, coverage);
    uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
  };
  for (let layer = 0; layer < 2; layer++) {
    const start = positions.length / 3;
    const y = layer === 0 ? 0 : -config.trash.oil.thickness;
    vertex(0, y, 0, 0);
    for (let ring = 1; ring <= rings; ring++) {
      const radial = [0.12, 0.25, 0.4, 0.56, 0.73, 0.86, 0.94, 1][ring - 1];
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2;
        const reach = 0.91 + 0.085 * Math.sin(angle * 3 + phase) + 0.055 * Math.cos(angle * 5 - phase) + 0.025 * Math.sin(angle * 9 + phase);
        vertex(Math.cos(angle) * reach * stretch * radial, y, Math.sin(angle) * reach / stretch * radial, radial);
        const a = start + 1 + (ring - 1) * segments + i;
        const b = start + 1 + (ring - 1) * segments + (i + 1) % segments;
        if (ring === 1) indices.push(start, b, a);
        else indices.push(a - segments, b, a, a - segments, b - segments, b);
      }
    }
    if (layer === 1) {
      const first = indices.length / 2;
      for (let i = first; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 4));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const group = new Group();
  group.name = `trash-oil-${variant}`;
  const mesh = new Mesh(geometry, filmMaterial());
  mesh.renderOrder = 1;
  group.add(mesh);
  return group;
}

export function createOilMaterial(surface: OilSurface): MeshBasicMaterial {
  const material = filmMaterial();
  shadeSea(material, surface.sky, surface.uniforms);
  const compileSea = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    compileSea(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vOilUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOilUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vOilUv;")
      .replace("#include <color_fragment>", "#include <color_fragment>\nfloat oilCoverage = diffuseColor.a;")
      .replace("vec3 N = normalize( vec3( - slope.x, 1.0, - slope.y ) );", "vec3 N = normalize( vec3( - slope.x * 0.65, 1.0, - slope.y * 0.65 ) );")
      .replace("#include <alphamap_fragment>", /* glsl */ `#include <alphamap_fragment>
        vec2 p = vOilUv * 6.0;
        float drift = uTime * 0.055;
        float flow = sin(p.x * 1.7 + sin(p.y * 1.4 + drift) * 1.2);
        float bands = sin(p.y * 2.2 - p.x * 1.1 + flow * 2.1 + drift);
        float ribbon = pow(0.5 + 0.5 * bands, 5.0);
        vec3 V = normalize(cameraPosition - vSeaPos);
        if (cameraPosition.y > uLevel) {
          vec3 sheen = 0.5 + 0.5 * cos(6.2831853 * (flow * 0.3 + bands * 0.2 + vec3(0.08, 0.4, 0.7)));
          diffuseColor.rgb += sheen * ribbon * (0.018 + 0.032 * pow(1.0 - abs(V.y), 2.0));
        } else {
          diffuseColor.rgb *= 0.25;
        }
        // The water reflection must not turn the transparent edge opaque.
        float fringe = 1.0 - smoothstep(0.3, 0.65, oilCoverage);
        float erosion = 0.08 * (0.5 + 0.5 * sin(p.x * 11.0 + sin(p.y * 8.0) * 1.3));
        diffuseColor.a = max(0.0, oilCoverage - fringe * erosion) * (0.94 + 0.06 * sin(p.x * 3.0 + p.y * 4.0 + flow));
      `);
  };
  material.customProgramCacheKey = () => "oil-film";
  return material;
}
