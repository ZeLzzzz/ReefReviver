import { expect, test, type Page } from "@playwright/test";
import { config } from "../../src/config";

type Vec = [number, number, number];
type Spot = { landing: { x: number; z: number; yaw: number }; park: { x: number; z: number } } | null;
type Hook = {
  mode(): string;
  rovPosition(): Vec;
  placeRov(x: number, y: number, z: number, yaw: number, pitch: number): void;
  onLand(): boolean;
  inTransition(): boolean;
  walker(): { position: Vec; yaw: number } | null;
  placeWalker(x: number, z: number, yaw: number, pitch: number): void;
  subPosition(): Vec;
  cameraPosition(): Vec;
  ashoreSpot(x: number, z: number): Spot;
  water(): { background: number };
  newDive(): void;
};
const reef = <T>(page: Page, fn: (hook: Hook, arg: any) => T, arg?: unknown) =>
  page.evaluate(`(${fn.toString()})(window.__reef, ${JSON.stringify(arg ?? null)})`) as Promise<T>;

async function startDive(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Mulai|Start/ }).click();
  await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
  await expect(page.locator(".hud")).toBeVisible();
  // Under pointer lock, Playwright's mouse events carry movement equal to the cursor position; park it at (0, 0).
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

/** Puts the submarine a few metres off the beach at z, facing the land, where E goes ashore. */
async function nearTheBeach(page: Page, z = 0) {
  await reef(
    page,
    (h, a) => {
      let x = -100;
      while (!h.ashoreSpot(x, a.z)) x -= 0.5;
      h.placeRov(x - 3, -2, a.z, -Math.PI / 2, 0.1);
    },
    { z },
  );
}

async function goAshore(page: Page) {
  await nearTheBeach(page);
  await expect(page.locator(".message-prompt")).toHaveText("Tekan E untuk naik ke darat");
  await page.keyboard.press("KeyE");
  await expect.poll(() => reef(page, (h) => h.onLand() && !h.inTransition())).toBe(true);
}

const prompt = (page: Page) => page.locator(".message-prompt");

