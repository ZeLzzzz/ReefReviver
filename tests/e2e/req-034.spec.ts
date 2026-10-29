import { devices, expect, test, type Page } from "@playwright/test";

// REQ-034: on a phone held sideways (a touch screen at most 480 px high) the HUD is about a fifth smaller. The phone is
// Chromium as a Pixel 7 held sideways, sized like the user's Android (765×360), as in req-030.spec.ts. That the touch
// controls still cover no panel, hotbar or message is checked there, at 640×360, 765×360 and 1366×1024 (AC-3).

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
const { defaultBrowserType: _, ...phone } = devices["Pixel 7 landscape"];

// Measured at 765×360 just before REQ-034 (2026-10-30): the panels and touch controls below covered 110,824 px².
const COVERED_BEFORE = 110_824;
const PARTS = [".hud-goals", ".hud-stats", ".hud-minimap", ".touch-menu-button", ".hotbar-slots", ".stick", ".touch-use", ".touch-rise", ".touch-dive", ".touch-interact"];

async function dive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Mulai|Start)$/ }).tap();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".touch-use")).toBeVisible();
}

const size = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  });
const font = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontSize);

test.describe("phone 765×360", () => {
  test.use({ ...phone, viewport: { width: 765, height: 360 }, locale: "id-ID" });

  test("the HUD text is 13 px and the buttons, hotbar and minimap are the smaller sizes (AC-1)", async ({ page }) => {
    await dive(page);
    for (const selector of [".goal-text", ".stat-label", ".tool-hint", ".marker-label"]) expect(await font(page, selector), selector).toBe("13px");
    expect(await size(page, ".stick")).toEqual([96, 96]);
    expect(await size(page, ".touch-use")).toEqual([68, 68]);
    expect(await size(page, ".touch-rise")).toEqual([44, 44]);
    expect(await size(page, ".touch-dive")).toEqual([44, 44]);
    expect(await size(page, ".touch-interact")).toEqual([46, 46]);
    expect(await size(page, ".touch-menu-button")).toEqual([36, 36]);
    expect(await size(page, ".hotbar-slot")).toEqual([40, 40]);
    const [map] = await size(page, ".hud-minimap svg");
    expect(Math.abs(map - 360 * 0.26)).toBeLessThanOrEqual(1);
  });

  test("the panels and controls cover at least a quarter less of the screen than before (AC-2)", async ({ page }) => {
    await dive(page);
    const covered = await page.evaluate((parts) => {
      let area = 0;
      for (const selector of parts) {
        for (const el of document.querySelectorAll(selector)) {
          if ((el as HTMLElement).offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
          const r = el.getBoundingClientRect();
          area += r.width * r.height;
        }
      }
      return area;
    }, PARTS);
    expect(covered).toBeLessThanOrEqual(COVERED_BEFORE * 0.75);
  });
});

for (const locale of ["id-ID", "en-US"]) {
  test.describe(`phone 640×360, ${locale}`, () => {
    test.use({ ...phone, viewport: { width: 640, height: 360 }, locale });

    test("the stat labels and four-digit numbers stay on one line, and the goals end above the joystick (AC-4)", async ({ page }) => {
      await dive(page);
      await reef(page, (h) => h.giveMaterials(1250));
      await expect(page.locator(".stat-materials .stat-value")).toHaveText("1250");
      const rows = await page.locator(".hud-stats .stat").evaluateAll((stats) =>
        stats.map((row) => {
          const label = row.querySelector(".stat-label")!;
          const value = row.querySelector(".stat-value")!;
          const line = parseFloat(getComputedStyle(row).lineHeight) || parseFloat(getComputedStyle(row).fontSize) * 1.35;
          return {
            text: row.textContent,
            oneLine: row.getBoundingClientRect().height <= line * 1.2,
            fits: label.getBoundingClientRect().right <= value.getBoundingClientRect().left && value.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.5,
          };
        }),
      );
      for (const row of rows) expect(row, row.text ?? "").toMatchObject({ oneLine: true, fits: true });
      const goals = (await page.locator(".hud-goals").boundingBox())!;
      const stick = (await page.locator(".stick").boundingBox())!;
      expect(goals.y + goals.height).toBeLessThan(stick.y);
    });
  });
}

test.describe("tablet 1024×768", () => {
  test.use({ ...phone, viewport: { width: 1024, height: 768 }, locale: "id-ID" });

  test("a tablet keeps the full sizes (AC-5)", async ({ page }) => {
    await dive(page);
    expect(await font(page, ".goal-text")).toBe("16px");
    expect(await size(page, ".stick")).toEqual([112, 112]);
    expect(await size(page, ".touch-use")).toEqual([84, 84]);
    expect(await size(page, ".touch-menu-button")).toEqual([44, 44]);
    expect(await size(page, ".hotbar-slot")).toEqual([56, 56]);
  });
});

test.describe("computer", () => {
  test.use({ viewport: { width: 1280, height: 720 }, locale: "id-ID" });

  test("a computer keeps the full sizes and no touch controls (AC-5)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    expect(await font(page, ".goal-text")).toBe("16px");
    expect(await size(page, ".hotbar-slot")).toEqual([56, 56]);
    await expect(page.locator(".touch")).toHaveCount(0);
  });
});
