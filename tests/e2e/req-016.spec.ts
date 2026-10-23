import { expect, test, type Locator, type Page } from "@playwright/test";
import { goAshore, standAtCounter } from "./ashore";

type Vec = [number, number, number];
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** Sucks `n` pieces of trash into the tank with the Vacuum, one at a time. */
async function suck(page: Page, n: number) {
  for (let i = 1; i <= n; i++) {
    expect(await reef(page, (h) => h.aimAtTrash(3))).not.toBeNull();
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText(new RegExp(`^${i}/12$`), { timeout: 20_000 });
    await page.mouse.up();
  }
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
async function boxOf(locator: Locator): Promise<Box | null> {
  return (await locator.isVisible()) ? locator.boundingBox() : null;
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the shed with its beacon and the dock stand on the west shore, seen from the water; the map shows both (AC-1, AC-6)", async ({ page }) => {
    await startDive(page);
    const [, y] = await reef(page, (h) => h.station());
    expect(y).toBeGreaterThan(1);
    await expect(page.locator('.hud-minimap [data-kind="station"]')).toBeVisible();
    // The dock is a horizontal line on the map (zero height, so it is checked by its length, not its visibility).
    const dock = page.locator('.hud-minimap [data-kind="dock"]');
    await expect(dock).toHaveCount(1);
    expect((await dock.boundingBox())!.width).toBeGreaterThan(4);
    await reef(page, (h) => h.placeRov(-112, -1.5, 14, -Math.PI / 2 - 0.25, 0.15));
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-016-from-water.png" });
  });

  test("on foot at the counter E turns the tank into materials and ticks the goal; again with an empty tank it says so (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await suck(page, 3);
    await goAshore(page);
    await standAtCounter(page);
    await expect(page.locator(".message-prompt")).toHaveText("Tekan E untuk menyetor sampah");
    await page.screenshot({ path: "test-results/req-016-counter.png" });
    await page.keyboard.press("KeyE");
    await expect(stat(page, "tank")).toHaveText("0/12");
    await expect(stat(page, "materials")).toHaveText("3");
    await expect(page.locator(".message-notice")).toHaveText("Disetor, bahan +3");
    await expect(page.locator('.goal[data-goal="deposit"]')).toHaveClass(/done/);
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toHaveText("Tangki kosong");
    await expect(stat(page, "materials")).toHaveText("3");
  });

  test("the marker to the shed never covers the goals, the map and stats, the tool panel or a message, whichever way the submarine faces (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    // A full tank, so the message and the loud marker both show.
    await suck(page, 12);
    await expect(page.locator(".message-full")).toHaveText("Tangki penuh, setor di gudang daur ulang di darat");
    for (let k = 0; k < 16; k++) {
      await reef(page, (h, yaw) => h.placeRov(-20, -6, 20, yaw, 0), (k / 16) * Math.PI * 2);
      await page.waitForTimeout(150);
      const marker = (await boxOf(page.locator(".station-marker")))!;
      expect(marker).not.toBeNull();
      for (const selector of [".hud-goals", ".hud-minimap", ".hud-stats", ".hud-tool", ".message-full", ".message-notice", ".message-prompt"]) {
        const panel = await boxOf(page.locator(selector));
        if (panel) expect(overlaps(marker, panel), `${selector} at yaw ${k}/16`).toBe(false);
      }
    }
    await page.screenshot({ path: "test-results/req-016-marker.png" });
  });

  test("the player stands on the dock above the water and cannot walk into the shed (AC-7)", async ({ page }) => {
    await startDive(page);
    await goAshore(page);
    await reef(page, (h) => h.placeWalker(-120, 8, Math.PI / 2, 0));
    const [, y] = (await reef(page, (h) => h.walker())).position as Vec;
    expect(y).toBeCloseTo(0.9, 2);
    // From the counter, walking west into the shed's wall for 3 s: stopped in front of it.
    await standAtCounter(page);
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(3000);
    await page.keyboard.up("KeyW");
    const [x] = (await reef(page, (h) => h.walker())).position as Vec;
    const [sx] = await reef(page, (h) => h.station());
    expect(x).toBeGreaterThan(sx + 2.5);
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the full-tank message and the marker name the shed in English (G-004)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await expect(page.locator(".marker-label")).toHaveText(/^Recycling shed · \d+ m$/);
    await suck(page, 12);
    await expect(page.locator(".message-full")).toHaveText("Tank full, deposit it at the recycling shed on land");
  });
});
