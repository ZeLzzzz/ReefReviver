import { expect, test, type Page } from "@playwright/test";
import { grassBlades } from "../../src/game/grass";
import { inland } from "../../src/game/terrain";
import { goAshore, standAtCounter } from "./ashore";

type Look = { blades: number; colour: number; time: number };
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

/** The average colour of the grass as 0xRRGGBB: greener than it is red or blue. */
const isGreen = (colour: number) => ((colour >> 8) & 0xff) > ((colour >> 16) & 0xff) && ((colour >> 8) & 0xff) > (colour & 0xff);

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

/** A blade about `metres` inland and about 30 m north of the shed, clear of the palms and rocks, so a walk east crosses only grass. */
const spotInland = (metres: number) => grassBlades.find((b) => Math.abs(inland(b.x, b.z) - metres) < 0.5 && Math.abs(b.z + 30) < 6)!;

/** On the land, standing on the grass about `metres` inland, facing the sea (east) and looking a little down. */
async function standOnGrass(page: Page, metres: number) {
  const spot = spotInland(metres);
  await reef(page, (h, s) => h.placeWalker(s.x, s.z, Math.PI / 2, -0.3), spot);
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

test.describe.configure({ mode: "serial" });

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("grass grows on the west beach from 8 m inland, and shows from the land and from the submarine at the surface (AC-1)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const look = (await reef(page, (h) => h.grass())) as Look;
    expect(look.blades).toBeGreaterThan(10_000);
    expect(look.blades).toBe(grassBlades.length);
    expect(isGreen(look.colour)).toBe(true);

    // From the submarine at the surface, facing the beach, before the Bloom: the water is murky, so the land is faint.
    await reef(page, (h) => h.placeRov(-126, -0.6, 0, -Math.PI / 2, 0.02));
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-018-surface-murky.png" });

    // On the land, 12 m inland, facing the sea, looking down at the grass.
    await goAshore(page, 0);
    await standOnGrass(page, 12);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-018-land.png" });
  });

  test("on foot the player walks through the grass at walking speed, which the grass does not slow (AC-2)", async ({ page }) => {
    await startDive(page);
    await goAshore(page, 0);
    await standOnGrass(page, 12);
    const from = (await reef(page, (h) => h.walker()))!.position;
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(1000);
    await page.keyboard.up("KeyW");
    const to = (await reef(page, (h) => h.walker()))!.position;
    // Walking at about 4 m/s for one second, east (toward the sea), over the grass.
    const walked = Math.hypot(to[0] - from[0], to[2] - from[2]);
    expect(walked).toBeGreaterThan(3);
    expect(walked).toBeLessThan(5);
    expect(to[0]).toBeGreaterThan(from[0]);
    await page.screenshot({ path: "test-results/req-018-walk.png" });
  });

  test("the grass stays green through the Bloom, and the wind keeps it swaying (AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const before = (await reef(page, (h) => h.grass())) as Look;
    expect(isGreen(before.colour)).toBe(true);
    await bloomNow(page);
    const after = (await reef(page, (h) => h.grass())) as Look;
    expect(after.colour).toBe(before.colour);
    expect(after.time).toBeGreaterThan(before.time);
    await page.waitForTimeout(1000);
    const later = (await reef(page, (h) => h.grass())) as Look;
    expect(later.time).toBeGreaterThan(after.time);
  });

  test("the counter's zone stays clear, so the player can still deposit at the shed with the grass around it (AC-2, AC-3)", async ({ page }) => {
    await startDive(page);
    await goAshore(page, 0);
    await standAtCounter(page);
    await expect(page.locator(".message-prompt")).toHaveText("Tekan E untuk menyetor sampah");
    await page.screenshot({ path: "test-results/req-018-counter.png" });
  });

  test("after the Bloom the game runs at 30 frames a second or more on the land, with the grass (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await bloomNow(page);
    await goAshore(page, 0);
    await standOnGrass(page, 12);
    await page.waitForTimeout(500);
    const fps = await framesPerSecond(page, 3000);
    console.log(`REQ-018 fps on land after the Bloom: ${fps.toFixed(1)}`);
    expect(fps).toBeGreaterThanOrEqual(30);
  });
});
