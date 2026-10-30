import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

// REQ-038: oil slicks at the sea surface. Where they lie, their shape and how the vacuum takes them are checked in
// oil.test.ts; here, the game draws them on the water, the vacuum takes them into the tank, and a new dive brings them back.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
type Slick = { id: number; state: string; position: number[]; home: number[] };
type SlickModel = { y: number; tilt: number; width: number; visible: boolean };
const slicks = (page: Page) => reef(page, (h) => h.oil()) as Promise<Slick[]>;
const models = (page: Page) => reef(page, (h) => h.oilModels()) as Promise<SlickModel[]>;
const stat = (page: Page, name: string) => page.locator(`.stat-${name} .stat-value`);
const { bay, trash } = config;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await page.mouse.move(0, 0);
}

/** Mean brightness of a square of the screenshot around (x, y). */
async function brightness(page: Page, x: number, y: number, half = 6): Promise<number> {
  const png = await page.screenshot({ clip: { x: x - half, y: y - half, width: half * 2, height: half * 2 } });
  return page.evaluate(async (data) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    return sum / (pixels.length / 4);
  }, png.toString("base64"));
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("a dive starts with 4 oil slicks lying flat on the water, about 2 m across, out of 60 pieces of trash (AC-1, AC-2)", async ({ page }) => {
    await startDive(page);
    expect(await reef(page, (h) => h.trashTotal())).toBe(trash.count);
    const all = await slicks(page);
    expect(all).toHaveLength(trash.oil.count);
    expect(all.every((s) => s.state === "free")).toBe(true);
    for (let i = 0; i < 6; i++) {
      for (const model of await models(page)) {
        expect(model.visible).toBe(true);
        expect(model.tilt).toBe(0);
        expect(model.width).toBeGreaterThan(trash.oil.size * 0.8);
        expect(model.width).toBeLessThan(trash.oil.size * 1.4);
        expect(Math.abs(model.y - (bay.surfaceY + trash.oil.lift))).toBeLessThanOrEqual(trash.surface.bob.amplitude + 1e-6);
      }
      await page.waitForTimeout(300);
    }
  });

  test.describe("on a 1280x720 screen", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("seen from under the water a slick is a dark patch on the surface (AC-2)", async ({ page }) => {
      await startDive(page);
      // Close under it, 1.5 m down: further off, the murky water's fog pales it like everything else.
      const slick = (await reef(page, (h) => h.aimAtSurfaceTrash(3, 1.5, false, true))) as number[] | null;
      expect(slick).not.toBeNull();
      await expect.poll(() => reef(page, (h) => h.view().above)).toBe(false);
      await page.waitForTimeout(2500);
      const [x, y] = (await reef(page, (h, a) => h.screenOf(a[0], a[1] + 0.03, a[2]), slick)) as number[];
      const withSlick = await brightness(page, x, y, 4);
      await page.screenshot({ path: "test-results/req-038-below.png" });
      // The same spot with the floating things taken away: the bare surface seen from below.
      await reef(page, (h) => h.removeSurfaceTrash());
      await page.waitForTimeout(400);
      expect(withSlick).toBeLessThan((await brightness(page, x, y, 4)) - 20);
    });
  });

  test("the vacuum takes a slick from the floating submarine into the tank, and one from under the water too (AC-3)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await page.keyboard.press("Digit2");
    const first = (await reef(page, (h) => h.aimAtSurfaceTrash(4, 0, true, true))) as number[] | null;
    expect(first).not.toBeNull();
    await page.waitForTimeout(500);
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText("1/12", { timeout: 15_000 });
    await page.mouse.up();
    let taken = (await slicks(page)).filter((s) => s.state === "collected");
    expect(taken).toHaveLength(1);
    expect(taken[0].home[0]).toBeCloseTo(first![0], 3);
    // One of 60 pieces of trash and 2 nets.
    await expect(stat(page, "cleanliness")).toHaveText("1%");

    const second = (await reef(page, (h) => h.aimAtSurfaceTrash(4, 2, true, true))) as number[] | null;
    expect(second).not.toBeNull();
    await page.waitForTimeout(500);
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText("2/12", { timeout: 15_000 });
    await page.mouse.up();
    taken = (await slicks(page)).filter((s) => s.state === "collected");
    expect(taken).toHaveLength(2);
  });

  test("from 70% cleanliness the slicks left show on the minimap as trash dots, and a taken one's dot goes (AC-4)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    const dots = () => page.locator('.hud-minimap [data-kind="trash"]');
    await expect(dots()).toHaveCount(0);
    // 44 of 60 trash and 2 nets is just over 70%: the floor's 40 and four of the beach's 8, so the oil is all still there.
    await reef(page, (h) => {
      h.removeTrash(40);
      h.removeTrash(4, true);
    });
    const free = (await reef(page, (h) => h.trash())) as number[][];
    await expect(dots()).toHaveCount(free.length);
    expect((await slicks(page)).filter((s) => s.state === "free")).toHaveLength(trash.oil.count);
    await page.keyboard.press("Digit2");
    expect(await reef(page, (h) => h.aimAtSurfaceTrash(4, 0, true, true))).not.toBeNull();
    await page.waitForTimeout(500);
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText("1/12", { timeout: 15_000 });
    await page.mouse.up();
    await expect(dots()).toHaveCount(free.length - 1);
  });

  test("a new dive brings all 4 slicks back, laid for that dive (AC-5)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await page.keyboard.press("Digit2");
    expect(await reef(page, (h) => h.aimAtSurfaceTrash(4, 0, true, true))).not.toBeNull();
    await page.waitForTimeout(500);
    await page.mouse.down();
    await expect(stat(page, "tank")).toHaveText("1/12", { timeout: 15_000 });
    await page.mouse.up();
    const before = (await slicks(page)).map((s) => s.home);
    await reef(page, (h) => h.newDive());
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    const after = await slicks(page);
    expect(after).toHaveLength(trash.oil.count);
    expect(after.every((s) => s.state === "free")).toBe(true);
    expect(after.map((s) => s.home)).not.toEqual(before);
    expect((await models(page)).every((m) => m.visible)).toBe(true);
  });
});
