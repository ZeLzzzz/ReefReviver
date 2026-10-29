import { devices, expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";
import { boardAgain, goAshore, standAtCounter } from "./ashore";

// REQ-030: playing on a phone or tablet with touch controls. The phone is Chromium as a Pixel 7 held sideways: its user agent
// makes the game a phone game, and the touches go in through the DevTools protocol, one or more fingers at a time.

type Vec = [number, number, number];
type Point = [number, number];

const reef = <T>(page: Page, fn: (hook: any, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

const mode = (page: Page) => reef(page, (h) => h.mode());
const position = (page: Page) => reef(page, (h) => h.rovPosition()) as Promise<Vec>;
const yaw = (page: Page) => reef(page, (h) => h.rovYaw()) as Promise<number>;
const hud = (page: Page) => reef(page, (h) => h.hud()) as Promise<any>;
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// `defaultBrowserType` cannot be set inside a describe; the project is Chromium already.
const { defaultBrowserType: _, ...phone } = devices["Pixel 7 landscape"];

/** Fingers on the screen: every call sends the whole set of fingers that are down after it, as a phone does. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const down = new Map<number, Point>();
  const send = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel") => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [...down].map(([id, [x, y]]) => ({ id, x, y })) });
  return {
    async press(id: number, at: Point) {
      down.set(id, at);
      await send("touchStart");
    },
    async move(id: number, at: Point) {
      down.set(id, at);
      await send("touchMove");
    },
    async lift(id: number) {
      down.delete(id);
      await send("touchEnd");
    },
    async cancel() {
      down.clear();
      await send("touchCancel");
    },
    async tap(at: Point) {
      await this.press(9, at);
      await this.lift(9);
    },
  };
}

async function centre(page: Page, selector: string): Promise<Point> {
  const box = (await page.locator(selector).boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function tapButton(page: Page, touch: Awaited<ReturnType<typeof fingers>>, selector: string) {
  await touch.tap(await centre(page, selector));
}

/** Opens the game on the phone and starts a dive (cinematics are off on the test server); the touch controls are up. */
async function dive(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^(Mulai|Start)$/ }).tap();
  await expect.poll(() => mode(page)).toBe("playing");
  await expect(page.locator(".touch-use")).toBeVisible();
  return { touch: await fingers(page), problems };
}

test.describe("phone, Indonesian", () => {
  test.use({ ...phone, locale: "id-ID" });

  test("opens on the title, full screen, the opening skipped with a tap, then the mission card (AC-1, AC-5)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Mulai" })).toBeVisible();
    await expect(page.getByText("Mainkan di komputer")).toHaveCount(0);
    await page.waitForFunction(() => typeof (window as any).__reef?.cinematics === "function");
    await reef(page, (h) => h.cinematics(true));
    const touch = await fingers(page);
    await tapButton(page, touch, "button.primary");
    await expect.poll(() => reef(page, (h) => h.cinematic())).not.toBeNull();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
    await expect(page.locator(".cine-skip")).toHaveText("Ketuk untuk melewati");
    await page.screenshot({ path: "test-results/req-030-opening.png" });

    await touch.tap([600, 200]);
    await expect(page.locator(".mission-screen")).toBeVisible();
    await expect(page.locator(".mission-controls")).toHaveText(/^Joystick bergerak · Geser layar mengarahkan/);
    await page.getByRole("button", { name: "Mulai menyelam" }).tap();
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(page.locator(".touch-use")).toBeVisible();
    // No cursor is locked on a phone.
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    await expect(page.locator(".tool-hint")).toHaveText("Tahan PAKAI untuk menyedot sampah");
  });

  test("the joystick moves, a drag steers, ▲ rises, and two fingers work at once (AC-2)", async ({ page }) => {
    const { touch, problems } = await dive(page);
    const stick = await centre(page, ".stick");

    // Forward: the knob pushed up.
    const start = await position(page);
    const heading = await yaw(page);
    await touch.press(1, stick);
    await touch.move(1, [stick[0], stick[1] - config.touch.stickRadius]);
    await expect.poll(async () => distance(await position(page), start), { timeout: 15_000 }).toBeGreaterThan(2);
    await touch.lift(1);
    const moved = await position(page);
    expect((moved[0] - start[0]) * Math.sin(heading) + (moved[2] - start[2]) * Math.cos(heading)).toBeGreaterThan(1.5);

    // A drag to the right on the right half turns right (the yaw goes down, as with the mouse).
    await touch.press(2, [600, 150]);
    await touch.move(2, [700, 150]);
    await touch.lift(2);
    await expect.poll(() => yaw(page)).toBeLessThan(heading - 0.3);

    // ▲ lifts the submarine.
    const low = (await position(page))[1];
    await touch.press(3, await centre(page, ".touch-rise"));
    await expect.poll(async () => (await position(page))[1], { timeout: 15_000 }).toBeGreaterThan(low + 0.5);
    await touch.lift(3);

    // Both thumbs at once: the joystick and the drag.
    const before = await position(page);
    const turned = await yaw(page);
    await touch.press(1, stick);
    await touch.press(2, [600, 150]);
    await touch.move(1, [stick[0], stick[1] - config.touch.stickRadius]);
    await touch.move(2, [500, 150]);
    await expect.poll(async () => distance(await position(page), before), { timeout: 15_000 }).toBeGreaterThan(1);
    expect(await yaw(page)).toBeGreaterThan(turned + 0.3);
    await touch.lift(2);
    await touch.lift(1);
    expect(problems).toEqual([]);
  });

  test("PAKAI sucks up trash, a slot picks a tool, E goes ashore, and on the land only the joystick and E are left (AC-3)", async ({ page }) => {
    const { touch } = await dive(page);
    await reef(page, (h) => h.aimAtTrash(2));
    await touch.press(1, await centre(page, ".touch-use"));
    await expect.poll(async () => (await hud(page)).tank, { timeout: 15_000 }).toBeGreaterThan(0);
    await touch.lift(1);

    await tapButton(page, touch, ".hotbar-slot >> nth=0");
    await expect.poll(async () => (await hud(page)).tool).toBe("cutter");
    await expect(page.locator(".hotbar-slot").first()).toHaveAttribute("aria-pressed", "true");
    await tapButton(page, touch, ".hotbar-slot >> nth=1");

    await reef(page, (h) => {
      let x = -100;
      while (!h.ashoreSpot(x, 8)) x -= 0.5;
      h.placeRov(x - 2, -2, 8, -Math.PI / 2, 0.1);
    });
    await expect.poll(async () => (await hud(page)).land?.canGoAshore).toBe(true);
    await expect(page.locator(".message-prompt")).toHaveText("Ketuk E untuk naik ke darat");
    await tapButton(page, touch, ".touch-interact");
    await expect.poll(() => reef(page, (h) => h.onLand() && !h.inTransition())).toBe(true);
    for (const hidden of [".touch-use", ".touch-rise", ".touch-dive", ".hotbar"]) await expect(page.locator(hidden)).toBeHidden();
    await expect(page.locator(".touch-interact")).toBeVisible();

    // The joystick walks.
    const walker = (await reef(page, (h) => h.walker().position)) as Vec;
    const stick = await centre(page, ".stick");
    await touch.press(1, stick);
    await touch.move(1, [stick[0], stick[1] - config.touch.stickRadius]);
    await expect.poll(async () => distance((await reef(page, (h) => h.walker().position)) as Vec, walker), { timeout: 15_000 }).toBeGreaterThan(1);
    await touch.lift(1);
    await page.screenshot({ path: "test-results/req-030-land.png" });
  });

  test("the pause, Logbook and sound buttons work like Esc, L and M (AC-4)", async ({ page }) => {
    const { touch } = await dive(page);
    await page.getByRole("button", { name: "Jeda" }).tap();
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
    await page.getByRole("button", { name: "Kontrol" }).tap();
    await expect(page.locator(".controls kbd").first()).toHaveText("Joystick");
    await page.getByRole("button", { name: "Kembali" }).tap();
    await page.getByRole("button", { name: "Lanjut" }).tap();
    await expect.poll(() => mode(page)).toBe("playing");

    await page.getByRole("button", { name: "Marine Logbook" }).tap();
    await expect(page.getByRole("dialog", { name: "Marine Logbook" })).toBeVisible();
    await expect(page.locator(".logbook-hint")).toHaveText("Ketuk Tutup untuk kembali bermain");
    await page.getByRole("button", { name: "Tutup" }).tap();
    await expect.poll(() => mode(page)).toBe("playing");

    await tapButton(page, touch, "[aria-label='Matikan suara']");
    await expect(page.locator(".sound-off")).toHaveText("Suara mati");
    await tapButton(page, touch, "[aria-label='Nyalakan suara']");
    await expect(page.locator(".sound-off")).toBeHidden();
  });

  test("held upright the game pauses under a message; turned back the pause menu is there; a cancelled touch lets go (AC-6)", async ({ page }) => {
    const { touch } = await dive(page);
    // A touch the browser cancels (e.g. a system gesture) leaves the submarine still.
    const stick = await centre(page, ".stick");
    await touch.press(1, stick);
    await touch.move(1, [stick[0], stick[1] - config.touch.stickRadius]);
    const start = await position(page);
    await expect.poll(async () => distance(await position(page), start), { timeout: 15_000 }).toBeGreaterThan(1);
    await touch.cancel();
    await page.waitForTimeout(2500);
    const stopped = await position(page);
    await page.waitForTimeout(1000);
    expect(distance(await position(page), stopped)).toBeLessThan(0.05);

    // The test window cannot change size in full screen; a phone turning leaves it too.
    await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
    const { width, height } = page.viewportSize()!;
    await page.setViewportSize({ width: height, height: width });
    await expect(page.getByRole("alertdialog", { name: "Putar perangkat ke posisi mendatar" })).toBeVisible();
    await expect.poll(() => mode(page)).toBe("paused");
    await page.screenshot({ path: "test-results/req-030-portrait.png" });
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Jeda" })).toBeVisible();
    await page.getByRole("button", { name: "Lanjut" }).tap();
    await expect.poll(() => mode(page)).toBe("playing");
  });

  test("draws fewer pixels and no antialiasing (AC-7)", async ({ page }) => {
    await dive(page);
    expect(await reef(page, (h) => h.render())).toEqual({ pixelRatio: config.touch.pixelRatio, antialias: false });
  });
});

