import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { goAshore } from "./ashore";

// REQ-037: the blinking marker to the dumping boat, the line under its goal that says how to turn it over, and the
// sentence on the mission card. The HUD's texts are checked in dumper-marker.test.ts and mission.test.ts; here, the game
// places the marker, blinks it, keeps it off the panels and the station's marker, and takes it away.

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;
type Boat = { phase: string; position: number[] };
const boat = (page: Page) => reef(page, (h) => h.dumper()) as Promise<Boat>;
const marker = (page: Page) => page.locator(".dumper-marker");
const { defaultBrowserType: _, ...phone } = devices["Pixel 7 landscape"];
const label = (page: Page) => page.locator(".dumper-marker-label");

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await page.mouse.move(0, 0);
}

/** Calls the boat in to stop at (x, z) and waits until it has stopped there. */
async function boatAt(page: Page, x: number, z: number) {
  await reef(page, (h, a) => h.summonDumper(a.x, a.z), { x, z });
  await expect.poll(async () => (await boat(page)).phase, { timeout: 30_000 }).toBe("dumping");
}

type Box = { left: number; top: number; right: number; bottom: number };
const box = (locator: Locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }) as Promise<Box>;
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The marker's box is clear of the station's marker and of every HUD panel and message that shows (AC-3). */
async function clearOfTheRest(page: Page) {
  const mine = await box(marker(page));
  for (const selector of [".station-marker", ".hud-goals", ".hud-stats", ".minimap", ".hotbar", ".message:not([hidden])"]) {
    for (const other of await page.locator(selector).all()) {
      if (!(await other.isVisible())) continue;
      expect(overlaps(mine, await box(other)), selector).toBe(false);
    }
  }
}

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  // On a roomy screen nothing is in the marker's way, so it sits right over the boat; on smaller ones it may move off a
  // panel (AC-3, checked at the default 800x450 below).
  test.describe("on a 1280x720 screen", () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test("a blinking '!' with the boat's name and distance hangs over the boat in view and rides the edge toward it out of view (AC-1, AC-2)", async ({ page }) => {
      test.setTimeout(90_000);
      await startDive(page);
      // Floating 30 m west of where the boat stops, facing it (east).
      await reef(page, (h) => h.placeRov(20, -0.3, 10, Math.PI / 2, 0.05));
      await expect(marker(page)).toBeHidden();
      await boatAt(page, 50, 10);
      await expect(marker(page)).toBeVisible();
      await expect(marker(page)).toHaveClass(/on-screen/);
      const [bx, by, bz] = (await boat(page)).position;
      const rov = (await reef(page, (h) => h.rovPosition())) as number[];
      const shown = Number((await label(page).textContent())!.match(/^!Kapal pembuang sampah · (\d+) m$/)![1]);
      expect(Math.abs(shown - Math.hypot(bx - rov[0], bz - rov[2]))).toBeLessThanOrEqual(1);
      // In view it hangs over the boat: its pointer is right above the boat on the screen.
      const over = (await reef(page, (h, a) => h.screenOf(a.x, a.y + 3, a.z), { x: bx, y: by, z: bz })) as number[];
      const placed = await box(marker(page));
      expect(Math.abs((placed.left + placed.right) / 2 - over[0])).toBeLessThan(40);
      expect(Math.abs((placed.top + placed.bottom) / 2 - over[1])).toBeLessThan(60);
      // The "!" blinks; the label does not.
      expect(await page.locator(".dumper-marker-mark").evaluate((el) => getComputedStyle(el).animationName)).toBe("dumper-blink");
      expect(await label(page).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      await clearOfTheRest(page);

      // Turned away (facing south, so the boat in the east is to the right): the marker rides the right edge, pointing right.
      await reef(page, (h) => h.placeRov(20, -0.3, 10, Math.PI, 0.05));
      await expect(marker(page)).not.toHaveClass(/on-screen/);
      const edge = await box(marker(page));
      expect(edge.right).toBeGreaterThan(page.viewportSize()!.width - config.hud.markerMargin - 200);
      const angle = await page.locator(".dumper-marker-arrow").evaluate((el) => el.style.transform);
      expect(Number(angle.match(/rotate\((-?[\d.]+)rad\)/)![1])).toBeGreaterThan(0.5);
      await clearOfTheRest(page);
    });
  });

  test("when the boat and the shed lie the same way, the boat's marker moves beside the shed's instead of over it (AC-3)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(30, -6, 8, Math.PI / 2, 0));
    // The boat stops west of the submarine, toward the shed: both behind, both markers pointing down at the bottom.
    await boatAt(page, -40, 8);
    await expect(marker(page)).toBeVisible();
    await expect(page.locator(".station-marker")).toBeVisible();
    await clearOfTheRest(page);
    // Facing them (west), both in view.
    await reef(page, (h) => h.placeRov(30, -6, 8, -Math.PI / 2, 0));
    await page.waitForTimeout(300);
    await clearOfTheRest(page);
  });

  test("the line under the goal says how to turn the boat over, and the marker and the line go when it capsizes (AC-4, AC-5)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(26, -0.3, 10, Math.PI / 2, 0.05));
    await boatAt(page, 40, 10);
    await expect(page.locator(".goal-alert-hint")).toHaveText("Pegang Cutter (1), dekati kapal, bidik lambungnya, lalu tahan klik kiri");
    await expect(page.locator(".goal-alert-hint")).toBeVisible();
    const [x, y, z] = (await boat(page)).position;
    await page.keyboard.press("Digit1");
    expect(await reef(page, (h, a) => h.aimAtPoint(a.x, a.y - 0.4, a.z, 7, -1.2, 0.5), { x, y, z })).toBe(true);
    await page.mouse.down();
    await expect.poll(async () => (await boat(page)).phase, { timeout: 10_000 }).not.toBe("dumping");
    await page.mouse.up();
    await expect(marker(page)).toBeHidden();
    await expect(page.locator(".goal-alert-list")).toBeHidden();
  });

  test("on the beach the marker still points at the boat, with the distance from the player (AC-1)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await goAshore(page);
    await boatAt(page, 0, 8);
    await expect(marker(page)).toBeVisible();
    const walker = (await reef(page, (h) => h.walker().position)) as number[];
    const [bx, , bz] = (await boat(page)).position;
    const shown = Number((await label(page).textContent())!.match(/· (\d+) m$/)![1]);
    expect(Math.abs(shown - Math.hypot(bx - walker[0], bz - walker[2]))).toBeLessThanOrEqual(1);
    await clearOfTheRest(page);
  });

  test("during a cinematic the marker hides with the rest of the HUD (AC-4)", async ({ page }) => {
    test.setTimeout(90_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(20, -6, 10, Math.PI / 2, 0));
    await boatAt(page, 50, 10);
    await expect(marker(page)).toBeVisible();
    // The Bloom's cinematic, with the boat still in the bay.
    await reef(page, (h) => h.cinematics(true));
    await reef(page, (h) => {
      h.freeAnimals();
      h.removeTrash(1000);
      h.plantAll();
    });
    await expect.poll(async () => ((await reef(page, (h) => h.cinematic())) as { kind: string } | null)?.kind, { timeout: 20_000 }).toBe("bloom");
    await expect(marker(page)).toBeHidden();
  });

  test("a new dive starts without the marker (AC-4)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(26, -0.3, 10, Math.PI / 2, 0.05));
    await boatAt(page, 40, 10);
    await expect(marker(page)).toBeVisible();
    await reef(page, (h) => h.newDive());
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    await expect(marker(page)).toBeHidden();
  });
});