test.describe("Indonesian", () => {
  test.use({ locale: "id-ID" });

  test("near the beach E goes ashore: first person on the land, sky and sea above the water, no tools, the submarine on the map (AC-1, AC-2, AC-5, AC-6)", async ({ page }) => {
    await startDive(page);
    await expect(prompt(page)).toBeHidden();
    await page.screenshot({ path: "test-results/req-015-start.png" });
    await goAshore(page);

    // First person, eyes above the water and the beach; the sky instead of the water's fog.
    const eye = await reef(page, (h) => h.cameraPosition());
    const walker = (await reef(page, (h) => h.walker()))!;
    expect(eye[1]).toBeGreaterThan(0);
    expect(eye[1] - walker.position[1]).toBeCloseTo(1.6, 1);
    expect(Math.hypot(eye[0] - walker.position[0], eye[2] - walker.position[2])).toBeLessThan(0.01);
    expect((await reef(page, (h) => h.water())).background).toBe(config.land.sky);
    // The submarine floats at the surface, alongside the beach.
    const sub = await reef(page, (h) => h.subPosition());
    expect(sub[1]).toBeGreaterThan(-0.6);
    expect(sub[1]).toBeLessThan(0);
    // No tools on the land; goals, stats and the map stay, with the submarine's own mark.
    await expect(page.locator(".hud-tool")).toBeHidden();
    await expect(page.locator(".hud-goals")).toBeVisible();
    await expect(page.locator(".hud-stats")).toBeVisible();
    await expect(page.locator('.hud-minimap [data-kind="sub"]')).toBeVisible();
    await page.screenshot({ path: "test-results/req-015-ashore.png" });

    // W walks at about 4 m/s; Space does not lift the player; clicking and 1-4 do nothing.
    const before = (await reef(page, (h) => h.walker()))!.position;
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(1000);
    await page.keyboard.up("KeyW");
    const after = (await reef(page, (h) => h.walker()))!.position;
    const walked = Math.hypot(after[0] - before[0], after[2] - before[2]);
    expect(walked).toBeGreaterThan(2);
    expect(walked).toBeLessThan(6);
    await page.keyboard.down("Space");
    await page.waitForTimeout(500);
    await page.keyboard.up("Space");
    expect((await reef(page, (h) => h.walker()))!.position[1]).toBeCloseTo(after[1], 3);
    for (const key of ["Digit1", "Digit3", "Digit4"]) await page.keyboard.press(key);
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.up();
    await expect(page.locator(".hud-tool")).toBeHidden();
  });

  test("the sea stops a walking player at wading depth (AC-3)", async ({ page }) => {
    await startDive(page);
    await goAshore(page);
    const at = (await reef(page, (h) => h.walker()))!.position;
    // Facing the sea (east), walking for 6 s.
    await reef(page, (h, a) => h.placeWalker(a.x, a.z + 10, Math.PI / 2, 0), { x: at[0], z: at[2] });
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(6000);
    await page.keyboard.up("KeyW");
    const end = (await reef(page, (h) => h.walker()))!.position;
    expect(end[1]).toBeGreaterThanOrEqual(-0.5 - 1e-6);
    expect(end[1]).toBeLessThan(0.5);
    expect(await reef(page, (h) => h.onLand())).toBe(true);
  });

  test("next to the submarine E gets back in: third person behind the submarine, and it dives again (AC-4)", async ({ page }) => {
    await startDive(page);
    await goAshore(page);
    // Away from the submarine there is no prompt, and E does nothing.
    const at = (await reef(page, (h) => h.walker()))!.position;
    await reef(page, (h, a) => h.placeWalker(a.x - 6, a.z, -Math.PI / 2, 0), { x: at[0], z: at[2] });
    await expect(prompt(page)).toBeHidden();
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(800);
    expect(await reef(page, (h) => h.onLand())).toBe(true);

    // Walk to the water's edge by the submarine.
    await reef(page, (h, a) => h.placeWalker(a.x, a.z, Math.PI / 2, 0), { x: at[0], z: at[2] });
    await page.keyboard.down("KeyW");
    await expect(prompt(page)).toHaveText("Tekan E untuk masuk kapal selam mini", { timeout: 10_000 });
    await page.keyboard.up("KeyW");
    await page.keyboard.press("KeyE");
    await expect.poll(() => reef(page, (h) => !h.onLand() && !h.inTransition())).toBe(true);
    // Third person again (REQ-024: from the surface the camera is out of the water, above and behind the floating submarine).
    const eye = await reef(page, (h) => h.cameraPosition());
    const sub = await reef(page, (h) => h.rovPosition());
    expect(eye[1]).toBeGreaterThan(sub[1] + 1);
    expect(Math.hypot(eye[0] - sub[0], eye[2] - sub[2])).toBeGreaterThan(3);
    await expect(page.locator(".hud-tool")).toBeVisible();
    await expect(page.locator('.hud-minimap [data-kind="sub"]')).toBeHidden();
    const y = (await reef(page, (h) => h.rovPosition()))[1];
    await page.keyboard.down("ShiftLeft");
    await expect.poll(async () => (await reef(page, (h) => h.rovPosition()))[1], { timeout: 10_000 }).toBeLessThan(y - 0.5);
    await page.keyboard.up("ShiftLeft");
    await page.screenshot({ path: "test-results/req-015-aboard-again.png" });
  });

  test("E out in the bay does nothing; Esc pauses on the land; a new dive starts aboard at the start (AC-8)", async ({ page }) => {
    await startDive(page);
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(800);
    expect(await reef(page, (h) => h.onLand())).toBe(false);
    await expect(prompt(page)).toBeHidden();

    await goAshore(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("paused");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect.poll(() => reef(page, (h) => h.mode())).toBe("playing");
    expect(await reef(page, (h) => h.onLand())).toBe(true);

    await reef(page, (h) => h.newDive());
    expect(await reef(page, (h) => h.onLand())).toBe(false);
    const [x, , z] = await reef(page, (h) => h.rovPosition());
    expect(x).toBeCloseTo(-96, 0);
    expect(z).toBeCloseTo(8, 0);
  });
});

test.describe("English", () => {
  test.use({ locale: "en-US" });

  test("the prompts are in English (G-004)", async ({ page }) => {
    await startDive(page);
    await nearTheBeach(page);
    await expect(prompt(page)).toHaveText("Press E to go ashore");
  });
});