test.describe("phone, English", () => {
  test.use({ ...phone, locale: "en-US" });

  test("names the touch controls in English (AC-5)", async ({ page }) => {
    await dive(page);
    await expect(page.locator(".touch-use")).toHaveText("USE");
    await expect(page.locator(".tool-hint")).toHaveText("Hold USE to suck up trash");
  });
});

// AC-4: from the smallest phone to a tablet, no touch control covers the goals, the minimap, the stats or a message, with the
// goals at their longest (Phase 1 and Phase 2, after the first deposit).
for (const size of [
  { width: 640, height: 360 },
  { width: 1366, height: 1024 },
]) {
  test.describe(`phone ${size.width}×${size.height}`, () => {
    test.use({ ...phone, viewport: size, locale: "id-ID" });

    test("no touch control covers a HUD panel or a message (AC-4)", async ({ page }) => {
      const { touch } = await dive(page);
      await reef(page, (h) => h.aimAtTrash(2));
      await touch.press(1, await centre(page, ".touch-use"));
      await expect.poll(async () => (await hud(page)).tank, { timeout: 15_000 }).toBeGreaterThan(0);
      await touch.lift(1);
      await goAshore(page);
      await standAtCounter(page);
      await page.keyboard.press("KeyE");
      await expect.poll(async () => (await hud(page)).reef?.phase2?.length ?? 0).toBeGreaterThan(0);
      await boardAgain(page);
      await expect(page.locator(".goal-list-phase2")).toBeVisible();
      const overlaps = await page.evaluate(() => {
        const shown = (el: Element) => (el as HTMLElement).offsetParent !== null && getComputedStyle(el).visibility !== "hidden";
        const panels = [...document.querySelectorAll(".hud-goals, .hud-minimap, .hud-stats, .hud-tool, .message")].filter(shown);
        const controls = [...document.querySelectorAll(".stick, .touch-control, .touch-menu-button")].filter(shown);
        const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return panels.flatMap((p) => controls.filter((c) => hit(p.getBoundingClientRect(), c.getBoundingClientRect())).map((c) => `${p.className} / ${c.className}`));
      });
      expect(overlaps).toEqual([]);
      await page.screenshot({ path: `test-results/req-030-${size.width}x${size.height}.png` });
    });
  });
}

test.describe("laptop with a touchscreen (AC-8)", () => {
  test.use({ hasTouch: true, locale: "id-ID" });

  test("keeps the keyboard and mouse, the locked cursor and the keyboard texts", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Mulai" }).click();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe("scene");
    await expect.poll(() => mode(page)).toBe("playing");
    await expect(page.locator(".touch")).toHaveCount(0);
    await expect(page.locator(".tool-hint")).toHaveText("Tahan klik kiri untuk menyedot sampah");
    expect(await reef(page, (h) => h.render())).toEqual({ pixelRatio: 1, antialias: true });
  });
});
