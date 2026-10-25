import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
type Hook = {
  mode(): string;
  rovPosition(): Vec;
  rovYaw(): number;
  station(): Vec;
  trashTotal(): number;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
  fits(x: number, y: number, z: number): boolean;
  removeTrash(n: number): number;
  plantAll(): void;
  bloom(): { state: string };
};
const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the dive starts off the west shore by the dock, facing east into a bay of 60 pieces of trash and a 12-item tank (AC-1, AC-5)", async ({ page }) => {
    await startDive(page);
    const [x] = await reef(page, (h) => h.rovPosition());
    // The shed stands on the land behind the beach (REQ-016), a short way from the start.
    const [sx] = await reef(page, (h) => h.station());
    expect(x).toBeLessThan(-80);
    expect(x - sx).toBeGreaterThan(20);
    expect(x - sx).toBeLessThan(60);
    // Facing east (clicking Mulai can turn it a little under pointer lock; the exact start is a unit test).
    expect(Math.sin(await reef(page, (h) => h.rovYaw()))).toBeGreaterThan(0.5);
    expect(await reef(page, (h) => h.trashTotal())).toBe(60);
    await expect(page.locator(".stat-tank .stat-value")).toHaveText("0/12");
    await expect(page.locator(".marker-label")).toHaveText(/^Gudang daur ulang · \d+ m$/);
  });

  test("the minimap shades the land and the depth of the floor, and no longer a rock wall (AC-6, changed by REQ-022)", async ({ page }) => {
    await startDive(page);
    const shades = await page.locator(".hud-minimap .mm-terrain").evaluateAll((els) => els.map((el) => el.getAttribute("data-shade")));
    expect(shades).toEqual(expect.arrayContaining(["land", "depth-0", "depth-1", "depth-2", "depth-3"]));
    expect(shades).not.toContain("wall");
    // The landmarks are drawn over the terrain.
    await expect(page.locator('.hud-minimap [data-kind="station"]')).toBeVisible();
    await page.locator(".hud-minimap").screenshot({ path: "test-results/req-011-minimap.png" });
  });

  test("holding W to the east stops the ROV at the edge of the dive area, inside the map (AC-3, changed by REQ-022: an invisible edge, not a rock wall)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    // In the middle of the bay, facing east toward the edge about 90 m away.
    await reef(page, (h) => h.placeRov(60, -9, 5, Math.PI / 2, 0));
    await page.keyboard.down("KeyW");
    let last: Vec = await reef(page, (h) => h.rovPosition());
    await expect
      .poll(
        async () => {
          const now = await reef(page, (h) => h.rovPosition());
          const step = Math.hypot(now[0] - last[0], now[2] - last[2]);
          last = now;
          return now[0] > 100 && step < 0.05;
        },
        { timeout: 90_000, intervals: [1000] },
      )
      .toBe(true);
    await page.keyboard.up("KeyW");
    const [x, y] = last;
    expect(x).toBeLessThan(150);
    expect(y).toBeLessThan(0);
    // Right ahead, the ROV does not fit: the dive area ends there.
    expect(await reef(page, (h, a) => h.fits(a.x + 2, a.y, a.z), { x: last[0], y: last[1], z: last[2] })).toBe(false);
    await page.screenshot({ path: "test-results/req-011-edge-murky.png" });
  });

  test("after the Bloom the hills, boulders and the open sea at the edge are in view (AC-1)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await reef(page, (h) => {
      h.removeTrash(50);
      h.plantAll();
    });
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
    for (const [name, at] of [
      ["hill", [0, -6, -24, Math.PI / 2, -0.15]],
      ["arch", [3, -9, -75, 0.4, -0.1]],
      ["edge", [100, -6, 60, 1.0, 0]],
    ] as const) {
      await reef(page, (h, a) => h.placeRov(a[0], a[1], a[2], a[3], a[4]), at);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/req-011-clear-${name}.png` });
    }
  });
});
