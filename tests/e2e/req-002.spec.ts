import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
type Hook = {
  trash(): Vec[];
  rocks(): [number, number, number, number][];
  station(): Vec;
  rovPosition(): Vec;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
};
const reef = <T>(page: Page, fn: (hook: Hook) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__reef.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position, which would turn
  // the ROV at every click. Park the cursor at (0, 0), where that movement is zero, before aiming.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** Puts the ROV 3 m from the nearest free trash item, towards the bay's centre, aimed straight at it. */
async function aimAtNearestTrash(page: Page, distance = 3): Promise<Vec> {
  return page.evaluate((d) => {
    const reef = (window as any).__reef as Hook;
    const [px, , pz] = reef.rovPosition();
    const items = reef.trash();
    items.sort((a, b) => Math.hypot(a[0] - px, a[2] - pz) - Math.hypot(b[0] - px, b[2] - pz));
    const [x, y, z] = items[0];
    const len = Math.hypot(x, z) || 1;
    const rx = x - (x / len) * d;
    const rz = z - (z / len) * d;
    const ry = y + 1;
    reef.placeRov(rx, ry, rz, Math.atan2(x - rx, z - rz), Math.atan2(y - ry, d));
    return items[0];
  }, distance);
}

/** Holds the left mouse button until the tank reaches `count`, then lets go. */
async function suckUntil(page: Page, count: number) {
  await page.mouse.down();
  await expect(stat(page, "tank")).toHaveText(new RegExp(`^${count}/8$`), { timeout: 20_000 });
  await page.mouse.up();
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("goals are listed at the start (AC-6)", async ({ page }) => {
    await startDive(page);
    await expect(page.locator(".goal-text")).toHaveText(["Bersihkan teluk 0%/80%", "Bebaskan satwa 0/2", "Setor sampah ke stasiun"]);
    await expect(page.locator(".goal.done")).toHaveCount(0);
    await expect(page.locator(".tool-name")).toHaveText("2 Vacuum");
    await expect(stat(page, "tank")).toHaveText("0/8");
    await page.screenshot({ path: "test-results/req-002-start.png" });
  });

  test("hold left click on trash: it flies to the drone, the tank, score and cleanliness rise (AC-1, AC-5)", async ({ page }) => {
    await startDive(page);
    const before = await reef(page, (h) => h.trash().length);
    await aimAtNearestTrash(page);
    await page.mouse.down();
    await expect.poll(() => page.locator(".hud.sucking").count()).toBe(1);
    await page.screenshot({ path: "test-results/req-002-sucking.png" });
    await expect(stat(page, "tank")).toHaveText("1/8", { timeout: 20_000 });
    await page.mouse.up();
    await expect(stat(page, "score")).toHaveText("10");
    await expect(stat(page, "cleanliness")).toHaveText("2%");
    expect(await reef(page, (h) => h.trash().length)).toBe(before - 1);
  });

  test("nothing is sucked without the Vacuum button held, or aimed at a rock (AC-7)", async ({ page }) => {
    await startDive(page);
    await aimAtNearestTrash(page);
    await page.waitForTimeout(1500);
    await expect(stat(page, "tank")).toHaveText("0/8");

    // Face the biggest rock from 3 m away, keeping clear of the trash in the cone.
    const clear = await page.evaluate(() => {
      const hook = (window as any).__reef as Hook;
      const trash = hook.trash();
      for (const [x, y, z, size] of hook.rocks()) {
        const len = Math.hypot(x, z) || 1;
        const rx = x - (x / len) * (size + 3);
        const rz = z - (z / len) * (size + 3);
        const yaw = Math.atan2(x - rx, z - rz);
        const ahead = trash.some(([tx, , tz]) => {
          const dx = tx - rx;
          const dz = tz - rz;
          const d = Math.hypot(dx, dz);
          return d < 10 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d > 0.6;
        });
        if (ahead) continue;
        hook.placeRov(rx, y + 0.5, rz, yaw, 0);
        return true;
      }
      return false;
    });
    expect(clear).toBe(true);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    await expect(stat(page, "tank")).toHaveText("0/8");
    await expect(stat(page, "score")).toHaveText("0");
  });

  test("full tank: no more suction, message and marker to the station; deposit with E (AC-2, AC-3, AC-4, AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    for (let n = 1; n <= 8; n++) {
      await aimAtNearestTrash(page);
      await suckUntil(page, n);
    }
    await expect(stat(page, "tank")).toHaveText("8/8");
    await expect(stat(page, "score")).toHaveText("80");
    await expect(stat(page, "cleanliness")).toHaveText("19%");
    await expect(page.locator(".message-full")).toHaveText("Tangki penuh, setor ke stasiun");
    await expect(page.locator(".station-marker")).toBeVisible();
    await expect(page.locator(".marker-label")).toContainText("Stasiun daur ulang");
    await page.screenshot({ path: "test-results/req-002-full.png" });

    // A ninth item is not sucked.
    const left = await reef(page, (h) => h.trash().length);
    await aimAtNearestTrash(page);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    await expect(stat(page, "tank")).toHaveText("8/8");
    expect(await reef(page, (h) => h.trash().length)).toBe(left);

    // E outside the zone does nothing.
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(500);
    await expect(stat(page, "tank")).toHaveText("8/8");

    // At the station: the zone prompt shows, E empties the tank into materials; cleanliness stays.
    await reef(page, (h) => {
      const [x, y, z] = h.station();
      h.placeRov(x + 2, y + 2, z + 2, 0, 0);
    });
    await expect(page.locator(".message-prompt")).toHaveText("Tekan E untuk menyetor sampah");
    await page.keyboard.press("KeyE");
    await expect(stat(page, "tank")).toHaveText("0/8");
    await expect(stat(page, "materials")).toHaveText("8");
    await expect(stat(page, "cleanliness")).toHaveText("19%");
    await expect(page.locator(".message-notice")).toHaveText("Disetor, bahan +8");
    await expect(page.locator(".message-full")).toBeHidden();
    await expect(page.locator('.goal[data-goal="deposit"]')).toHaveClass(/done/);
    await page.screenshot({ path: "test-results/req-002-deposited.png" });

    // E again with an empty tank.
    await page.keyboard.press("KeyE");
    await expect(page.locator(".message-notice")).toHaveText("Tangki kosong");
    await expect(stat(page, "materials")).toHaveText("8");
  });

  test("key 4 does nothing yet; the pause controls list the new controls", async ({ page }) => {
    await startDive(page);
    for (const key of ["Digit4", "Digit2"]) await page.keyboard.press(key);
    await expect(page.locator(".tool-name")).toHaveText("2 Vacuum");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Kontrol" }).click();
    const rows = await page.locator(".controls dt").evaluateAll((els) => els.map((el) => `${el.textContent} = ${el.nextElementSibling?.textContent}`));
    expect(rows).toContain("Klik kiri = Pakai alat (tahan)");
    expect(rows).toContain("2 = Pilih Vacuum");
    expect(rows).toContain("E = Setor sampah atau pasang rangka");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the HUD is in English and follows a language change while paused (G-004)", async ({ page }) => {
    await startDive(page);
    await expect(page.locator(".goal-text")).toHaveText(["Clean the bay 0%/80%", "Free the animals 0/2", "Deposit trash at the station"]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Language" }).click();
    await page.getByRole("button", { name: "Indonesia" }).click();
    await page.getByRole("button", { name: "Kembali" }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(page.locator(".goal-text").first()).toHaveText("Bersihkan teluk 0%/80%");
  });
});
