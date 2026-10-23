import { expect, test, type Page } from "@playwright/test";
import { boardAgain, goAshore, standAtCounter } from "./ashore";

type Vec = [number, number, number];
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);
const icons = (page: Page, kind: string) => page.locator(`.hud-minimap [data-kind="${kind}"]`);
const prompt = (page: Page) => page.locator(".message-prompt");

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** On the land: stands `distance` m from the `index`th beach item still lying there, the crosshair on it. */
async function aimAtBeach(page: Page, distance = 2, index = 0) {
  const at = await reef(page, (h, a) => h.aimAtBeachTrash(a.distance, a.index), { distance, index });
  expect(at).not.toBeNull();
  return at as Vec;
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

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("8 of the 60 pieces lie on the sand of the west beach, in 3 or 4 groups, within 7 m of the water; the sea keeps 52 (AC-1)", async ({ page }) => {
    await startDive(page);
    expect(await reef(page, (h) => h.trashTotal())).toBe(60);
    expect(await reef(page, (h) => h.beachTotal())).toBe(8);
    const beach: Vec[] = await reef(page, (h) => h.beachTrash());
    expect(beach).toHaveLength(8);
    expect(await reef(page, (h) => h.trash().length)).toBe(60);
    const waterline = -132;
    for (const [x, y, z] of beach) {
      expect(x).toBeLessThan(waterline + 8); // within the wiggle of the waterline, on its land side or just above it
      expect(x).toBeGreaterThan(waterline - 14);
      expect(y).toBeGreaterThan(0);
      expect(Math.abs(z)).toBeLessThanOrEqual(85);
    }
    // Groups: items within 8 m of one another make one group.
    const groups: Vec[][] = [];
    for (const item of beach) {
      const group = groups.find((g) => g.some((o) => Math.hypot(o[0] - item[0], o[2] - item[2]) < 8));
      if (group) group.push(item);
      else groups.push([item]);
    }
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups.length).toBeLessThanOrEqual(4);
  });

  test("on foot, aiming at a piece from 2 m asks to pick it up; E lifts it, tank +1, score +10, cleanliness up, gone in about 0.3 s (AC-2)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await goAshore(page);
    await expect(prompt(page)).toBeHidden();
    const cleanBefore = await stat(page, "cleanliness").innerText();
    const [x, , z] = await aimAtBeach(page);
    await expect(prompt(page)).toHaveText("Tekan E untuk memungut sampah");
    await page.screenshot({ path: "test-results/req-017-aiming.png" });
    await page.keyboard.press("KeyE");
    await expect(stat(page, "tank")).toHaveText("1/12");
    await expect(stat(page, "score")).toHaveText("10");
    expect(await stat(page, "cleanliness").innerText()).not.toBe(cleanBefore);
    // Lifting, then gone (the state changes after about 0.3 s of game time).
    await expect.poll(() => reef(page, (h) => h.beachStates().filter((s: string) => s === "collected").length), { timeout: 3000 }).toBe(1);
    await expect(prompt(page)).toBeHidden();
    const left: Vec[] = await reef(page, (h) => h.beachTrash());
    expect(left).toHaveLength(7);
    expect(left.some((p) => Math.hypot(p[0] - x, p[2] - z) < 0.01)).toBe(false);
    // Pressing E again at the same spot, looking at bare sand, picks up nothing.
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(300);
    await expect(stat(page, "tank")).toHaveText("1/12");
  });

  test("all 8 pieces can be reached on foot and picked up; the shed's counter takes them together with the rest of the tank (AC-3, AC-8)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await goAshore(page);
    for (let i = 1; i <= 8; i++) {
      await aimAtBeach(page, 2, 0);
      await expect(prompt(page)).toHaveText("Tekan E untuk memungut sampah");
      await page.keyboard.press("KeyE");
      await expect(stat(page, "tank")).toHaveText(`${i}/12`);
    }
    expect(await reef(page, (h) => h.beachTrash().length)).toBe(0);
    await expect(stat(page, "score")).toHaveText("80");
    await standAtCounter(page);
    await expect(prompt(page)).toHaveText("Tekan E untuk menyetor sampah");
    await page.keyboard.press("KeyE");
    await expect(stat(page, "tank")).toHaveText("0/12");
    await expect(stat(page, "materials")).toHaveText("8");
    await expect(page.locator(".message-notice")).toHaveText("Disetor, bahan +8");
  });

  test("with a full tank E leaves the piece on the sand, tank and score unchanged, and the full-tank message stays (AC-4)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await suck(page, 12);
    await goAshore(page);
    await aimAtBeach(page);
    await expect(page.locator(".message-full")).toHaveText("Tangki penuh, setor di gudang daur ulang di darat");
    const score = await stat(page, "score").innerText();
    const cleanliness = await stat(page, "cleanliness").innerText();
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(700);
    await expect(stat(page, "tank")).toHaveText("12/12");
    await expect(stat(page, "score")).toHaveText(score);
    await expect(stat(page, "cleanliness")).toHaveText(cleanliness);
    expect(await reef(page, (h) => h.beachTrash().length)).toBe(8);
    await expect(page.locator(".message-full")).toBeVisible();
    // Deposit, and the same piece can be picked up.
    await standAtCounter(page);
    await page.keyboard.press("KeyE");
    await expect(stat(page, "tank")).toHaveText("0/12");
    await aimAtBeach(page);
    await page.keyboard.press("KeyE");
    await expect(stat(page, "tank")).toHaveText("1/12");
  });

  test("no prompt and no pick-up from further than 3 m or when the crosshair is elsewhere; E still deposits at the counter and boards the submarine (AC-5)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await goAshore(page);
    // 3.6 m away, the crosshair on the piece: too far.
    await aimAtBeach(page, 3.6);
    await page.waitForTimeout(200);
    await expect(prompt(page)).toBeHidden();
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(300);
    await expect(stat(page, "tank")).toHaveText("0/12");
    // 2.8 m away: in reach.
    await aimAtBeach(page, 2.8);
    await expect(prompt(page)).toHaveText("Tekan E untuk memungut sampah");
    // In reach, but looking to the side or up at the sky.
    const walker = await reef(page, (h) => h.walker());
    await reef(page, (h, a) => h.placeWalker(a.p[0], a.p[2], a.yaw + 0.6, 0), { p: walker.position, yaw: walker.yaw });
    await expect(prompt(page)).toBeHidden();
    await reef(page, (h, a) => h.placeWalker(a.p[0], a.p[2], a.yaw, 1.1), { p: walker.position, yaw: walker.yaw });
    await expect(prompt(page)).toBeHidden();
    // The counter still deposits (here, not aiming at trash) and the submarine can still be boarded.
    await standAtCounter(page);
    await expect(prompt(page)).toHaveText("Tekan E untuk menyetor sampah");
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toHaveText("Tangki kosong");
    await boardAgain(page);
  });

  test("the submarine's vacuum does not pull trash from the sand, not even from the shallows right in front of it (AC-6)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    const [x, y, z] = (await reef(page, (h) => h.beachTrash()))[0] as Vec;
    // a few metres off the item, just under the surface in the shallows, the nozzle aimed at the piece.
    await reef(
      page,
      (h, a) => {
        const sx = a.x + 5.5;
        const dx = a.x - sx;
        h.placeRov(sx, -1.6, a.z, -Math.PI / 2, Math.atan2(a.y + 1.6, -dx));
      },
      { x, y, z },
    );
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    await expect(stat(page, "tank")).toHaveText("0/12");
    expect(await reef(page, (h) => h.beachTrash().length)).toBe(8);
  });

  test("beach pieces count for cleanliness and show as dots on the minimap from 70% (AC-7)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    // 52 of the 60 + 2 nets is 83%; the sea's pieces are gone, the beach's 8 remain.
    await reef(page, (h) => h.removeTrash(52));
    await expect(stat(page, "cleanliness")).toHaveText("83%");
    await expect(icons(page, "trash")).toHaveCount(8);
    await goAshore(page);
    await aimAtBeach(page);
    await page.keyboard.press("KeyE");
    await expect(stat(page, "cleanliness")).toHaveText("85%");
    await expect(icons(page, "trash")).toHaveCount(7);
    await page.screenshot({ path: "test-results/req-017-map.png" });
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the prompt is in English", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await goAshore(page);
    await aimAtBeach(page);
    await expect(prompt(page)).toHaveText("Press E to pick up the trash");
  });
});
