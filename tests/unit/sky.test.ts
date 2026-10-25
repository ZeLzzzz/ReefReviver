import { Color, DirectionalLight, DoubleSide, type Fog, type Mesh, MeshBasicMaterial, Scene, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { config } from "../../src/config";
import { mirrorAt, patchSeaShader } from "../../src/game/sea-surface";
import { createSky, createSkyUniforms, sunDirection, underwaterSunDirection } from "../../src/game/sky";
import { buildWorld } from "../../src/game/world";

const { sky, sea, land, water, bloom, camera } = config;

function lightOf(scene: Scene): DirectionalLight {
  let found: DirectionalLight | null = null;
  scene.traverse((o) => {
    if (o instanceof DirectionalLight) found = o;
  });
  return found!;
}

function surfaceOf(scene: Scene): MeshBasicMaterial {
  let found: Mesh | null = null;
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && mesh.material instanceof MeshBasicMaterial && mesh.material.transparent && mesh.geometry.type === "PlaneGeometry") found = mesh;
  });
  return found!.material as MeshBasicMaterial;
}

const luminance = (hex: number) => {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

describe("the sky (REQ-023 AC-1)", () => {
  it("runs from blue overhead to a whitish light blue at the horizon, which is the haze's colour", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const look = world.sky.look();
    expect(look.horizon).toBe(land.sky);
    expect(look.zenith).toBe(sky.zenith);
    // The zenith is a deeper blue (blue clearly above red), the horizon pale: light, with little saturation.
    const zenith = new Color(look.zenith);
    const horizon = new Color(look.horizon);
    expect(zenith.b).toBeGreaterThan(zenith.r * 2);
    expect(luminance(look.horizon)).toBeGreaterThan(luminance(look.zenith) * 1.8);
    expect(horizon.r).toBeGreaterThan(0.5);
    expect(horizon.b).toBeGreaterThan(horizon.r);
    // The haze over the bay is the same colour as the sky at the horizon, so far land melts into it.
    world.setAbove(true);
    const fog = scene.fog as Fog;
    expect(fog.color.getHex()).toBe(look.horizon);
    expect((scene.background as Color).getHex()).toBe(look.horizon);
  });

  it("draws a gradient, not one flat colour: the shader mixes the horizon and the zenith by height", () => {
    const material = createSky(createSkyUniforms()).mesh.material as ShaderMaterial;
    expect(material.fragmentShader).toContain("mix( uHorizon, uZenith");
    expect(material.fragmentShader).toContain("d.y");
  });
});

describe("the sun (REQ-023 AC-2)", () => {
  it("is high enough to be seen over the sea and is a disc with a glow in the shader", () => {
    expect(sunDirection.y).toBeGreaterThan(0.2);
    expect(sunDirection.y).toBeLessThan(0.8);
    const material = createSky(createSkyUniforms()).mesh.material as ShaderMaterial;
    expect(material.fragmentShader).toContain("uSunRadius");
    expect(material.fragmentShader).toContain("glow");
    expect(material.uniforms.uSunRadius.value).toBeGreaterThan(0.01);
  });

  it("stands where the sunlight comes from above the water, and the light is steeper under it", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const light = lightOf(scene);
    const direction = () => light.position.clone().normalize();
    // Under the water the light comes at its own, steeper angle (the light bends toward the vertical going in).
    expect(direction().distanceTo(underwaterSunDirection)).toBeLessThan(1e-9);
    expect(underwaterSunDirection.y).toBeGreaterThan(sunDirection.y);
    world.setAbove(true);
    expect(direction().distanceTo(sunDirection)).toBeLessThan(1e-9);
    expect(new Vector3(...world.sky.look().sun).distanceTo(direction())).toBeLessThan(1e-9);
    world.setAbove(false);
    expect(direction().distanceTo(underwaterSunDirection)).toBeLessThan(1e-9);
  });
});

