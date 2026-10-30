import { devices, expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { LOGBOOK_ENTRIES } from "../../src/logbook/entries";

// REQ-039: SDG 14 under the mission card's title, and on the end screen what restoring a bay takes in real life, what the
// player can do and a link to SDG 14. The texts are checked in mission.test.ts and end.test.ts; here, they show and fit.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
const { defaultBrowserType: _, ...phone } = devices["Pixel 7 landscape"];

/** The opening played to its end with the cinematics on: the mission card shows. */
async function toMissionCard(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
  await reef(page, (h) => h.cinematics(true));
  await page.getByRole("button", { name: /^(Mulai|Start)$/ }).click();
  await expect.poll(() => reef(page, (h) => h.cinematic())).not.toBeNull();
  await reef(page, (h, a) => h.seekCinematic(a.seconds), { seconds: config.cinematic.opening.duration - 0.6 });
  await expect(page.locator(".mission-screen")).toBeVisible({ timeout: 15_000 });
}

/** A dive with every Logbook entry scanned: the end screen shows. */
async function toEndScreen(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Mulai|Start)$/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  for (const entry of LOGBOOK_ENTRIES) await reef(page, (h, id) => h.scanEntry(id), entry.id);
  await expect(page.locator(".end-screen")).toBeVisible({ timeout: 20_000 });
}

/** The panel lies inside the window, and each of `parts` can be scrolled into view inside it. */
async function wholeAndReachable(page: Page, panel: string, parts: string[]) {
  const viewport = page.viewportSize()!;
  const box = await page.locator(panel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, sideways: el.scrollWidth > el.clientWidth + 1 };
  });
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(viewport.width);
  expect(box.bottom).toBeLessThanOrEqual(viewport.height);
  expect(box.sideways).toBe(false);
  for (const part of parts) {
    const locator = page.locator(part).first();
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeInViewport();
  }
}

for (const [name, device] of [
  ["a computer at 800x450", { viewport: { width: 800, height: 450 } }],
  ["a computer at 1920x1080", { viewport: { width: 1920, height: 1080 } }],
  ["a phone held sideways at 765x360", { ...phone, viewport: { width: 765, height: 360 } }],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ ...device, locale: "id-ID" });

    test("the mission card names SDG 14 under its title, and stays whole (AC-1, AC-4)", async ({ page }) => {
      test.setTimeout(90_000);
      await toMissionCard(page);
      const line = page.locator(".mission-sdg");
      await expect(line).toHaveText("ReefReviver mendukung SDG 14: Ekosistem Lautan");
      expect(await line.evaluate((el) => el.previousElementSibling?.tagName)).toBe("H1");
      await wholeAndReachable(page, ".panel.mission", [".mission-sdg", ".mission-dumper", "button.primary"]);
    });

    test("the end screen says what restoring a bay takes, what to do, and links SDG 14, and stays whole (AC-2, AC-3, AC-4)", async ({ page }) => {
      test.setTimeout(90_000);
      await toEndScreen(page);
      const real = page.locator(".end-real");
      await expect(real.locator("h2")).toHaveText("Di dunia nyata");
      await expect(real.locator("p")).toHaveText("Terumbu karang dan padang lamun butuh bertahun-tahun untuk pulih. Yang bisa kamu lakukan:");
      await expect(real.locator("li")).toHaveCount(3);
      const link = real.locator("a");
      await expect(link).toHaveText("Pelajari SDG 14 di situs PBB");
      await expect(link).toHaveAttribute("href", "https://sdgs.un.org/goals/goal14");
      await expect(link).toHaveAttribute("target", "_blank");
      await wholeAndReachable(page, ".panel.end", [".end-real h2", ".end-real a", ".end-actions button.primary"]);
      await page.screenshot({ path: `test-results/req-039-end-${page.viewportSize()!.width}.png` });
    });
  });
}

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the card and the end screen say it in English (AC-1, AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(90_000);
    await toMissionCard(page);
    await expect(page.locator(".mission-sdg")).toHaveText("ReefReviver supports SDG 14: Life Below Water");
    await toEndScreen(page);
    await expect(page.locator(".end-real h2")).toHaveText("In real life");
    await expect(page.locator(".end-real a")).toHaveText("Learn about SDG 14 on the UN website");
  });
});
