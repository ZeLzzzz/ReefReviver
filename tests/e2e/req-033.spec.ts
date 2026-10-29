import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { boardAgain, goAshore } from "./ashore";

// REQ-033: the tools as a hotbar at the bottom centre. The phone's hotbar (tapping a slot, hidden on the land, clear of the
// touch controls) is in req-030.spec.ts.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await reef(page, (h) => h.placeRov(60, -6, 5, Math.PI / 2, 0));
}

const held = (page: Page) => page.locator(".hotbar-slot.held").getAttribute("data-tool");
const caption = (page: Page) => page.locator(".hotbar-caption");

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the four tools sit in a hotbar at the bottom centre; the frame follows 1–4, and the name and hint fade after a while (AC-1, AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await expect(page.locator(".hotbar-slot")).toHaveCount(4);
    expect(await page.locator(".hotbar-slot").evaluateAll((slots) => slots.map((slot) => (slot as HTMLElement).dataset.tool))).toEqual(["cutter", "vacuum", "seedLauncher", "scanner"]);
    const bar = (await page.locator(".hotbar-slots").boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(Math.abs(bar.x + bar.width / 2 - viewport.width / 2)).toBeLessThan(2);
    expect(viewport.height - (bar.y + bar.height)).toBeLessThan(24);

    // The dive has just begun: the name and hint show, then fade.
    expect(await held(page)).toBe("vacuum");
    await expect(caption(page)).toHaveClass(/shown/);
    await expect(page.locator(".tool-hint")).toHaveText("Tahan klik kiri untuk menyedot sampah");
    await expect(caption(page)).not.toHaveClass(/shown/, { timeout: (config.hud.toolCaptionSeconds + 2) * 1000 });
    await expect.poll(() => caption(page).evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(0.05);

    for (const [key, tool, name] of [["Digit1", "cutter", "Cutter"], ["Digit3", "seedLauncher", "Seed launcher"]]) {
      await page.keyboard.press(key);
      await expect.poll(() => held(page)).toBe(tool);
      await expect(caption(page)).toHaveClass(/shown/);
      await expect(page.locator(".tool-name")).toHaveText(name);
    }

    // The Vacuum's slot fills while it pulls.
    await page.keyboard.press("Digit2");
    await reef(page, (h) => h.aimAtTrash(0));
    await page.mouse.down();
    await expect(page.locator(".hotbar-slot.working")).toHaveAttribute("data-tool", "vacuum");
    await page.mouse.up();
    await expect(page.locator(".hotbar-slot.working")).toHaveCount(0);
  });

  test("the Scanner is dim with a lock until the Bloom, and 4 says why instead of picking it; the scroll wheel picks nothing (AC-4, AC-7)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const scanner = page.locator(".hotbar-slot[data-tool='scanner']");
    await expect(scanner).toHaveClass(/locked/);
    await expect(scanner.locator(".hotbar-lock")).toBeVisible();
    await expect(scanner.locator(".visually-hidden")).toHaveText("4 Scanner, terkunci");
    await page.keyboard.press("Digit4");
    await expect(page.locator(".message-notice")).toHaveText("Scanner aktif setelah laut pulih");
    expect(await held(page)).toBe("vacuum");
    await page.mouse.wheel(0, 300);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
    expect(await held(page)).toBe("vacuum");

    await reef(page, (h) => {
      h.removeTrash(50);
      h.plantAll();
    });
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
    await expect(scanner).not.toHaveClass(/locked/);
    await expect(scanner.locator(".hotbar-lock")).toBeHidden();
    await page.keyboard.press("Digit4");
    await expect.poll(() => held(page)).toBe("scanner");
    await expect(scanner.locator(".visually-hidden")).toHaveText("4 Scanner, dipegang");
  });

  test("on the land the hotbar goes, and back in the submarine it returns with the tool's name (AC-3, AC-5)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await goAshore(page);
    await expect(page.locator(".hotbar")).toBeHidden();
    await boardAgain(page);
    await expect(page.locator(".hotbar")).toBeVisible();
    await expect(caption(page)).toHaveClass(/shown/);
  });

  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1024, height: 640 }, { width: 800, height: 450 }]) {
    test(`at ${size.width}×${size.height} the hotbar and its caption keep off the goals, minimap, stats, messages and crosshair (AC-5)`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(size);
      await startDive(page);
      const overlaps = () =>
        page.evaluate(() => {
          const shown = (el: Element) => (el as HTMLElement).offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
          const rect = (selector: string) => [...document.querySelectorAll(selector)].filter(shown).map((el) => el.getBoundingClientRect());
          const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          const bar = [...rect(".hotbar-slots"), ...rect(".hotbar-caption")];
          const others = [".hud-goals", ".hud-minimap", ".hud-stats", ".message", ".crosshair"].flatMap((selector) => rect(selector).map((r) => ({ selector, r })));
          return bar.flatMap((b) => others.filter(({ r }) => hit(b, r)).map(({ selector }) => selector));
        });
      // The Cutter's name and hint over the hotbar.
      await page.keyboard.press("Digit1");
      await expect(caption(page)).toHaveClass(/shown/);
      expect(await overlaps()).toEqual([]);
      // A message (the locked Scanner's notice) takes the place right above the hotbar; the caption steps aside for it.
      await page.keyboard.press("Digit4");
      await expect(page.locator(".message-notice")).toBeVisible();
      await expect.poll(() => caption(page).evaluate((el) => getComputedStyle(el).visibility)).toBe("hidden");
      expect(await overlaps()).toEqual([]);
      const notice = (await page.locator(".message-notice").boundingBox())!;
      const slots = (await page.locator(".hotbar-slots").boundingBox())!;
      expect(slots.y - (notice.y + notice.height)).toBeLessThanOrEqual(10);
    });
  }
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the names, hints and slot words are in English (AC-6)", async ({ page }) => {
    await startDive(page);
    await expect(page.locator(".tool-name")).toHaveText("Vacuum");
    await expect(page.locator(".tool-hint")).toHaveText("Hold left click to suck up trash");
    expect(await page.locator(".hotbar-slot .visually-hidden").allTextContents()).toEqual(["1 Cutter", "2 Vacuum, in hand", "3 Seed launcher", "4 Scanner, locked"]);
  });
});
