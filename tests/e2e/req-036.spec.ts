import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

// REQ-036: a boat comes into the bay and dumps trash until the Cutter capsizes it. When it comes on its own and how often,
// the trash it drops, the capsizing and the crew's swim are checked in dumper.test.ts; here, the game shows it and plays it.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
type Boat = { phase: string; position: number[]; dumped: number; crew: { phase: string; position: number[] }[] };
const boat = (page: Page) => reef(page, (h) => h.dumper()) as Promise<Boat>;
const hud = (page: Page) => reef(page, (h) => h.hud()) as Promise<any>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await page.mouse.move(0, 0);
}

/** The boat called in to stop at (40, 10), with the submarine floating nearby; waits until it has stopped. */
async function boatAt(page: Page) {
  await reef(page, (h) => h.placeRov(26, -0.3, 10, Math.PI / 2, 0.05));
  await reef(page, (h) => h.summonDumper(40, 10));
  await expect.poll(async () => (await boat(page)).phase, { timeout: 30_000 }).toBe("dumping");
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the boat comes with a notice, an urgent goal and a mark on the minimap, and its trash adds to the bay's (AC-1, AC-2)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    expect((await boat(page)).phase).toBe("waiting");
    await expect(page.locator(".goal-alert-list")).toBeHidden();
    await reef(page, (h) => h.placeRov(26, -0.3, 10, Math.PI / 2, 0.05));
    await reef(page, (h) => h.summonDumper(40, 10));
    await expect(page.locator(".message-notice")).toHaveText("Kapal membuang sampah di teluk! Balikkan dengan Cutter");
    await expect(page.locator(".goal-alert-list")).toBeVisible();
    await expect(page.locator(".goal-alert-text")).toHaveText("Balikkan kapal pembuang sampah");
    await expect(page.locator(".mm-icon[data-kind='dumper']")).toBeVisible();
    await expect.poll(async () => (await boat(page)).phase, { timeout: 30_000 }).toBe("dumping");

    const total = (await reef(page, (h) => h.trashTotal())) as number;
    const clean = (await hud(page)).cleanliness as number;
    await reef(page, (h) => h.hurryDrop(0.2));
    await expect.poll(() => reef(page, (h) => h.trashTotal())).toBe(total + 1);
    await reef(page, (h) => h.hurryDrop(0.2));
    await expect.poll(() => reef(page, (h) => h.trashTotal())).toBe(total + 2);
    expect((await boat(page)).dumped).toBe(2);
    expect((await hud(page)).cleanliness).toBeLessThanOrEqual(clean);
    // The dropped trash is there to clean: the new pieces lie near the boat.
    const near = await reef(page, (h) => h.trash().filter((p: number[]) => Math.hypot(p[0] - 40, p[2] - 10) < 5).length);
    expect(near).toBeGreaterThanOrEqual(2);
  });

  test("holding the Cutter on the hull turns the boat over: +100, the goal goes, it stops dumping, the crew swims for the beach (AC-4, AC-5)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await boatAt(page);
    const [x, y, z] = (await boat(page)).position;
    await page.keyboard.press("Digit1");
    expect(await reef(page, (h, a) => h.aimAtPoint(a.x, a.y - 0.4, a.z, 7, -1.2, 0.5), { x, y, z })).toBe(true);
    // Let go too soon: the ring empties and the boat stays upright.
    await page.mouse.down();
    await expect(page.locator(".cut-label")).toContainText("Membalikkan kapal");
    await page.mouse.up();
    await expect(page.locator(".cut-progress")).toBeHidden();
    expect((await boat(page)).phase).toBe("dumping");
    await page.mouse.down();
    await expect(page.locator(".cut-label")).toContainText("Membalikkan kapal");
    await expect.poll(async () => (await boat(page)).phase, { timeout: 10_000 }).not.toBe("dumping");
    await page.mouse.up();
    const after = await hud(page);
    expect(after.score).toBe(config.dumper.score);
    await expect(page.locator(".message-notice")).toHaveText(`Kapal pembuang sampah terbalik +${config.dumper.score}`);
    await expect(page.locator(".goal-alert-list")).toBeHidden();
    await expect(page.locator(".mm-icon[data-kind='dumper']")).toBeHidden();
    const capsized = await boat(page);
    expect(capsized.crew.every((person) => person.phase !== "aboard")).toBe(true);
    await expect.poll(async () => (await boat(page)).crew.every((person) => person.phase === "swimming"), { timeout: 10_000 }).toBe(true);
    const start = (await boat(page)).crew.map((person) => person.position[0]);
    await page.waitForTimeout(2000);
    const swum = (await boat(page)).crew.map((person) => person.position[0]);
    swum.forEach((x2, i) => expect(x2).toBeLessThan(start[i] - 1.5));
    // No more trash comes from it.
    const total = await reef(page, (h) => h.trashTotal());
    await reef(page, (h) => h.hurryDrop(0.1));
    await page.waitForTimeout(800);
    expect(await reef(page, (h) => h.trashTotal())).toBe(total);
  });

  test("the boat waits while the game is paused, and a new dive starts without it or its trash (AC-3, AC-6)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await boatAt(page);
    await reef(page, (h) => h.hurryDrop(1));
    await page.keyboard.press("Escape");
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("paused");
    const total = await reef(page, (h) => h.trashTotal());
    await page.waitForTimeout(2000);
    expect(await reef(page, (h) => h.trashTotal())).toBe(total);
    await reef(page, (h) => h.newDive());
    expect((await boat(page)).phase).toBe("waiting");
    expect(await reef(page, (h) => h.trashTotal())).toBe(config.trash.count);
  });

  test("once the Bloom begins, a boat still dumping sails away and no other comes (AC-3)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await boatAt(page);
    await reef(page, (h) => {
      h.removeTrash(80);
      h.plantAll();
    });
    await expect.poll(async () => (await boat(page)).phase, { timeout: 30_000 }).toBe("leaving");
    await expect(page.locator(".goal-alert-list")).toBeHidden();
    await expect.poll(async () => (await boat(page)).phase, { timeout: 40_000 }).toBe("done");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the boat's notice and goal are in English (AC-1)", async ({ page }) => {
    await startDive(page);
    await reef(page, (h) => h.summonDumper(40, 10));
    await expect(page.locator(".message-notice")).toHaveText("A boat is dumping trash in the bay! Capsize it with the Cutter");
    await expect(page.locator(".goal-alert-text")).toHaveText("Capsize the dumping boat");
  });
});
