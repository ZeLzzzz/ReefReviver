import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { goAshore } from "./ashore";

// REQ-035: ships passing far out at sea, seen and heard above the water only. Where they sail, how many there are and how
// often the horn sounds is checked in ships.test.ts; here, the game draws them, stops them when paused and plays the horn.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
type Shown = { visible: boolean; list: { kind: string; distance: number; bearing: number; x: number; z: number }[] };
const ships = (page: Page) => reef(page, (h) => h.ships()) as Promise<Shown>;
const horns = (page: Page) => reef(page, (h) => h.horns()) as Promise<number>;
const { bay, rov } = config;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await page.mouse.move(0, 0);
}

/** Floating at the surface in the middle of the bay, facing east, out to sea. */
async function float(page: Page) {
  await reef(page, (h, a) => h.placeRov(20, a.y, 0, Math.PI / 2, 0.02), { y: bay.surfaceY - rov.floatDepth });
  await expect.poll(() => reef(page, (h) => h.view().above)).toBe(true);
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("a dive starts with a ship out at sea, drawn above the water to the east, and none under the water (AC-1, AC-3, AC-4, AC-6)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await float(page);
    const shown = await ships(page);
    expect(shown.visible).toBe(true);
    expect(shown.list).toHaveLength(1);
    const [ship] = shown.list;
    expect(ship.distance).toBeGreaterThan(100);
    expect(ship.distance).toBeLessThan(config.ships.horn.sight);
    expect(ship.bearing).toBeGreaterThan(5);
    expect(ship.bearing).toBeLessThan(175);
    // Out at sea, east of the bay's dive area.
    expect(ship.x).toBeGreaterThan(20 + 100);

    await reef(page, (h) => h.placeRov(20, -8, 0, Math.PI / 2, 0));
    await expect.poll(() => reef(page, (h) => h.view().above)).toBe(false);
    expect((await ships(page)).visible).toBe(false);
  });

  test("the ships sail on, keep their distance as the submarine moves, and stop while paused (AC-3, AC-6)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await float(page);
    const first = (await ships(page)).list[0];
    await page.waitForTimeout(1500);
    const later = (await ships(page)).list[0];
    expect(later.bearing).not.toBeCloseTo(first.bearing, 3);
    // The lane moves with the camera: across the bay, the ship is as far away as before.
    await reef(page, (h, a) => h.placeRov(-90, a.y, 60, Math.PI / 2, 0.02), { y: bay.surfaceY - rov.floatDepth });
    await page.waitForTimeout(300);
    const moved = (await ships(page)).list[0];
    expect(Math.abs(moved.distance - later.distance)).toBeLessThan(15);

    await page.keyboard.press("Escape");
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("paused");
    const paused = (await ships(page)).list[0];
    await page.waitForTimeout(1500);
    expect((await ships(page)).list[0]).toEqual(paused);
  });

  test("from the beach a ship is out at sea; its horn sounds above the water, not under it or while paused (AC-1, AC-5)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await goAshore(page);
    const shown = await ships(page);
    expect(shown.visible).toBe(true);
    const walker = (await reef(page, (h) => h.walker().position)) as number[];
    for (const ship of shown.list) expect(ship.x).toBeGreaterThan(walker[0] + 50);

    const before = await horns(page);
    await reef(page, (h) => h.hurryHorn(0.3));
    await expect.poll(() => horns(page)).toBe(before + 1);

    // Back in the water and under it: the next horn never comes.
    await reef(page, (h) => h.newDive());
    await reef(page, (h) => h.placeRov(20, -8, 0, Math.PI / 2, 0));
    await expect.poll(() => reef(page, (h) => h.view().above)).toBe(false);
    const under = await horns(page);
    await reef(page, (h) => h.hurryHorn(0.3));
    await page.waitForTimeout(1500);
    expect(await horns(page)).toBe(under);

    // Paused at the surface: not either.
    await float(page);
    await reef(page, (h) => h.hurryHorn(1));
    await page.keyboard.press("Escape");
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("paused");
    await page.waitForTimeout(2000);
    expect(await horns(page)).toBe(under);
  });
});
