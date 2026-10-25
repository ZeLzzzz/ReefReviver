import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { goAshore } from "./ashore";

type Vec = [number, number, number];
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

type SkyState = { visible: boolean; sun: Vec; time: number; horizon: number; zenith: number; sea: { mirror: number; time: number }; lightDirection: Vec };
const skyState = (page: Page) => reef(page, (h) => h.sky()) as Promise<SkyState>;

const SUN = new (class {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  constructor() {
    const { x, y, z } = config.sky.sun.direction;
    const length = Math.hypot(x, y, z);
    this.x = x / length;
    this.y = y / length;
    this.z = z / length;
  }
})();
/** The walker's look that puts the sun in the middle of the screen (forward is (sin yaw, cos yaw) on the ground). */
const towardSun = { yaw: Math.atan2(SUN.x, SUN.z), pitch: Math.asin(SUN.y) };
const awayFromSun = { yaw: Math.PI, pitch: 0.5 };

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

async function bloomNow(page: Page) {
  await reef(page, (h) => {
    h.removeTrash(50);
    h.plantAll();
  });
  await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
}

async function look(page: Page, yaw: number, pitch: number) {
  const walker = (await reef(page, (h) => h.walker())) as { position: Vec };
  await reef(page, (h, a) => h.placeWalker(a.x, a.z, a.yaw, a.pitch), { x: walker.position[0], z: walker.position[2], yaw, pitch });
  await page.waitForTimeout(600);
}

/** The screen as a 200-pixel-wide grid of colours, read back by drawing the screenshot in a second page. */
interface Shot {
  width: number;
  height: number;
  at(x: number, y: number): Vec;
}
async function shoot(page: Page, name?: string): Promise<Shot> {
  const png = await page.screenshot(name ? { path: `test-results/req-023-${name}.png` } : {});
  const decoder = await page.context().newPage();
  try {
    await decoder.goto("about:blank");
    const grid = await decoder.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const width = 200;
      const height = Math.round((image.height / image.width) * width);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, width, height);
      return { width, height, data: Array.from(context.getImageData(0, 0, width, height).data) };
    }, png.toString("base64"));
    return {
      width: grid.width,
      height: grid.height,
      at: (x, y) => {
        const i = (Math.min(grid.height - 1, Math.max(0, Math.round(y))) * grid.width + Math.min(grid.width - 1, Math.max(0, Math.round(x)))) * 4;
        return [grid.data[i], grid.data[i + 1], grid.data[i + 2]];
      },
    };
  } finally {
    await decoder.close();
  }
}

const luma = ([r, g, b]: Vec) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Every pixel of a band of rows (a share of the height), between the goals panel and the map, which cover the corners. */
function band(shot: Shot, from: number, to: number): Vec[] {
  const out: Vec[] = [];
  for (let y = Math.floor(shot.height * from); y < Math.floor(shot.height * to); y++) for (let x = Math.floor(shot.width * 0.22); x < shot.width * 0.8; x++) out.push(shot.at(x, y));
  return out;
}
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
/** The average difference between two shots over a band of rows, in 0-255 steps. */
function difference(a: Shot, b: Shot, from: number, to: number): number {
  const pa = band(a, from, to);
  const pb = band(b, from, to);
  return mean(pa.map((p, i) => (Math.abs(p[0] - pb[i][0]) + Math.abs(p[1] - pb[i][1]) + Math.abs(p[2] - pb[i][2])) / 3));
}

