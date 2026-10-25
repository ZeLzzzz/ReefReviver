import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

type Vec = [number, number, number];
type Target = { x: number; y: number; z: number; r: number; entry: string };
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const { bay, rov } = config;
const FLOAT_Y = bay.surfaceY - rov.floatDepth;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

const position = (page: Page) => reef(page, (h) => h.rovPosition() as Vec);
const camera = (page: Page) => reef(page, (h) => h.cameraPosition() as Vec);
const view = (page: Page) => reef(page, (h) => h.view() as { above: boolean; flips: number; modelY: number });
const fog = (page: Page) => reef(page, (h) => h.water() as { background: number; fogFar: number });

/** Open water in the middle of the bay, clear of the rocks, deep, facing east. */
async function openWater(page: Page, y = -6) {
  await reef(page, (h, a) => h.placeRov(60, a.y, 5, Math.PI / 2, 0), { y });
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("holding Space brings the submarine to the surface, where it floats with its dome above the water and bobs, and goes no higher (AC-1, AC-2)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await openWater(page);
    await page.keyboard.down("Space");
    await expect.poll(async () => (await position(page))[1], { timeout: 30_000 }).toBeGreaterThan(FLOAT_Y - 0.01);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-024-surface.png" });

    // Space still held: it never gets higher, and never flies over the water, over seconds of bobbing.
    const models: number[] = [];
    for (let i = 0; i < 24; i++) {
      const y = (await position(page))[1];
      expect(y).toBeLessThanOrEqual(FLOAT_Y + 1e-9);
      expect(y).toBeGreaterThan(FLOAT_Y - 0.01);
      const { modelY } = await view(page);
      models.push(modelY);
      // The dome's base is 0.5 m over the model's origin: above the water at every moment of the bobbing.
      expect(modelY + 0.5).toBeGreaterThan(bay.surfaceY);
      expect(modelY).toBeLessThan(bay.surfaceY + 0.2);
      await page.waitForTimeout(250);
    }
    // It rocks: the model's height moves over those seconds, gently.
    expect(Math.max(...models) - Math.min(...models)).toBeGreaterThan(0.02);
    expect(Math.max(...models) - Math.min(...models)).toBeLessThan(0.2);
    await page.keyboard.up("Space");

    // Shift dives it again.
    await page.keyboard.down("ShiftLeft");
    await expect.poll(async () => (await position(page))[1], { timeout: 30_000 }).toBeLessThan(FLOAT_Y - 2);
    await page.keyboard.up("ShiftLeft");
  });

  test("the camera follows out of the water; the view switches to the sky once it is clear of the surface (AC-3, AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await openWater(page, -4);
    expect((await view(page)).above).toBe(false);
    await page.waitForTimeout(400);
    const under = await fog(page);
    expect(under.background).not.toBe(config.land.sky);
    await page.screenshot({ path: "test-results/req-024-under.png" });

    await page.keyboard.down("Space");
    await expect.poll(async () => (await position(page))[1], { timeout: 30_000 }).toBeGreaterThan(FLOAT_Y - 0.01);
    await page.keyboard.up("Space");
    await page.waitForTimeout(500);
    const eye = await camera(page);
    const sub = await position(page);
    // Behind and above, out of the water, not held at the surface.
    expect(eye[1]).toBeGreaterThan(bay.surfaceY + 1);
    expect(eye[1] - sub[1]).toBeGreaterThan(config.camera.height - 0.1);
    expect(Math.hypot(eye[0] - sub[0], eye[2] - sub[2])).toBeGreaterThan(config.camera.distance * 0.8);
    expect((await view(page)).above).toBe(true);
    expect((await fog(page)).background).toBe(config.land.sky);
    await page.screenshot({ path: "test-results/req-024-above.png" });

    // Diving brings the underwater look back.
    await page.keyboard.down("ShiftLeft");
    await expect.poll(async () => (await view(page)).above, { timeout: 30_000 }).toBe(false);
    await page.keyboard.up("ShiftLeft");
    expect((await fog(page)).background).not.toBe(config.land.sky);
  });

  test("with the camera right at the waterline the view does not flicker; it changes once per crossing (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    // Level with the ship the camera is camera.height above it: put the ship so the camera hovers at the waterline.
    const base = bay.surfaceY - config.camera.height;
    const band = config.camera.surfaceBand;
    await reef(page, (h, a) => h.placeRov(60, a.y, 5, Math.PI / 2, 0), { y: base });
    await page.waitForTimeout(500);
    const start = await view(page);
    expect(start.above).toBe(false);
    // The ship drifts up and down by most of the band for a few seconds, camera across the waterline over and over.
    for (let i = 0; i < 60; i++) {
      const dy = Math.sin(i * 0.9) * band * 0.8;
      await reef(page, (h, a) => h.placeRov(60, a.y, 5, Math.PI / 2, 0), { y: base + dy });
      await page.waitForTimeout(40);
    }
    const hovering = await view(page);
    expect(hovering.flips).toBe(start.flips);
    expect(hovering.above).toBe(false);

    // Really going up: one change, and one when going down again.
    await reef(page, (h, a) => h.placeRov(60, a.y, 5, Math.PI / 2, 0), { y: base + band * 3 });
    await expect.poll(async () => (await view(page)).above).toBe(true);
    for (let i = 0; i < 40; i++) {
      await reef(page, (h, a) => h.placeRov(60, a.y, 5, Math.PI / 2, 0), { y: base + band * 3 + Math.sin(i) * band * 0.8 });
      await page.waitForTimeout(30);
    }
    expect((await view(page)).flips).toBe(start.flips + 1);
    await reef(page, (h, a) => h.placeRov(60, a.y, 5, Math.PI / 2, 0), { y: base - band * 3 });
    await expect.poll(async () => (await view(page)).above).toBe(false);
    expect((await view(page)).flips).toBe(start.flips + 2);
  });

  test("floating, the vacuum and the tool keys work as before, and E goes ashore from the surface (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await openWater(page);
    await page.keyboard.down("Space");
    await expect.poll(async () => (await position(page))[1], { timeout: 30_000 }).toBeGreaterThan(FLOAT_Y - 0.01);
    await page.keyboard.up("Space");

    for (const [key, name] of [
      ["Digit1", "1 Cutter"],
      ["Digit3", "3 Seed launcher"],
      ["Digit2", "2 Vacuum"],
    ]) {
      await page.keyboard.press(key);
      await expect(page.locator(".tool-name")).toHaveText(name);
    }
    await page.keyboard.press("Digit2");
    await page.mouse.down();
    await expect.poll(() => page.locator(".hud.sucking").count()).toBe(1);
    await page.screenshot({ path: "test-results/req-024-vacuum.png" });
    await page.mouse.up();
    // The submarine did not leave the surface.
    expect((await position(page))[1]).toBeCloseTo(FLOAT_Y, 5);

    // Floating off the beach, E goes ashore (REQ-015 AC-1) with the submarine left floating at the same height.
    await reef(page, (h, a) => {
      let x = -100;
      while (!h.ashoreSpot(x, a.z)) x -= 0.5;
      h.placeRov(x - 3, a.y, a.z, -Math.PI / 2, 0.1);
    }, { z: 0, y: FLOAT_Y });
    await expect(page.locator(".message-prompt")).toHaveText("Tekan E untuk naik ke darat");
    await page.keyboard.press("KeyE");
    await expect.poll(() => reef(page, (h) => h.onLand() && !h.inTransition())).toBe(true);
    expect((await reef(page, (h) => h.subPosition() as Vec))[1]).toBeCloseTo(FLOAT_Y, 5);
    await page.screenshot({ path: "test-results/req-024-ashore.png" });
  });

  test("the Scanner works from the surface over a meadow after the Bloom (AC-5)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await reef(page, (h) => {
      h.removeTrash(50);
      h.plantAll();
    });
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 90_000 }).toBe("done");
    await page.keyboard.press("Digit4");
    await expect(page.locator(".tool-name")).toHaveText("4 Scanner");
    const meadows = ((await reef(page, (h) => h.naturalTargets())) as Target[]).filter((t) => t.entry === "seagrass");
    meadows.sort((a, b) => b.y - a.y);
    // Floating right above the shallowest meadow, the camera above the water, looking down at it.
    await reef(page, (h, t) => h.placeRov(t.x, -0.3, t.z, Math.PI / 2, -1.0), meadows[0]);
    await page.waitForTimeout(500);
    expect((await camera(page))[1]).toBeGreaterThan(bay.surfaceY);
    await page.screenshot({ path: "test-results/req-024-scan.png" });
    await page.mouse.down();
    await expect.poll(() => reef(page, (h) => h.unlocked()), { timeout: 30_000 }).toContain("seagrass");
    await page.mouse.up();
  });

  test("the cave's roof still stops the camera, with the camera low in the tunnel (AC-6)", async ({ page }) => {
    await startDive(page);
    const info = await reef(page, (h) => h.cave());
    const mid = info.path[Math.floor(info.path.length / 2)] as { x: number; y: number; z: number };
    for (const pitch of [-0.8, 0, 0.6]) {
      await reef(page, (h, a) => h.placeRov(a.p.x, a.p.y, a.p.z, Math.PI / 2, a.pitch), { p: mid, pitch });
      await page.waitForTimeout(300);
      const eye = await camera(page);
      // The roof's underside over the middle of the tunnel is what holds it down.
      expect(eye[1]).toBeLessThan(info.hole.under);
      expect((await reef(page, (h) => h.cave())).cameraLevel).toBeGreaterThan(0.5);
    }
    await page.screenshot({ path: "test-results/req-024-cave.png" });
  });
});
