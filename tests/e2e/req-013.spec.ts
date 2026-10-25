import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

type Target = { x: number; y: number; z: number; r: number; entry: string };
type Look = { coral: number[]; seagrass: number; bladesShown: number; rays: number };
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

async function bloomNow(page: Page) {
  await reef(page, (h) => {
    h.removeTrash(50);
    h.plantAll();
  });
  await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
}

/** Scans a natural target with the real Scanner: aim at it from a clear side, hold the button until the entry opens. */
async function scan(page: Page, target: Target, entry: string) {
  // Clear of rock up to the target's own size: a coral cluster is solid itself.
  expect(await reef(page, (h, t) => h.aimAtPoint(t.x, t.y, t.z, 6, 1, t.r), target)).toBe(true);
  await page.mouse.down();
  await expect.poll(() => reef(page, (h) => h.unlocked()), { timeout: 20_000 }).toContain(entry);
  await page.mouse.up();
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("before the Bloom the coral is pale, the meadows sparse and brown and there are no rays; after it the reef is bright, lush and lit (AC-1, AC-2, AC-3, AC-8)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const targets = (await reef(page, (h) => h.naturalTargets())) as Target[];
    expect(targets.filter((t) => t.entry === "coral").length).toBeGreaterThan(50);
    const meadowCount = targets.filter((t) => t.entry === "seagrass").length;
    expect(meadowCount).toBeGreaterThanOrEqual(10);
    expect(meadowCount).toBeLessThanOrEqual(12);
    // The deepest meadow, looked at from just above it: REQ-019 put the meadows in the shallows and REQ-024 lets the ROV
    // float with its camera out of the water, but the rays are an underwater sight, so the camera must stay down.
    const meadow = targets.filter((t) => t.entry === "seagrass").sort((a, b) => a.y - b.y)[0];
    await reef(page, (h, m) => h.placeRov(m.x, m.y + 1.1, m.z, Math.PI / 2, -0.1), meadow);
    await page.waitForTimeout(500);
    expect((await reef(page, (h) => h.view())).above).toBe(false);
    const before = (await reef(page, (h) => h.natureLook())) as Look;
    expect(new Set(before.coral)).toEqual(new Set([config.nature.pale]));
    expect(before.seagrass).toBe(config.nature.meadows.brown);
    expect(before.rays).toBe(0);
    await page.screenshot({ path: "test-results/req-013-before.png" });

    await bloomNow(page);
    await page.waitForTimeout(500);
    const after = (await reef(page, (h) => h.natureLook())) as Look;
    expect(after.coral).toEqual([...config.bloom.coral.pastel]);
    expect(after.seagrass).toBe(config.nature.meadows.green);
    expect(after.bladesShown).toBeGreaterThan(before.bladesShown * 2.5);
    expect(after.rays).toBeGreaterThan(0);
    await page.screenshot({ path: "test-results/req-013-after.png" });
  });

  test("after the Bloom the Scanner opens Karang from a natural coral and Lamun from a natural meadow (AC-5, AC-8)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    await bloomNow(page);
    await page.keyboard.press("Digit4");
    await expect(page.locator(".tool-name")).toHaveText("4 Scanner");
    const targets = (await reef(page, (h) => h.naturalTargets())) as Target[];
    await scan(page, targets.find((t) => t.entry === "coral" && t.y < -10)!, "coral");
    await expect(page.locator(".message-notice")).toHaveText("Entri baru: Karang");
    await scan(page, targets.find((t) => t.entry === "seagrass")!, "seagrass");
    await expect(page.locator(".message-notice")).toHaveText("Entri baru: Lamun");
    await page.screenshot({ path: "test-results/req-013-scanned.png" });
  });
});