/** Frames per second over `ms` milliseconds, counted with requestAnimationFrame in the page. */
async function framesPerSecond(page: Page, ms: number) {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          frames++;
          if (now - start < duration) requestAnimationFrame(tick);
          else resolve(frames / ((now - start) / 1000));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the sky is a gradient with a sun and white clouds that drift without flicker (AC-1, AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await goAshore(page);
    const state = await skyState(page);
    expect(state.visible).toBe(true);
    // The sun is where the game's sunlight comes from, and the haze is the sky's colour at the horizon.
    expect(Math.hypot(state.sun[0] - SUN.x, state.sun[1] - SUN.y, state.sun[2] - SUN.z)).toBeLessThan(1e-6);
    expect(Math.hypot(state.lightDirection[0] - SUN.x, state.lightDirection[1] - SUN.y, state.lightDirection[2] - SUN.z)).toBeLessThan(1e-6);
    const water = (await reef(page, (h) => h.water())) as { fog: number; background: number };
    expect(water.fog).toBe(config.land.sky);
    expect(state.horizon).toBe(config.land.sky);

    // AC-1: looking up with the sun behind, the sky is deeper blue overhead and paler near the horizon.
    await look(page, awayFromSun.yaw, awayFromSun.pitch);
    const sky = await shoot(page, "sky");
    const top = band(sky, 0.14, 0.3);
    const low = band(sky, 0.4, 0.55);
    // The plain sky (clouds are lighter than it): the darker fifth of each band.
    expect(percentile(top.map(luma), 0.2)).toBeLessThan(percentile(low.map(luma), 0.2) - 12);
    const blue = top.filter((p) => p[2] - p[0] > 60);
    expect(blue.length / top.length).toBeGreaterThan(0.2);
    // Paler (less blue over red) toward the horizon.
    expect(percentile(low.map((p) => p[2] - p[0]), 0.8)).toBeLessThan(percentile(top.map((p) => p[2] - p[0]), 0.8) - 10);

    // AC-3: white clouds are scattered over it, and they leave blue sky between them.
    const white = top.filter((p) => Math.min(...p) > 215);
    expect(white.length / top.length).toBeGreaterThan(0.02);
    expect(white.length / top.length).toBeLessThan(0.8);

    // AC-3: nothing flickers from one frame to the next, and the clouds do move over time.
    const second = await shoot(page);
    const flicker = difference(sky, second, 0.02, 0.55);
    expect(flicker).toBeLessThan(2);
    const timeBefore = (await skyState(page)).time;
    await page.waitForTimeout(8000);
    const later = await shoot(page, "sky-later");
    expect((await skyState(page)).time).toBeGreaterThan(timeBefore + 7);
    const drift = difference(sky, later, 0.02, 0.55);
    console.log(`REQ-023 cloud change over 8 s: ${drift.toFixed(2)}, between two frames: ${flicker.toFixed(2)}`);
    expect(drift).toBeGreaterThan(flicker);
    expect(drift).toBeLessThan(25);

    // AC-2: the sun is a bright disc with a glow, in the direction of the light.
    await look(page, towardSun.yaw, towardSun.pitch);
    const sun = await shoot(page, "sun");
    const centre = sun.at(sun.width / 2, sun.height / 2);
    expect(Math.min(...centre)).toBeGreaterThan(240);
    const nearby = sun.at(sun.width / 2 + 14, sun.height / 2);
    const far = sun.at(sun.width / 2 + 60, sun.height / 2);
    expect(luma(nearby)).toBeLessThan(luma(centre) - 5);
    expect(luma(far)).toBeLessThan(luma(nearby));
    // The disc is small: well inside the screen, the middle is bright and the edge of the glow is not.
    expect(band(sun, 0, 1).filter((p) => Math.min(...p) > 240).length / (sun.width * sun.height)).toBeLessThan(0.06);
  });

  test("the sea seen from the land has waves and a glint, murky before the Bloom and clear blue after it (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await goAshore(page);
    await look(page, Math.PI / 2, -0.25);
    const murky = await shoot(page, "sea-murky");
    // A patch of open water, off the dock and the glint.
    const patch = (shot: Shot) => {
      const out: Vec[] = [];
      for (let y = shot.height * 0.46; y < shot.height * 0.52; y++) for (let x = shot.width * 0.62; x < shot.width * 0.9; x++) out.push(shot.at(x, y));
      return out;
    };
    const murkyColour = [0, 1, 2].map((c) => mean(patch(murky).map((p) => p[c])));
    // Murky: green-grey, not blue.
    expect(murkyColour[2]).toBeLessThan(murkyColour[1] * 1.12);

    // The waves move, gently: the same water a second later is a little different, not a different picture.
    const again = await shoot(page);
    await page.waitForTimeout(1000);
    const moved = await shoot(page);
    const wave = difference(again, moved, 0.4, 0.62);
    console.log(`REQ-023 sea change in 1 s: ${wave.toFixed(2)}`);
    expect(wave).toBeGreaterThan(0.1);
    expect(wave).toBeLessThan(15);

    await bloomNow(page);
    await page.waitForTimeout(1500);
    const clear = await shoot(page, "sea-clear");
    const clearColour = [0, 1, 2].map((c) => mean(patch(clear).map((p) => p[c])));
    // Clear: blue, well above red, and bluer than before.
    console.log(`REQ-023 sea colour murky ${murkyColour.map(Math.round)}, clear ${clearColour.map(Math.round)}`);
    expect(clearColour[2]).toBeGreaterThan(clearColour[0] * 1.3);
    expect(clearColour[2] / clearColour[0]).toBeGreaterThan(murkyColour[2] / murkyColour[0]);
    // The glint: bright spots on the water, below the horizon.
    const water = band(clear, 0.5, 0.95);
    const glint = water.filter((p) => Math.min(...p) > 235);
    console.log(`REQ-023 glint share of the water: ${((glint.length / water.length) * 100).toFixed(2)} %`);
    expect(glint.length / water.length).toBeGreaterThan(0.003);
    // Still the same sky, above the water, after the Bloom.
    expect(((await reef(page, (h) => h.water())) as { background: number }).background).toBe(config.land.sky);
  });

  test("under the water the sky and clouds do not show through, the surface ripples with light and the rays stay (AC-5, AC-6)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    // Looking up at the surface from 3.5 m deep, in the murk.
    const up = async (yaw: number) => {
      await reef(page, (h, a) => h.placeRov(-40, -3.5, 0, a.yaw, 0.65), { yaw });
      await page.waitForTimeout(1000);
    };
    await up(Math.PI / 2);
    expect((await skyState(page)).visible).toBe(false);
    const murky = await shoot(page, "under-murky");
    // The murk is green-grey all over: no sky blue and no white cloud.
    const all = band(murky, 0.1, 0.5);
    expect(all.filter((p) => p[2] - p[0] > 45).length / all.length).toBeLessThan(0.02);
    expect(all.filter((p) => Math.min(...p) > 225).length / all.length).toBeLessThan(0.02);
    expect(((await reef(page, (h) => h.natureLook())) as { rays: number }).rays).toBe(0);

    await bloomNow(page);
    await page.waitForTimeout(1500);
    await up(Math.PI / 2);
    expect((await skyState(page)).visible).toBe(false);
    const clear = await shoot(page, "under-clear");
    const surface = band(clear, 0.05, 0.5);
    // Ripples of light: bright ridges over a bluer ground, and they move.
    const bright = surface.filter((p) => luma(p) > 190);
    expect(bright.length / surface.length).toBeGreaterThan(0.02);
    expect(bright.length / surface.length).toBeLessThan(0.7);
    const next = await shoot(page);
    await page.waitForTimeout(1000);
    const moved = await shoot(page);
    expect(difference(next, moved, 0.05, 0.5)).toBeGreaterThan(0.2);
    // The light rays after the Bloom (REQ-013 AC-3), seen level with the surface above.
    await reef(page, (h) => h.placeRov(-40, -3.5, 0, Math.PI / 2, 0.2));
    await page.waitForTimeout(1000);
    expect(((await reef(page, (h) => h.natureLook())) as { rays: number }).rays).toBeGreaterThan(0.03);
    await page.screenshot({ path: "test-results/req-023-under-level.png" });
  });

  test("inside the cave there is no sky or cloud at all (AC-6)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await bloomNow(page);
    const cave = (await reef(page, (h) => h.cave())) as { path: { x: number; y: number; z: number }[] };
    const middle = cave.path[Math.floor(cave.path.length / 2)];
    for (const pitch of [0.3, 0.7]) {
      await reef(page, (h, a) => h.placeRov(a.x, a.y, a.z, Math.PI / 2, a.pitch), { ...middle, pitch });
      await page.waitForTimeout(3500);
      expect((await reef(page, (h) => h.cave())).dark).toBeGreaterThan(0.9);
      expect((await skyState(page)).visible).toBe(false);
      const shot = await shoot(page, `cave-${pitch}`);
      const pixels = band(shot, 0, 1);
      expect(mean(pixels.map(luma))).toBeLessThan(90);
      // No sky blue or cloud white anywhere in the dark.
      expect(pixels.filter((p) => Math.min(...p) > 225).length / pixels.length).toBeLessThan(0.03);
    }
  });

  test("the game keeps 30 frames a second or more after the Bloom, on the land and under the water (AC-7)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await goAshore(page);
    await bloomNow(page);
    await page.waitForTimeout(1500);
    for (const [name, look3] of [
      ["the sun", towardSun],
      ["the clouds", awayFromSun],
      ["the sea", { yaw: Math.PI / 2, pitch: -0.2 }],
    ] as const) {
      await look(page, look3.yaw, look3.pitch);
      const fps = await framesPerSecond(page, 3000);
      console.log(`REQ-023 fps on the land looking at ${name}: ${fps.toFixed(1)}`);
      expect(fps).toBeGreaterThanOrEqual(30);
    }
    // Under the water, back in the submarine.
    await reef(page, (h) => {
      const [x, , z] = h.subPosition();
      h.placeWalker(x - 6, z, Math.PI / 2, 0);
    });
    await page.keyboard.down("KeyW");
    await expect.poll(() => reef(page, (h) => h.hud()?.land?.canBoard), { timeout: 10_000 }).toBe(true);
    await page.keyboard.up("KeyW");
    await page.keyboard.press("KeyE");
    await expect.poll(() => reef(page, (h) => !h.onLand() && !h.inTransition())).toBe(true);
    await reef(page, (h) => h.placeRov(-40, -3.5, 0, Math.PI / 2, 0.65));
    await page.waitForTimeout(1000);
    const fps = await framesPerSecond(page, 3000);
    console.log(`REQ-023 fps under the water looking up at the surface: ${fps.toFixed(1)}`);
    expect(fps).toBeGreaterThanOrEqual(30);
  });
});
