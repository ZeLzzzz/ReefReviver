import { expect, test, type Page } from "@playwright/test";
import { goAshore } from "./ashore";

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

const propellers = (page: Page) => reef(page, (h) => h.propellers() as number[]);

/** Whether the propellers turned in the next half second. */
async function turning(page: Page): Promise<boolean> {
  const before = await propellers(page);
  await page.waitForTimeout(500);
  const after = await propellers(page);
  return before.some((angle, i) => angle !== after[i]);
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the propellers spin while the submarine moves, and hold still when it stops or the game is paused (AC-3)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(60, -6, 5, Math.PI / 2, 0));
    expect(await propellers(page)).toHaveLength(2);
    expect(await turning(page)).toBe(false);

    await page.keyboard.down("KeyW");
    await page.waitForTimeout(500);
    expect(await turning(page)).toBe(true);
    await page.keyboard.up("KeyW");
    // The submarine glides to a stop (rov.acceleration), and the propellers with it.
    await page.waitForTimeout(3000);
    expect(await turning(page)).toBe(false);

    await page.keyboard.down("KeyW");
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("paused");
    expect(await turning(page)).toBe(false);
    await page.keyboard.up("KeyW");
  });

  test("the propellers of the submarine left at the beach hold still while the player walks (AC-3)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await goAshore(page);
    await page.keyboard.down("KeyW");
    expect(await turning(page)).toBe(false);
    await page.keyboard.up("KeyW");
  });
});