describe("the clouds (REQ-023 AC-3)", () => {
  const shader = (createSky(createSkyUniforms()).mesh.material as ShaderMaterial).fragmentShader;

  it("drift slowly: the clouds' clock is the game's time, at a few thousandths of a noise unit a second", () => {
    expect(Math.hypot(sky.clouds.drift.x, sky.clouds.drift.z)).toBeGreaterThan(0);
    expect(Math.hypot(sky.clouds.drift.x, sky.clouds.drift.z)).toBeLessThan(0.02);
    expect(shader).toContain("uDrift * uTime");
  });

  it("have soft edges and no broken ones: smooth noise, a wide edge, a fade into the haze, an exact integer hash", () => {
    // Quintic interpolation (continuous in its slope too) and a wide smoothstep for the edge, never a hard step.
    expect(shader).toContain("f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 )");
    expect(sky.clouds.softness).toBeGreaterThanOrEqual(0.2);
    expect(shader).toContain("smoothstep( uCloud.y, uCloud.y + 0.28, n )");
    expect(shader).not.toMatch(/\bstep\(\s*uCloud/);
    // The cell corners come from an integer hash: a float one jumped along the cell edges (the noise showed seams).
    expect(shader).toContain("uvec2( ivec2( p ) )");
    expect(shader).not.toContain("sin(");
    // Fine octaves fade out where a pixel is wider than their cycle, and the clouds fade out toward the horizon: no shimmer.
    expect(shader).toContain("fwidth( uv.x )");
    expect(shader).toContain("smoothstep( 0.02, 0.24, up )");
  });
});

describe("the sky only exists above the water (REQ-023 AC-6)", () => {
  it("is drawn above the water, hidden under it and in the cave, Bloom or not", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    expect(world.sky.look().visible).toBe(false);
    expect(world.sky.mesh.parent).toBe(scene);
    world.setAbove(true);
    expect(world.sky.look().visible).toBe(true);
    world.setAbove(false);
    expect(world.sky.look().visible).toBe(false);
    for (const clarity of [0, 0.5, 1]) {
      world.setClarity(clarity);
      world.setCave(1);
      expect(world.sky.look().visible).toBe(false);
      world.setCave(0);
      expect(world.sky.look().visible).toBe(false);
    }
  });

  it("stays out of the cave: going up the water's fog and darkness are back, and the background is the water's", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    world.setAbove(true);
    world.setCave(1);
    world.setAbove(false);
    const fog = scene.fog as Fog;
    expect(world.sky.look().visible).toBe(false);
    expect(fog.color.getHex()).toBe(config.bay.cave.dark.fogColor);
    expect((scene.background as Color).getHex()).toBe(config.bay.cave.dark.fogColor);
  });

  it("is a dome inside the camera's far plane, drawn after the solid scene and behind everything", () => {
    const sky = createSky(createSkyUniforms());
    const geometry = sky.mesh.geometry as SphereGeometry;
    expect(geometry.parameters.radius).toBeLessThan(camera.far);
    expect(geometry.parameters.radius).toBeGreaterThan(config.land.hazeFar);
    const material = sky.mesh.material as ShaderMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(sky.mesh.renderOrder).toBeGreaterThan(0);
    // It follows the camera.
    sky.update(new Vector3(5, 2, -7));
    expect(sky.mesh.position.toArray()).toEqual([5, 2, -7]);
  });
});

describe("the clocks advance smoothly (REQ-023 AC-3, AC-4; REQ-005 AC-7)", () => {
  it("moves the clouds and the waves by the frame time, steadily, and holds still when not updated (a pause)", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    const around = new Vector3(0, -3, 0);
    expect(world.sky.look().time).toBe(0);
    let last = 0;
    for (let i = 0; i < 120; i++) {
      world.update(1 / 60, around);
      const now = world.sky.look().time;
      expect(now - last).toBeCloseTo(1 / 60, 9);
      last = now;
    }
    expect(world.sea.look().time).toBe(last);
    // Going above and under the water does not move the clock.
    world.setAbove(true);
    expect(world.sky.look().time).toBe(last);
    world.setAbove(false);
    expect(world.sky.look().time).toBe(last);
  });
});

