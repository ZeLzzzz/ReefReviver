import { expect, test, type Page } from "@playwright/test";

type Vec = [number, number, number];
const mode = (page: Page) => page.evaluate(() => (window as any).__reef.mode() as string);
const rovPosition = (page: Page) => page.evaluate(() => (window as any).__reef.rovPosition() as Vec);
const rovYaw = (page: Page) => page.evaluate(() => (window as any).__reef.rovYaw() as number);

test.describe("desktop, Indonesian browser", () => {
  test.use({ locale: "id-ID" });

  test("title screen over the murky bay (AC-1, AC-3)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ReefReviver" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Bahasa" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("title");
    await page.screenshot({ path: "test-results/req-001-title.png" });
  });

  test("dive, pause with Esc, resume where the ROV stopped (AC-3, AC-5)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe("scene");
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(page.locator(".crosshair")).toBeVisible();

    // Headless Chromium renders in software at a few frames per second, so wait for movement instead of timing it.
    const start = await rovPosition(page);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => Math.hypot(...(await rovPosition(page)).map((v, i) => v - start[i])), { timeout: 15_000 }).toBeGreaterThan(2);
    await page.keyboard.up("KeyW");
    const moved = await rovPosition(page);
    const yaw = await rovYaw(page);
    // W moves along the ROV's heading.
    const along = (moved[0] - start[0]) * Math.sin(yaw) + (moved[2] - start[2]) * Math.cos(yaw);
    expect(along).toBeGreaterThan(2);
    await page.screenshot({ path: "test-results/req-001-playing.png" });

    // The mouse steers. Synthetic CDP mouse moves carry no movementX under pointer lock, so send one directly.
    await page.evaluate(() => document.dispatchEvent(new MouseEvent("mousemove", { movementX: 400 })));
    await expect.poll(() => rovYaw(page)).toBeLessThan(yaw - 0.5);

    await page.keyboard.down("KeyS");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
    const paused = await rovPosition(page);
    await page.waitForTimeout(1500);
    expect(await rovPosition(page)).toEqual(paused);
    await page.keyboard.up("KeyS");
    await page.screenshot({ path: "test-results/req-001-paused.png" });

    // Chrome refuses to re-lock right after Esc; the game asks to click again instead of failing silently.
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    // Same dive, same place: at most the glide of a frame or two, never a reset to the start.
    const resumed = await rovPosition(page);
    const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(distance(resumed, paused)).toBeLessThan(1);
    expect(distance(resumed, start)).toBeGreaterThan(1);
  });

  test("pauses when the browser releases the cursor, e.g. on alt-tab (AC-6)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => mode(page)).toBe("playing");
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
  });

  test("language choice survives a reload (AC-2)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("desktop, English browser", () => {
  test.use({ locale: "en-US" });

  test("starts in English (AC-2)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  });

  test("explains a missing WebGL 2 instead of a black screen (AC-8)", async ({ page }) => {
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === "webgl2" ? null : (getContext as any).call(this, type, ...rest);
      } as typeof getContext;
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "This browser can't run ReefReviver" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/req-001-no-webgl.png" });
  });
});

test.describe("phone", () => {
  test.use({
    locale: "id-ID",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });

  test("asks to play on a computer (AC-7)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Mainkan di komputer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mulai" })).toHaveCount(0);
    await page.screenshot({ path: "test-results/req-001-phone.png" });
  });
});
