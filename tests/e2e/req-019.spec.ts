import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

type Target = { x: number; y: number; z: number; r: number; entry: string };
type Look = { coral: number[]; seagrass: number; bladesShown: number; blades: number; sand: number; sandOpacity: number; rays: number };
type Patch = { x: number; y: number; z: number; seeds: number };
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const setup = config.nature.meadows;

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

/** The meadows: a natural target stands 0.9 m above the floor in the middle of each. */
const meadows = async (page: Page) => ((await reef(page, (h) => h.naturalTargets())) as Target[]).filter((t) => t.entry === "seagrass");

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("the natural meadows lie on the shallow sand, and so do the five spots for the player's patches (AC-1, AC-4)", async ({ page }) => {
    await startDive(page);
    const found = await meadows(page);
    expect(found.length).toBeGreaterThanOrEqual(8);
    expect(found.length).toBeLessThanOrEqual(12);
    for (const m of found) {
      const floor = m.y - config.scanner.meadowHeight;
      expect(floor).toBeLessThan(-1);
      expect(floor).toBeGreaterThan(-7);
      // In front of the west beach, not out in the bay.
      expect(m.x).toBeLessThan(-105);
    }
    const { patches } = (await reef(page, (h) => h.reefSites())) as { patches: Patch[] };
    expect(patches).toHaveLength(2);
    for (const p of patches) {
      expect(p.y).toBeLessThan(-2);
      expect(p.y).toBeGreaterThan(-5);
      expect(p.seeds).toBe(0);
      expect(Math.min(...found.map((m) => Math.hypot(m.x - p.x, m.z - p.z)))).toBeLessThan(20);
    }
    const look = (await reef(page, (h) => h.natureLook())) as Look;
    expect(look.blades).toBeGreaterThan(15_000);
  });

  test("a meadow is a dense, sparse-and-brown carpet before the Bloom and a lush green one after it, steadily, without flashes (AC-2, AC-3)", async ({ page }) => {
    test.setTimeout(150_000);
    await startDive(page);
    const meadow = (await meadows(page))[1];
    // Level with the ship, a few metres off, looking over the meadow; then from above.
    const view = async (name: string) => {
      await reef(page, (h, m) => h.placeRov(m.x + 7, m.y + 1.3, m.z, -Math.PI / 2, -0.15), meadow);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `test-results/req-019-${name}-side.png` });
      await reef(page, (h, m) => h.placeRov(m.x + 3, m.y + 0.7, m.z, -Math.PI / 2, -0.35), meadow);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `test-results/req-019-${name}-close.png` });
    };
    const before = (await reef(page, (h) => h.natureLook())) as Look;
    expect(before.seagrass).toBe(setup.brown);
    expect(before.bladesShown / before.blades).toBeGreaterThan(setup.sparse - 0.05);
    expect(before.bladesShown / before.blades).toBeLessThan(setup.sparse + 0.05);
    expect(before.sandOpacity).toBe(setup.sand.opacityBefore);
    await view("before");

    // Through the Bloom: the leaves only ever fill in and the colours only move toward the clear-water ones.
    await reef(page, (h) => {
      h.removeTrash(50);
      h.plantAll();
    });
    let last = before;
    const seen: Look[] = [];
    for (let i = 0; i < 400; i++) {
      const now = (await reef(page, (h) => h.natureLook())) as Look;
      expect(now.bladesShown).toBeGreaterThanOrEqual(last.bladesShown);
      expect(now.sandOpacity).toBeGreaterThanOrEqual(last.sandOpacity - 1e-9);
      expect(now.bladesShown - last.bladesShown).toBeLessThan(now.blades * 0.25);
      seen.push(now);
      last = now;
      if ((await reef(page, (h) => h.bloom().state)) === "done") break;
      await page.waitForTimeout(100);
    }
    await expect.poll(() => reef(page, (h) => h.bloom().state), { timeout: 60_000 }).toBe("done");
    await page.waitForTimeout(500);
    const after = (await reef(page, (h) => h.natureLook())) as Look;
    expect(after.seagrass).toBe(setup.green);
    expect(after.sand).toBe(setup.sand.green);
    expect(after.bladesShown).toBe(after.blades);
    expect(after.bladesShown).toBeGreaterThan(before.bladesShown * 2.5);
    expect(seen.length).toBeGreaterThan(5);
    await view("after");
  });

  test("the ship passes over and through the seagrass; a seed shot at it is lost, not counted; a patch on the shallow sand can still be planted (AC-4, AC-5)", async ({ page }) => {
    test.setTimeout(150_000);
    await startDive(page);
    const meadow = (await meadows(page))[3];
    // The ship fits right down among the leaves of a meadow.
    const floor = meadow.y - config.scanner.meadowHeight;
    expect(await reef(page, (h, m) => h.fits(m.x, m.floor + 1, m.z), { x: meadow.x, z: meadow.z, floor })).toBe(true);
    // A seed that lands on the meadow plants nothing.
    await page.keyboard.press("Digit3");
    await expect(page.locator(".tool-name")).toHaveText("3 Seed launcher");
    expect(await reef(page, (h, t) => h.aimAtPoint(t.x, t.y, t.z, 8, 2, 1), { x: meadow.x, y: floor, z: meadow.z })).toBe(true);
    await page.mouse.down();
    await page.waitForTimeout(2500);
    await page.mouse.up();
    let { patches } = (await reef(page, (h) => h.reefSites())) as { patches: Patch[] };
    expect(patches.every((p) => p.seeds === 0)).toBe(true);
    // The first patch is bare shallow sand: three seeds plant it.
    const p = patches[0];
    expect(await reef(page, (h, t) => h.aimAtPoint(t.x, t.y, t.z, 8, 2, 1), p)).toBe(true);
    await page.mouse.down();
    await expect.poll(async () => (((await reef(page, (h) => h.reefSites())) as { patches: Patch[] }).patches[0].seeds), { timeout: 30_000 }).toBe(3);
    await page.mouse.up();
    patches = ((await reef(page, (h) => h.reefSites())) as { patches: Patch[] }).patches;
    expect(patches[0].seeds).toBe(3);
    await expect(page.locator(".message-notice")).toHaveText("Petak lamun ditanami, skor +50");
    await page.screenshot({ path: "test-results/req-019-planted.png" });
  });

  test("after the Bloom the Scanner opens Lamun from a natural meadow, then says it is already recorded (AC-6)", async ({ page }) => {
    test.setTimeout(150_000);
    await startDive(page);
    await bloomNow(page);
    await page.keyboard.press("Digit4");
    await expect(page.locator(".tool-name")).toHaveText("4 Scanner");
    const meadow = (await meadows(page))[2];
    const aim = async () => expect(await reef(page, (h, t) => h.aimAtPoint(t.x, t.y, t.z, 9, 1.2, 1), meadow)).toBe(true);
    await aim();
    await page.mouse.down();
    await expect.poll(() => reef(page, (h) => h.unlocked()), { timeout: 20_000 }).toContain("seagrass");
    await page.mouse.up();
    await expect(page.locator(".message-notice")).toHaveText("Entri baru: Lamun");
    // Another meadow, entry already in the Logbook.
    const other = (await meadows(page))[4];
    expect(await reef(page, (h, t) => h.aimAtPoint(t.x, t.y, t.z, 9, 1.2, 1), other)).toBe(true);
    await page.mouse.down();
    await expect(page.locator(".message-notice")).toHaveText("Sudah tercatat", { timeout: 10_000 });
    await page.mouse.up();
    await page.screenshot({ path: "test-results/req-019-scanned.png" });
  });

  test("a ship hovering right above a meadow, the camera looking down at it, can scan it after the Bloom (AC-6)", async ({ page }) => {
    test.setTimeout(150_000);
    await startDive(page);
    await bloomNow(page);
    await page.keyboard.press("Digit4");
    await expect(page.locator(".tool-name")).toHaveText("4 Scanner");
    // Over shallow water the camera used to sit almost on top of the ship (REQ-024 lets it rise out of the water now): inside
    // any sphere the meadow's target could have, which a ray starting inside cannot hit.
    const hover = async (m: Target) => reef(page, (h, t) => h.placeRov(t.x, t.y + 0.7, t.z, Math.PI / 2, -1.0), m);
    const [first, second] = await meadows(page);
    await hover(first);
    await page.screenshot({ path: "test-results/req-019-hover-scan.png" });
    await page.mouse.down();
    await expect.poll(() => reef(page, (h) => h.unlocked()), { timeout: 20_000 }).toContain("seagrass");
    await page.mouse.up();
    await expect(page.locator(".message-notice")).toHaveText("Entri baru: Lamun");
    await hover(second);
    await page.mouse.down();
    await expect(page.locator(".message-notice")).toHaveText("Sudah tercatat", { timeout: 10_000 });
    await page.mouse.up();
  });

  test("the game keeps at least 30 fps after the Bloom with the ship above a meadow (AC-7)", async ({ page }) => {
    test.setTimeout(150_000);
    await startDive(page);
    await bloomNow(page);
    const meadow = (await meadows(page))[1];
    await reef(page, (h, m) => h.placeRov(m.x + 4, m.y + 1.1, m.z, -Math.PI / 2, -0.3), meadow);
    await page.waitForTimeout(800);
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const start = performance.now();
          const tick = () => {
            frames++;
            if (performance.now() - start >= 3000) resolve((frames * 1000) / (performance.now() - start));
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(`fps above a meadow after the Bloom: ${fps.toFixed(1)}`);
    expect(fps).toBeGreaterThanOrEqual(30);
  });
});
