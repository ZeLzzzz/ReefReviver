import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { colonies, reefs } from "../../src/game/bay";

type Target = { x: number; y: number; z: number; r: number; entry: string };
type Vec = [number, number, number];
const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const heads = colonies.filter((c) => c.kind === 4);
const beltHead = heads.find((c) => reefs[c.reef].kind === "belt")!;
const belt = colonies.filter((c) => reefs[c.reef].kind === "belt" && c.kind !== 4);

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
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

/** Scans a natural coral target with the real Scanner: aim at it from a clear side, hold the button until the notice shows. */
async function scan(page: Page, target: Target) {
  // The notice of the last scan has to go first, or it would be taken for this one's.
  await expect(page.locator(".message-notice")).toBeHidden({ timeout: 6000 });
  expect(await reef(page, (h, t) => h.aimAtPoint(t.x, t.y, t.z, 6, 2, t.r), target)).toBe(true);
  await page.mouse.down();
  await expect(page.locator(".message-notice")).toHaveText(/Entri baru: Karang|Sudah tercatat/, { timeout: 20_000 });
  await page.mouse.up();
}

/** Frames per second over `ms` milliseconds, counted with requestAnimationFrame in the page. */
async function framesPerSecond(page: Page, ms: number) {
  return page.evaluate(
    (duration) =>
      new Promise<number>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
          frames++;
          if (now - start < duration) requestAnimationFrame(tick);
          else resolve(frames / ((now - start) / 1000));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

test.describe.configure({ mode: "serial" });

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("at the start the belt is in view, pale and dull; after the Bloom it turns pastel all at once (AC-1, AC-4)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    // Natural coral ahead of the start camera, within 30 m, on the screen's 100 degrees.
    const camera = (await reef(page, (h) => h.cameraPosition())) as Vec;
    const yaw = (await reef(page, (h) => h.rovYaw())) as number;
    const targets = (await reef(page, (h) => h.naturalTargets())) as Target[];
    const ahead = targets.filter((t) => {
      const dx = t.x - camera[0];
      const dz = t.z - camera[2];
      const distance = Math.hypot(dx, dz);
      return t.entry === "coral" && distance < 30 && Math.acos((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance) < (50 * Math.PI) / 180;
    });
    expect(ahead.length).toBeGreaterThanOrEqual(5);
    const before = (await reef(page, (h) => h.natureLook())) as { coral: number[] };
    expect(new Set(before.coral)).toEqual(new Set([config.nature.pale]));
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-020-start-murky.png" });
    await reef(page, (h, a) => h.placeRov(a[0], a[1], a[2], a[3], a[4]), [-102, -4, -20, 0, -0.55]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-020-belt-murky.png" });

    await bloomNow(page);
    const after = (await reef(page, (h) => h.natureLook())) as { coral: number[] };
    expect(after.coral).toEqual([...config.bloom.coral.pastel]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-020-belt-bloom.png" });
    await reef(page, (h, a) => h.placeRov(a[0], a[1], a[2], a[3], a[4]), [-96, -5, 8, Math.PI / 2, 0]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-020-start-bloom.png" });
    // A patch reef on a boulder, and a Porites head on the belt.
    const boulder = reefs.find((r) => r.host === "boulder")!;
    await reef(page, (h, a) => h.placeRov(a[0], a[1], a[2], a[3], a[4]), [boulder.x, -3.5, boulder.z - 17, 0, -0.3]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-020-patch-bloom.png" });
    await reef(page, (h, a) => h.placeRov(a[0], a[1], a[2], a[3], a[4]), [beltHead.x - 9, beltHead.y + 5, beltHead.z, Math.PI / 2, -0.3]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "test-results/req-020-head-bloom.png" });
  });

  test("the submarine stops at a Porites head, a reef blob and the belt, never inside, and can hover over them (AC-5)", async ({ page }) => {
    test.setTimeout(120_000);
    await startDive(page);
    const fits = (x: number, y: number, z: number) => reef(page, (h, a) => h.fits(a[0], a[1], a[2]), [x, y, z]);
    // Hovering 4 m above the head's top is free.
    expect(await fits(beltHead.x, beltHead.y + 5, beltHead.z)).toBe(true);
    // The head and a belt colony's middle are solid.
    expect(await fits(beltHead.x, beltHead.y + 0.8, beltHead.z)).toBe(false);
    const dense = belt.find((c) => belt.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 3).length > 8)!;
    expect(await fits(dense.x, dense.y + dense.size * 0.3, dense.z)).toBe(false);
    // Driving into the head from the west at its mid height, holding W: it meets the head and never ends up inside.
    await reef(page, (h, a) => h.placeRov(a[0], a[1], a[2], a[3], a[4]), [beltHead.x - 7, beltHead.y + 1.2, beltHead.z, Math.PI / 2, 0]);
    await page.keyboard.down("KeyW");
    let highest = -Infinity;
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(100);
      const [x, y, z] = (await reef(page, (h) => h.rovPosition())) as Vec;
      // Never inside it; and over the head's footprint it is above it (it was lifted over the head, not taken through it).
      expect(await fits(x, y, z)).toBe(true);
      if (Math.hypot(x - beltHead.x, z - beltHead.z) < beltHead.size / 2 - 0.3) expect(y).toBeGreaterThan(beltHead.y + 0.425 * beltHead.size * 0.5);
      highest = Math.max(highest, y);
    }
    await page.keyboard.up("KeyW");
    expect(highest).toBeGreaterThan(beltHead.y + 1.2 + 0.3);
    await page.screenshot({ path: "test-results/req-020-stopped.png" });
  });

  test("after the Bloom the Scanner opens Karang from the belt, from a patch reef and from a Porites head (AC-7)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    await bloomNow(page);
    await page.keyboard.press("Digit4");
    await expect(page.locator(".tool-name")).toHaveText("Scanner");
    const targets = ((await reef(page, (h) => h.naturalTargets())) as Target[]).filter((t) => t.entry === "coral");
    const near = (x: number, z: number) => targets.find((t) => Math.hypot(t.x - x, t.z - z) < 1)!;
    const hill = reefs.find((r) => r.host === "hill")!;
    await scan(page, near(beltHead.x, beltHead.z));
    await expect(page.locator(".message-notice")).toHaveText("Entri baru: Karang");
    // A belt blob and a patch reef: Karang is already in the Logbook.
    const bloom = targets.filter((t) => t.x < -95 && t.x > -112 && t.z > 20 && t.z < 60 && t.r < 3.6);
    await scan(page, bloom[0]);
    await expect(page.locator(".message-notice")).toHaveText("Sudah tercatat");
    await scan(page, targets.filter((t) => Math.hypot(t.x - hill.x, t.z - hill.z) < hill.width / 2 + 1)[0]);
    await expect(page.locator(".message-notice")).toHaveText("Sudah tercatat");
    await page.screenshot({ path: "test-results/req-020-scanned.png" });
  });

  test("every piece of trash can still be reached, and the game stays at 30 fps or more at the densest view after the Bloom (AC-6, AC-8)", async ({ page }) => {
    test.setTimeout(180_000);
    await startDive(page);
    // The pieces in the bay's water (not the ones on the beach or in the cave, which have their own rules).
    const trash = ((await reef(page, (h) => h.trash())) as Vec[]).filter(([x, y, z]) => y < -2 && Math.hypot(x - config.bay.cave.x, z - config.bay.cave.z) > config.bay.cave.clear);
    expect(trash.length).toBeGreaterThan(35);
    for (const [x, y, z] of trash) expect(await reef(page, (h, a) => h.fits(a[0], a[1], a[2]), [x, y + 2, z])).toBe(true);
    await bloomNow(page);
    // The densest view: where the most colonies lie within 14 m of a point, looked at from 9 m away and above.
    const centre = belt.reduce((best, c) => {
      const n = belt.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 14).length;
      return n > best.n ? { n, c } : best;
    }, { n: 0, c: belt[0] }).c;
    await reef(page, (h, a) => h.placeRov(a[0], a[1], a[2], a[3], a[4]), [centre.x, -4, centre.z - 9, 0, -0.35]);
    await page.waitForTimeout(1000);
    const fps = await framesPerSecond(page, 4000);
    const info = (await reef(page, (h) => h.renderInfo())) as { calls: number; triangles: number };
    console.log(`REQ-020 fps after the Bloom at the densest view: ${fps.toFixed(1)}; ${colonies.length} colonies, ${info.calls} draw calls, ${info.triangles} triangles in the frame`);
    expect(fps).toBeGreaterThanOrEqual(30);
    await page.screenshot({ path: "test-results/req-020-dense.png" });
  });
});
