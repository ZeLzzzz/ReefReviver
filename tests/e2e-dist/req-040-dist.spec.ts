import { expect, test } from "@playwright/test";

// REQ-040 AC-1: presenter mode works in the build players get, served from a sub-path, without the dev hooks.
test.use({ locale: "id-ID" });

test("with ?presenter the build shows the tag, P skips Phase 1 and then brings the Bloom with its cinematic", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/game/?presenter");
  await expect(page.locator(".presenter-tag")).toHaveText("Presenter · P: lewati fase · B: panggil kapal");
  await page.getByRole("button", { name: "Mulai" }).click();
  await expect(page.locator(".cine-skip")).toBeVisible();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Mulai menyelam" }).click({ timeout: 10_000 });
  await expect(page.locator(".crosshair")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("KeyP");
  await expect(page.locator(".message-notice")).toHaveText("Mode presenter: Fase 1 dilewati");
  await expect(page.locator(".goal-list-phase2")).toBeVisible();
  await page.keyboard.press("KeyP");
  // The Bloom's cinematic: its bars and the skip hint.
  await expect(page.locator(".cine-skip")).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "test-results/req-040-dist-bloom.png" });
});