test.describe("reduced motion", () => {
  test.use({ locale: "id-ID", reducedMotion: "reduce" });

  test("the '!' stays still when the device asks for less motion (AC-2)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(20, -0.3, 10, Math.PI / 2, 0.05));
    await boatAt(page, 50, 10);
    await expect(marker(page)).toBeVisible();
    expect(await page.locator(".dumper-marker-mark").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the marker and the line are in English (AC-1, AC-5)", async ({ page }) => {
    test.setTimeout(60_000);
    await startDive(page);
    await reef(page, (h) => h.placeRov(20, -0.3, 10, Math.PI / 2, 0.05));
    await boatAt(page, 50, 10);
    await expect(label(page)).toHaveText(/^!Dumping boat · \d+ m$/);
    await expect(page.locator(".goal-alert-hint")).toHaveText("Hold the Cutter (1), get close, aim at the hull and hold left click");
  });
});

for (const [name, device] of [
  ["a computer at 800x450", { viewport: { width: 800, height: 450 } }],
  ["a phone held sideways at 765x360", { ...phone, viewport: { width: 765, height: 360 } }],
] as const) {
  test.describe(`the mission card on ${name}`, () => {
    test.use({ ...device, locale: "id-ID" });

    test("warns of the dumping boat, and the sentence and the button can be reached inside the screen (AC-6)", async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto("/");
      await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
      await reef(page, (h) => h.cinematics(true));
      await page.getByRole("button", { name: /^Mulai$/ }).click();
      await expect.poll(() => reef(page, (h) => h.cinematic())).not.toBeNull();
      await reef(page, (h, a) => h.seekCinematic(a.seconds), { seconds: config.cinematic.opening.duration - 0.6 });
      await expect(page.locator(".mission-screen")).toBeVisible({ timeout: 15_000 });
      const sentence = page.locator(".mission-dumper");
      await expect(sentence).toHaveText("Sesekali kapal pembuang sampah datang. Balikkan dengan Cutter supaya sampahnya tidak terus bertambah.");
      const viewport = page.viewportSize()!;
      const panel = await box(page.locator(".panel.mission"));
      expect(panel.left).toBeGreaterThanOrEqual(0);
      expect(panel.top).toBeGreaterThanOrEqual(0);
      expect(panel.right).toBeLessThanOrEqual(viewport.width);
      expect(panel.bottom).toBeLessThanOrEqual(viewport.height);
      await sentence.scrollIntoViewIfNeeded();
      await expect(sentence).toBeInViewport();
      const start = page.getByRole("button", { name: "Mulai menyelam" });
      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeInViewport();
    });
  });
}