describe("the sea surface (REQ-023 AC-4, AC-5)", () => {
  it("keeps the bay's colour: murky before the Bloom and clear after it, with the sea's opacity, through the shader", () => {
    const scene = new Scene();
    const world = buildWorld(scene);
    world.setAbove(true);
    const material = surfaceOf(scene);
    expect(material).toBe(world.sea.material);
    expect(material.color.getHex()).toBe(water.murky.color);
    expect(material.opacity).toBe(land.seaOpacity);
    world.setClarity(1);
    expect(material.color.getHex()).toBe(bloom.clear.color);
    expect(material.opacity).toBe(land.seaOpacity);
    // Seen from below it is the Bloom's own surface colour, as before.
    world.setAbove(false);
    expect(material.color.getHex()).toBe(bloom.clear.surfaceColor);
    expect(material.opacity).toBe(0.5);
  });

  it("mirrors the sky and glints less in the murk than in the clear water, steadily", () => {
    expect(mirrorAt(0)).toBe(sea.reflection.murky);
    expect(mirrorAt(1)).toBe(sea.reflection.clear);
    expect(sea.reflection.murky).toBeLessThan(sea.reflection.clear);
    let last = mirrorAt(0);
    for (let c = 0.05; c <= 1.0001; c += 0.05) {
      expect(mirrorAt(c)).toBeGreaterThanOrEqual(last);
      last = mirrorAt(c);
    }
    const scene = new Scene();
    const world = buildWorld(scene);
    expect(world.sea.look().mirror).toBe(sea.reflection.murky);
    world.setClarity(1);
    expect(world.sea.look().mirror).toBe(sea.reflection.clear);
    world.setClarity(0);
    expect(world.sea.look().mirror).toBe(sea.reflection.murky);
  });

  it("is still one plane the scene's fog fades, seen from both sides", () => {
    const scene = new Scene();
    buildWorld(scene);
    const material = surfaceOf(scene);
    expect(material.fog).toBe(true);
    expect(material.side).toBe(DoubleSide);
    expect(material.transparent).toBe(true);
  });

  it("has gentle waves: low slopes, several sizes, moving slowly", () => {
    expect(sea.waves.length).toBeGreaterThanOrEqual(3);
    for (const wave of sea.waves) {
      expect(wave.slope).toBeGreaterThan(0);
      expect(wave.slope).toBeLessThanOrEqual(0.1);
      expect(wave.speed).toBeGreaterThan(0);
      expect(wave.speed).toBeLessThan(2);
    }
    expect(new Set(sea.waves.map((w) => w.length)).size).toBe(sea.waves.length);
  });
});

describe("the sea shader (REQ-023, cross-REQ contract with the wider surface)", () => {
  const original = {
    vertexShader: "#include <common>\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\n#include <fog_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main() {\nvec4 diffuseColor = vec4( diffuse, opacity );\n#include <color_fragment>\n#include <fog_fragment>\n}",
  };
  const patched = { ...original };
  patchSeaShader(patched);

  it("makes the waves from the world position of each pixel and moves no vertex, so any plane will do", () => {
    // The vertex shader only learns the world position; it does not touch `transformed` or gl_Position.
    expect(patched.vertexShader).toContain("vSeaPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;");
    expect(patched.vertexShader).not.toMatch(/transformed\s*(\.\w+)?\s*[+*-]?=/);
    expect(patched.vertexShader).not.toContain("gl_Position");
    // The fragment shader makes the slope from vSeaPos and the clock.
    expect(patched.fragmentShader).toContain("dot( w.xy, vSeaPos.xz )");
    expect(patched.fragmentShader).toContain("uTime");
  });

  it("changes the colour before the fog is applied, so the sea fades into the haze and into the murk", () => {
    const shading = patched.fragmentShader.indexOf("vec3 toEye = cameraPosition - vSeaPos;");
    expect(shading).toBeGreaterThan(patched.fragmentShader.indexOf("#include <color_fragment>"));
    expect(shading).toBeLessThan(patched.fragmentShader.indexOf("#include <fog_fragment>"));
    // The base colour and opacity are the material's own, and it is mixed, not replaced.
    expect(patched.fragmentShader).toContain("diffuseColor.rgb = mix( diffuseColor.rgb, mirrored");
  });

  it("tells above from below by the camera, and shows the glint above and the ripples below", () => {
    expect(patched.fragmentShader).toContain("cameraPosition.y > uLevel");
    expect(patched.fragmentShader).toContain("glint");
    expect(patched.fragmentShader).toContain("ripple");
    // Waves too fine for a pixel are faded out, so far water does not shimmer.
    expect(patched.fragmentShader).toContain("fwidth( vSeaPos.xz )");
  });

  it("does not depend on the plane's size or vertex count", () => {
    // Nothing in the shaders mentions the plane's extent, or reads its vertex positions but to find the world position.
    expect(patched.fragmentShader).not.toMatch(/halfSize|uSize|uExtent|position\b/);
    expect(patched.vertexShader).not.toMatch(/halfSize|uSize|uExtent/);
  });
});
