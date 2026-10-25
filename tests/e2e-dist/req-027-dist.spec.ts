import { expect, test } from "@playwright/test";

// REQ-027 AC-1, AC-6: in the build for players the opening always plays (the browser tests' switch that turns the cinematics off
// exists only in the dev server, with the test hooks), on the first Mulai after the page opens, and again after a refresh.
test.use({ locale: "id-ID" });

test("the production build plays the opening on Mulai, skips with Space, and plays it again after a refresh (AC-1, AC-3, AC-4, AC-6)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));

  for (const round of [1, 2]) {
    await page.goto("/game/");
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe("scene");
    // No hooks in this build, and the cinematic is on: bars, hint, narration, and no HUD or crosshair.
    expect(await page.evaluate(() => "__reef" in window)).toBe(false);
    await expect(page.locator(".hud.cinematic")).toBeVisible();
    await expect(page.locator(".cine-bar-top")).toBeVisible();
    await expect(page.locator(".cine-skip")).toHaveText("Klik atau Spasi untuk melewati");
    await expect(page.locator(".crosshair")).toBeHidden();
    await expect(page.locator(".hud-goals")).toBeHidden();
    await expect(page.locator(".cine-caption")).toHaveText("Teluk ini dulu penuh kehidupan.", { timeout: 15_000 });
    await page.screenshot({ path: `test-results/req-027-dist-opening-${round}.png` });

    // Space skips it, and the player has the HUD.
    await page.keyboard.press("Space");
    await expect(page.locator(".crosshair")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".hud-goals")).toBeVisible();
    await expect(page.locator(".cine")).toBeHidden();
    await page.screenshot({ path: `test-results/req-027-dist-playing-${round}.png` });
  }
  expect(errors).toEqual([]);
});
