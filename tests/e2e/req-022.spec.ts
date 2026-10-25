import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { squareRadius } from "../../src/game/terrain";
import { goAshore } from "./ashore";

type Vec = [number, number, number];
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const { area, headland } = config.bay;

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

const notice = (page: Page) => page.locator(".message-notice");

async function toTheEdge(page: Page, message: string) {
  test.setTimeout(150_000);
  await startDive(page);
  // In the middle of the bay, facing east toward the edge about 90 m away.
  await reef(page, (h) => h.placeRov(60, -9, 5, Math.PI / 2, 0));
  await page.keyboard.down("KeyW");
  // The speed falls away in the last metres: slower in the band than before it.
  const speeds: { r: number; v: number }[] = [];
  let last: Vec = await reef(page, (h) => h.rovPosition());
  const started = Date.now();
  let stopped: Vec = last;
  let said = false;
  while (Date.now() - started < 100_000) {
    await page.waitForTimeout(250);
    const now: Vec = await reef(page, (h) => h.rovPosition());
    speeds.push({ r: squareRadius(now[0], now[2]), v: Math.hypot(now[0] - last[0], now[2] - last[2]) / 0.25 });
    // The message shows as the edge is reached, for about two seconds.
    if (!said && squareRadius(now[0], now[2]) > area.radius - 0.8) {
      said = true;
      await expect(notice(page)).toBeVisible({ timeout: 1500 });
      await expect(notice(page)).toHaveText(message);
      await page.screenshot({ path: `test-results/req-022-edge-${message.startsWith("Batas") ? "id" : "en"}.png` });
    }
    if (squareRadius(now[0], now[2]) > area.radius - 1.5 && Math.hypot(now[0] - last[0], now[2] - last[2]) < 0.02) {
      stopped = now;
      break;
    }
    last = now;
  }
  await page.keyboard.up("KeyW");
  // It reached the edge at about where the wall was, and stopped there.
  expect(squareRadius(stopped[0], stopped[2])).toBeGreaterThan(area.radius - 1.6);
  expect(squareRadius(stopped[0], stopped[2])).toBeLessThanOrEqual(area.radius + 0.05);
  const cruising = speeds.filter((s) => s.r < area.radius - area.slowBand - 2).map((s) => s.v);
  const slowing = speeds.filter((s) => s.r > area.radius - 5 && s.r < area.radius - 2).map((s) => s.v);
  expect(Math.max(...cruising)).toBeGreaterThan(config.rov.maxSpeed * 0.8);
  expect(slowing.length).toBeGreaterThan(0);
  expect(Math.max(...slowing)).toBeLessThan(config.rov.maxSpeed * 0.6);
  expect(said).toBe(true);
  // ... and then it goes away.
  await expect(notice(page)).toBeHidden({ timeout: 4000 });
  return stopped;
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("holding W to the east slows the submarine, stops it at the edge of the dive area and says so; it can turn back at once (AC-4)", async ({ page }) => {
    const stopped = await toTheEdge(page, "Batas area penyelaman");
    // Nothing is in the way there: open water, the floor far below.
    expect(await reef(page, (h, a) => h.fits(a.x - 4, a.y, a.z), { x: stopped[0], y: stopped[1], z: stopped[2] })).toBe(true);
    // Turn round (S backs away straight away) and the message is not shown again while it leaves.
    await page.keyboard.down("KeyS");
    await page.waitForTimeout(1500);
    await page.keyboard.up("KeyS");
    const back: Vec = await reef(page, (h) => h.rovPosition());
    expect(back[0]).toBeLessThan(stopped[0] - 2);
  });

  test("the camera is not held by the edge: looking in from the edge, it floats outside the area (AC-4)", async ({ page }) => {
    await startDive(page);
    await reef(page, (h, a) => h.placeRov(a.r - 0.2, -9, 5, -Math.PI / 2, 0), { r: area.radius });
    await page.waitForTimeout(600);
    const camera: Vec = await reef(page, (h) => h.cameraPosition());
    expect(camera[0]).toBeGreaterThan(area.radius + 3);
    await page.screenshot({ path: "test-results/req-022-camera-outside.png" });
  });

  test("the minimap has no rock wall; a thin line marks the edge of the dive area (AC-6)", async ({ page }) => {
    await startDive(page);
    const shades = await page.locator(".hud-minimap .mm-terrain").evaluateAll((els) => els.map((el) => el.getAttribute("data-shade")));
    expect(shades).toEqual(expect.arrayContaining(["land", "depth-0", "depth-1", "depth-2", "depth-3"]));
    expect(shades).not.toContain("wall");
    await expect(page.locator(".hud-minimap .mm-edge")).toBeVisible();
    await page.locator(".hud-minimap").screenshot({ path: "test-results/req-022-minimap.png" });
  });

  test("on the beach the walker stops at the headlands at both ends and cannot climb them (AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await goAshore(page, 0);
    for (const side of [-1, 1]) {
      // Along the beach toward the end, a little inland (north is yaw PI, south is yaw 0).
      await reef(page, (h, a) => h.placeWalker(a.x, a.z, a.yaw, 0), { x: -135, z: side * 60, yaw: side < 0 ? Math.PI : 0 });
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(14_000);
      await page.keyboard.up("KeyW");
      const walker = (await reef(page, (h) => h.walker()))!;
      expect(Math.abs(walker.position[2])).toBeGreaterThan(headland.z - 45);
      expect(Math.abs(walker.position[2])).toBeLessThan(headland.z - headland.core + 8);
      // Still stopped a second later: it cannot climb on.
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(1000);
      await page.keyboard.up("KeyW");
      const later = (await reef(page, (h) => h.walker()))!;
      expect(Math.abs(later.position[2] - walker.position[2])).toBeLessThan(1.2);
      // From the foot of the headland, looking at it.
      await reef(page, (h, a) => h.placeWalker(a.x, a.z, a.yaw, 0.15), { x: later.position[0], z: later.position[2], yaw: side < 0 ? Math.PI : 0 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/req-022-headland-${side < 0 ? "north" : "south"}.png` });
    }
  });

  test("from the beach the sea is open to the horizon to the north, east and south (AC-2)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await goAshore(page, 0);
    const walker = (await reef(page, (h) => h.walker()))!;
    for (const [name, yaw] of [
      ["east", Math.PI / 2],
      ["north-east", (Math.PI * 3) / 4],
      ["south-east", Math.PI / 4],
    ] as const) {
      await reef(page, (h, a) => h.placeWalker(a.x, a.z, a.yaw, 0), { x: walker.position[0], z: walker.position[2], yaw });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/req-022-beach-${name}.png` });
    }
    // From the end of the dock, where the sea is all round.
    const dock = config.bay.dock;
    for (const [name, yaw] of [
      ["north", Math.PI],
      ["east", Math.PI / 2],
      ["south", 0],
    ] as const) {
      await reef(page, (h, a) => h.placeWalker(a.x, a.z, a.yaw, 0.02), { x: dock.seaX - 0.5, z: dock.z, yaw });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/req-022-dock-${name}.png` });
    }
  });

  test("after the Bloom the game runs at 30 frames a second or more under the water at the edge and on the land (AC-7)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await bloomNow(page);
    // Under the water, at the edge, looking out to sea: the deepest view the terrain gives.
    await reef(page, (h, a) => h.placeRov(a.r - 3, -9, 5, Math.PI / 2, -0.1), { r: area.radius });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/req-022-edge-clear.png" });
    const underwater = await framesPerSecond(page, 4000);
    console.log(`REQ-022 fps under the water at the edge after the Bloom: ${underwater.toFixed(1)}`);
    expect(underwater).toBeGreaterThanOrEqual(30);
    const info = (await reef(page, (h) => h.renderInfo())) as { calls: number; triangles: number };
    console.log(`REQ-022 ${info.calls} draw calls, ${info.triangles} triangles in the frame`);
    await goAshore(page, 0);
    await page.waitForTimeout(1000);
    const onLand = await framesPerSecond(page, 4000);
    console.log(`REQ-022 fps on the land after the Bloom: ${onLand.toFixed(1)}`);
    expect(onLand).toBeGreaterThanOrEqual(30);
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the edge message is in English (G-004)", async ({ page }) => {
    await toTheEdge(page, "Edge of the dive area");
  });
});
